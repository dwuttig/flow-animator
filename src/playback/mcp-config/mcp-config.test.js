'use strict';
var test = require('node:test');
var assert = require('node:assert');
var M = require('./mcp-config.js');

test('stdio config runs the mcp image through docker', function () {
  var r = M.build({ mode: 'stdio', flowsDir: 'flow-animator-data' });
  var e = r.json.mcpServers['flow-animator'];
  assert.strictEqual(e.command, 'docker');
  assert.deepStrictEqual(e.args.slice(0, 5), ['run', '-i', '--rm', '-v', 'flow-animator-data:/data']);
  assert.ok(r.command.indexOf('claude mcp add flow-animator -- docker run -i') === 0);
  assert.deepStrictEqual(JSON.parse(r.text), r.json);
});

test('http config targets :8081/mcp and adds the token only when given', function () {
  var a = M.build({ mode: 'http', host: 'localhost' }).json.mcpServers['flow-animator'];
  assert.strictEqual(a.url, 'http://localhost:8081/mcp');
  assert.strictEqual(a.headers, undefined);
  var b = M.build({ mode: 'http', host: 'localhost', token: ' s3 ' });
  assert.strictEqual(b.json.mcpServers['flow-animator'].headers.Authorization, 'Bearer s3');
  assert.ok(b.command.indexOf('--header "Authorization: Bearer s3"') > 0);
});

test('windows config uses docker.exe (CreateProcess cannot run the extensionless docker)', function () {
  var r = M.build({ mode: 'stdio', windows: true });
  assert.strictEqual(r.json.mcpServers['flow-animator'].command, 'docker.exe');
  assert.ok(r.command.indexOf('-- docker.exe run') > 0);
});
