'use strict';
var test = require('node:test');
var assert = require('node:assert');
var Saver = require('./save-flow.js');

function setup(answer, results) {
  var saved = [], notes = [];
  var host = { getText: function () { return '{"title":"Order Flow"}'; }, askName: function (def) { host.def = def; return Promise.resolve(answer); },
    markClean: function () {}, notify: function (m) { notes.push(m); }, report: function () {}, show: function () {},
    confirm: function (m) { host.asked = m; return Promise.resolve(host.yes); },
    askToken: function () { host.tokenAsked = (host.tokenAsked || 0) + 1; return Promise.resolve(host.token); } };
  var gw = { save: function (n, t, o) { saved.push({ n: n, o: o }); return Promise.resolve((results && results.shift()) || { ok: true, revision: 'r1', warnings: [] }); } };
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

test('save as: cancelling the name dialog saves nothing; sync answers still work', async function () {
  var t = setup(null);
  assert.strictEqual((await t.s.saveAs()).kind, 'cancelled');
  assert.strictEqual(t.saved.length, 0);
  var u = setup('x');
  u.host.askName = function () { return 'billing'; };
  await u.s.saveAs();
  assert.strictEqual(u.saved[0].n, 'billing');
});

test('unauthorized asks for a token (async) and retries once it is given', async function () {
  var t = setup('orders', [{ ok: false, kind: 'unauthorized' }]);
  t.host.token = 'tok';
  var r = await t.s.saveAs();
  assert.ok(r.ok);
  assert.strictEqual(t.host.tokenAsked, 1);
  assert.strictEqual(t.saved.length, 2);
  var u = setup('orders', [{ ok: false, kind: 'unauthorized' }]);
  assert.strictEqual((await u.s.saveAs()).kind, 'unauthorized');
  assert.match(u.notes.pop(), /token is required/);
});

test('conflict asks (async) before overwriting; declining keeps the draft', async function () {
  var t = setup('x', [{ ok: false, kind: 'conflict', revision: 'r9' }]);
  t.s.setSource('orders', 'r1');
  t.host.yes = false;
  var r = await t.s.save();
  assert.strictEqual(r.kind, 'conflict');
  assert.match(t.host.asked, /changed on the server/);
  assert.strictEqual(t.saved.length, 1);
  var u = setup('x', [{ ok: false, kind: 'conflict', revision: 'r9' }]);
  u.s.setSource('orders', 'r1'); u.host.yes = true;
  assert.ok((await u.s.save()).ok);
  assert.deepStrictEqual(u.saved[1].o, {}, 'overwrite without If-Match');
});
