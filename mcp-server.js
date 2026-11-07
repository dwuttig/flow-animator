#!/usr/bin/env node
/*
 * mcp-server.js: MCP server to create and edit flow-animator files.
 * No dependencies. Speaks MCP (JSON-RPC 2.0) over stdio or Streamable HTTP.
 *
 *   node mcp-server.js                 stdio (default)
 *   node mcp-server.js --http [PORT]   HTTP on PORT (default 8081), endpoint POST /mcp
 *   node mcp-server.js --import [DIR]  copy DIR/*.flow.json (default FLOW_DIR) into the SQLite database, keeping existing names
 *
 * Environment:
 *   FLOW_STORE  sqlite (default) or files
 *   FLOW_DB     SQLite database file (default <FLOW_DIR>/flows.db)
 *   FLOW_DIR    directory holding *.flow.json files (default ./flows); with sqlite it is the import source
 *   FLOW_IMPORT 0 = do not import FLOW_DIR into a new database on first start
 *   MCP_TOKEN   if set, HTTP requests must send "Authorization: Bearer <token>"
 *   MCP_HOST    HTTP bind address (default 127.0.0.1; the Docker image sets 0.0.0.0)
 *   PORT        HTTP port if not given on the command line
 *
 * HTTP also serves the Flow API (same token): GET /api/flows, GET|PUT|DELETE /api/flows/<name>.
 * See docs/features/flow-storage.md.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var http = require('http');
var S = require('./flow-store.js');

var PROTOCOL = '2025-03-26';
var SUPPORTED = ['2025-03-26', '2024-11-05'];
var store = S.openStore(process.env);

/* ---------- tool definitions ---------- */

var STR = { type: 'string' };
var FILE = { type: 'string', description: 'Unique flow name, e.g. "orders" (no suffix needed; a trailing .flow.json is accepted)' };
var COLORS = { enum: ['gray', 'purple', 'teal', 'coral', 'pink', 'blue', 'green', 'amber', 'red'] };
var SHAPE = { enum: ['box', 'database', 'queue'] };
var KIND = { enum: ['sync', 'async', 'response', 'event'] };
var INT = { type: 'integer', minimum: 0 };
var NULLNOTE = ' Pass null to remove the field.';

function obj(props, required) {
  props.file = FILE;
  return { type: 'object', properties: props, required: ['file'].concat(required || []), additionalProperties: false };
}

