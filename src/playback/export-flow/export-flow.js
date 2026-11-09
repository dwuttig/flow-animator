/*
 * export-flow: turn the shown Flow into a file (Playback context, browser only).
 *   ExportFlow.scriptsOf(pageHtml)                       -> ['flow-core.js', ...] the page's external scripts, in order
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
  /* The page's script manifest: its external script tags, in order. The page is the single source of truth. */
  var TAG = new RegExp('<script src="([^"]+)"></' + 'script>', 'g');
  function scriptsOf(pageHtml) {
    var out = [], m;
    TAG.lastIndex = 0;
    while ((m = TAG.exec(String(pageHtml)))) out.push(m[1]);
    return out;
  }

  function safe(s) { return s.replace(/<\//g, '<\\/'); }

  function fileName(title, ext) {
    var base = String(title || 'flow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flow';
    return base + (ext === 'json' ? '.flow.json' : ext === 'svg' ? '.svg' : '.html');
  }

  /* pageHtml: index.html; sources: {path: text}. flowText must be valid JSON. */
  function standaloneHtml(pageHtml, sources, flowText) {
    // Built from pieces so these markers never appear literally in this file, which gets inlined into bundles.
    var open = '<script id="', DATA = open + 'flow-data"', SAMPLE = open + 'sample-flow"';
    var data = '<script id="' + 'flow-data' + '" type="application/json">' + safe(JSON.stringify(JSON.parse(flowText))) + '</script>';
    var html = String(pageHtml).split('\r\n').join('\n').replace(new RegExp(DATA + '[^>]*>[\\s\\S]*?<' + '/script>\\n?'), '');
    scriptsOf(html).forEach(function (f) {
      if (typeof sources[f] !== 'string') throw new Error('missing script source: ' + f);
      html = html.replace('<script src="' + f + '"></' + 'script>', function () { return '<script>\n' + safe(sources[f]) + '\n</' + 'script>'; });
    });
    // Data goes in front of the wiring script; a page that is already bundled only gets its data swapped.
    var i = html.indexOf(SAMPLE);
    if (i < 0) throw new Error('unrecognised viewer page');
    return html.slice(0, i) + data + '\n' + html.slice(i);
  }

  function fetchStandalone(f, pageUrl, flowText) {
    var base = String(pageUrl).split('#')[0].split('?')[0];
    function get(u) { return f(u, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + u); return r.text(); }); }
    return get(base).then(function (page) {
      var list = scriptsOf(page), dir = base.replace(/[^/]*$/, '');
      if (!list.length) return standaloneHtml(page, {}, flowText);
      return Promise.all(list.map(function (s) { return get(dir + s); })).then(function (texts) {
        var sources = {}; list.forEach(function (s, i) { sources[s] = texts[i]; });
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

  return { scriptsOf: scriptsOf, fileName: fileName, standaloneHtml: standaloneHtml, fetchStandalone: fetchStandalone, download: download };
});
