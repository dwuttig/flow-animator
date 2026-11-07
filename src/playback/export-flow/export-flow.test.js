'use strict';
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var os = require('os');
var X = require('./export-flow.js');
var C = require('../../../flow-core.js');

var ROOT = path.join(__dirname, '..', '..', '..');
var FLOW = fs.readFileSync(path.join(ROOT, 'examples', 'order-flow.flow.json'), 'utf8');

test('fileName slugs the title', function () {
  assert.strictEqual(X.fileName('Order Flow: v2!', 'json'), 'order-flow-v2.flow.json');
  assert.strictEqual(X.fileName('', 'html'), 'flow.html');
});

test('every script the viewer loads is in SCRIPTS, in order', function () {
  var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  var tags = (html.match(/<script src="[^"]+"><\/script>/g) || []).map(function (t) { return t.slice(13, -11); });
  assert.deepStrictEqual(tags, X.SCRIPTS);
});

test('standaloneHtml inlines scripts and embeds the flow; can be re-exported', function () {
  var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), sources = {};
  X.SCRIPTS.forEach(function (f) { sources[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });
  var out = X.standaloneHtml(html, sources, FLOW);
  assert.ok(out.indexOf('<script src="flow-core.js"') < 0 && out.indexOf('src="src/') < 0);
  assert.ok(out.indexOf('id="flow-data"') > 0);
  var again = X.standaloneHtml(out, {}, JSON.stringify(Object.assign(JSON.parse(FLOW), { title: 'Changed' })));
  assert.strictEqual((again.match(/id="flow-data"/g) || []).length, 1);
  assert.ok(again.indexOf('"title":"Changed"') > 0);
  assert.ok(C.load(FLOW).ok);
});

test('build-standalone.js CLI still produces a bundle', function () {
  var out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bs-')), 'o.html');
  cp.execFileSync(process.execPath, [path.join(ROOT, 'build-standalone.js'), path.join(ROOT, 'examples', 'order-flow.flow.json'), out]);
  assert.ok(fs.readFileSync(out, 'utf8').indexOf('id="flow-data"') > 0);
});
