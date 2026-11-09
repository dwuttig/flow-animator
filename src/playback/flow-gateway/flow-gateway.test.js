'use strict';
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var Gateway = require('./flow-gateway.js');

var ROOT = path.join(__dirname, '..', '..', '..');
var DOC = JSON.stringify({ title: 'T', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], steps: [{ from: 'a', to: 'b', label: 'go' }] });

function server(token) {
  var env = Object.assign({}, process.env, { FLOW_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'gw-')) });
  delete env.MCP_TOKEN; if (token) env.MCP_TOKEN = token;
  var p = cp.spawn(process.execPath, [path.join(ROOT, 'mcp-server.js'), '--http', '0'], { env: env });
  return new Promise(function (resolve) {
    p.stderr.on('data', function (c) { var m = /:(\d+)\/mcp/.exec(String(c)); if (m) resolve({ port: +m[1], stop: function () { p.kill(); } }); });
  });
}
function gateway(port, token) {
  var origin = 'http://127.0.0.1:' + port + '/';
  return Gateway.create({
    fetch: function (u, o) { return fetch(new URL(u, origin).href, o); },
    getToken: function () { return token; }
  });
}

test('gateway: save, load, list, conflict, invalid, delete', async function () {
  var s = await server();
  try {
    var gw = gateway(s.port);
    assert.strictEqual(await gw.available(), true);
    var c = await gw.save('a.flow.json', DOC, { create: true });
    assert.ok(c.ok && c.created && c.revision);
    assert.strictEqual((await gw.save('a.flow.json', DOC, { create: true })).kind, 'conflict');
    var l = await gw.load('a.flow.json');
    assert.ok(l.ok && l.revision === c.revision && JSON.parse(l.text).title === 'T');
    assert.ok((await gw.load('a.flow.json', { ifNoneMatch: c.revision })).notModified);
    var u = await gw.save('a.flow.json', DOC.replace('"T"', '"U"'), { ifMatch: c.revision });
    assert.ok(u.ok && u.revision !== c.revision);
    var stale = await gw.save('a.flow.json', DOC, { ifMatch: c.revision });
    assert.strictEqual(stale.kind, 'conflict'); assert.strictEqual(stale.revision, u.revision);
    var bad = await gw.save('a.flow.json', '{"nodes":[],"steps":[{"from":"x","to":"y","label":"z"}]}');
    assert.strictEqual(bad.kind, 'invalid'); assert.ok(bad.errors.length);
    assert.strictEqual((await gw.list())[0].revision, u.revision);
    assert.strictEqual((await gw.load('nope.flow.json')).kind, 'notfound');
    assert.strictEqual((await gw.remove('a.flow.json', { ifMatch: c.revision })).kind, 'conflict');
    assert.ok((await gw.remove('a.flow.json', { ifMatch: u.revision })).ok);
  } finally { s.stop(); }
});

test('gateway: token required, wrong token is unauthorized', async function () {
  var s = await server('t0k');
  try {
    assert.strictEqual(await gateway(s.port, 'bad').available(), true);
    assert.strictEqual((await gateway(s.port, 'bad').save('a.flow.json', DOC)).kind, 'unauthorized');
    assert.ok((await gateway(s.port, 't0k').save('a.flow.json', DOC)).ok);
  } finally { s.stop(); }
});

test('gateway: without an API it falls back to the static listing and read-only', async function () {
  var calls = [];
  var gw = Gateway.create({
    fetch: function (u) {
      calls.push(u);
      if (u === 'api/flows') return Promise.resolve({ ok: false, status: 404, text: function () { return Promise.resolve('x'); } });
      if (u === 'flows/') return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify([{ name: 'o.flow.json', type: 'file', mtime: 'm' }, { name: 'x.txt', type: 'file' }, { name: 'd', type: 'directory' }])); } });
      if (u === 'flows/o.flow.json') return Promise.resolve({ ok: true, status: 200, headers: { get: function () { return null; } }, text: function () { return Promise.resolve(DOC); } });
      return Promise.reject(new Error('unexpected ' + u));
    }
  });
  assert.strictEqual(await gw.available(), false);
  assert.deepStrictEqual((await gw.list()).map(function (e) { return e.file; }), ['o']);
  var l = await gw.load('o');
  assert.ok(l.ok && l.revision === null);
  var down = Gateway.create({ fetch: function () { return Promise.reject(new Error('offline')); } });
  assert.strictEqual(await down.available(), false);
  assert.deepStrictEqual(await down.list(), []);
  assert.strictEqual((await down.save('a.flow.json', DOC)).kind, 'unavailable');
});

