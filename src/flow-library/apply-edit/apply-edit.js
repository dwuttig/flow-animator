/*
 * apply-edit: pure Edit operations on a flow document (Flow Library context,
 * slice apply-edit). No fs, no DOM: runs in Node (flow-store.js) and in the
 * browser (editor mode). Validation stays in Flow Modeling; callers validate
 * the result before persisting or showing it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlowEdits = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

function fail(msg) { var e = new Error(msg); e.userError = true; return e; }

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
  },
  /* set_parallel: the step at `index` plays in one Beat with exactly the steps listed in `with`
   * (0-based indexes). Stored as `together` flags, so a Beat stays a run of adjacent steps:
   * the chosen steps are moved next to `index`; steps that were in the Beat but are no longer chosen
   * keep their relative order as their own Beat. `with: []` makes the step play alone. */
  set_parallel: function (doc, a) {
    var s = list(doc, 'steps'); checkIdx(s, a.index, 'step');
    var others = a.with === undefined || a.with === null ? [] : a.with;
    if (!Array.isArray(others)) throw fail('"with" must be an array of step indexes');
    var group = [a.index];
    others.forEach(function (j) {
      checkIdx(s, j, 'with');
      if (j !== a.index && group.indexOf(j) < 0) group.push(j);
    });
    group.sort(function (x, y) { return x - y; });
    var beats = [];
    s.forEach(function (st, i) {
      if (st.together === true && beats.length) beats[beats.length - 1].push(i); else beats.push([i]);
    });
    var rest = [], at = 0;
    beats.forEach(function (b) {
      var keep = b.filter(function (i) { return group.indexOf(i) < 0; });
      if (b.indexOf(a.index) < 0) { if (keep.length) rest.push(keep); return; }
      // the step's old beat: leftovers before it stay before, leftovers after it stay after
      var before = keep.filter(function (i) { return i < a.index; }), after = keep.filter(function (i) { return i > a.index; });
      if (before.length) rest.push(before);
      at = rest.length; rest.push(group);
      if (after.length) rest.push(after);
    });
    var out = [];
    rest.forEach(function (b) {
      b.forEach(function (i, k) {
        var st = s[i];
        if (k === 0) delete st.together; else st.together = true;
        out.push(st);
      });
    });
    doc.steps = out;
  }
};

var NAMES = Object.keys(ops);

/* Apply one Edit to a deep copy of doc and return the copy. Throws a userError on misuse. */
function apply(doc, op, args) {
  if (!ops[op]) throw fail('unknown operation ' + op);
  var copy = JSON.parse(JSON.stringify(doc));
  ops[op](copy, args || {});
  return copy;
}

return { ops: ops, names: NAMES, apply: apply, fail: fail };
});
