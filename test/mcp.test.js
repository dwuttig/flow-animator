'use strict';
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'flows-')); }

function rpc(id, method, params) { return { jsonrpc: '2.0', id: id, method: method, params: params }; }
function toolCall(id, name, args) { return rpc(id, 'tools/call', { name: name, arguments: args }); }
function parsed(res) { return JSON.parse(res.result.content[0].text); }

function session(dir) {
  var p = cp.spawn(process.execPath, [path.join(ROOT, 'mcp-server.js')], { env: Object.assign({}, process.env, { FLOW_DIR: dir, FLOW_STORE: 'files' }) });
  var buf = '', waiters = {};
  p.stdout.on('data', function (c) {
    buf += c; var i;
    while ((i = buf.indexOf('\n')) >= 0) {
      var m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (waiters[m.id]) { waiters[m.id](m); delete waiters[m.id]; }
    }
  });
  return {
    call: function (msg) { return new Promise(function (r) { waiters[msg.id] = r; p.stdin.write(JSON.stringify(msg) + '\n'); }); },
    close: function () { p.kill(); }
  };
}

var DOC = {
  title: 'T', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  steps: [{ from: 'a', to: 'b', label: 'go' }]
};

test('stdio: initialize, list, create, edit, reject invalid', async function () {
  var dir = tmp(), s = session(dir);
  try {
    var init = await s.call(rpc(1, 'initialize', { protocolVersion: '2025-03-26' }));
    assert.strictEqual(init.result.serverInfo.name, 'flow-animator');
    var tl = await s.call(rpc(2, 'tools/list'));
    assert.ok(tl.result.tools.some(function (t) { return t.name === 'add_step'; }));

    var c = await s.call(toolCall(3, 'create_flow', { file: 'x.flow.json', document: DOC }));
    assert.strictEqual(parsed(c).ok, true);
    var a = await s.call(toolCall(4, 'add_node', { file: 'x.flow.json', id: 'c', label: 'C' }));
    assert.strictEqual(parsed(a).stats.nodes, 3);
    var st = await s.call(toolCall(5, 'add_step', { file: 'x.flow.json', from: 'b', to: 'c', label: 'next', at: 0 }));
    assert.strictEqual(parsed(st).ok, true);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'x.flow.json'), 'utf8')).steps[0].label, 'next');

    var before = fs.readFileSync(path.join(dir, 'x.flow.json'), 'utf8');
    var bad = await s.call(toolCall(6, 'add_step', { file: 'x.flow.json', from: 'a', to: 'nope', label: 'bad' }));
    assert.strictEqual(bad.result.isError, true);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'x.flow.json'), 'utf8'), before, 'file untouched');

    var rm = await s.call(toolCall(7, 'remove_node', { file: 'x.flow.json', id: 'c' }));
    assert.strictEqual(rm.result.isError, true);
    var rm2 = await s.call(toolCall(8, 'remove_node', { file: 'x.flow.json', id: 'c', cascade: true }));
    assert.strictEqual(parsed(rm2).stats.steps, 1);

    var ls = await s.call(toolCall(9, 'list_flows', {}));
    assert.strictEqual(parsed(ls).flows[0].file, 'x.flow.json');
  } finally { s.close(); }
});

test('path traversal and bad names are rejected', async function () {
  var dir = tmp(), s = session(dir);
  try {
    for (var n of ['../evil.flow.json', 'a/b.flow.json', '.hidden.flow.json', 'x.json']) {
      var r = await s.call(toolCall(1, 'create_flow', { file: n, document: DOC }));
      assert.strictEqual(r.result.isError, true, n);
    }
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  } finally { s.close(); }
});

test('http: auth, tools/call, notification, health', async function () {
  var dir = tmp();
  process.env.MCP_TOKEN = 't0k';
  process.env.FLOW_STORE = 'files';
  var mod = require('../mcp-server.js');
  mod.store.dir = path.resolve(dir);
  var server = mod.runHttp(0);
  await new Promise(function (r) { server.on('listening', r); });
  var port = server.address().port;
  var base = 'http://127.0.0.1:' + port;
  try {
    assert.strictEqual((await fetch(base + '/healthz')).status, 200);
    var noauth = await fetch(base + '/mcp', { method: 'POST', body: '{}' });
    assert.strictEqual(noauth.status, 401);
    var h = { 'Content-Type': 'application/json', Authorization: 'Bearer t0k' };
    var note = await fetch(base + '/mcp', { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    assert.strictEqual(note.status, 202);
    var r = await fetch(base + '/mcp', { method: 'POST', headers: h, body: JSON.stringify(toolCall(1, 'create_flow', { file: 'h.flow.json', document: DOC })) });
    assert.strictEqual(parsed(await r.json()).ok, true);
    assert.ok(fs.existsSync(path.join(dir, 'h.flow.json')));
    assert.strictEqual((await fetch(base + '/mcp', { headers: h })).status, 405);
  } finally { server.close(); delete process.env.MCP_TOKEN; }
});

test('tool schemas only use string enums (strict clients reject null in enum)', function () {
  var bad = [];
  (function walk(n, where) {
    if (Array.isArray(n)) return n.forEach(function (x, i) { walk(x, where + '[' + i + ']'); });
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n.enum) && n.enum.some(function (v) { return typeof v !== 'string'; })) bad.push(where);
    Object.keys(n).forEach(function (k) { walk(n[k], where + '.' + k); });
  })(require('../mcp-server.js').TOOLS, 'TOOLS');
  assert.deepStrictEqual(bad, []);
});
