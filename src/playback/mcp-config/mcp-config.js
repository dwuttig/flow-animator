/*
 * mcp-config: copy-ready MCP client configuration (Playback context, browser + Node).
 *   McpConfig.build({ mode: 'stdio'|'http', host, token, flowsDir, image, port })
 *     -> { json: <object>, text: <pretty JSON>, command: <claude mcp add ...> }
 *   McpConfig.create(doc, getHost) -> { open() }   (dialog UI)
 * Pure builder; the dialog only renders and copies.
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.McpConfig = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var NAME = 'flow-animator';

  function q(s) { return /[\s"']/.test(s) ? '"' + s.replace(/"/g, '\\"') + '"' : s; }

  function build(o) {
    o = o || {};
    var port = o.port || 8081, host = o.host || 'localhost', token = (o.token || '').trim();
    var image = o.image || 'flow-animator-mcp:latest', dir = o.flowsDir || '/path/to/flows';
    var entry, command;
    if (o.mode === 'http') {
      var url = 'http://' + host + ':' + port + '/mcp';
      entry = { type: 'http', url: url };
      command = 'claude mcp add --transport http ' + NAME + ' ' + url;
      if (token) {
        entry.headers = { Authorization: 'Bearer ' + token };
        command += ' --header ' + q('Authorization: Bearer ' + token);
      }
    } else {
      var args = ['run', '-i', '--rm', '-v', dir + ':/flows', image, 'node', 'mcp-server.js'];
      var exe = o.windows ? 'docker.exe' : 'docker';
      entry = { command: exe, args: args };
      command = 'claude mcp add ' + NAME + ' -- ' + exe + ' ' + args.map(q).join(' ');
    }
    var json = { mcpServers: {} };
    json.mcpServers[NAME] = entry;
    return { json: json, text: JSON.stringify(json, null, 2), command: command };
  }

  function create(doc, getHost) {
    var dlg = null, mode = 'stdio', pre, cmd, note, tokenIn, dirIn, tokenRow, dirRow, tabs = {};

    function el(tag, text, parent, attrs) {
      var e = doc.createElement(tag);
      if (text) e.textContent = text;
      if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      if (parent) parent.appendChild(e);
      return e;
    }
    function copy(text, btn) {
      var done = function () { var t = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = t; }, 1500); };
      var nav = doc.defaultView && doc.defaultView.navigator;
      if (nav && nav.clipboard) nav.clipboard.writeText(text).then(done, done);
      else done();
    }
    function update() {
      var r = build({ mode: mode, host: getHost && getHost(), token: tokenIn.value, flowsDir: dirIn.value, windows: /Win/i.test((doc.defaultView && doc.defaultView.navigator.platform) || '') });
      pre.textContent = r.text; cmd.textContent = r.command;
      Object.keys(tabs).forEach(function (k) { tabs[k].setAttribute('aria-pressed', k === mode ? 'true' : 'false'); });
      tokenRow.hidden = mode !== 'http'; dirRow.hidden = mode !== 'stdio';
      note.textContent = mode === 'http'
        ? 'Needs the mcp service running (docker compose up). If MCP_TOKEN is set on the server, enter it here.'
        : 'Runs a throw-away container per session. The folder must be the one the viewer serves as ./flows (an absolute path, e.g. C:/flows or /home/you/flows).';
    }
    function buildDialog() {
      dlg = el('dialog', null, doc.body, { id: 'mcpDlg', 'aria-labelledby': 'mcpTitle' });
      var box = el('div', null, dlg, { 'class': 'mcpbox' });
      el('h2', 'MCP configuration', box, { id: 'mcpTitle' });
      el('p', 'Lets Claude (or any MCP client) create and edit your flows. Paste into the client\u2019s MCP settings, for example claude_desktop_config.json or .mcp.json.', box);
      var bar = el('div', null, box, { 'class': 'mcptabs' });
      tabs.stdio = el('button', 'stdio via Docker', bar, { type: 'button' });
      tabs.http = el('button', 'HTTP (port 8081)', bar, { type: 'button' });
      tabs.stdio.addEventListener('click', function () { mode = 'stdio'; update(); });
      tabs.http.addEventListener('click', function () { mode = 'http'; update(); });
      dirRow = el('label', 'Flows folder on this machine ', box, { 'class': 'mcprow' });
      dirIn = el('input', null, dirRow, { type: 'text', value: '/path/to/flows', spellcheck: 'false' });
      tokenRow = el('label', 'Access token (optional) ', box, { 'class': 'mcprow' });
      tokenIn = el('input', null, tokenRow, { type: 'text', placeholder: 'MCP_TOKEN', spellcheck: 'false', autocomplete: 'off' });
      dirIn.addEventListener('input', update); tokenIn.addEventListener('input', update);
      var h1 = el('div', null, box, { 'class': 'mcphead' });
      el('strong', 'JSON', h1);
      var c1 = el('button', 'Copy', h1, { type: 'button' });
      pre = el('pre', null, box);
      c1.addEventListener('click', function () { copy(pre.textContent, c1); });
      var h2 = el('div', null, box, { 'class': 'mcphead' });
      el('strong', 'Claude Code command', h2);
      var c2 = el('button', 'Copy', h2, { type: 'button' });
      cmd = el('pre', null, box);
      c2.addEventListener('click', function () { copy(cmd.textContent, c2); });
      note = el('p', null, box, { 'class': 'mcpnote' });
      var close = el('button', 'Close', box, { type: 'button' });
      close.addEventListener('click', function () { dlg.close(); });
    }
    return {
      open: function () { if (!dlg) buildDialog(); update(); dlg.showModal(); }
    };
  }

  return { build: build, create: create };
});
