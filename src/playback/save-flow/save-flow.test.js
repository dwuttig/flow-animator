'use strict';
var test = require('node:test');
var assert = require('node:assert');
var Saver = require('./save-flow.js');

function setup(answer) {
  var saved = [], notes = [];
  var host = { getText: function () { return '{"title":"Order Flow"}'; }, askName: function (def) { host.def = def; return answer; },
    markClean: function () {}, notify: function (m) { notes.push(m); }, report: function () {}, show: function () {}, confirm: function () { return true; } };
  var gw = { save: function (n, t, o) { saved.push({ n: n, o: o }); return Promise.resolve({ ok: true, revision: 'r1', warnings: [] }); } };
  return { s: Saver.create(host, gw), saved: saved, notes: notes, host: host };
}

test('save as asks for a bare name and strips a typed suffix', async function () {
  var t = setup('orders.flow.json');
  await t.s.saveAs();
  assert.strictEqual(t.host.def, 'order-flow');
  assert.strictEqual(t.saved[0].n, 'orders');
  assert.deepStrictEqual(t.saved[0].o, { create: true });
  assert.strictEqual(t.s.name(), 'orders');
});

test('save as rejects names with spaces or folders and keeps unique create semantics', async function () {
  var t = setup('my flow');
  var r = await t.s.saveAs();
  assert.strictEqual(r.kind, 'badname');
  assert.strictEqual(t.saved.length, 0);
});
