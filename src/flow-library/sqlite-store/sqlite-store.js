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
  this.db.exec('CREATE TABLE IF NOT EXISTS flows (name TEXT PRIMARY KEY, body TEXT NOT NULL, revision TEXT NOT NULL, modified_at TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
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
  return this.db.prepare('SELECT name, body, revision, modified_at FROM flows ORDER BY name').all().map(function (r) {
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
  this.resolve(name);
  var r = row(this, name);
  return r ? r.revision : null;
};

SqliteStore.prototype.exists = function (name) { this.resolve(name); return !!row(this, name); };

SqliteStore.prototype.readWithRevision = function (name) {
  this.resolve(name);
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
  this.resolve(name);
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
  this.resolve(name);
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
    if (this.exists(n)) return out.existing.push(n);
    var doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); }
    catch (e) { return out.skipped.push({ file: n, reason: 'not valid JSON' }); }
    var w = this.write(n, doc, { ifNoneMatch: '*' });
    if (w.ok) out.imported.push(n);
    else out.skipped.push({ file: n, reason: 'invalid flow: ' + (w.errors[0] && (w.errors[0].message || w.errors[0])) });
  }, this);
  return out;
};

SqliteStore.prototype.close = function () { this.db.close(); };

module.exports = { SqliteStore: SqliteStore };
