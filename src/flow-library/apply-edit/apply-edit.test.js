'use strict';
var test = require('node:test');
var assert = require('node:assert');
var E = require('./apply-edit.js');
var Modeling = require('../../flow-modeling/flow-modeling.js');

var DOC = { title: 'T', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], steps: [{ from: 'a', to: 'b', label: 'go' }] };

test('apply returns a changed copy and leaves the input untouched', function () {
  var out = E.apply(DOC, 'add_node', { id: 'c', label: 'C' });
  assert.strictEqual(out.nodes.length, 3);
  assert.strictEqual(DOC.nodes.length, 2);
});

test('update_node rename follows steps', function () {
  var out = E.apply(DOC, 'update_node', { id: 'a', new_id: 'z' });
  assert.strictEqual(out.steps[0].from, 'z');
});

test('misuse throws a userError', function () {
  assert.throws(function () { E.apply(DOC, 'remove_node', { id: 'a' }); }, function (e) { return e.userError === true; });
  assert.throws(function () { E.apply(DOC, 'nope', {}); }, function (e) { return e.userError === true; });
});

test('move_step reorders', function () {
  var d = E.apply(DOC, 'add_step', { from: 'b', to: 'a', label: 'back' });
  var out = E.apply(d, 'move_step', { index: 1, to_index: 0 });
  assert.strictEqual(out.steps[0].label, 'back');
});

function labels(d) { return d.steps.map(function (s) { return s.label + (s.together ? '*' : ''); }).join(' '); }
var PAR = { title: 'T', nodes: DOC.nodes, steps: ['a', 'b', 'c', 'd'].map(function (l) { return { from: 'a', to: 'b', label: l }; }) };

test('set_parallel moves chosen steps next to the step and flags them together', function () {
  assert.strictEqual(labels(E.apply(PAR, 'set_parallel', { index: 0, with: [2] })), 'a c* b d');
  assert.strictEqual(labels(E.apply(PAR, 'set_parallel', { index: 3, with: [0, 1] })), 'c a b* d*');
});

test('set_parallel with an empty selection splits the beat, keeping order', function () {
  var d = E.apply(PAR, 'set_parallel', { index: 1, with: [0, 2] });
  assert.strictEqual(labels(d), 'a b* c* d');
  assert.strictEqual(labels(E.apply(d, 'set_parallel', { index: 1, with: [] })), 'a b c d');
  assert.strictEqual(labels(E.apply(d, 'set_parallel', { index: 1, with: [0] })), 'a b* c d');
});

test('set_parallel rejects bad indexes', function () {
  assert.throws(function () { E.apply(PAR, 'set_parallel', { index: 0, with: [9] }); }, function (e) { return e.userError; });
});

test('set_meta merges layout: direction keeps connection, null removes one key, empty layout is dropped', function () {
  var d = E.apply(DOC, 'set_meta', { connection: 'orthogonal' });
  assert.deepStrictEqual(d.layout, { connection: 'orthogonal' });
  d = E.apply(d, 'set_meta', { direction: 'TB' });
  assert.deepStrictEqual(d.layout, { connection: 'orthogonal', direction: 'TB' });
  d = E.apply(d, 'set_meta', { direction: null });
  assert.deepStrictEqual(d.layout, { connection: 'orthogonal' });
  d = E.apply(d, 'set_meta', { connection: null });
  assert.strictEqual('layout' in d, false);
  assert.strictEqual(E.apply(DOC, 'set_meta', { title: 'x' }).layout, undefined);
});

test('inherited object keys are not operations', function () {
  ['toString', 'constructor', '__proto__'].forEach(function (op) {
    assert.throws(function () { E.apply(DOC, op, {}); }, function (e) { return e.userError === true; }, op);
  });
});

test('describe covers every operation with string-only enums', function () {
  assert.deepStrictEqual(Object.keys(E.describe).sort(), E.names.slice().sort());
  E.names.forEach(function (n) {
    var d = E.describe[n];
    assert.ok(typeof d.description === 'string' && d.description, n);
    assert.ok(d.properties && typeof d.properties === 'object', n);
    assert.ok(Array.isArray(d.required), n);
    d.required.forEach(function (r) { assert.ok(d.properties[r], n + '.' + r); });
  });
  assert.deepStrictEqual(E.describe.set_meta.properties.connection.enum, ['auto', 'bezier', 'linear', 'orthogonal']);
  assert.deepStrictEqual(JSON.stringify(E.describe).match(/"enum":\[[^\]]*null/g), null);
});

test('describe enums come from Flow Modeling', function () {
  assert.deepStrictEqual(E.describe.set_meta.properties.direction.enum, Modeling.DIRS);
  assert.deepStrictEqual(E.describe.set_meta.properties.connection.enum, Modeling.CONNECTIONS);
  assert.deepStrictEqual(E.describe.add_group.properties.color.enum, Modeling.COLORS);
  assert.deepStrictEqual(E.describe.add_node.properties.shape.enum, Modeling.SHAPES);
  assert.deepStrictEqual(E.describe.add_step.properties.kind.enum, Modeling.KINDS);
});
