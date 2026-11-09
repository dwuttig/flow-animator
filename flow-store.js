/*
 * flow-store.js: file access and edit operations for flow-animator files.
 * Used by mcp-server.js. Node only, no dependencies. Validation is delegated
 * to flow-core.js so the server and the viewer always agree.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var K = require('./src/flow-library/store-core/store-core.js');

var SUFFIX = K.SUFFIX;

function Store(dir) {
  this.dir = path.resolve(dir);
}

var fail = K.fail;
var ops = K.ops;
var revisionOf = K.revisionOf;
var validName = K.validName;
var stats = K.stats;
var validate = K.validate;

/* Path of a flow file. An existing file whose name differs only in case is reused, so names are unique ignoring case. */
Store.prototype.resolve = function (name) {
  var file = validName(name) + SUFFIX, full = path.join(this.dir, file);
  if (fs.existsSync(full) || !fs.existsSync(this.dir)) return full;
  var low = file.toLowerCase();
  var hit = fs.readdirSync(this.dir).filter(function (n) { return n.toLowerCase() === low; })[0];
  return hit ? path.join(this.dir, hit) : full;
};

Store.prototype.list = function () {
  var self = this;
  if (!fs.existsSync(this.dir)) return [];
  return fs.readdirSync(this.dir).filter(function (n) {
    return n.slice(-SUFFIX.length) === SUFFIX && n.charAt(0) !== '.';
  }).sort().map(function (n) {
    var out = { file: n.slice(0, -SUFFIX.length) };
    try {
      var full = path.join(self.dir, n), raw = fs.readFileSync(full, 'utf8');
      out.revision = revisionOf(raw);
      out.modifiedAt = fs.statSync(full).mtime.toISOString();
      Object.assign(out, K.summary(JSON.parse(raw)));
    } catch (e) { out.error = 'not valid JSON'; }
    return out;
  });
};

/* Current revision of a stored flow, or null if it does not exist. */
Store.prototype.revision = function (name) {
  var full = this.resolve(name);
  if (!fs.existsSync(full)) return null;
  return revisionOf(fs.readFileSync(full));
};

/* Read the document with its revision: { doc, revision, text }. */
Store.prototype.readWithRevision = function (name) {
  var full = this.resolve(name);
  if (!fs.existsSync(full)) throw fail('no such flow: ' + name);
  var raw = fs.readFileSync(full, 'utf8');
  try { return { doc: JSON.parse(raw), revision: revisionOf(raw), text: raw }; }
  catch (e) { throw fail(name + ' is not valid JSON: ' + e.message); }
};

/* A folder keeps no history: the current revision only, [{ revision, modifiedAt }]. */
Store.prototype.revisions = function (name) {
  var full = this.resolve(name);
  if (!fs.existsSync(full)) throw fail('no such flow: ' + name);
  return [{ revision: revisionOf(fs.readFileSync(full)), modifiedAt: fs.statSync(full).mtime.toISOString() }];
};

/* { doc, revision, text } of a revision; only the current one exists in a folder. */
Store.prototype.readRevision = function (name, rev) {
  var r = this.readWithRevision(name);
  if (r.revision !== rev) throw fail('no such revision of ' + name + ': ' + rev);
  return r;
};

/* Check a precondition: opts.ifMatch (revision) or opts.ifNoneMatch === '*'. */
Store.prototype.checkPrecondition = function (name, opts) { return K.checkPrecondition(this, name, opts); };

Store.prototype.exists = function (name) { return fs.existsSync(this.resolve(name)); };

Store.prototype.read = function (name) {
  var full = this.resolve(name);
  if (!fs.existsSync(full)) throw fail('no such flow: ' + name);
  try { return JSON.parse(fs.readFileSync(full, 'utf8')); }
  catch (e) { throw fail(name + ' is not valid JSON: ' + e.message); }
};

/* Validate, then write atomically. Never writes an invalid document.
 * opts.ifMatch / opts.ifNoneMatch: optional preconditions (see checkPrecondition);
 * a failed one returns { ok:false, conflict:true, revision } and writes nothing. */
Store.prototype.write = function (name, doc, opts) {
  var full = this.resolve(name);
  var res = K.loadDoc(doc);
  if (!res.ok) return { ok: false, errors: res.errors, warnings: res.warnings };
  var pre = this.checkPrecondition(name, opts);
  if (pre) return pre;
  var existed = fs.existsSync(full);
  fs.mkdirSync(this.dir, { recursive: true });
  var tmp = full + '.' + process.pid + '.tmp';
  var text = JSON.stringify(doc, null, 2) + '\n';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, full);
  return { ok: true, errors: [], warnings: res.warnings, stats: stats(res), revision: revisionOf(text), created: !existed };
};

/* Remove a flow. opts.ifMatch as for write; returns { ok:false, conflict } on mismatch. */
Store.prototype.remove = function (name, opts) {
  var full = this.resolve(name);
  if (!fs.existsSync(full)) throw fail('no such flow: ' + name);
  var pre = this.checkPrecondition(name, opts);
  if (pre) return pre;
  fs.unlinkSync(full);
  return { ok: true };
};

/* Load, apply one operation, validate, write only if valid. */
Store.prototype.edit = function (name, op, args, opts) { return K.edit(this, name, op, args, opts); };

/* Choose the backend from environment variables (see docs/features/sqlite-storage.md):
 * FLOW_STORE=sqlite (default) | files, FLOW_DIR, FLOW_DB, FLOW_IMPORT=0 to skip the first-start import. */
function openStore(env) {
  env = env || process.env;
  var dir = env.FLOW_DIR || path.join(__dirname, 'flows');
  var kind = env.FLOW_STORE || 'sqlite';
  if (kind === 'files') return new Store(dir);
  if (kind !== 'sqlite') throw new Error('FLOW_STORE must be "sqlite" or "files", got "' + kind + '"');
  var SQ = require('./src/flow-library/sqlite-store/sqlite-store.js');
  var st = new SQ.SqliteStore(env.FLOW_DB || path.join(dir, 'flows.db'));
  if (env.FLOW_IMPORT !== '0' && !st.getMeta('imported')) {
    st.setMeta('imported', new Date().toISOString());
    if (fs.existsSync(dir)) {
      var r = st.importDir(dir);
      if (r.imported.length || r.skipped.length) {
        console.error('flow-animator: imported ' + r.imported.length + ' flow(s) from ' + dir + ' into ' + st.file +
          (r.skipped.length ? '; skipped ' + r.skipped.map(function (k) { return k.file + ' (' + k.reason + ')'; }).join(', ') : ''));
      }
    }
  }
  return st;
}

module.exports = { revisionOf: revisionOf, Store: Store, openStore: openStore, validName: validName, stats: stats, ops: ops, validate: validate, fail: fail, SUFFIX: SUFFIX };