test('parseSse splits complete events, skips comments and keeps the rest', function () {
  var p = Gateway.parseSse(': ping\n\nevent: revision\ndata: {"revision":"r1"}\n\nevent: rev');
  assert.deepStrictEqual(p.events, [{ event: 'revision', data: '{"revision":"r1"}', id: null }]);
  assert.strictEqual(p.rest, 'event: rev');
  var q = Gateway.parseSse('id: 7\r\ndata: a\r\ndata: b\r\n\r\n');
  assert.deepStrictEqual(q.events, [{ event: 'message', data: 'a\nb', id: '7' }]);
});

function fakeTimers() {
  var q = [], id = 0;
  return { q: q, set: function (fn, ms) { q.push({ id: ++id, fn: fn, ms: ms }); return id; },
    clear: function (i) { for (var k = q.length - 1; k >= 0; k--) if (q[k].id === i) q.splice(k, 1); },
    run: function () { var t = q.shift(); if (t) t.fn(); return t; } };
}
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }
function stream() {
  var pending = [], waiting = null, enc = new TextEncoder();
  function deliver() { if (waiting && pending.length) { var w = waiting; waiting = null; w(pending.shift()); } }
  return {
    body: { getReader: function () { return { read: function () { return new Promise(function (r) { waiting = r; deliver(); }); } }; } },
    push: function (s) { pending.push({ done: false, value: enc.encode(s) }); deliver(); },
    end: function () { pending.push({ done: true }); deliver(); }
  };
}

test('watch: follows the SSE stream with Authorization, ignores the known revision, reconnects with backoff', async function () {
  var calls = [], streams = [], timers = fakeTimers(), seen = [], rev = 'r1';
  var gw = Gateway.create({
    getToken: function () { return 'tok'; },
    fetch: function (u, o) {
      calls.push({ u: u, o: o });
      if (u === 'api/flows') return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve('{"flows":[]}'); } });
      var s = stream(); streams.push(s);
      return Promise.resolve({ ok: true, status: 200, body: s.body });
    }
  });
  var stop = gw.watch('orders', function (ev) { seen.push(ev); rev = ev.revision; }, { known: function () { return rev; }, timers: timers });
  await tick();
  var ev = calls[1];
  assert.strictEqual(ev.u, 'api/flows/orders/events');
  assert.strictEqual(ev.o.headers.Authorization, 'Bearer tok');
  assert.strictEqual(ev.o.headers.Accept, 'text/event-stream');
  streams[0].push('event: revision\ndata: {"revision":"r1","deleted":false}\n\n: ping\n\n');
  await tick();
  assert.deepStrictEqual(seen, [], 'known revision is not reported');
  streams[0].push('event: revision\ndata: {"revision":"r2",');
  streams[0].push('"deleted":false}\n\n');
  await tick();
  assert.deepStrictEqual(seen, [{ revision: 'r2', deleted: false }]);
  streams[0].end();
  await tick();
  assert.strictEqual(timers.q.length, 1); assert.strictEqual(timers.q[0].ms, 1000);
  timers.run(); await tick();
  assert.strictEqual(streams.length, 2, 'reconnected');
  streams[1].push('event: revision\ndata: {"revision":null,"deleted":true}\n\n');
  streams[1].push('event: revision\ndata: {"revision":null,"deleted":true}\n\n');
  await tick();
  assert.deepStrictEqual(seen[1], { revision: null, deleted: true });
  assert.strictEqual(seen.length, 2, 'deleted is reported once');
  streams[1].end(); await tick();
  stop();
  assert.strictEqual(timers.q.length, 0, 'stop clears the reconnect timer');
});

