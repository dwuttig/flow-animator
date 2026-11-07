/*
 * flow-store.js: file access and edit operations for flow-animator files.
 * Used by mcp-server.js. Node only, no dependencies. Validation is delegated
 * to flow-core.js so the server and the viewer always agree.
 */
'use strict';
var fs = require('fs');
var crypto = require('crypto');
var path = require('path');
var Core = require('./flow-core.js');
var Edits = require('./src/flow-library/apply-edit/apply-edit.js');

var SUFFIX = '.flow.json';

function Store(dir) {
  this.dir = path.resolve(dir);
}

var fail = Edits.fail;
var ops = Edits.ops;

/* A Flow name is a bare unique name such as "orders". A trailing ".flow.json" is accepted and
 * stripped, so older names, links and clients keep working. Returns the bare name. */
var NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
function bareName(name) {
  if (typeof name !== 'string' || !name) throw fail('flow name must be a non-empty string');
  return name.slice(-SUFFIX.length) === SUFFIX ? name.slice(0, -SUFFIX.length) : name;
}
function validName(name) {
  var n = bareName(name);
  if (!NAME_RE.test(n) || /\.json$/i.test(n)) throw fail('flow name must be 1-100 letters, digits, dot, dash or underscore, starting with a letter or digit, e.g. "orders"');
  return n;
}

Store.prototype.resolve = function (name) {
  return path.join(this.dir, validName(name) + SUFFIX);
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
      var d = JSON.parse(raw);
      out.title = d.title || null;
      out.nodes = Array.isArray(d.nodes) ? d.nodes.length : 0;
      out.steps = Array.isArray(d.steps) ? d.steps.length : 0;
    } catch (e) { out.error = 'not valid JSON'; }
    return out;
  });
};

/* Revision: first 16 hex chars of the SHA-256 of the file bytes. */
function revisionOf(raw) { return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16); }

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

/* Check a precondition: opts.ifMatch (revision) or opts.ifNoneMatch === '*'. */
Store.prototype.checkPrecondition = function (name, opts) {
  opts = opts || {};
  var cur = this.revision(name);
  if (opts.ifNoneMatch === '*' && cur !== null) return { ok: false, conflict: true, revision: cur };
  if (opts.ifMatch !== undefined && opts.ifMatch !== null && opts.ifMatch !== cur) return { ok: false, conflict: true, revision: cur };
  return null;
};

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
  var res = Core.loadDoc(doc);
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

function stats(res) {
  return {
    nodes: res.model.nodes.length, steps: res.model.steps.length,
    beats: res.model.beats.length, groups: res.model.groups.length
  };
}

function validate(doc) {
  var res = Core.loadDoc(doc);
  return { ok: res.ok, errors: res.errors, warnings: res.warnings, stats: res.ok ? stats(res) : null };
}

/* Load, apply one operation, validate, write only if valid. */
Store.prototype.edit = function (name, op, args, opts) {
  if (!ops[op]) throw fail('unknown operation ' + op);
  var doc = this.read(name);
  ops[op](doc, args || {});
  var r = this.write(name, doc, opts);
  if (!r.ok) r.note = 'Change rejected; the file was not modified.';
  if (r.conflict) r.error = 'conflict: the flow changed since revision ' + (opts && opts.ifMatch) + '; read it again.';
  return r;
};

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
