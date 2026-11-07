/*
 * sqlite-store: Flow store backed by one SQLite file (Node's built-in node:sqlite).
 * Same interface as Store in flow-store.js; precondition check and write happen
 * in one transaction. Node only, no dependencies.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var Core = require('../../../flow-core.js');
var Base = require('../../../flow-store.js');

function SqliteStore(file) {
  var DatabaseSync = require('node:sqlite').DatabaseSync;
  this.file = path.resolve(file);
  this.dir = this.file; // what servers log as the storage location
  fs.mkdirSync(path.dirname(this.file), { recursive: true });
  this.db = new DatabaseSync(this.file);
  this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  this.db.exec('CREATE TABLE IF NOT EXISTS flows (name TEXT PRIMARY KEY COLLATE NOCASE, body TEXT NOT NULL, revision TEXT NOT NULL, modified_at TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  migrateNames(this.db);
}

/* Older databases stored names with ".flow.json" and compared case-sensitively. Rebuild once:
 * bare names, case-insensitive unique (the first of two clashing names wins, the other is kept as name-2 etc.). */
function migrateNames(db) {
  var sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'flows'").get().sql;
  var rows = db.prepare('SELECT name, body, revision, modified_at FROM flows ORDER BY name').all();
  var legacy = sql.indexOf('NOCASE') < 0 || rows.some(function (r) { return r.name.slice(-Base.SUFFIX.length) === Base.SUFFIX; });
  if (!legacy) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('ALTER TABLE flows RENAME TO flows_old');
    db.exec('CREATE TABLE flows (name TEXT PRIMARY KEY COLLATE NOCASE, body TEXT NOT NULL, revision TEXT NOT NULL, modified_at TEXT NOT NULL)');
    var ins = db.prepare('INSERT INTO flows (name, body, revision, modified_at) VALUES (?, ?, ?, ?)');
    var has = db.prepare('SELECT 1 AS x FROM flows WHERE name = ?');
    rows.forEach(function (r) {
      var n = r.name.slice(-Base.SUFFIX.length) === Base.SUFFIX ? r.name.slice(0, -Base.SUFFIX.length) : r.name, c = n, i = 2;
      while (has.get(c)) c = n + '-' + (i++);
      ins.run(c, r.body, r.revision, r.modified_at);
    });
    db.exec('DROP TABLE flows_old');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

SqliteStore.prototype.resolve = Base.validName;
SqliteStore.prototype.checkPrecondition = Base.Store.prototype.checkPrecondition;
SqliteStore.prototype.edit = Base.Store.prototype.edit;

function row(st, name) { return st.db.prepare('SELECT body, revision FROM flows WHERE name = ?').get(name); }

SqliteStore.prototype.getMeta = function (key) {
  var r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return r ? r.value : null;
};
SqliteStore.prototype.setMeta = function (key, value) {
  this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
};

SqliteStore.prototype.list = function () {
  return this.db.prepare('SELECT name, body, revision, modified_at FROM flows ORDER BY name COLLATE NOCASE').all().map(function (r) {
    var out = { file: r.name, revision: r.revision, modifiedAt: r.modified_at };
    try {
      var d = JSON.parse(r.body);
      out.title = d.title || null;
      out.nodes = Array.isArray(d.nodes) ? d.nodes.length : 0;
      out.steps = Array.isArray(d.steps) ? d.steps.length : 0;
    } catch (e) { out.error = 'not valid JSON'; }
    return out;
  });
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
  if (!r) throw Base.fail('no such flow: ' + name);
  try { return { doc: JSON.parse(r.body), revision: r.revision, text: r.body }; }
  catch (e) { throw Base.fail(name + ' is not valid JSON: ' + e.message); }
};

SqliteStore.prototype.read = function (name) { return this.readWithRevision(name).doc; };

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { var r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

SqliteStore.prototype.write = function (name, doc, opts) {
  name = this.resolve(name);
  var res = Core.loadDoc(doc);
  if (!res.ok) return { ok: false, errors: res.errors, warnings: res.warnings };
  var self = this, text = JSON.stringify(doc, null, 2) + '\n', rev = Base.revisionOf(text);
  return transaction(this.db, function () {
    var pre = self.checkPrecondition(name, opts);
    if (pre) return pre;
    var existed = !!row(self, name);
    self.db.prepare('INSERT OR REPLACE INTO flows (name, body, revision, modified_at) VALUES (?, ?, ?, ?)')
      .run(name, text, rev, new Date().toISOString());
    return { ok: true, errors: [], warnings: res.warnings, stats: Base.stats(res), revision: rev, created: !existed };
  });
};

SqliteStore.prototype.remove = function (name, opts) {
  name = this.resolve(name);
  var self = this;
  return transaction(this.db, function () {
    if (!row(self, name)) throw Base.fail('no such flow: ' + name);
    var pre = self.checkPrecondition(name, opts);
    if (pre) return pre;
    self.db.prepare('DELETE FROM flows WHERE name = ?').run(name);
    return { ok: true };
  });
};

/* Import *.flow.json files from a folder. Existing names are kept, invalid files skipped.
 * Returns { imported:[names], existing:[names], skipped:[{file, reason}] }. */
SqliteStore.prototype.importDir = function (dir) {
  var out = { imported: [], existing: [], skipped: [] };
  fs.readdirSync(dir).filter(function (n) {
    return n.slice(-Base.SUFFIX.length) === Base.SUFFIX && n.charAt(0) !== '.';
  }).sort().forEach(function (n) {
    var bare = n.slice(0, -Base.SUFFIX.length);
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
