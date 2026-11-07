/*
 * export-flow: turn the shown Flow into a file (Playback context, browser only).
 *   ExportFlow.fileName(title, ext)                      -> 'my-flow.flow.json' | 'my-flow.html'
 *   ExportFlow.standaloneHtml(pageHtml, sources, flowText) -> one self-contained HTML string (pure)
 *   ExportFlow.fetchStandalone(fetch, pageUrl, flowText) -> Promise<string>  (loads the viewer's own files)
 *   ExportFlow.download(doc, name, mime, content)
 * Mirrors build-standalone.js (CLI) so both produce the same bundle.
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.ExportFlow = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var SCRIPTS = ['flow-core.js', 'src/flow-library/apply-edit/apply-edit.js', 'src/playback/edit-flow/edit-flow.js', 'src/playback/flow-gateway/flow-gateway.js', 'src/playback/save-flow/save-flow.js', 'src/playback/mcp-config/mcp-config.js', 'src/playback/export-flow/export-flow.js', 'src/playback/flow-menu/flow-menu.js'];

  function safe(s) { return s.replace(/<\//g, '<\\/'); }

  function fileName(title, ext) {
    var base = String(title || 'flow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flow';
    return base + (ext === 'json' ? '.flow.json' : '.html');
  }

  /* pageHtml: index.html; sources: {path: text}. flowText must be valid JSON. */
  function standaloneHtml(pageHtml, sources, flowText) {
    // Built from pieces so these markers never appear literally in this file, which gets inlined into bundles.
    var open = '<script id="', DATA = open + 'flow-data"', SAMPLE = open + 'sample-flow"';
    var data = '<script id="' + 'flow-data' + '" type="application/json">' + safe(JSON.stringify(JSON.parse(flowText))) + '</script>';
    var html = String(pageHtml).split('\r\n').join('\n').replace(new RegExp(DATA + '[^>]*>[\\s\\S]*?<' + '/script>\\n?'), '');
    var block = SCRIPTS.map(function (f) { return '<script src="' + f + '"></script>'; }).join('\n');
    if (html.indexOf(block) >= 0) {
      var inline = SCRIPTS.map(function (f) { return '<script>\n' + safe(sources[f]) + '\n</script>'; }).join('\n');
      return html.replace(block, function () { return inline + '\n' + data; });
    }
    // Already bundled (the page carries its scripts inline): only swap the data.
    var i = html.indexOf(SAMPLE);
    if (i < 0) throw new Error('unrecognised viewer page');
    return html.slice(0, i) + data + '\n' + html.slice(i);
  }

  function fetchStandalone(f, pageUrl, flowText) {
    var base = String(pageUrl).split('#')[0].split('?')[0];
    function get(u) { return f(u, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + u); return r.text(); }); }
    return get(base).then(function (page) {
      if (page.indexOf('<script src="' + SCRIPTS[0] + '"></script>') < 0) return standaloneHtml(page, {}, flowText);
      var dir = base.replace(/[^/]*$/, '');
      return Promise.all(SCRIPTS.map(function (s) { return get(dir + s); })).then(function (texts) {
        var sources = {}; SCRIPTS.forEach(function (s, i) { sources[s] = texts[i]; });
        return standaloneHtml(page, sources, flowText);
      });
    });
  }

  function download(doc, name, mime, content) {
    var url = URL.createObjectURL(new Blob([content], { type: mime }));
    var a = doc.createElement('a'); a.href = url; a.download = name;
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  return { SCRIPTS: SCRIPTS, fileName: fileName, standaloneHtml: standaloneHtml, fetchStandalone: fetchStandalone, download: download };
});
