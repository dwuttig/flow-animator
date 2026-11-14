/*
 * viewer: boots the Playback context in the page (browser only). Pure wiring: it connects the page
 * controls to the slices play-flow, render-diagram, view-options, dialogs, edit-flow, flow-gateway,
 * save-flow, flow-menu, export-flow, mcp-config and record-video. It holds no domain rules.
 * Loaded last by index.html, after the embedded flow data and the built-in example.
 */
(function () {
  'use strict';
  var C = window.FlowCore, doc = document;

  function $(id) { return doc.getElementById(id); }
  function h(tag, cls, text, parent) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function nodeLabel(model, id) {
    for (var i = 0; i < model.nodes.length; i++) if (model.nodes[i].id === id) return model.nodes[i].label;
    return id;
  }

  $('pal').textContent = window.RenderDiagram.paletteCss();

  var S = { model: null, geo: null, text: '', name: '', apiUp: false };
  var reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var ask = window.Dialogs.create(doc);

  /* ---------- diagram, player and view settings ---------- */

  var V = window.ViewOptions.load(window.localStorage, C.CONNECTIONS);

  var diagram = window.RenderDiagram.create(doc, {
    svg: $('svg'), stage: $('stage'), legend: $('legend'), steps: $('steps'), cap: $('cap'), core: C,
    onPick: function (i) { player.jump(S.model.stepBeat[i], true); }
  });

  var player = window.PlayFlow.create({
    begin: function (i) { diagram.begin(i); paint(); },
    move: function (t) { diagram.move(t); },
    arrive: function () { diagram.hidePackets(); paint(); },
    change: function () { paint(); }
  }, { playing: !reduced, loop: $('loop').checked, speed: parseFloat($('spd').value) || 1 });
  var frames = window.PlayFlow.loop(player, { raf: function (f) { return requestAnimationFrame(f); }, caf: function (id) { cancelAnimationFrame(id); } });

  function paint() {
    if (!S.model) return;
    var st = player.state();
    diagram.paint({ idx: st.idx, arrived: st.arrived, trail: $('trail').checked });
    $('scrub').value = String(st.idx);
    $('count').textContent = (st.idx + 1) + ' / ' + st.beats;
    $('play').textContent = st.playing ? 'Pause' : (st.finished ? 'Replay' : 'Play');
    frames.sync();
  }

  var panel = window.ViewOptions.bind(doc, V, {
    relayout: relayout,
    look: function () { diagram.look(V); },
    change: function () { window.ViewOptions.save(window.localStorage, V); }
  });

  function relayout() {
    if (!S.model) return;
    var st = player.state();
    S.geo = C.layout(S.model, window.ViewOptions.layoutOpts(V, S.model));
    diagram.render(S.model, S.geo, true);
    diagram.look(V);
    player.jump(st.idx, st.arrived);
  }

  /* ---------- editor mode (slice edit-flow) ---------- */

  var editor = window.FlowEditor && window.FlowEdits ? window.FlowEditor.create({
    getText: function () { return S.text || ''; },
    show: function (text, name, res) { loadText(text, name, res, true); },
    jumpToStep: function (i) { player.jump(S.model.stepBeat[i], true); },
    highlight: function (sel) { diagram.select(sel); },
    report: function (errors, warnings) { showIssues(errors, warnings, 'edit', true); },
    pause: function () { player.setPlaying(false); },
    confirm: function (m) { return ask.confirm(m); },
    canSave: function () { return S.apiUp; },
    save: function () { return saver.save(); },
    saveAs: function () { return saver.saveAs(); },
    canReload: function () { return !!saver.name(); },
    reload: function () {
      if (!editor.isDirty()) return saver.reload();
      return ask.confirm('Discard unsaved edits and reload the stored version?', { okLabel: 'Discard' }).then(function (ok) { if (ok) return saver.reload(); });
    }
  }, doc, C, window.FlowEdits) : null;

  function discardOk() {
    if (!editor || !editor.isDirty()) return Promise.resolve(true);
    return ask.confirm('Discard unsaved edits?', { okLabel: 'Discard' });
  }
  function guarded(fn) { return discardOk().then(function (ok) { if (ok) return fn(); }); }

  /* ---------- storage (slices flow-gateway, save-flow) ---------- */

  function getToken() { try { return sessionStorage.getItem('flowToken') || ''; } catch (e) { return ''; } }
  function setToken(t) { try { sessionStorage.setItem('flowToken', t); } catch (e) {} }
  function askToken() {
    return ask.prompt('This server needs an access token:', '', { type: 'password', okLabel: 'Use token' }).then(function (t) { if (t) setToken(t); return t; });
  }
  var gateway = window.FlowGateway.create({ getToken: getToken });
  var noteTimer = null;
  function notify(msg) {
    $('note').textContent = msg;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { $('note').textContent = ''; }, 6000);
  }
  function srcLabel() {
    var n = saver.name();
    return n ? 'Stored flow: ' + n + (saver.revision() ? ' · revision ' + saver.revision() : '') : null;
  }
  var saver = window.FlowSaver.create({
    getText: function () { return S.text || ''; },
    show: function (text, name) { loadText(text, name); },
    markClean: function () { if (editor) editor.markClean(); },
    report: function (errors, warnings) { showIssues(errors, warnings, 'save', true); },
    notify: notify,
    askName: function (def) { return ask.prompt('Save as (a unique flow name):', def, { okLabel: 'Save' }); },
    askToken: askToken,
    confirm: function (m) { return ask.confirm(m); },
    changed: function () { var l = srcLabel(); if (l) $('src').textContent = l; picker.select(saver.name()); picker.refresh(); }
  }, gateway);

  /* ---------- header menu (slices flow-menu, export-flow, mcp-config, record-video) ---------- */

  var NEW_FLOW = JSON.stringify({
    format: 'flow-animator/1', title: 'New flow', description: 'Describe what this flow shows.',
    nodes: [{ id: 'a', label: 'Start' }, { id: 'b', label: 'Next' }],
    steps: [{ from: 'a', to: 'b', label: 'First step', detail: 'Edit me.' }]
  }, null, 2);
  var mcpDialog = window.McpConfig.create(doc, function () { return location.hostname || 'localhost'; });
  function copyText(t) {
    if (navigator.clipboard) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return false; });
    return Promise.resolve(false);
  }
  function exportName(ext) { return window.ExportFlow.fileName(S.model && S.model.title, ext); }
  function deleteStored() {
    var n = saver.name(); if (!n) return;
    ask.confirm('Delete "' + n + '" from the server? This cannot be undone.', { okLabel: 'Delete' }).then(function (ok) {
      if (!ok) return;
      return gateway.remove(n, saver.revision() ? { ifMatch: saver.revision() } : {}).then(function (r) {
        if (r.ok) {
          notify('Deleted ' + n);
          if (editor) editor.markClean();
          loadLocal($('sample-flow').textContent, 'built-in example');
          picker.refresh();
        } else if (r.kind === 'unauthorized') {
          return askToken().then(function (t) { if (t) deleteStored(); });
        } else if (r.kind === 'conflict') notify('Not deleted: "' + n + '" changed on the server. Reload it first.');
        else if (r.kind === 'notfound') { notify(n + ' is already gone'); picker.refresh(); }
        else notify('Not deleted: ' + (r.message || r.kind));
      });
    });
  }

  /* Record the animation once, from the first step, as a video file (slice record-video). */
  var recording = null;
  function recordVideo() {
    if (!S.model || recording) return;
    var saved = null, svg = $('svg'), RV = window.RecordVideo;
    var host = {
      svg: function () { return svg; },
      css: function () {
        var out = '';
        Array.prototype.forEach.call(doc.styleSheets, function (sh) {
          try { Array.prototype.forEach.call(sh.cssRules, function (r) { out += r.cssText + '\n'; }); } catch (e) {}
        });
        return out;
      },
      colors: function () {
        var cs = getComputedStyle(doc.documentElement), g = function (v) { return cs.getPropertyValue(v).trim(); };
        return { bg: g('--bg'), text: g('--text'), text2: g('--text2'), card: g('--card') };
      },
      caption: function () {
        return S.model.beats[player.state().idx].map(function (si) {
          var s = S.model.steps[si];
          return { head: (si + 1) + '. ' + s.label + '   ' + nodeLabel(S.model, s.from) + ' → ' + nodeLabel(S.model, s.to), detail: s.detail || '' };
        });
      },
      prepare: function () {
        var st = player.state();
        saved = { loop: $('loop').checked, playing: st.playing, idx: st.idx, finished: st.finished };
        $('loop').checked = false; player.setLoop(false);
        player.restart(); player.setPlaying(true);
      },
      done: function () { var st = player.state(); return st.finished && !st.playing; },
      progress: function () { return 'Recording video… step ' + (player.state().idx + 1) + ' of ' + S.model.beats.length + ' (Esc cancels)'; },
      restore: function () {
        $('loop').checked = saved.loop; player.setLoop(saved.loop);
        player.jump(saved.idx, true); player.setPlaying(saved.playing && !saved.finished);
      }
    };
    notify('Recording video… keep this tab in front until it finishes (Esc cancels).');
    recording = RV.record(window, host, { onProgress: function (t) { clearTimeout(noteTimer); $('note').textContent = t; } });
    var title = S.model.title;
    recording.done.then(function (r) {
      var name = RV.fileName(title, r.ext);
      window.ExportFlow.download(doc, name, r.blob.type, r.blob);
      notify('Video saved as ' + name + (r.ext === 'webm' ? ' (WebM: PowerPoint may not play it; use Edge or Chrome for MP4)' : '') + '. In PowerPoint: Insert > Video > This Device.');
    }).catch(function (e) {
      notify(e && e.message === 'cancelled' ? 'Recording cancelled.' : 'Could not record the video: ' + (e && e.message ? e.message : e));
    }).then(function () { recording = null; });
  }
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && recording) recording.cancel(); });

  var picker = window.FlowMenu.create(doc, gateway, {
    openStored: function (name) { guarded(function () { return openStored(name); }); },
    openFile: function () { guarded(function () { $('file').click(); }); },
    paste: function () { guarded(function () { $('dlg').showModal(); }); },
    sample: function () { guarded(function () { loadLocal($('sample-flow').textContent, 'built-in example'); }); },
    newFlow: function () {
      guarded(function () {
        loadLocal(NEW_FLOW, 'new flow');
        if (editor && !editor.isActive()) $('editBtn').click();
        notify(S.apiUp ? 'New flow. Use Save as to store it.' : 'New flow. Use Download to keep it.');
      });
    },
    share: function () {
      var n = saver.name(); if (!n) return;
      var link = location.origin + location.pathname + '?flow=' + encodeURIComponent(n);
      copyText(link).then(function (ok) { if (ok) notify('Link copied: ' + link); else ask.prompt('Copy this link:', link, { readOnly: true, okLabel: 'Close' }); });
    },
    remove: deleteStored,
    exportJson: function () {
      if (!S.text) return;
      window.ExportFlow.download(doc, exportName('json'), 'application/json', S.text);
    },
    exportSvg: function () {
      if (!S.model) return;
      window.ExportFlow.download(doc, exportName('svg'), 'image/svg+xml', diagram.svgText(window.RenderDiagram.diagramCss(doc)));
    },
    exportPptx: function () {
      if (!S.model) return;
      var dark = !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
      try {
        var bytes = window.ExportPptx.build({ model: S.model, geo: S.geo, beats: S.model.beats, theme: dark ? 'dark' : 'light', title: S.model.title });
        window.ExportFlow.download(doc, exportName('pptx'), window.ExportPptx.MIME, bytes);
      } catch (e) {
        notify('Could not build the PowerPoint file: ' + (e && e.message ? e.message : e));
      }
    },
    exportHtml: function () {
      if (!S.text) return;
      window.ExportFlow.fetchStandalone(fetch.bind(window), location.href, S.text).then(function (html) {
        window.ExportFlow.download(doc, exportName('html'), 'text/html', html);
      }).catch(function (e) {
        notify('Could not build the standalone HTML: ' + (e && e.message ? e.message : e) + (location.protocol === 'file:' ? ' (serve the viewer over http, or use build-standalone.js)' : ''));
      });
    },
    canRecordVideo: function () { return !!window.RecordVideo.supported(window); },
    exportVideo: recordVideo,
    mcp: function () { mcpDialog.open(); }
  });

  function openStored(name) {
    name = String(name).replace(/\.flow\.json$/i, ''); // older links carry the suffix
    return gateway.load(name).then(function (r) {
      if (!r.ok && r.kind === 'unauthorized') {
        return askToken().then(function (t) { return t ? openStored(name) : r; });
      }
      if (!r.ok) { notify('Could not open ' + name + ': ' + (r.message || r.kind)); picker.select(saver.name()); return r; }
      var res = loadText(r.text, name);
      if (res.ok) { saver.setSource(name, r.revision); picker.select(name); $('src').textContent = srcLabel() || ('Source: ' + name); }
      return r;
    });
  }

  /* Loads that do not come from the Flow Library: forget the stored name. */
  function loadLocal(text, name) { saver.clearSource(); picker.select(null); return loadText(text, name); }

  /* ---------- loading ---------- */

  function showIssues(errors, warnings, name, kept) {
    var box = $('issues');
    box.textContent = '';
    if (!errors.length && !warnings.length) { box.hidden = true; return; }
    box.hidden = false;
    box.className = errors.length ? 'bad' : 'warn';
    var head;
    if (errors.length) {
      head = 'Could not load ' + name + ': ' + errors.length + ' error' + (errors.length > 1 ? 's' : '') +
        (warnings.length ? ' and ' + warnings.length + ' warning' + (warnings.length > 1 ? 's' : '') : '') +
        (kept ? ' (still showing the previous diagram)' : '');
    } else {
      head = name + ' loaded with ' + warnings.length + ' warning' + (warnings.length > 1 ? 's' : '');
    }
    h('div', 'ihead', head, box);
    var ul = h('ul', null, null, box);
    errors.concat(warnings).forEach(function (it) {
      var li = h('li', null, null, ul);
      h('code', null, it.path, li);
      li.appendChild(doc.createTextNode(it.message));
    });
  }

  /* res: an already loaded FlowCore result for text (the editor passes it); keep: keep pan and zoom. */
  function loadText(text, name, res, keep) {
    res = res || C.load(text);
    name = name || 'input';
    if (!res.ok) {
      showIssues(res.errors, res.warnings, name, !!S.model);
      return res;
    }
    player.setPlaying(!reduced); // a freshly loaded flow starts playing
    S.name = name; S.text = text;
    S.model = res.model;
    S.geo = window.ViewOptions.needsLayout(V, res.model) ? C.layout(res.model, window.ViewOptions.layoutOpts(V, res.model)) : res.geometry;
    panel.sync(res.model);
    diagram.render(res.model, S.geo, !!keep);
    diagram.look(V);
    $('scrub').max = String(res.model.beats.length - 1);
    $('title').textContent = res.model.title;
    $('desc').textContent = res.model.description;
    doc.title = res.model.title + ' · Flow animator';
    $('src').textContent = (saver.name() === name && srcLabel()) || ('Source: ' + name);
    showIssues([], res.warnings, name, false);
    player.setBeats(res.model.beats.length, 0);
    if (editor) editor.onLoaded(text);
    return res;
  }

  function loadFromUrl(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }

  function fetchFailed(src, e) {
    var msg = 'Could not fetch ' + src + ': ' + (e && e.message ? e.message : e) + '.';
    if (location.protocol === 'file:') {
      msg += ' Browsers block fetch() on file:// pages. Serve this folder (python3 -m http.server) or use "Open file..." instead.';
    }
    showIssues([{ path: 'src', message: msg + ' Showing the built-in example instead.' }], [], src, false);
  }

  /* ---------- controls ---------- */

  $('play').addEventListener('click', function () { player.togglePlay(); });
  $('next').addEventListener('click', function () { player.next(); });
  $('prev').addEventListener('click', function () { player.prev(); });
  $('restart').addEventListener('click', function () { player.restart(); });
  $('scrub').addEventListener('input', function (e) { player.setPlaying(false); player.jump(+e.target.value, true); });
  $('spd').addEventListener('input', function (e) { var s = parseFloat(e.target.value); player.setSpeed(s); $('spdl').textContent = s + 'x'; });
  $('loop').addEventListener('change', function () { player.setLoop(this.checked); });
  $('trail').addEventListener('change', paint);

  if (editor) {
    editor.mount($('editor'));
    $('editBtn').addEventListener('click', function () {
      var on = editor.setActive(!editor.isActive());
      $('editBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
      doc.body.classList.toggle('editing', on);
    });
    window.addEventListener('beforeunload', function (e) { if (editor.isDirty()) { e.preventDefault(); e.returnValue = ''; } });
  } else $('editBtn').hidden = true;

  $('file').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    f.text().then(function (t) { loadLocal(t, f.name); });
    e.target.value = '';
  });
  $('dlg').addEventListener('close', function () {
    if ($('dlg').returnValue === 'ok' && $('ta').value.trim()) loadLocal($('ta').value, 'pasted JSON');
  });

  window.addEventListener('dragenter', function (e) { e.preventDefault(); $('drop').hidden = false; });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  $('drop').addEventListener('dragleave', function () { $('drop').hidden = true; });
  window.addEventListener('drop', function (e) {
    e.preventDefault(); $('drop').hidden = true;
    var f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) guarded(function () { return f.text().then(function (t) { loadLocal(t, f.name); }); });
  });

  /* ---------- view panel, zoom, maximize ---------- */

  var VP_KEY = 'flow-animator.viewpanel';
  function setPanel(collapsed) {
    $('vizbar').classList.toggle('collapsed', collapsed);
    $('vpToggle').textContent = collapsed ? 'Show' : 'Hide';
    $('vpToggle').setAttribute('aria-expanded', String(!collapsed));
    try { localStorage.setItem(VP_KEY, collapsed ? '1' : '0'); } catch (e) {}
  }
  $('vpToggle').addEventListener('click', function () { setPanel(!$('vizbar').classList.contains('collapsed')); });
  try { if (localStorage.getItem(VP_KEY) === '1') setPanel(true); } catch (e) {}
  $('zin').addEventListener('click', function () { diagram.zoom(1.25); });
  $('zout').addEventListener('click', function () { diagram.zoom(0.8); });
  $('zreset').addEventListener('click', function () { diagram.fit(); });

  window.addEventListener('keydown', function (e) { if (e.key === 'Control') doc.body.classList.add('ctrl'); });
  window.addEventListener('keyup', function (e) { if (e.key === 'Control') doc.body.classList.remove('ctrl'); });
  window.addEventListener('blur', function () { doc.body.classList.remove('ctrl'); });

  function setMaxed(on) {
    $('viewer').classList.toggle('maxed', on);
    doc.body.classList.toggle('maxed', on);
    $('maxBtn').setAttribute('aria-pressed', String(on));
    $('maxBtn').textContent = on ? 'Minimize' : 'Maximize';
    paint();
  }
  $('maxBtn').addEventListener('click', function () { setMaxed(!$('viewer').classList.contains('maxed')); });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('viewer').classList.contains('maxed') && !doc.fullscreenElement) setMaxed(false);
  });

  function toggleFullscreen() {
    if (doc.fullscreenElement) return doc.exitFullscreen();
    var v = $('viewer');
    if (v.requestFullscreen) v.requestFullscreen().catch(function () {});
  }
  $('fsBtn').addEventListener('click', toggleFullscreen);
  doc.addEventListener('fullscreenchange', function () {
    var on = !!doc.fullscreenElement;
    $('fsBtn').setAttribute('aria-pressed', String(on));
    $('fsBtn').textContent = on ? 'Exit fullscreen' : 'Fullscreen';
  });

  window.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'LI' || tag === 'SELECT') return;
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) toggleFullscreen();
    else if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) setMaxed(!$('viewer').classList.contains('maxed'));
    else if (e.key === ' ') { e.preventDefault(); player.togglePlay(); }
    else if (e.key === 'ArrowRight') player.next();
    else if (e.key === 'ArrowLeft') player.prev();
    else if (e.key === 'Home') player.restart();
  });

  // public API for scripts, tests and agents driving a browser
  window.FlowAnimator = {
    load: function (input) {
      return loadLocal(typeof input === 'string' ? input : JSON.stringify(input), 'API call');
    },
    validate: function (input) {
      var p = typeof input === 'string' ? C.parse(input) : { doc: input, errors: [] };
      return p.errors.length ? { errors: p.errors, warnings: [] } : C.validate(p.doc);
    },
    state: function () {
      var st = player.state();
      return { title: S.model && S.model.title, beat: st.idx, beats: S.model && S.model.beats.length, playing: st.playing, arrived: st.arrived };
    },
    edit: function (op, args) { return editor ? editor.edit(op, args) : { ok: false, errors: [{ path: '', message: 'editor not available' }] }; },
    jump: function (i, arrived) { player.jump(i, arrived); }
  };

  /* ---------- start ---------- */

  var params = new URLSearchParams(location.search);
  var src = params.get('src');
  var embedded = $('flow-data');

  picker.mount($('menuHost'));
  window.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && editor && editor.isActive() && S.apiUp) {
      e.preventDefault(); saver.save();
    }
  });
  function watchStored(name) {
    setInterval(function () {
      if (saver.name() !== name || (editor && editor.isDirty())) return;
      gateway.load(name, { ifNoneMatch: saver.revision() }).then(function (r) {
        if (r.ok && !r.notModified && r.text) { loadText(r.text, name, null, true); saver.setSource(name, r.revision); $('src').textContent = srcLabel() || ('Source: ' + name); }
      }).catch(function () {});
    }, 1500);
  }
  var SESSION_KEY = 'flow-animator.session';
  function readSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }
  function saveSession() {
    try {
      var n = saver.name();
      if (!n || !S.model) { sessionStorage.removeItem(SESSION_KEY); return; }
      var st = player.state();
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ flow: n, idx: st.idx, playing: st.playing, x: window.scrollX, y: window.scrollY, sx: $('stage').scrollLeft }));
    } catch (e) {}
  }
  function restoreSession(name) {
    var s = readSession();
    if (!s || s.flow !== name || !S.model) return;
    var playing = !!s.playing && !reduced;
    player.setPlaying(playing);
    player.jump(s.idx || 0, !playing);
    requestAnimationFrame(function () { $('stage').scrollLeft = s.sx || 0; window.scrollTo(s.x || 0, s.y || 0); });
  }
  window.addEventListener('pagehide', saveSession);
  var last = !src && !embedded ? readSession() : null;
  var flowParam = params.get('flow') || (last && last.flow);
  gateway.available().then(function (up) {
    S.apiUp = up; picker.setApi(up);
    if (editor) editor.refresh();
    return picker.refresh();
  }).then(function () {
    if (flowParam) {
      return openStored(flowParam).then(function (r) {
        if (!r.ok) { loadLocal($('sample-flow').textContent, 'built-in example'); return; }
        restoreSession(flowParam.replace(/\.flow\.json$/i, ''));
        if (params.get('watch')) watchStored(flowParam);
      });
    }
  });

  if (flowParam) {
    // handled above once the gateway knows whether the API exists
  } else if (src) {
    loadFromUrl(src).then(function (t) {
      var prev = t;
      loadLocal(t, src);
      if (params.get('watch')) {
        setInterval(function () {
          loadFromUrl(src).then(function (nt) { if (nt !== prev && !(editor && editor.isDirty())) { prev = nt; loadText(nt, src, null, true); } }).catch(function () {});
        }, 1500);
      }
    }).catch(function (e) { loadLocal($('sample-flow').textContent, 'built-in example'); fetchFailed(src, e); });
  } else if (embedded) {
    loadLocal(embedded.textContent, 'embedded flow');
  } else {
    loadLocal($('sample-flow').textContent, 'built-in example');
  }
})();
