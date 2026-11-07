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
  assert.deepStrictEqual((await gw.list()).map(function (e) { return e.file; }), ['o.flow.json']);
  var l = await gw.load('o.flow.json');
  assert.ok(l.ok && l.revision === null);
  var down = Gateway.create({ fetch: function () { return Promise.reject(new Error('offline')); } });
  assert.strictEqual(await down.available(), false);
  assert.deepStrictEqual(await down.list(), []);
  assert.strictEqual((await down.save('a.flow.json', DOC)).kind, 'unavailable');
});
