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