var TOOLS = [
  { name: 'list_flows', description: 'List flow files with title and node/step counts.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'read_flow', description: 'Return the full JSON of a flow file.', inputSchema: obj({}) },
  { name: 'validate_flow', description: 'Validate a file, or an inline document, without writing. Returns errors (blocking), warnings and stats.',
    inputSchema: { type: 'object', properties: { file: FILE, document: { type: 'object', description: 'Inline flow document instead of a file' } }, additionalProperties: false } },
  { name: 'create_flow', description: 'Create a flow file from a complete document (format flow-animator/1: nodes + steps, optional groups; never coordinates). Read resource flow://guide first. Fails if the file exists unless overwrite is true. Invalid documents are rejected.',
    inputSchema: obj({ document: { type: 'object' }, overwrite: { type: 'boolean' } }, ['document']) },
  { name: 'delete_flow', description: 'Delete a flow file. Requires confirm:true.', inputSchema: obj({ confirm: { type: 'boolean' } }, ['confirm']) },
  { name: 'set_meta', description: 'Change title, description or layout direction (LR or TB).' + NULLNOTE,
    inputSchema: obj({ title: STR, description: { type: ['string', 'null'] }, direction: { enum: ['LR', 'TB'] } }) },
  { name: 'add_group', description: 'Add a node group (colored band).', inputSchema: obj({ id: STR, label: STR, color: COLORS }, ['id']) },
  { name: 'update_group', description: 'Change a group.' + NULLNOTE, inputSchema: obj({ id: STR, label: { type: ['string', 'null'] }, color: COLORS }, ['id']) },
  { name: 'remove_group', description: 'Remove a group. If nodes use it, pass cascade:true to ungroup them.', inputSchema: obj({ id: STR, cascade: { type: 'boolean' } }, ['id']) },
  { name: 'add_node', description: 'Add a component. Position is automatic; col/row are optional grid hints only.',
    inputSchema: obj({ id: STR, label: { type: 'string', maxLength: 28 }, subtitle: { type: 'string', maxLength: 36 }, group: STR, shape: SHAPE, col: INT, row: INT }, ['id', 'label']) },
  { name: 'update_node', description: 'Change a node. new_id renames it and updates steps.' + NULLNOTE,
    inputSchema: obj({ id: STR, new_id: STR, label: STR, subtitle: { type: ['string', 'null'] }, group: { type: ['string', 'null'] }, shape: SHAPE, col: { type: ['integer', 'null'] }, row: { type: ['integer', 'null'] } }, ['id']) },
  { name: 'remove_node', description: 'Remove a node. If steps use it, pass cascade:true to remove those steps too.', inputSchema: obj({ id: STR, cascade: { type: 'boolean' } }, ['id']) },
  { name: 'add_step', description: 'Add an interaction between two existing nodes. Appended unless "at" (0-based position) is given. together:true runs it in parallel with the previous step.',
    inputSchema: obj({ from: STR, to: STR, label: STR, detail: STR, payload: STR, kind: KIND, together: { type: 'boolean' }, at: INT }, ['from', 'to', 'label']) },
  { name: 'update_step', description: 'Change the step at a 0-based index.' + NULLNOTE,
    inputSchema: obj({ index: INT, from: STR, to: STR, label: STR, detail: { type: ['string', 'null'] }, payload: { type: ['string', 'null'] }, kind: KIND, together: { type: ['boolean', 'null'] } }, ['index']) },
  { name: 'remove_step', description: 'Remove the step at a 0-based index.', inputSchema: obj({ index: INT }, ['index']) },
  { name: 'set_parallel', description: 'Make the step at "index" play in one beat with exactly the steps listed in "with" (0-based). Chosen steps are moved next to it and stored as together flags; steps no longer chosen become their own beat. Empty "with" = plays alone.',
    inputSchema: obj({ index: INT, with: { type: 'array', items: INT } }, ['index', 'with']) },
  { name: 'move_step', description: 'Move a step from one 0-based index to another.', inputSchema: obj({ index: INT, to_index: INT }, ['index', 'to_index']) }
];

/* Optional optimistic-concurrency parameter on every Tool that writes. */
var REVISION = { type: 'string', description: 'Revision of the flow you last read (from list_flows, read_flow with with_revision, or a previous write). If the file changed since, the write is rejected with a conflict. Omit for last-write-wins.' };
TOOLS.forEach(function (t) {
  if (['read_flow', 'validate_flow', 'list_flows'].indexOf(t.name) >= 0) return;
  t.inputSchema.properties.expected_revision = REVISION;
});
TOOLS.filter(function (t) { return t.name === 'read_flow'; })[0].inputSchema.properties.with_revision =
  { type: 'boolean', description: 'Return { revision, document } instead of the bare document.' };

var EDIT_OPS = ['set_meta', 'add_group', 'update_group', 'remove_group', 'add_node', 'update_node', 'remove_node', 'add_step', 'update_step', 'remove_step', 'move_step', 'set_parallel'];

function preconditions(a) {
  return typeof a.expected_revision === 'string' && a.expected_revision ? { ifMatch: a.expected_revision } : {};
}

function callTool(name, a) {
  a = a || {};
  switch (name) {
    case 'list_flows': return { flows: store.list() };
    case 'read_flow':
      if (a.with_revision) { var rr = store.readWithRevision(a.file); return { revision: rr.revision, document: rr.doc }; }
      return store.read(a.file);
    case 'validate_flow':
      if (a.document) return S.validate(a.document);
      return S.validate(store.read(a.file));
    case 'create_flow':
      if (!a.document || typeof a.document !== 'object') throw S.fail('"document" is required');
      if (store.exists(a.file) && !a.overwrite) throw S.fail(a.file + ' already exists. Use edit tools, or pass overwrite:true.');
      return store.write(a.file, a.document, preconditions(a));
    case 'delete_flow':
      if (a.confirm !== true) throw S.fail('Pass confirm:true to delete ' + a.file);
      var dr = store.remove(a.file, preconditions(a));
      return dr.ok ? { ok: true, deleted: a.file } : dr;
  }
  if (EDIT_OPS.indexOf(name) >= 0) return store.edit(a.file, name, a, preconditions(a));
  var e = new Error('Unknown tool: ' + name); e.rpc = -32602; throw e;
}

/* ---------- resources ---------- */

var RESOURCES = [
  { uri: 'flow://schema', name: 'Flow file JSON schema', mimeType: 'application/json', file: 'flow.schema.json' },
  { uri: 'flow://guide', name: 'Format guide for writing flows (README)', mimeType: 'text/markdown', file: 'README.md' }
];

function readResource(uri) {
  var r = RESOURCES.filter(function (x) { return x.uri === uri; })[0];
  if (!r) { var e = new Error('Unknown resource: ' + uri); e.rpc = -32002; throw e; }
  var p = path.join(__dirname, r.file);
  var text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '(' + r.file + ' not available in this install)';
  return { contents: [{ uri: uri, mimeType: r.mimeType, text: text }] };
}

/* ---------- JSON-RPC ---------- */

function handle(msg) {
  // Returns a response object, or null for notifications.
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return { jsonrpc: '2.0', id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32600, message: 'Invalid request' } };
  }
  var isNote = msg.id === undefined || msg.id === null;
  var p = msg.params || {};
  try {
    var result;
    switch (msg.method) {
      case 'initialize':
        result = {
          protocolVersion: SUPPORTED.indexOf(p.protocolVersion) >= 0 ? p.protocolVersion : PROTOCOL,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'flow-animator', version: '0.1.0' },
          instructions: 'Create and edit flow-animator files. Read resource flow://guide for the format. Edits are validated; invalid changes are rejected and the file is left untouched.'
        };
        break;
      case 'ping': result = {}; break;
      case 'tools/list': result = { tools: TOOLS }; break;
      case 'tools/call':
        try {
          var out = callTool(p.name, p.arguments);
          result = { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: !!(out && out.ok === false) };
        } catch (e) {
          if (!e.userError) throw e;
          result = { content: [{ type: 'text', text: e.message }], isError: true };
        }
        break;
      case 'resources/list': result = { resources: RESOURCES.map(function (r) { return { uri: r.uri, name: r.name, mimeType: r.mimeType }; }) }; break;
      case 'resources/read': result = readResource(p.uri); break;
      default:
        if (isNote) return null;
        return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found: ' + msg.method } };
    }
    return isNote ? null : { jsonrpc: '2.0', id: msg.id, result: result };
  } catch (e) {
    if (isNote) return null;
    return { jsonrpc: '2.0', id: msg.id, error: { code: e.rpc || -32603, message: e.message } };
  }
}

