'use strict';
var test = require('node:test');
var assert = require('node:assert');
var V = require('./view-options.js');

function store(init) {
  var m = {}; if (init !== undefined) m[V.KEY] = init;
  return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, val) { m[k] = val; }, m: m };
}

test('load falls back to defaults for missing, broken or out-of-range values', function () {
  assert.deepStrictEqual(V.load(store()), V.defaults());
  assert.deepStrictEqual(V.load(store('not json')), V.defaults());
  assert.deepStrictEqual(V.load(store(JSON.stringify({ direction: 'XY', connection: 'zig', step: 'wavy', thick: 9, spacing: 7, optimize: 'yes' }))), V.defaults());
  assert.deepStrictEqual(V.load(null), V.defaults());
});

test('save and load round-trip all settings', function () {
  var s = store(), all = { direction: 'TB', connection: 'linear', step: 'dotted', thick: 3, labels: false, optimize: true, spacing: 1.8 };
  V.save(s, all);
  assert.deepStrictEqual(V.load(s, ['auto', 'bezier', 'linear', 'orthogonal']), all);
  V.save({ setItem: function () { throw new Error('quota'); } }, V.defaults());
});

test('layoutOpts uses the Flow defaults unless overridden; needsLayout only when they differ', function () {
  var model = { direction: 'LR', connection: 'auto' };
  var v = V.defaults();
  assert.deepStrictEqual(V.layoutOpts(v, model), { direction: 'LR', connection: 'auto', optimize: false, spacing: 1 });
  assert.strictEqual(V.needsLayout(v, model), false);
  v.direction = 'LR'; assert.strictEqual(V.needsLayout(v, model), false);
  v.direction = 'TB'; assert.strictEqual(V.needsLayout(v, model), true);
  v.direction = ''; v.connection = 'bezier'; assert.strictEqual(V.needsLayout(v, model), true);
});

test('optimize and spacing also need a fresh layout', function () {
  var model = { direction: 'LR', connection: 'auto' }, v = V.defaults();
  v.optimize = true; assert.strictEqual(V.needsLayout(v, model), true);
  v.optimize = false; v.spacing = 1.5; assert.strictEqual(V.needsLayout(v, model), true);
  assert.strictEqual(V.layoutOpts(v, model).spacing, 1.5);
});
