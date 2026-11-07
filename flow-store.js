/*
 * flow-store.js: file access and edit operations for flow-animator files.
 * Used by mcp-server.js. Node only, no dependencies. Validation is delegated
 * to flow-core.js so the server and the viewer always agree.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var Core = require('./flow-core.js');
var Edits = require('./src/flow-library/apply-edit/apply-edit.js');

var SUFFIX = '.flow.json';

function Store(dir) {
  this.dir = path.resolve(dir);
}

var fail = Edits.fail;
var ops = Edits.ops;

Store.prototype.resolve = function (name) {
  if (typeof name !== 'string' || !name) throw fail('"file" must be a non-empty string');
  if (name.slice(-SUFFIX.length) !== SUFFIX) throw fail('file name must end in ' + SUFFIX);
  if (/[\\/\0]/.test(name) || name.charAt(0) === '.') throw fail('file name must be a plain name without folders, e.g. "orders.flow.json"');
  var full = path.join(this.dir, name);
  if (path.dirname(full) !== this.dir) throw fail('file name escapes the flow directory');
  return full;
};

Store.prototype.list = function () {
  var self = this;
  if (!fs.existsSync(this.dir)) return [];
  return fs.readdirSync(this.dir).filter(function (n) {
    return n.slice(-SUFFIX.length) === SUFFIX && n.charAt(0) !== '.';
  }).sort().map(function (n) {
    var out = { file: n };
    try {
      var d = JSON.parse(fs.readFileSync(path.join(self.dir, n), 'utf8'));
      out.title = d.title || null;
      out.nodes = Array.isArray(d.nodes) ? d.nodes.length : 0;
      out.steps = Array.isArray(d.steps) ? d.steps.length : 0;
    } catch (e) { out.error = 'not valid JSON'; }
    return out;
  });
};

Store.prototype.exists = function (name) { return fs.existsSync(this.resolve(name)); };

Store.prototype.read = function (name) {
  var full = this.resolve(name);
  if (!fs.existsSync(full)) throw fail('no such flow: ' + name);
  try { return JSON.parse(fs.readFileSync(full, 'utf8')); }
  catch (e) { throw fail(name + ' is not valid JSON: ' + e.message); }
};

/* Validate, then write atomically. Never writes an invalid document. */
Store.prototype.write = function (name, doc) {
  var full = this.resolve(name);
  var res = Core.loadDoc(doc);
  if (!res.ok) return { ok: false, errors: res.errors, warnings: res.warnings };
  fs.mkdirSync(this.dir, { recursive: true });
  var tmp = full + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  fs.renameSync(tmp, full);
  return { ok: true, errors: [], warnings: res.warnings, stats: stats(res) };
};

Store.prototype.remove = function (name) {
  var full = this.resolve(name);
  if (!fs.existsSync(full)) throw fail('no such flow: ' + name);
  fs.unlinkSync(full);
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
Store.prototype.edit = function (name, op, args) {
  if (!ops[op]) throw fail('unknown operation ' + op);
  var doc = this.read(name);
  ops[op](doc, args || {});
  var r = this.write(name, doc);
  if (!r.ok) r.note = 'Change rejected; the file was not modified.';
  return r;
};

module.exports = { Store: Store, ops: ops, validate: validate, fail: fail, SUFFIX: SUFFIX };