function handleAny(body) {
  if (Array.isArray(body)) {
    var rs = body.map(handle).filter(Boolean);
    return rs.length ? rs : null;
  }
  return handle(body);
}

/* ---------- transports ---------- */

function runStdio() {
  var buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (chunk) {
    buf += chunk;
    var i;
    while ((i = buf.indexOf('\n')) >= 0) {
      var line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      var out;
      try { out = handleAny(JSON.parse(line)); }
      catch (e) { out = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }; }
      if (out) process.stdout.write(JSON.stringify(out) + '\n');
    }
  });
  process.stdin.on('end', function () { process.exit(0); });
  console.error('flow-animator MCP server on stdio, storage=' + store.dir);
}

/* ---------- Flow API (Flow Library, slice flow-http-api) ---------- */

function etagOf(rev) { return '"' + rev + '"'; }
/* Parse an If-Match / If-None-Match header value into a revision or '*'. */
function headerRev(v) {
  if (typeof v !== 'string' || !v) return undefined;
  v = v.trim();
  if (v === '*') return '*';
  return v.replace(/^W\//, '').replace(/^"|"$/g, '');
}

function flowApi(req, res, url, send, MAX) {
  var rest = url.slice('/api/flows'.length).replace(/^\//, '');
  var name;
  try { name = rest ? decodeURIComponent(rest) : null; } catch (e) { return send(res, 400, { error: 'bad file name encoding' }); }
  var m = req.method;
  try {
    if (!name) {
      if (m !== 'GET') return send(res, 405, { error: 'use GET' }, { Allow: 'GET' });
      return send(res, 200, { flows: store.list() });
    }
    store.resolve(name); // validates the name, throws userError
    if (m === 'GET') {
      var cur = store.revision(name);
      if (cur === null) return send(res, 404, { error: 'no such flow: ' + name });
      if (headerRev(req.headers['if-none-match']) === cur) { res.writeHead(304, { ETag: etagOf(cur), 'Cache-Control': 'no-store' }); return res.end(); }
      var r = store.readWithRevision(name);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ETag: etagOf(r.revision) });
      return res.end(r.text);
    }
    var ifMatch = headerRev(req.headers['if-match']), ifNone = headerRev(req.headers['if-none-match']);
    var opts = {};
    if (ifMatch && ifMatch !== '*') opts.ifMatch = ifMatch;
    if (ifNone === '*') opts.ifNoneMatch = '*';
    if (m === 'DELETE') {
      if (!store.exists(name)) return send(res, 404, { error: 'no such flow: ' + name });
      var d = store.remove(name, opts);
      if (d.conflict) return send(res, 412, { error: 'conflict', revision: d.revision }, { ETag: etagOf(d.revision) });
      res.writeHead(204); return res.end();
    }
    if (m !== 'PUT') return send(res, 405, { error: 'use GET, PUT or DELETE' }, { Allow: 'GET, PUT, DELETE' });
    var size = 0, chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > MAX) { send(res, 413, { error: 'request too large' }); req.destroy(); } else chunks.push(c);
    });
    req.on('end', function () {
      if (res.writableEnded) return;
      var doc;
      try { doc = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch (e) { return send(res, 400, { error: 'body is not valid JSON' }); }
      try {
        var w = store.write(name, doc, opts);
        if (w.conflict) return send(res, 412, { error: 'conflict', revision: w.revision }, { ETag: etagOf(w.revision) });
        if (!w.ok) return send(res, 422, { error: 'invalid flow', errors: w.errors, warnings: w.warnings });
        send(res, w.created ? 201 : 200, { ok: true, revision: w.revision, warnings: w.warnings, stats: w.stats }, { ETag: etagOf(w.revision) });
      } catch (e) { apiError(e, send, res); }
    });
  } catch (e) { apiError(e, send, res); }
}

