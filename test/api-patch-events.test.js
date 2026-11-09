'use strict';
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'api-')); }
var DOC = { title: 'T', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], steps: [{ from: 'a', to: 'b', label: 'go' }] };
function clone(o) { return JSON.parse(JSON.stringify(o)); }

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

function boot(env) {
  var e = Object.assign({}, process.env, env);
  delete e.MCP_TOKEN; if (env.MCP_TOKEN) e.MCP_TOKEN = env.MCP_TOKEN;
  var p = cp.spawn(process.execPath, [path.join(ROOT, 'mcp-server.js'), '--http', '0'], { env: e });
  return new Promise(function (resolve) {
    p.stderr.on('data', function (c) {
      var m = /:(\d+)\/mcp/.exec(String(c));
      if (m) resolve({ port: +m[1], stop: function () { p.kill(); return new Promise(function (r) { p.on('exit', r); }); } });
    });
  });
}
function sqliteEnv(extra) { return Object.assign({ FLOW_DIR: tmp(), FLOW_DB: path.join(tmp(), 'flows.db'), FLOW_STORE: 'sqlite' }, extra || {}); }

/* Open an SSE stream; next() resolves with the next parsed `revision` event. */
function events(port, name, headers) {
  return new Promise(function (resolve, reject) {
    var queue = [], waiting = [], buf = '';
    var req = http.request({ port: port, host: '127.0.0.1', path: '/api/flows/' + name + '/events', headers: headers || {} }, function (res) {
      res.setEncoding('utf8');
      res.on('data', function (c) {
        buf += c; var i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          var block = buf.slice(0, i); buf = buf.slice(i + 2);
          var ev = /^event: (.*)$/m.exec(block), data = /^data: (.*)$/m.exec(block);
          if (!ev) continue;
          var msg = { event: ev[1], data: JSON.parse(data[1]) };
          if (waiting.length) waiting.shift()(msg); else queue.push(msg);
        }
      });
      resolve({
        res: res,
        next: function () { return queue.length ? Promise.resolve(queue.shift()) : new Promise(function (r) { waiting.push(r); }); },
        close: function () { req.destroy(); }
      });
    });
    req.on('error', function (e) { if (e.code !== 'ECONNRESET') reject(e); });
    req.end();
  });
}
function within(ms, p) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout after ' + ms + 'ms')); }, ms); })]); }

function mcp(port, name, args, headers) {
  return api(port, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: name, arguments: args } }, headers)
    .then(function (r) { var t = r.body.result.content[0].text, o; try { o = JSON.parse(t); } catch (e) { o = t; } return { err: r.body.result.isError, out: o }; });
}

test('PATCH applies one edit with If-Match; 412, 422, 400 and 404 as documented', async function () {
  var s = await boot({ FLOW_DIR: tmp(), FLOW_STORE: 'files', MCP_TOKEN: 'k' });
  var H = { Authorization: 'Bearer k' };
  try {
    var c = await api(s.port, 'PUT', '/api/flows/p', DOC, H);
    assert.strictEqual((await api(s.port, 'PATCH', '/api/flows/p', { op: 'set_meta', args: { title: 'x' } })).status, 401);
    var ok = await api(s.port, 'PATCH', '/api/flows/p', { op: 'add_node', args: { id: 'c', label: 'C' } }, Object.assign({ 'If-Match': c.headers.etag }, H));
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.ok, true); assert.strictEqual(ok.body.stats.nodes, 3); assert.ok(Array.isArray(ok.body.warnings));
    assert.strictEqual(ok.headers.etag, '"' + ok.body.revision + '"');
    var stale = await api(s.port, 'PATCH', '/api/flows/p', { op: 'set_meta', args: { title: 'y' } }, Object.assign({ 'If-Match': c.headers.etag }, H));
    assert.strictEqual(stale.status, 412); assert.strictEqual(stale.body.revision, ok.body.revision);
    var bad = await api(s.port, 'PATCH', '/api/flows/p', { op: 'add_step', args: { from: 'a', to: 'zz', label: 'l' } }, H);
    assert.strictEqual(bad.status, 422); assert.ok(bad.body.errors.length); assert.ok(bad.body.note); assert.ok(Array.isArray(bad.body.warnings));
    assert.strictEqual((await api(s.port, 'PATCH', '/api/flows/p', { op: 'nope', args: {} }, H)).status, 400);
    assert.strictEqual((await api(s.port, 'PATCH', '/api/flows/p', { op: 'toString' }, H)).status, 400);
    assert.strictEqual((await api(s.port, 'PATCH', '/api/flows/p', { op: 'remove_node', args: { id: 'a' } }, H)).status, 400);
    assert.strictEqual((await api(s.port, 'PATCH', '/api/flows/p', '{nope', H)).status, 400);
    assert.strictEqual((await api(s.port, 'PATCH', '/api/flows/p', { args: {} }, H)).status, 400);
    assert.strictEqual((await api(s.port, 'PATCH', '/api/flows/missing', { op: 'set_meta', args: { title: 'q' } }, H)).status, 404);
    var g = await api(s.port, 'GET', '/api/flows/p', undefined, H);
    assert.strictEqual(g.body.nodes.length, 3); assert.strictEqual(g.headers.etag, ok.headers.etag);
    var lay = await api(s.port, 'PATCH', '/api/flows/p', { op: 'set_meta', args: { connection: 'linear' } }, H);
    assert.strictEqual(lay.status, 200);
    assert.deepStrictEqual((await api(s.port, 'GET', '/api/flows/p', undefined, H)).body.layout, { connection: 'linear' });
  } finally { await s.stop(); }
});

