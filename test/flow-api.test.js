'use strict';
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var S = require('../flow-store.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'flows-')); }
var DOC = { title: 'T', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], steps: [{ from: 'a', to: 'b', label: 'go' }] };
function clone(o) { return JSON.parse(JSON.stringify(o)); }

test('store: revision changes with content, preconditions guard writes', function () {
  var st = new S.Store(tmp());
  assert.strictEqual(st.revision('x.flow.json'), null);
  var w1 = st.write('x.flow.json', DOC, { ifNoneMatch: '*' });
  assert.ok(w1.ok && w1.created && /^[0-9a-f]{16}$/.test(w1.revision));
  assert.strictEqual(st.revision('x.flow.json'), w1.revision);
  assert.strictEqual(st.write('x.flow.json', DOC, { ifNoneMatch: '*' }).conflict, true);
  var d2 = clone(DOC); d2.title = 'T2';
  var w2 = st.write('x.flow.json', d2, { ifMatch: w1.revision });
  assert.ok(w2.ok && !w2.created && w2.revision !== w1.revision);
  var stale = st.write('x.flow.json', DOC, { ifMatch: w1.revision });
  assert.strictEqual(stale.conflict, true);
  assert.strictEqual(stale.revision, w2.revision);
  assert.strictEqual(st.read('x.flow.json').title, 'T2');
  assert.strictEqual(st.remove('x.flow.json', { ifMatch: w1.revision }).conflict, true);
  assert.ok(st.remove('x.flow.json', { ifMatch: w2.revision }).ok);
  var list = (function () { st.write('y.flow.json', DOC); return st.list(); })();
  assert.ok(list[0].revision && list[0].modifiedAt);
});

test('store: stale edit is rejected and file untouched', function () {
  var st = new S.Store(tmp());
  var w = st.write('x.flow.json', DOC);
  st.edit('x.flow.json', 'set_meta', { title: 'other' });
  var r = st.edit('x.flow.json', 'set_meta', { title: 'mine' }, { ifMatch: w.revision });
  assert.strictEqual(r.conflict, true);
  assert.strictEqual(st.read('x.flow.json').title, 'other');
});

