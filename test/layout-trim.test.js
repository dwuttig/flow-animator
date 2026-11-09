'use strict';
var test = require('node:test');
var assert = require('node:assert');
var M = require('../src/flow-modeling/flow-modeling.js');
var L = require('../src/layout/layout.js');
var C = require('../flow-core.js');

function ends(d) {
  var n = d.match(/-?\d*\.?\d+/g).map(Number);
  return { a: { x: n[0], y: n[1] }, z: { x: n[n.length - 2], y: n[n.length - 1] } };
}
function dist(p, q) { return Math.hypot(p.x - q.x, p.y - q.y); }
function cmds(d) { return d.replace(/[^MLQC]/g, ''); }

function doc(dir, conn) {
  return {
    format: M.FORMAT, title: 't', layout: { direction: dir, connection: conn },
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D', col: 1, row: 1 }],
    steps: [
      { from: 'a', to: 'b', label: '1' }, { from: 'b', to: 'a', label: '2', kind: 'response' },
      { from: 'b', to: 'c', label: '3' }, { from: 'a', to: 'd', label: '4' },
      { from: 'd', to: 'c', label: '5' }, { from: 'c', to: 'c', label: '6' }, { from: 'a', to: 'c', label: '7' }
    ]
  };
}

['LR', 'TB'].forEach(function (dir) {
  ['auto', 'bezier', 'linear', 'orthogonal'].forEach(function (conn) {
    test('edges are trimmed 3 px at the start and 11 px at the end (' + dir + ', ' + conn + ')', function () {
      var model = M.normalize(doc(dir, conn)), g = L.layout(model), raw = L.route(g.nodes, model, dir, conn).edges;
      assert.strictEqual(g.edges.length, raw.length);
      g.edges.forEach(function (e, i) {
        var r = raw[i], u = ends(r.d), t = ends(e.d);
        assert.strictEqual(e.id, r.id); assert.strictEqual(e.from, r.from); assert.strictEqual(e.to, r.to); assert.strictEqual(e.kind, r.kind);
        assert.strictEqual(cmds(e.d)[1], cmds(r.d)[1], 'path type kept: ' + r.d + ' -> ' + e.d);
        assert.ok(Math.abs(dist(u.a, t.a) - 3) < 0.4, e.id + ' start ' + dist(u.a, t.a));
        assert.ok(Math.abs(dist(u.z, t.z) - 11) < 0.8, e.id + ' end ' + dist(u.z, t.z));
        var full = L.trimPath(r.d, 0, 0).length;
        assert.ok(Math.abs(e.length - (full - 14)) < 0.2, e.id + ' length');
      });
      assert.ok(g.edges.some(function (e) { return e.from === e.to; }), 'has a self-loop');
    });
  });
});

test('trimPath keeps line, quadratic, cubic and polyline types', function () {
  assert.strictEqual(L.trimPath('M0 0 L100 0', 3, 11).d, 'M3 0 L89 0');
  assert.strictEqual(cmds(L.trimPath('M0 0 Q50 50 100 0', 3, 11).d), 'MQ');
  assert.strictEqual(cmds(L.trimPath('M0 0 C30 40 70 40 100 0', 3, 11).d), 'MC');
  var p = L.trimPath('M0 0 L2 0 L2 50 L60 50 L60 58', 3, 11);
  assert.strictEqual(p.d, 'M2 1 L2 50 L57 50');
  assert.strictEqual(p.length, 118 - 14);
});

test('short paths are not trimmed', function () {
  assert.deepStrictEqual(L.trimPath('M0 0 L18 0', 3, 11), { d: 'M0 0 L18 0', length: 18 });
  assert.strictEqual(L.trimPath('M0 0 L19 0', 3, 11).d, 'M3 0 L8 0');
});

test('SHAPE_METRICS keys match the SHAPES list and drive nodeWidth', function () {
  assert.deepStrictEqual(Object.keys(L.SHAPE_METRICS).sort(), M.SHAPES.slice().sort());
  var n = { label: 'Queue', subtitle: '' };
  assert.strictEqual(L.nodeWidth(Object.assign({ shape: 'box' }, n)), 120);
  n.label = 'Twelve chars';
  assert.strictEqual(L.nodeWidth(Object.assign({ shape: 'queue' }, n)) - L.nodeWidth(Object.assign({ shape: 'box' }, n)), 30);
  assert.strictEqual(C.SHAPE_METRICS, L.SHAPE_METRICS);
});
