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
var PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('fileName slugs the title', function () {
  assert.strictEqual(X.fileName('Order Flow: v2!', 'json'), 'order-flow-v2.flow.json');
  assert.strictEqual(X.fileName('', 'html'), 'flow.html');
  assert.strictEqual(X.fileName('Order Flow', 'svg'), 'order-flow.svg');
  assert.strictEqual(X.fileName('Order submission', 'pptx'), 'order-submission.pptx');
});

test('scriptsOf lists the page script tags in order and every one exists', function () {
  var list = X.scriptsOf(PAGE);
  assert.ok(list.length > 5);
  assert.strictEqual(list.indexOf('flow-core.js') > list.indexOf('src/layout/layout.js'), true, 'facade after its contexts');
  list.forEach(function (f) { assert.ok(fs.existsSync(path.join(ROOT, f)), f); });
  assert.deepStrictEqual(X.scriptsOf('<script src="a.js"></script>\n<script>x</script>\n<script src="b/c.js"></script>'), ['a.js', 'b/c.js']);
});

test('standaloneHtml inlines scripts and embeds the flow; can be re-exported', function () {
  var sources = {};
  X.scriptsOf(PAGE).forEach(function (f) { sources[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });
  var out = X.standaloneHtml(PAGE, sources, FLOW);
  assert.deepStrictEqual(X.scriptsOf(out), [], 'no external script refs');
  assert.ok(out.indexOf('src="src/') < 0);
  assert.ok(out.indexOf('id="flow-data"') > 0);
  assert.ok(out.indexOf('id="flow-data"') < out.indexOf('id="sample-flow"'), 'data before the wiring script');
  var again = X.standaloneHtml(out, {}, JSON.stringify(Object.assign(JSON.parse(FLOW), { title: 'Changed' })));
  assert.strictEqual((again.match(/id="flow-data"/g) || []).length, 1);
  assert.ok(again.indexOf('"title":"Changed"') > 0);
  assert.ok(C.load(FLOW).ok);
  assert.throws(function () { X.standaloneHtml(PAGE, {}, FLOW); }, /missing script source/);
});

test('fetchStandalone loads the page and the scripts it lists', async function () {
  var asked = [];
  function f(u) {
    asked.push(u);
    var rel = u.replace('http://h/app/', '');
    var text = rel === 'index.html' ? PAGE : fs.readFileSync(path.join(ROOT, rel), 'utf8');
    return Promise.resolve({ ok: true, text: function () { return Promise.resolve(text); } });
  }
  var out = await X.fetchStandalone(f, 'http://h/app/index.html?flow=x#y', FLOW);
  assert.strictEqual(asked[0], 'http://h/app/index.html');
  assert.deepStrictEqual(asked.slice(1), X.scriptsOf(PAGE).map(function (s) { return 'http://h/app/' + s; }));
  assert.deepStrictEqual(X.scriptsOf(out), []);
});

test('build-standalone.js CLI produces a self-contained bundle', function () {
  var out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bs-')), 'o.html');
  cp.execFileSync(process.execPath, [path.join(ROOT, 'build-standalone.js'), path.join(ROOT, 'examples', 'order-flow.flow.json'), out]);
  var html = fs.readFileSync(out, 'utf8');
  assert.ok(html.indexOf('id="flow-data"') > 0);
  assert.deepStrictEqual(X.scriptsOf(html), []);
});
