/*
 * sqlite-store: Flow store backed by one SQLite file (Node's built-in node:sqlite).
 * Same interface as Store in flow-store.js; precondition check and write happen
 * in one transaction. Node only, no dependencies.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var K = require('../store-core/store-core.js');
var FlowName = require('../flow-name/flow-name.js');

var HISTORY = 50;
var FLOWS = 'flows (name TEXT PRIMARY KEY COLLATE NOCASE, body TEXT NOT NULL, revision TEXT NOT NULL, modified_at TEXT NOT NULL, title TEXT, nodes INTEGER, steps INTEGER)';

function SqliteStore(file) {
  var DatabaseSync = require('node:sqlite').DatabaseSync;
  this.file = path.resolve(file);
  this.dir = this.file; // what servers log as the storage location
  this.stmts = {};
  fs.mkdirSync(path.dirname(this.file), { recursive: true });
  this.db = new DatabaseSync(this.file);
  this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  this.db.exec('CREATE TABLE IF NOT EXISTS ' + FLOWS + ';' +
    'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  migrateNames(this.db);
  migrateColumns(this.db);
  migrateHistory(this.db);
}

/* [title, nodes, steps] of a stored body for the list columns; nulls if it is not valid JSON. */
function columnsOf(body) {
  try { var s = K.summary(JSON.parse(body)); return [s.title, s.nodes, s.steps]; }
  catch (e) { return [null, null, null]; }
}

/* Databases from before the list columns: add title, nodes, steps and fill them, in one transaction. */
function migrateColumns(db) {
  function missing() {
    var have = db.prepare('PRAGMA table_info(flows)').all().map(function (c) { return c.name; });
    return ['title TEXT', 'nodes INTEGER', 'steps INTEGER'].filter(function (c) { return have.indexOf(c.split(' ')[0]) < 0; });
  }
  if (!missing().length) return;
  transaction(db, function () {
    var add = missing();
    if (!add.length) return;
    add.forEach(function (c) { db.exec('ALTER TABLE flows ADD COLUMN ' + c); });
    var up = db.prepare('UPDATE flows SET title = ?, nodes = ?, steps = ? WHERE name = ?');
    db.prepare('SELECT name, body FROM flows').all().forEach(function (r) {
      var c = columnsOf(r.body);
      up.run(c[0], c[1], c[2], r.name);
    });
  });
}

