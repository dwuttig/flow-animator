'use strict';
var test = require('node:test');
var assert = require('node:assert');
var E = require('./apply-edit.js');

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
