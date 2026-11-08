'use strict';
var test = require('node:test');
var assert = require('node:assert');
var R = require('./record-video.js');

test('pickMimeType prefers MP4 over WebM', function () {
  assert.deepStrictEqual(R.pickMimeType(function () { return true; }), { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' });
  var r = R.pickMimeType(function (m) { return m.indexOf('webm') >= 0; });
  assert.strictEqual(r.ext, 'webm');
  assert.strictEqual(R.pickMimeType(function () { return false; }), null);
  assert.strictEqual(R.pickMimeType(function () { throw new Error('x'); }), null);
});

test('fileName slugs the title', function () {
  assert.strictEqual(R.fileName('Order Flow: v2!', 'mp4'), 'order-flow-v2.mp4');
  assert.strictEqual(R.fileName('', 'webm'), 'flow.webm');
});

test('frameSize gives even sizes, keeps aspect, caps height', function () {
  assert.deepStrictEqual(R.frameSize(1000, 500, 1280, 120), { w: 1280, h: 640 + 120, svgH: 640 });
  assert.ok(R.frameSize(100, 5000, 1280, 0).svgH <= 1920);
  var o = R.frameSize(777, 333, 1001, 0);
  assert.ok(o.w % 2 === 0 && o.h % 2 === 0);
});

test('wrapText wraps and ellipsizes', function () {
  var m = function (t) { return t.length; };
  assert.deepStrictEqual(R.wrapText(m, 'aaa bbb ccc', 7, 5), ['aaa bbb', 'ccc']);
  var l = R.wrapText(m, 'one two three four five six', 9, 1);
  assert.strictEqual(l.length, 1);
  assert.ok(l[0].slice(-1) === '…' && l[0].length <= 9);
  assert.deepStrictEqual(R.wrapText(m, '', 10, 2), []);
});