test('watch: falls back to If-None-Match polling when the stream is not available', async function () {
  var calls = [], timers = fakeTimers(), seen = [], rev = 'r1', serverRev = 'r1';
  var gw = Gateway.create({
    fetch: function (u, o) {
      calls.push({ u: u, o: o });
      if (u === 'api/flows') return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve('{"flows":[]}'); } });
      if (/\/events$/.test(u)) return Promise.resolve({ ok: false, status: 404, text: function () { return Promise.resolve(''); } });
      if (o.headers['If-None-Match'] === '"' + serverRev + '"') return Promise.resolve({ ok: false, status: 304 });
      return Promise.resolve({ ok: true, status: 200, headers: { get: function () { return '"' + serverRev + '"'; } }, text: function () { return Promise.resolve(DOC); } });
    }
  });
  var stop = gw.watch('orders', function (ev) { seen.push(ev); rev = ev.revision; }, { known: function () { return rev; }, timers: timers });
  await tick();
  assert.strictEqual(calls[calls.length - 1].o.headers['If-None-Match'], '"r1"');
  assert.strictEqual(timers.q[0].ms, 1500);
  serverRev = 'r2';
  timers.run(); await tick();
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].revision, 'r2'); assert.strictEqual(seen[0].text, DOC);
  timers.run(); await tick();
  assert.strictEqual(seen.length, 1, 'unchanged: nothing reported');
  stop();
  assert.strictEqual(timers.q.length, 0);
});

test('watch: static fallback (no API) polls the file and compares text', async function () {
  var timers = fakeTimers(), seen = [], text = DOC;
  var gw = Gateway.create({
    fetch: function (u) {
      if (u === 'api/flows') return Promise.resolve({ ok: false, status: 404, text: function () { return Promise.resolve(''); } });
      return Promise.resolve({ ok: true, status: 200, headers: { get: function () { return null; } }, text: function () { return Promise.resolve(text); } });
    }
  });
  var stop = gw.watch('o', function (ev) { seen.push(ev); }, { timers: timers });
  await tick();
  timers.run(); await tick();
  assert.strictEqual(seen.length, 0);
  text = DOC.replace('"T"', '"U"');
  timers.run(); await tick();
  assert.strictEqual(seen.length, 1); assert.strictEqual(seen[0].text, text);
  stop();
});

test('watch: network errors retry with backoff, then poll', async function () {
  var timers = fakeTimers(), loads = 0;
  var gw = Gateway.create({
    fetch: function (u) {
      if (u === 'api/flows') return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve('{"flows":[]}'); } });
      if (/\/events$/.test(u)) return Promise.reject(new Error('offline'));
      loads++;
      return Promise.resolve({ ok: false, status: 304 });
    }
  });
  var stop = gw.watch('o', function () {}, { timers: timers });
  await tick();
  assert.strictEqual(timers.q[0].ms, 1000); timers.run(); await tick();
  assert.strictEqual(timers.q[0].ms, 2000); timers.run(); await tick();
  assert.strictEqual(loads, 1, 'polling after three failed connects');
  stop();
});

test('watch: live revisions from the real server over SSE', async function () {
  var s = await server();
  var stop = function () {};
  try {
    var gw = gateway(s.port);
    var c = await gw.save('live', DOC, { create: true });
    var rev = c.revision, seen = [];
    var got = new Promise(function (resolve) {
      stop = gw.watch('live', function (ev) { seen.push(ev); rev = ev.revision; resolve(); }, { known: function () { return rev; } });
    });
    await new Promise(function (r) { setTimeout(r, 300); });
    assert.deepStrictEqual(seen, [], 'current revision is not reported');
    var u = await gw.save('live', DOC.replace('"T"', '"U"'), { ifMatch: c.revision });
    await got;
    assert.strictEqual(seen[0].revision, u.revision);
    assert.strictEqual(seen[0].deleted, false);
  } finally { stop(); s.stop(); }
});