/* Create the Revision history table once, seeded with the current revision of every flow. */
function migrateHistory(db) {
  function exists() { return !!db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'flow_history'").get(); }
  if (exists()) return;
  transaction(db, function () {
    if (exists()) return;
    db.exec('CREATE TABLE flow_history (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE, revision TEXT NOT NULL, body TEXT NOT NULL, modified_at TEXT NOT NULL);' +
      'CREATE INDEX flow_history_name ON flow_history (name, id);' +
      'INSERT INTO flow_history (name, revision, body, modified_at) SELECT name, revision, body, modified_at FROM flows ORDER BY name;');
  });
}

/* Older databases stored names with ".flow.json" and compared case-sensitively. Rebuild once:
 * bare names, case-insensitive unique (the first of two clashing names wins, the other is kept as name-2 etc.). */
function migrateNames(db) {
  var sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'flows'").get().sql;
  var rows = db.prepare('SELECT name, body, revision, modified_at FROM flows ORDER BY name').all();
  var legacy = sql.indexOf('NOCASE') < 0 || rows.some(function (r) { return FlowName.bare(r.name) !== r.name; });
  if (!legacy) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('ALTER TABLE flows RENAME TO flows_old');
    db.exec('CREATE TABLE ' + FLOWS);
    var ins = db.prepare('INSERT INTO flows (name, body, revision, modified_at, title, nodes, steps) VALUES (?, ?, ?, ?, ?, ?, ?)');
    var has = db.prepare('SELECT 1 AS x FROM flows WHERE name = ?');
    rows.forEach(function (r) {
      var n = FlowName.bare(r.name), c = n, i = 2, cols = columnsOf(r.body);
      while (has.get(c)) c = n + '-' + (i++);
      ins.run(c, r.body, r.revision, r.modified_at, cols[0], cols[1], cols[2]);
    });
    db.exec('DROP TABLE flows_old');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

SqliteStore.prototype.resolve = K.validName;
SqliteStore.prototype.checkPrecondition = function (name, opts) { return K.checkPrecondition(this, name, opts); };
SqliteStore.prototype.edit = function (name, op, args, opts) { return K.edit(this, name, op, args, opts); };

/* Prepared statement for sql, cached on the store. */
function q(st, sql) { return st.stmts[sql] || (st.stmts[sql] = st.db.prepare(sql)); }

function row(st, name) { return q(st, 'SELECT body, revision FROM flows WHERE name = ?').get(name); }

SqliteStore.prototype.getMeta = function (key) {
  var r = q(this, 'SELECT value FROM meta WHERE key = ?').get(key);
  return r ? r.value : null;
};
SqliteStore.prototype.setMeta = function (key, value) {
  q(this, 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
};

SqliteStore.prototype.list = function () {
  return q(this, 'SELECT name, revision, modified_at, title, nodes, steps FROM flows ORDER BY name COLLATE NOCASE').all().map(function (r) {
    var out = { file: r.name, revision: r.revision, modifiedAt: r.modified_at };
    if (r.nodes === null) out.error = 'not valid JSON';
    else { out.title = r.title; out.nodes = r.nodes; out.steps = r.steps; }
    return out;
  });
};

/* Stored Revisions of a flow, newest first: [{ revision, modifiedAt }] (at most HISTORY). */
SqliteStore.prototype.revisions = function (name) {
  name = this.resolve(name);
  if (!row(this, name)) throw K.fail('no such flow: ' + name);
  return q(this, 'SELECT revision, modified_at FROM flow_history WHERE name = ? ORDER BY id DESC').all(name).map(function (r) {
    return { revision: r.revision, modifiedAt: r.modified_at };
  });
};

/* { doc, revision, text } of a current or historical Revision; a userError if it is not stored. */
SqliteStore.prototype.readRevision = function (name, rev) {
  name = this.resolve(name);
  var r = row(this, name);
  if (r && r.revision !== rev) r = q(this, 'SELECT body, revision FROM flow_history WHERE name = ? AND revision = ? ORDER BY id DESC LIMIT 1').get(name, String(rev));
  if (!r) throw K.fail('no such revision of ' + name + ': ' + rev);
  try { return { doc: JSON.parse(r.body), revision: r.revision, text: r.body }; }
  catch (e) { throw K.fail(name + ' is not valid JSON: ' + e.message); }
};

SqliteStore.prototype.revision = function (name) {
  name = this.resolve(name);
  var r = row(this, name);
  return r ? r.revision : null;
};

SqliteStore.prototype.exists = function (name) { name = this.resolve(name); return !!row(this, name); };

SqliteStore.prototype.readWithRevision = function (name) {
  name = this.resolve(name);
  var r = row(this, name);
  if (!r) throw K.fail('no such flow: ' + name);
  try { return { doc: JSON.parse(r.body), revision: r.revision, text: r.body }; }
  catch (e) { throw K.fail(name + ' is not valid JSON: ' + e.message); }
};

SqliteStore.prototype.read = function (name) { return this.readWithRevision(name).doc; };

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { var r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

SqliteStore.prototype.write = function (name, doc, opts) {
  name = this.resolve(name);
  var res = K.loadDoc(doc);
  if (!res.ok) return { ok: false, errors: res.errors, warnings: res.warnings };
  var self = this, text = JSON.stringify(doc, null, 2) + '\n', rev = K.revisionOf(text), sum = K.summary(doc);
  return transaction(this.db, function () {
    var pre = self.checkPrecondition(name, opts);
    if (pre) return pre;
    var existed = !!row(self, name), now = new Date().toISOString();
    q(self, 'INSERT OR REPLACE INTO flows (name, body, revision, modified_at, title, nodes, steps) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(name, text, rev, now, sum.title, sum.nodes, sum.steps);
    q(self, 'DELETE FROM flow_history WHERE name = ? AND revision = ?').run(name, rev);
    q(self, 'INSERT INTO flow_history (name, revision, body, modified_at) VALUES (?, ?, ?, ?)').run(name, rev, text, now);
    q(self, 'DELETE FROM flow_history WHERE name = ? AND id NOT IN (SELECT id FROM flow_history WHERE name = ? ORDER BY id DESC LIMIT ' + HISTORY + ')').run(name, name);
    return { ok: true, errors: [], warnings: res.warnings, stats: K.stats(res), revision: rev, created: !existed };
  });
};

SqliteStore.prototype.remove = function (name, opts) {
  name = this.resolve(name);
  var self = this;
  return transaction(this.db, function () {
    if (!row(self, name)) throw K.fail('no such flow: ' + name);
    var pre = self.checkPrecondition(name, opts);
    if (pre) return pre;
    q(self, 'DELETE FROM flows WHERE name = ?').run(name);
    q(self, 'DELETE FROM flow_history WHERE name = ?').run(name);
    return { ok: true };
  });
};

/* Import *.flow.json files from a folder. Existing names are kept, invalid files skipped.
 * Returns { imported:[names], existing:[names], skipped:[{file, reason}] }. */
SqliteStore.prototype.importDir = function (dir) {
  var out = { imported: [], existing: [], skipped: [] };
  fs.readdirSync(dir).filter(function (n) {
    return n.slice(-FlowName.SUFFIX.length) === FlowName.SUFFIX && n.charAt(0) !== '.';
  }).sort().forEach(function (n) {
    var bare = n.slice(0, -FlowName.SUFFIX.length);
    if (this.exists(bare)) return out.existing.push(bare);
    var doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); }
    catch (e) { return out.skipped.push({ file: n, reason: 'not valid JSON' }); }
    var w;
    try { w = this.write(bare, doc, { ifNoneMatch: '*' }); }
    catch (e) { if (e.userError) return out.skipped.push({ file: n, reason: e.message }); throw e; }
    if (w.ok) out.imported.push(bare);
    else out.skipped.push({ file: n, reason: 'invalid flow: ' + (w.errors[0] && (w.errors[0].message || w.errors[0])) });
  }, this);
  return out;
};

SqliteStore.prototype.close = function () { this.db.close(); };

module.exports = { SqliteStore: SqliteStore };
