'use strict';
var test = require('node:test');
var assert = require('node:assert');
var M = require('../src/flow-modeling/flow-modeling.js');
var L = require('../src/layout/layout.js');

function model() {
  var ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  return M.normalize({
    format: 'flow-animator/1', title: 't',
    nodes: ids.map(function (id) { return { id: id, label: id.toUpperCase() }; }),
    steps: [
      { from: 'a', to: 'b', label: 'x' }, { from: 'a', to: 'c', label: 'x' }, { from: 'a', to: 'd', label: 'x' },
      { from: 'b', to: 'f', label: 'x' }, { from: 'c', to: 'e', label: 'x' }, { from: 'd', to: 'f', label: 'x' }, { from: 'e', to: 'f', label: 'x' }
    ]
  });
}

test('optimize is off by default and flagged when on', function () {
  var m = model();
  assert.strictEqual(L.layout(m).optimized, false);
  assert.strictEqual(L.layout(m, { optimize: true }).optimized, true);
});

test('optimize keeps every node and never adds layout warnings', function () {
  var m = model(), a = L.layout(m), b = L.layout(m, { optimize: true });
  assert.deepStrictEqual(Object.keys(b.nodes).sort(), Object.keys(a.nodes).sort());
  assert.ok(b.warnings.length <= a.warnings.length);
});

test('optimize respects explicit rows', function () {
  var m = M.normalize({
    format: 'flow-animator/1', title: 't',
    nodes: [{ id: 'a', label: 'A', row: 0 }, { id: 'b', label: 'B', row: 1 }, { id: 'c', label: 'C', row: 0 }],
    steps: [{ from: 'a', to: 'b', label: 'x' }, { from: 'b', to: 'c', label: 'x' }]
  });
  var a = L.layout(m), b = L.layout(m, { optimize: true });
  assert.deepStrictEqual(b.nodes, a.nodes);
});

test('spacing scales the distance between nodes', function () {
  var m = model(), a = L.layout(m), b = L.layout(m, { spacing: 2 }), c = L.layout(m, { spacing: 0.5 });
  assert.ok(b.width > a.width && b.height > a.height);
  assert.ok(c.width < a.width);
  assert.deepStrictEqual(L.layout(m, { spacing: 1 }).nodes, a.nodes);
});
