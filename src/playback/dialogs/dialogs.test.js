'use strict';
var test = require('node:test');
var assert = require('node:assert');
var D = require('./dialogs.js');

/* Minimal DOM: just enough of <dialog> for the slice. */
function fakeDoc(withDialog) {
  var doc = { body: null, activeElement: null, opened: [] };
  function node(tag) {
    var n = {
      tagName: tag.toUpperCase(), children: [], parent: null, listeners: {}, attrs: {}, value: '', textContent: '',
      setAttribute: function (k, v) { n.attrs[k] = v; },
      appendChild: function (c) { c.parent = n; n.children.push(c); return c; },
      addEventListener: function (t, fn) { (n.listeners[t] = n.listeners[t] || []).push(fn); },
      dispatch: function (t, e) { (n.listeners[t] || []).forEach(function (fn) { fn(e || {}); }); },
      remove: function () { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = null; },
      focus: function () { doc.activeElement = n; }, select: function () {},
      querySelectorAll: function (sel) {
        var out = [], tags = sel.toUpperCase().split(',');
        (function walk(x) { x.children.forEach(function (c) { if (tags.indexOf(c.tagName) >= 0) out.push(c); walk(c); }); })(n);
        return out;
      }
    };
    if (tag === 'dialog' && withDialog) {
      n.showModal = function () { doc.opened.push(n); };
      n.close = function (v) { n.returnValue = v || ''; n.dispatch('close'); };
    }
    return n;
  }
  doc.createElement = node;
  doc.contains = function () { return true; };
  doc.body = node('body');
  doc.defaultView = withDialog ? { HTMLDialogElement: function () {} } : {
    prompt: function (m, d) { return 'typed:' + d; }, confirm: function () { return true; }, alert: function () { doc.alerted = true; }
  };
  return doc;
}
function find(n, tag) { return n.querySelectorAll(tag); }

test('falls back to window.prompt/confirm/alert without <dialog>', async function () {
  var doc = fakeDoc(false), ask = D.create(doc);
  assert.strictEqual(await ask.prompt('Name?', 'x'), 'typed:x');
  assert.strictEqual(await ask.confirm('Sure?'), true);
  await ask.alert('Hi'); assert.ok(doc.alerted);
});

test('prompt resolves the typed value on OK and null on cancel; focus returns', async function () {
  var doc = fakeDoc(true), ask = D.create(doc), back = doc.createElement('button');
  back.focus();
  var p = ask.prompt('Save as', 'orders');
  await Promise.resolve(); await Promise.resolve();
  var dlg = doc.opened[0];
  assert.strictEqual(dlg.attrs.role, 'dialog');
  var input = find(dlg, 'input')[0];
  assert.strictEqual(input.value, 'orders');
  assert.strictEqual(doc.activeElement, input);
  input.value = 'billing';
  dlg.dispatch('keydown', { key: 'Enter', target: input, preventDefault: function () {}, stopPropagation: function () {} });
  assert.strictEqual(await p, 'billing');
  assert.strictEqual(doc.activeElement, back);
  assert.strictEqual(doc.body.children.length, 0, 'dialog removed');
  var c = ask.prompt('Again', '');
  await Promise.resolve(); await Promise.resolve();
  doc.opened[1].close(''); // Escape closes with an empty returnValue
  assert.strictEqual(await c, null);
});

test('confirm is an alertdialog and requests queue one at a time', async function () {
  var doc = fakeDoc(true), ask = D.create(doc);
  var a = ask.confirm('First?'), b = ask.confirm('Second?', { okLabel: 'Delete' });
  await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(doc.opened.length, 1);
  assert.strictEqual(doc.opened[0].attrs.role, 'alertdialog');
  doc.opened[0].close('ok');
  assert.strictEqual(await a, true);
  await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(doc.opened.length, 2);
  var labels = find(doc.opened[1], 'button').map(function (x) { return x.textContent; });
  assert.deepStrictEqual(labels, ['Cancel', 'Delete']);
  doc.opened[1].close('cancel');
  assert.strictEqual(await b, false);
});