function apiError(e, send, res) {
  if (e.userError) return send(res, 400, { error: e.message });
  console.error(e);
  send(res, 500, { error: 'internal error' });
}

function runHttp(port) {
  var token = process.env.MCP_TOKEN || '';
  var host = process.env.MCP_HOST || '127.0.0.1';
  var MAX = 1024 * 1024;
  function send(res, code, obj, headers) {
    var body = obj === undefined ? '' : JSON.stringify(obj);
    res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, headers || {}));
    res.end(body);
  }
  var server = http.createServer(function (req, res) {
    var url = req.url.split('?')[0];
    if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok\n'); }
    if (url !== '/mcp' && url !== '/api/flows' && url.indexOf('/api/flows/') !== 0) return send(res, 404, { error: 'not found; endpoints are /mcp and /api/flows' });
    if (token && req.headers.authorization !== 'Bearer ' + token) return send(res, 401, { error: 'missing or wrong bearer token' });
    if (url !== '/mcp') return flowApi(req, res, url, send, MAX);
    if (req.method !== 'POST') return send(res, 405, { error: 'use POST' }, { Allow: 'POST' });
    var size = 0, chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > MAX) { send(res, 413, { error: 'request too large' }); req.destroy(); } else chunks.push(c);
    });
    req.on('end', function () {
      if (res.writableEnded) return;
      var out;
      try { out = handleAny(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
      if (!out) { res.writeHead(202); return res.end(); }
      send(res, 200, out);
    });
  });
  server.listen(port, host, function () {
    console.error('flow-animator MCP server on http://' + host + ':' + server.address().port + '/mcp, storage=' + store.dir + (token ? ', token required' : ', NO token'));
  });
  return server;
}

if (require.main === module) {
  var args = process.argv.slice(2);
  var hi = args.indexOf('--http'), ii = args.indexOf('--import');
  if (ii >= 0) {
    if (typeof store.importDir !== 'function') { console.error('--import needs FLOW_STORE=sqlite'); process.exit(1); }
    var from = args[ii + 1] || process.env.FLOW_DIR || path.join(__dirname, 'flows');
    var ir = store.importDir(from);
    console.log('imported ' + ir.imported.length + ', already present ' + ir.existing.length + ', skipped ' + ir.skipped.length + ' (from ' + from + ' into ' + store.file + ')');
    ir.skipped.forEach(function (k) { console.log('  skipped ' + k.file + ': ' + k.reason); });
  } else if (hi >= 0) {
    var pn = parseInt(args[hi + 1], 10);
    runHttp(isNaN(pn) ? parseInt(process.env.PORT, 10) || 8081 : pn);
  } else runStdio();
}

module.exports = { handle: handle, handleAny: handleAny, runHttp: runHttp, TOOLS: TOOLS, store: store };
