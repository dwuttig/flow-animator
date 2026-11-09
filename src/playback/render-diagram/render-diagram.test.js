'use strict';
var test = require('node:test');
var assert = require('node:assert');
var R = require('./render-diagram.js');
var C = require('../../../flow-core.js');

function recorder() {
  var made = [];
  return { made: made, el: function (tag, attrs) { made.push({ tag: tag, attrs: attrs }); return {}; } };
}

test('every Flow shape has a draw entry that returns a label box inside the node', function () {
  C.SHAPES.forEach(function (shape) {
    assert.strictEqual(typeof R.SHAPES[shape], 'function', shape);
    var r = { x: 10, y: 20, w: 160, h: 60 }, rec = recorder();
    var b = R.SHAPES[shape]({}, r, rec.el, (C.SHAPE_METRICS || {})[shape]);
    assert.ok(rec.made.some(function (m) { return /body/.test(m.attrs['class']); }), shape + ' draws a .body');
    assert.ok(b.cx > r.x && b.cx < r.x + r.w && b.cy > r.y && b.cy < r.y + r.h && b.avail > 0 && b.avail < r.w, shape);
  });
});

test('queue keeps its label clear of the slot dividers', function () {
  var b = R.SHAPES.queue({}, { x: 0, y: 0, w: 200, h: 60 }, recorder().el, { extraW: 30 });
  assert.strictEqual(b.cx, 85); assert.strictEqual(b.avail, 150);
});

test('paletteCss covers every Flow color in light and dark', function () {
  var css = R.paletteCss();
  C.COLORS.forEach(function (c) { assert.strictEqual(css.split('.c-' + c + '{').length, 3, c); });
  assert.ok(/@media \(prefers-color-scheme:dark\)/.test(css));
});

test('fit truncates with an ellipsis', function () {
  assert.strictEqual(R.fit('short', 200, 8), 'short');
  assert.strictEqual(R.fit('a very long node label', 80, 8), 'a very lo…');
});

test('every step kind has legend info', function () {
  C.KINDS.forEach(function (k) { assert.ok(C.KIND_INFO[k] && C.KIND_INFO[k].label, k); });
});