function api(port, method, url, body, headers) {
  return new Promise(function (resolve, reject) {
    var data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    var req = http.request({ port: port, host: '127.0.0.1', method: method, path: url, headers: Object.assign(data ? { 'Content-Type': 'application/json' } : {}, headers || {}) }, function (res) {
      var b = ''; res.on('data', function (c) { b += c; });
      res.on('end', function () { var j; try { j = b ? JSON.parse(b) : null; } catch (e) { j = b; } resolve({ status: res.statusCode, headers: res.headers, body: j }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function start(token) {
  var dir = tmp();
  var env = Object.assign({}, process.env, { FLOW_DIR: dir, FLOW_STORE: 'files' });
  delete env.MCP_TOKEN; if (token) env.MCP_TOKEN = token;
  var cp = require('child_process');
  var p = cp.spawn(process.execPath, [path.join(__dirname, '..', 'mcp-server.js'), '--http', '0'], { env: env });
  return new Promise(function (resolve) {
    p.stderr.on('data', function (c) {
      var m = /:(\d+)\/mcp/.exec(String(c));
      if (m) resolve({ port: +m[1], dir: dir, stop: function () { p.kill(); } });
    });
  });
}

test('http api: list, create, read, conflict, invalid, delete', async function () {
  var s = await start();
  try {
    assert.deepStrictEqual((await api(s.port, 'GET', '/api/flows')).body, { flows: [] });
    var c = await api(s.port, 'PUT', '/api/flows/a.flow.json', DOC, { 'If-None-Match': '*' });
    assert.strictEqual(c.status, 201);
    assert.strictEqual(c.headers.etag, '"' + c.body.revision + '"');
    assert.strictEqual((await api(s.port, 'PUT', '/api/flows/a.flow.json', DOC, { 'If-None-Match': '*' })).status, 412);
    var g = await api(s.port, 'GET', '/api/flows/a.flow.json');
    assert.strictEqual(g.status, 200); assert.strictEqual(g.headers.etag, c.headers.etag); assert.strictEqual(g.body.title, 'T');
    assert.strictEqual((await api(s.port, 'GET', '/api/flows/a.flow.json', undefined, { 'If-None-Match': c.headers.etag })).status, 304);
    var d2 = clone(DOC); d2.title = 'New';
    var u = await api(s.port, 'PUT', '/api/flows/a.flow.json', d2, { 'If-Match': c.headers.etag });
    assert.strictEqual(u.status, 200);
    var stale = await api(s.port, 'PUT', '/api/flows/a.flow.json', DOC, { 'If-Match': c.headers.etag });
    assert.strictEqual(stale.status, 412); assert.strictEqual(stale.body.revision, u.body.revision);
    var bad = await api(s.port, 'PUT', '/api/flows/a.flow.json', { nodes: [], steps: [{ from: 'x', to: 'y', label: 'z' }] });
    assert.strictEqual(bad.status, 422); assert.ok(bad.body.errors.length);
    assert.strictEqual((await api(s.port, 'GET', '/api/flows/a.flow.json')).body.title, 'New');
    assert.strictEqual((await api(s.port, 'PUT', '/api/flows/a.flow.json', '{nope')).status, 400);
    assert.strictEqual((await api(s.port, 'PUT', '/api/flows/..%2Fx.flow.json', DOC)).status, 400);
    assert.strictEqual((await api(s.port, 'GET', '/api/flows/missing.flow.json')).status, 404);
    var l = (await api(s.port, 'GET', '/api/flows')).body.flows;
    assert.strictEqual(l.length, 1); assert.strictEqual(l[0].revision, u.body.revision);
    assert.strictEqual((await api(s.port, 'DELETE', '/api/flows/a.flow.json', undefined, { 'If-Match': c.headers.etag })).status, 412);
    assert.strictEqual((await api(s.port, 'DELETE', '/api/flows/a.flow.json', undefined, { 'If-Match': u.headers.etag })).status, 204);
    assert.strictEqual(fs.readdirSync(s.dir).length, 0);
  } finally { s.stop(); }
});

test('http api: token guards reads and writes; mcp shares revisions', async function () {
  var s = await start('sekret');
  try {
    assert.strictEqual((await api(s.port, 'GET', '/api/flows')).status, 401);
    assert.strictEqual((await api(s.port, 'PUT', '/api/flows/a.flow.json', DOC)).status, 401);
    var H = { Authorization: 'Bearer sekret' };
    var c = await api(s.port, 'PUT', '/api/flows/a.flow.json', DOC, H);
    assert.strictEqual(c.status, 201);
    var call = function (name, args) {
      return api(s.port, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: name, arguments: args } }, H)
        .then(function (r) { return { err: r.body.result.isError, out: JSON.parse(r.body.result.content[0].text) }; });
    };
    var rd = await call('read_flow', { file: 'a.flow.json', with_revision: true });
    assert.strictEqual(rd.out.revision, c.body.revision);
    var ok = await call('set_meta', { file: 'a.flow.json', title: 'via mcp', expected_revision: rd.out.revision });
    assert.ok(ok.out.ok && ok.out.revision !== rd.out.revision);
    var stale = await call('set_meta', { file: 'a.flow.json', title: 'again', expected_revision: rd.out.revision });
    assert.ok(stale.err && stale.out.conflict);
    assert.strictEqual((await api(s.port, 'GET', '/api/flows/a.flow.json', undefined, H)).body.title, 'via mcp');
  } finally { s.stop(); }
});

test('http api on the default sqlite store: imports the folder, saves, survives restart', async function () {
  var dir = tmp(), db = path.join(tmp(), 'flows.db');
  fs.writeFileSync(path.join(dir, 'old.flow.json'), JSON.stringify(DOC));
  function boot() {
    var env = Object.assign({}, process.env, { FLOW_DIR: dir, FLOW_DB: db });
    delete env.MCP_TOKEN; delete env.FLOW_STORE;
    var p = require('child_process').spawn(process.execPath, [path.join(__dirname, '..', 'mcp-server.js'), '--http', '0'], { env: env });
    return new Promise(function (resolve) {
      p.stderr.on('data', function (c) {
        var m = /:(\d+)\/mcp/.exec(String(c));
        if (m) resolve({ port: +m[1], stop: function () { p.kill(); return new Promise(function (r) { p.on('exit', r); }); } });
      });
    });
  }
  var s = await boot(), rev;
  try {
    var l = (await api(s.port, 'GET', '/api/flows')).body.flows;
    assert.deepStrictEqual(l.map(function (f) { return f.file; }), ['old']);
    var c = await api(s.port, 'PUT', '/api/flows/new.flow.json', DOC, { 'If-None-Match': '*' });
    assert.strictEqual(c.status, 201); rev = c.body.revision;
    assert.strictEqual((await api(s.port, 'DELETE', '/api/flows/old.flow.json')).status, 204);
  } finally { await s.stop(); }
  s = await boot();
  try {
    var l2 = (await api(s.port, 'GET', '/api/flows')).body.flows;
    assert.deepStrictEqual(l2.map(function (f) { return f.file; }), ['new']);
    assert.strictEqual(l2[0].revision, rev);
    assert.ok(fs.existsSync(path.join(dir, 'old.flow.json')), 'import source folder is left untouched');
  } finally { await s.stop(); }
});
