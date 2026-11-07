/*
 * flow-store.js: file access and edit operations for flow-animator files.
 * Used by mcp-server.js. Node only, no dependencies. Validation is delegated
 * to flow-core.js so the server and the viewer always agree.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var Core = require('./flow-core.js');

var SUFFIX = '.flow.json';

function Store(dir) {
  this.dir = path.resolve(dir);
}

function fail(msg) { var e = new Error(msg); e.userError = true; return e; }

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

/* ---------- edit operations: mutate a document in place, throw on misuse ---------- */

function list(doc, key) { if (!Array.isArray(doc[key])) doc[key] = []; return doc[key]; }
function findIdx(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return i; return -1; }
function clean(o) { Object.keys(o).forEach(function (k) { if (o[k] === undefined) delete o[k]; }); return o; }

function checkIdx(arr, i, what) {
  if (typeof i !== 'number' || Math.floor(i) !== i || i < 0 || i >= arr.length)
    throw fail(what + ' index ' + i + ' out of range (0.. ' + (arr.length - 1) + ')');
}

/* patch: fields set to null are removed, others replaced. */
function patch(target, fields) {
  Object.keys(fields).forEach(function (k) {
    if (fields[k] === null) delete target[k]; else if (fields[k] !== undefined) target[k] = fields[k];
  });
}

var ops = {
  set_meta: function (doc, a) {
    patch(doc, { title: a.title, description: a.description });
    if (a.direction !== undefined) {
      if (a.direction === null) delete doc.layout;
      else doc.layout = { direction: a.direction };
    }
  },
  add_group: function (doc, a) {
    var g = list(doc, 'groups');
    if (findIdx(g, a.id) >= 0) throw fail('group already exists: ' + a.id);
    g.push(clean({ id: a.id, label: a.label, color: a.color }));
  },
  update_group: function (doc, a) {
    var g = list(doc, 'groups'), i = findIdx(g, a.id);
    if (i < 0) throw fail('no such group: ' + a.id);
    patch(g[i], { label: a.label, color: a.color });
  },
  remove_group: function (doc, a) {
    var g = list(doc, 'groups'), i = findIdx(g, a.id);
    if (i < 0) throw fail('no such group: ' + a.id);
    var users = list(doc, 'nodes').filter(function (n) { return n.group === a.id; });
    if (users.length && !a.cascade) throw fail('group ' + a.id + ' is used by nodes: ' + users.map(function (n) { return n.id; }).join(', ') + '. Pass cascade:true to ungroup them.');
    users.forEach(function (n) { delete n.group; });
    g.splice(i, 1);
  },
  add_node: function (doc, a) {
    var n = list(doc, 'nodes');
    if (findIdx(n, a.id) >= 0) throw fail('node already exists: ' + a.id);
    n.push(clean({ id: a.id, label: a.label, subtitle: a.subtitle, group: a.group, shape: a.shape, col: a.col, row: a.row }));
  },
  update_node: function (doc, a) {
    var n = list(doc, 'nodes'), i = findIdx(n, a.id);
    if (i < 0) throw fail('no such node: ' + a.id);
    patch(n[i], { label: a.label, subtitle: a.subtitle, group: a.group, shape: a.shape, col: a.col, row: a.row });
    if (a.new_id !== undefined && a.new_id !== a.id) {
      if (findIdx(n, a.new_id) >= 0) throw fail('node already exists: ' + a.new_id);
      n[i].id = a.new_id;
      list(doc, 'steps').forEach(function (s) {
        if (s.from === a.id) s.from = a.new_id;
        if (s.to === a.id) s.to = a.new_id;
      });
    }
  },
  remove_node: function (doc, a) {
    var n = list(doc, 'nodes'), i = findIdx(n, a.id);
    if (i < 0) throw fail('no such node: ' + a.id);
    var steps = list(doc, 'steps');
    var used = steps.filter(function (s) { return s.from === a.id || s.to === a.id; });
    if (used.length && !a.cascade) throw fail('node ' + a.id + ' is used by ' + used.length + ' step(s). Pass cascade:true to remove them too.');
    doc.steps = steps.filter(function (s) { return s.from !== a.id && s.to !== a.id; });
    n.splice(i, 1);
  },
  add_step: function (doc, a) {
    var s = list(doc, 'steps');
    var step = clean({ from: a.from, to: a.to, label: a.label, detail: a.detail, payload: a.payload, kind: a.kind, together: a.together });
    if (a.at === undefined) s.push(step);
    else {
      if (typeof a.at !== 'number' || a.at < 0 || a.at > s.length || Math.floor(a.at) !== a.at) throw fail('"at" must be 0..' + s.length);
      s.splice(a.at, 0, step);
    }
  },
  update_step: function (doc, a) {
    var s = list(doc, 'steps'); checkIdx(s, a.index, 'step');
    patch(s[a.index], { from: a.from, to: a.to, label: a.label, detail: a.detail, payload: a.payload, kind: a.kind, together: a.together });
  },
  remove_step: function (doc, a) {
    var s = list(doc, 'steps'); checkIdx(s, a.index, 'step');
    s.splice(a.index, 1);
  },
  move_step: function (doc, a) {
    var s = list(doc, 'steps'); checkIdx(s, a.index, 'step'); checkIdx(s, a.to_index, 'target');
    s.splice(a.to_index, 0, s.splice(a.index, 1)[0]);
  }
};

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
