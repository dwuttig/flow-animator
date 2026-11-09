'use strict';
var test = require('node:test');
var assert = require('node:assert');
var N = require('./flow-name.js');

test('bare trims and strips a trailing .flow.json ignoring case', function () {
  assert.strictEqual(N.SUFFIX, '.flow.json');
  assert.strictEqual(N.bare(' orders '), 'orders');
  assert.strictEqual(N.bare('orders.flow.json'), 'orders');
  assert.strictEqual(N.bare('Orders.FLOW.JSON'), 'Orders');
  assert.strictEqual(N.bare('a.flow.json.flow.json'), 'a.flow.json');
  assert.strictEqual(N.bare(null), '');
});

test('isValid follows NAME_RE and rejects .json names', function () {
  ['orders', 'a', 'Order_2.v1-x', 'orders.flow.json'].forEach(function (n) { assert.strictEqual(N.isValid(n), true, n); });
  ['', '.hidden', '../x', 'a/b', 'has space', 'x.json', 'x.JSON', '.flow.json', new Array(102).join('a'), 42].forEach(function (n) {
    assert.strictEqual(N.isValid(n), false, String(n));
  });
  assert.ok(N.NAME_RE.test('abc'));
});

test('slug makes a name from a title', function () {
  assert.strictEqual(N.slug('Order Checkout (v2)!'), 'order-checkout-v2');
  assert.strictEqual(N.slug('  --Ärger--  '), 'rger');
  assert.strictEqual(N.slug('!!!'), 'flow');
  assert.strictEqual(N.slug(''), 'flow');
  assert.strictEqual(N.slug(undefined), 'flow');
});
