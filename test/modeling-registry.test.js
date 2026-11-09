'use strict';
var test = require('node:test');
var assert = require('node:assert');
var M = require('../src/flow-modeling/flow-modeling.js');
var L = require('../src/layout/layout.js');
var C = require('../flow-core.js');

var DOC = {
  format: 'flow-animator/1', title: 't',
  nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  steps: [{ from: 'a', to: 'b', label: '1' }, { from: 'b', to: 'a', label: '2', together: true }, { from: 'a', to: 'a', label: '3' }]
};

test('FlowCore facade keeps its public API', function () {
  ['FORMAT', 'CONNECTIONS', 'COLORS', 'AUTO_COLORS', 'SHAPES', 'KINDS'].forEach(function (k) { assert.strictEqual(C[k], M[k], k); });
  ['parse', 'validate', 'normalize', 'buildBeats', 'migrate'].forEach(function (k) { assert.strictEqual(C[k], M[k], k); });
  assert.strictEqual(C.layout, L.layout); assert.strictEqual(C.nodeWidth, L.nodeWidth); assert.strictEqual(C.NODE_H, 60);
  assert.strictEqual(C.KIND_INFO, M.KIND_INFO);
  assert.strictEqual(typeof C.load, 'function'); assert.strictEqual(typeof C.loadDoc, 'function');
});

test('KINDS come from KIND_INFO', function () {
  assert.deepStrictEqual(M.KINDS, ['sync', 'async', 'response', 'event']);
  assert.deepStrictEqual(Object.keys(M.KIND_INFO), M.KINDS);
  assert.deepStrictEqual(M.KIND_INFO.response, { label: 'Response', line: 'dashed' });
});

test('normalize adds stepBeat and nodeById', function () {
  var m = M.normalize(DOC);
  assert.deepStrictEqual(m.beats, [[0, 1], [2]]);
  assert.deepStrictEqual(m.stepBeat, [0, 0, 1]);
  assert.strictEqual(m.nodeById.b, m.nodes[1]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(m)).nodeById.a, m.nodes[0]);
});

test('migrate applies registered migrations and loadDoc warns', function () {
  var plain = M.migrate(DOC);
  assert.deepStrictEqual(plain, { doc: DOC, from: 'flow-animator/1', migrated: false });
  M.MIGRATIONS['flow-animator/0'] = function (d) { return Object.assign({}, d, { format: 'flow-animator/0.5', boxes: undefined, nodes: d.boxes }); };
  M.MIGRATIONS['flow-animator/0.5'] = function (d) { var o = Object.assign({}, d, { format: 'flow-animator/1' }); delete o.boxes; return o; };
  try {
    var old = Object.assign({}, DOC, { format: 'flow-animator/0', boxes: DOC.nodes });
    delete old.nodes;
    var r = M.migrate(old);
    assert.strictEqual(r.migrated, true); assert.strictEqual(r.from, 'flow-animator/0'); assert.strictEqual(r.doc.format, M.FORMAT);
    var res = C.loadDoc(old);
    assert.ok(res.ok, JSON.stringify(res.errors));
    assert.strictEqual(res.warnings[0].path, '$.format');
    assert.ok(/migrated from "flow-animator\/0"/.test(res.warnings[0].message));
    assert.ok(C.load(JSON.stringify(old)).ok);
  } finally {
    delete M.MIGRATIONS['flow-animator/0']; delete M.MIGRATIONS['flow-animator/0.5'];
  }
  var unknown = C.loadDoc(Object.assign({}, DOC, { format: 'flow-animator/9' }));
  assert.strictEqual(unknown.ok, false);
  assert.strictEqual(unknown.errors[0].path, '$.format');
});