test('revisions over HTTP and MCP (sqlite store)', async function () {
  var s = await boot(sqliteEnv());
  try {
    var a = await api(s.port, 'PUT', '/api/flows/r', DOC);
    var d2 = clone(DOC); d2.title = 'Two';
    var b = await api(s.port, 'PUT', '/api/flows/r', d2);
    var l = await api(s.port, 'GET', '/api/flows/r/revisions');
    assert.strictEqual(l.status, 200);
    assert.deepStrictEqual(l.body.revisions.map(function (x) { return x.revision; }), [b.body.revision, a.body.revision]);
    assert.ok(l.body.revisions[0].modifiedAt);
    var old = await api(s.port, 'GET', '/api/flows/r?revision=' + a.body.revision);
    assert.strictEqual(old.status, 200); assert.strictEqual(old.body.title, 'T'); assert.strictEqual(old.headers.etag, '"' + a.body.revision + '"');
    assert.strictEqual((await api(s.port, 'GET', '/api/flows/r?revision=ffffffffffffffff')).status, 404);
    assert.strictEqual((await api(s.port, 'GET', '/api/flows/missing/revisions')).status, 404);
    assert.strictEqual((await api(s.port, 'GET', '/api/flows/r/nope')).status, 404);
    assert.strictEqual((await api(s.port, 'POST', '/api/flows/r/revisions')).status, 405);
    var lr = await mcp(s.port, 'list_revisions', { file: 'r' });
    assert.strictEqual(lr.out.revisions.length, 2);
    var rf = await mcp(s.port, 'read_flow', { file: 'r', revision: a.body.revision });
    assert.strictEqual(rf.out.title, 'T');
    var rw = await mcp(s.port, 'read_flow', { file: 'r', revision: a.body.revision, with_revision: true });
    assert.strictEqual(rw.out.revision, a.body.revision); assert.strictEqual(rw.out.document.title, 'T');
    assert.strictEqual((await mcp(s.port, 'read_flow', { file: 'r', revision: 'ffffffffffffffff' })).err, true);
    var tl = await api(s.port, 'POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    var sm = tl.body.result.tools.filter(function (t) { return t.name === 'set_meta'; })[0];
    assert.deepStrictEqual(sm.inputSchema.properties.connection.enum, ['auto', 'bezier', 'linear', 'orthogonal']);
    assert.ok(sm.inputSchema.properties.expected_revision && sm.inputSchema.required.indexOf('file') >= 0);
  } finally { await s.stop(); }
});

test('events: SSE sends the current revision, then every change from HTTP, MCP and other processes', async function () {
  var env = sqliteEnv({ MCP_TOKEN: 'k' });
  var s = await boot(env), H = { Authorization: 'Bearer k' };
  var other = null, ev = null;
  try {
    assert.strictEqual((await api(s.port, 'GET', '/api/flows/e/events')).status, 401);
    ev = await events(s.port, 'e', H);
    assert.strictEqual(ev.res.statusCode, 200);
    assert.ok(/^text\/event-stream/.test(ev.res.headers['content-type']));
    assert.strictEqual(ev.res.headers['cache-control'], 'no-store');
    assert.strictEqual(ev.res.headers['x-accel-buffering'], 'no');
    assert.deepStrictEqual((await within(2000, ev.next())).data, { revision: null, deleted: true });
    var c = await api(s.port, 'PUT', '/api/flows/e', DOC, H);
    var m1 = await within(1000, ev.next());
    assert.strictEqual(m1.event, 'revision');
    assert.deepStrictEqual(m1.data, { revision: c.body.revision, deleted: false });
    var p = await api(s.port, 'PATCH', '/api/flows/E', { op: 'set_meta', args: { title: 'patched' } }, H);
    assert.strictEqual((await within(1000, ev.next())).data.revision, p.body.revision);
    var t = await mcp(s.port, 'set_meta', { file: 'e', title: 'via mcp' }, H);
    assert.strictEqual((await within(1000, ev.next())).data.revision, t.out.revision);
    // another process on the same database (a stdio MCP server)
    other = cp.spawn(process.execPath, [path.join(ROOT, 'mcp-server.js')], { env: Object.assign({}, process.env, env) });
    var reply = new Promise(function (r) { other.stdout.once('data', function (d) { r(JSON.parse(String(d).split('\n')[0])); }); });
    other.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'set_meta', arguments: { file: 'e', title: 'elsewhere' } } }) + '\n');
    var ext = JSON.parse((await reply).result.content[0].text);
    assert.strictEqual((await within(4000, ev.next())).data.revision, ext.revision);
    assert.strictEqual((await api(s.port, 'DELETE', '/api/flows/e', undefined, H)).status, 204);
    assert.deepStrictEqual((await within(1000, ev.next())).data, { revision: null, deleted: true });
    assert.strictEqual((await api(s.port, 'GET', '/api/flows/..%2Fx/events', undefined, H)).status, 400);
  } finally { if (ev) ev.close(); if (other) other.kill(); await s.stop(); }
});

test('requiring mcp-server.js does not open the store', function () {
  var dir = tmp();
  var env = Object.assign({}, process.env, { FLOW_DIR: dir, FLOW_STORE: 'sqlite' });
  delete env.FLOW_DB;
  cp.execFileSync(process.execPath, ['-e', 'var m = require(' + JSON.stringify(path.join(ROOT, 'mcp-server.js')) + '); if (!m.TOOLS.length) process.exit(3);'], { env: env });
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});
