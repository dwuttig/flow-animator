/*
 * edit-flow: editor mode (Playback context, browser only).
 * Owns the Draft, undo/redo and the editing forms. Every change is an Edit
 * from FlowEdits (Flow Library, apply-edit) validated by FlowCore (Flow Modeling)
 * before it is committed or shown. Talks to the viewer through `host` only:
 *   host.getText()           current flow JSON text
 *   host.show(text, name, res)  render this text; `res` is FlowCore.loadDoc() of it (already validated and
 *                               laid out) so the host may skip re-parsing; hosts may ignore the 3rd param
 *   host.jumpToStep(i)       move Playback to the Beat of step i
 *   host.report(errs, warns) show Violations
 *   host.pause()             stop the animation while editing
 *   host.confirm(message)    confirm a destructive action; returns boolean or Promise<boolean>
 * Optional: host.highlight({nodes:[ids], edges:['from>to'], glow:{nodes,edges}}) marks Flow elements in the viewer for the
 *   expanded or focused editor items (groups -> member nodes, nodes, steps -> edge and end nodes).
 * Optional (storage, slice save-flow): host.canSave() -> boolean, host.save(), host.saveAs(),
 *   host.canReload() -> boolean, host.reload(). When canSave() is true the panel shows Save buttons.
 * Optional: host.download(text, title) exports the Draft (else the editor downloads a .flow.json itself).
 * Every focusable panel control carries a stable data-fkey; focus and caret survive panel re-renders.
 *
 *   var editor = FlowEditor.create(host, document, FlowCore, FlowEdits);
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = { create: factory };
  else root.FlowEditor = { create: factory };
})(typeof self !== 'undefined' ? self : this, function create(host, doc, Core, Edits) {
  'use strict';
  var MAX_HISTORY = 100;
  var KINDS = Core.KINDS, SHAPES = Core.SHAPES;
  var win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : {});

  var draft = null, undo = [], redo = [], dirty = false, lastEmitted = null, mount = null, active = false;
  var openKeys = {}, focusKey = null, hoverKey = null, items = [];
  var pendingFocus = null, dragIdx = null;

  function h(tag, cls, text, parent) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function snapshot() { return JSON.stringify(draft); }

  function sync() {
    var t = host.getText();
    try { draft = JSON.parse(t); } catch (e) { draft = null; }
    undo = []; redo = []; dirty = false; lastEmitted = t;
  }

  /* Try an Edit. Commits only if the result passes Flow Modeling validation. */
  function edit(op, args) {
    if (!draft) sync();
    if (!draft) return { ok: false, errors: [{ path: '', message: 'no flow loaded' }] };
    var next;
    try { next = Edits.apply(draft, op, args); }
    catch (e) {
      if (!e.userError) throw e;
      var ue = [{ path: op, message: e.message }];
      host.report(ue, []);
      renderPanel();
      return { ok: false, errors: ue };
    }
    var res = Core.loadDoc(next);
    if (!res.ok) { host.report(res.errors, res.warnings); renderPanel(); return { ok: false, errors: res.errors }; }
    undo.push(snapshot()); if (undo.length > MAX_HISTORY) undo.shift();
    redo = [];
    var rk = rekeyer(op, args), f = pendingFocus || captureFocus();
    if (rk) {
      var ok = {};
      Object.keys(openKeys).forEach(function (k) { var n = rk(k); if (n) ok[n] = true; });
      openKeys = ok;
      if (f) f.key = rk(f.key);
    }
    pendingFocus = f;
    draft = next; dirty = true;
    openAdded(op, args, f);
    emit(res);
    return { ok: true, errors: [], warnings: res.warnings };
  }

  /* Maps panel keys (open items, focus) across an Edit that renames a node or shifts step indexes. */
  function rekeyer(op, a) {
    if (op === 'update_node' && a.new_id !== undefined && a.new_id !== a.id) {
      var p = 'n:' + a.id;
      return function (k) { return k === p || k.indexOf(p + ':') === 0 ? 'n:' + a.new_id + k.slice(p.length) : k; };
    }
    var map = null;
    if (op === 'move_step') map = function (j) {
      if (j === a.index) return a.to_index;
      if (a.index < a.to_index && j > a.index && j <= a.to_index) return j - 1;
      if (a.index > a.to_index && j >= a.to_index && j < a.index) return j + 1;
      return j;
    };
    else if (op === 'add_step' && a.at !== undefined) map = function (j) { return j >= a.at ? j + 1 : j; };
    else if (op === 'remove_step') map = function (j) { return j === a.index ? -1 : j > a.index ? j - 1 : j; };
    if (!map) return null;
    return function (k) {
      var m = /^s:(\d+)(:.*)?$/.exec(k);
      if (!m) return k;
      var j = map(+m[1]);
      return j < 0 ? null : 's:' + j + (m[2] || '');
    };
  }

  /* Newly added groups/nodes/steps open; their first field gets focus if the user is in the panel. */
  function openAdded(op, a, f) {
    var k, first;
    if (op === 'add_group') { k = 'g:' + a.id; first = k + ':label'; }
    else if (op === 'add_node') { k = 'n:' + a.id; first = k + ':id'; }
    else if (op === 'add_step') { k = 's:' + (a.at === undefined ? draft.steps.length - 1 : a.at); first = k + ':from'; }
    else return;
    openKeys[k] = true;
    if (f) pendingFocus = { key: first };
  }

  function emit(res) {
    lastEmitted = JSON.stringify(draft, null, 2);
    host.pause();
    host.show(lastEmitted, 'draft', res);
    renderPanel();
  }

  function stepHistory(from, to) {
    if (!from.length) return;
    to.push(snapshot());
    draft = JSON.parse(from.pop());
    dirty = true;
    emit(Core.loadDoc(draft));
  }

  function download() {
    var text = JSON.stringify(draft, null, 2) + '\n';
    if (host.download) { host.download(text, draft && draft.title ? draft.title : 'flow'); return; }
    var name = (draft && draft.title ? draft.title : 'flow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flow';
    var blob = new Blob([JSON.stringify(draft, null, 2) + '\n'], { type: 'application/json' });
    var a = h('a'); a.href = URL.createObjectURL(blob); a.download = name + '.flow.json';
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    dirty = false; renderPanel();
  }

  /* ---------- focus keeping (the panel is rebuilt on every change) ---------- */

  /* Give a focusable control a stable key ('n:<id>:label', 's:<i>:from', 'meta:title', ...). */
  function fk(el, key) { el.setAttribute('data-fkey', key); return el; }
  function keyed(key) {
    var found = null;
    (function walk(el) {
      for (var i = 0; i < el.children.length && !found; i++) {
        var c = el.children[i];
        if (c.getAttribute('data-fkey') === key) found = c; else walk(c);
      }
    })(mount);
    return found;
  }
  /* Key (and caret of text inputs) of the focused panel control, or null. */
  function captureFocus() {
    var a = mount && doc && doc.activeElement;
    if (!a || a === mount || !mount.contains(a) || !a.getAttribute('data-fkey')) return null;
    var f = { key: a.getAttribute('data-fkey') };
    if (a.tagName === 'INPUT' && a.type === 'text') { f.start = a.selectionStart; f.end = a.selectionEnd; }
    return f;
  }
  function restoreFocus(f) {
    var el = f && f.key && keyed(f.key);
    if (!el) return;
    el.focus();
    if (f.start != null && el.setSelectionRange) el.setSelectionRange(f.start, f.end);
    else if (f.select && el.select) el.select();
  }
  /* Focusable panel controls in tab order (DOM order; content of closed <details> is skipped). */
  function focusables(el, out) {
    var closed = el.tagName === 'DETAILS' && !el.open;
    for (var i = 0; i < el.children.length; i++) {
      var c = el.children[i];
      if (c.hidden || (closed && c.tagName !== 'SUMMARY')) continue;
      if (/^(INPUT|SELECT|BUTTON|TEXTAREA|SUMMARY)$/.test(c.tagName) && !c.disabled) out.push(c);
      focusables(c, out);
    }
    return out;
  }
  /* Tab/Shift+Tab out of a control with a pending change: commit it, then focus (by key, so it survives
     the re-render) the control the browser was moving to. Leaving the panel keeps the browser default. */
  function tabCommit(ev, el, commit) {
    var list = focusables(mount, []), next = list[list.indexOf(el) + (ev.shiftKey ? -1 : 1)];
    var key = next && next.getAttribute('data-fkey');
    if (!key) return;
    ev.preventDefault();
    pendingFocus = { key: key, select: next.tagName === 'INPUT' };
    commit();
    if (pendingFocus) { var f = pendingFocus; pendingFocus = null; restoreFocus(f); }
  }

  /* ---------- panel ---------- */

  function field(parent, label, value, onChange, opts) {
    var l = h('label', 'ef', null, parent);
    h('span', null, label, l);
    var i = h('input', null, null, l);
    i.type = 'text'; i.value = value == null ? '' : value;
    if (opts && opts.max) i.maxLength = opts.max;
    if (opts && opts.key) fk(i, opts.key);
    var last = i.value;
    function commit() { if (i.value === last) return; last = i.value; onChange(i.value); }
    i.addEventListener('change', commit);
    i.addEventListener('keydown', function (ev) { if (ev.key === 'Tab' && i.value !== last) tabCommit(ev, i, commit); });
    cols(l, opts && opts.span);
    return i;
  }
  /* colorOf(optionValue) -> palette color name or null; tints each option and the closed select. */
  function select(parent, label, options, value, onChange, span, colorOf) {
    var l = h('label', 'ef', null, parent);
    h('span', null, label, l);
    var s = h('select', null, null, l);
    options.forEach(function (o) {
      var op = h('option', colorOf && colorOf(o) ? 'c-' + colorOf(o) : null, o === '' ? '(none)' : o, s); op.value = o;
    });
    s.value = value == null ? '' : value;
    function tint() { s.className = colorOf && colorOf(s.value) ? 'c-' + colorOf(s.value) : ''; }
    tint();
    s.addEventListener('change', function () { tint(); onChange(s.value); });
    cols(l, span);
    return s;
  }
  function button(parent, text, onClick, title, span) {
    var b = h('button', null, text, parent); b.type = 'button';
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    cols(b, span);
    return b;
  }
  var ICONS = {
    undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
    redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
    save: 'M5 3h11l4 4v14H5zM8 3v5h7V3M8 21v-7h8v7',
    saveas: 'M4 3h11l4 4v6M4 3v18h8M7 3v5h7V3M18 16v6M15 19h6',
    reload: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
    download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
    copy: 'M9 9h11v11H9zM5 15V4h11'
  };
  /* Icon-only button; `title` doubles as the accessible name. */
  function iconButton(parent, icon, title, onClick) {
    var b = button(parent, null, onClick, title);
    b.className = 'eicon'; b.setAttribute('aria-label', title); fk(b, 'bar:' + icon);
    b.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + ICONS[icon] + '"/></svg>';
    return b;
  }
  /* Place an element across n of the 12 grid columns of an editor row. */
  function cols(el, n) { if (n) el.style.gridColumn = 'span ' + n; return el; }
  function nullable(v) { return v === '' ? null : v; }
  function freshId(prefix, list) {
    var ids = list.map(function (x) { return x.id; }), i = list.length + 1;
    while (ids.indexOf(prefix + i) >= 0) i++;
    return prefix + i;
  }
  function section(title, count) {
    var s = h('details', 'esec', null, mount); s.open = true;
    var sm = fk(h('summary', null, title, s), 'sec:' + title);
    if (count != null) h('span', 'ecount', String(count), sm);
    return h('div', 'ebody', null, s);
  }

  /* A collapsible editor item (collapsed by default, one-line summary). Expanded or focused items
     highlight their nodes/edges in the viewer. Returns the .erow body. */
  function item(parent, key, summary, nodes, edges, color) {
    var d = h('details', 'eitem', null, parent); d.open = !!openKeys[key];
    fk(h('summary', color ? 'c-' + color : null, summary, d), key + ':sum');
    items.push({ key: key, nodes: nodes, edges: edges });
    d.addEventListener('toggle', function () {
      if (d.open) openKeys[key] = true; else delete openKeys[key];
      applyHighlight();
    });
    d.addEventListener('mouseenter', function () { hoverKey = key; applyHighlight(); });
    d.addEventListener('mouseleave', function () { if (hoverKey === key) { hoverKey = null; applyHighlight(); } });
    d.addEventListener('focusin', function () { focusKey = key; applyHighlight(); });
    d.addEventListener('focusout', function (ev) {
      if (ev.relatedTarget && d.contains(ev.relatedTarget)) return;
      if (focusKey === key) { focusKey = null; applyHighlight(); }
    });
    return h('div', 'erow', null, d);
  }

  function applyHighlight() {
    if (!host.highlight) return;
    var nodes = {}, edges = {}, glow = { nodes: [], edges: [] };
    if (active) items.forEach(function (it) {
      if (it.key === hoverKey) glow = { nodes: it.nodes, edges: it.edges };
      if (!openKeys[it.key] && focusKey !== it.key) return;
      it.nodes.forEach(function (n) { nodes[n] = true; });
      it.edges.forEach(function (e) { edges[e] = true; });
    });
    host.highlight({ nodes: Object.keys(nodes), edges: Object.keys(edges), glow: glow });
  }

  function addBtn(body, label, fn, key) {
    var b = fk(button(h('div', 'eadd', null, body), label, fn), key);
    b.className = 'eaddbtn';
    return b;
  }

  /* Drag handle in a step's summary; dropping on the upper/lower half of another step moves it before/after. */
  function stepDrag(d, i) {
    var sm = d.firstChild, hd = h('span', 'edrag', '⠿');
    sm.insertBefore(hd, sm.firstChild);
    hd.draggable = true; hd.title = 'Drag to reorder';
    hd.setAttribute('role', 'img'); hd.setAttribute('aria-label', 'Drag to reorder step ' + (i + 1) + ' (or use the ↑/↓ buttons)');
    hd.addEventListener('click', function (ev) { ev.preventDefault(); });
    hd.addEventListener('dragstart', function (ev) {
      dragIdx = i; d.setAttribute('data-dragging', 'true');
      if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(i + 1)); }
    });
    hd.addEventListener('dragend', function () { dragIdx = null; d.removeAttribute('data-dragging'); });
    function pos(ev) { var r = d.getBoundingClientRect(); return ev.clientY > r.top + r.height / 2 ? 'after' : 'before'; }
    d.addEventListener('dragover', function (ev) {
      if (dragIdx === null) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
      d.setAttribute('data-drop', pos(ev));
    });
    d.addEventListener('dragleave', function (ev) { if (!ev.relatedTarget || !d.contains(ev.relatedTarget)) d.removeAttribute('data-drop'); });
    d.addEventListener('drop', function (ev) {
      if (dragIdx === null) return;
      ev.preventDefault();
      d.removeAttribute('data-drop');
      var from = dragIdx, at = i + (pos(ev) === 'after' ? 1 : 0), to = at > from ? at - 1 : at;
      dragIdx = null;
      if (to !== from) edit('move_step', { index: from, to_index: to });
    });
  }

  /* Multi-select of the other steps that play in the same Beat as step i (edit set_parallel). */
  function parallelPicker(row, steps, i) {
    var mates = [];
    Core.buildBeats(steps).forEach(function (b) { if (b.indexOf(i) >= 0) mates = b.filter(function (j) { return j !== i; }); });
    var d = cols(h('details', 'ef epar', null, row), 12);
    fk(h('summary', null, 'Together with: ' + (mates.length ? mates.map(function (j) { return j + 1; }).join(', ') : 'none'), d), 's:' + i + ':par');
    steps.forEach(function (o, j) {
      if (j === i) return;
      var l = h('label', null, null, d);
      var cb = fk(h('input', null, null, l), 's:' + i + ':par:' + j); cb.type = 'checkbox'; cb.checked = mates.indexOf(j) >= 0;
      h('span', null, ' ' + (j + 1) + '. ' + (o.label || ''), l);
      cb.addEventListener('change', function () {
        var next = mates.filter(function (m) { return m !== j; });
        if (cb.checked) next.push(j);
        edit('set_parallel', { index: i, with: next });
      });
    });
  }

  /* ---------- sentence mode (Outlook-style rule description: click an underlined value) ---------- */

  var KIND_WORDS = { sync: 'call', async: 'async message', response: 'response', event: 'event' };
  var stepMode = 'fields';
  try { if (typeof localStorage !== 'undefined' && localStorage.getItem('flow-animator.stepMode') === 'sentence') stepMode = 'sentence'; } catch (e) { /* storage unavailable */ }

  function setStepMode(m) {
    stepMode = m;
    try { localStorage.setItem('flow-animator.stepMode', m); } catch (e) { /* storage unavailable */ }
    renderPanel();
  }

  function swapBack(parent, shown, link) { if (shown.parentNode === parent) parent.replaceChild(link, shown); }

  function linkSelect(parent, text, options, value, onPick, key) {
    var cur = options.filter(function (o) { return o.value === value; })[0];
    var b = fk(h('button', 'elink' + (cur && cur.color ? ' c-' + cur.color : ''), text, parent), key); b.type = 'button';
    b.addEventListener('click', function () {
      var s = fk(h('select', 'elinkin'), key);
      options.forEach(function (o) { h('option', o.color ? 'c-' + o.color : null, o.label, s).value = o.value; });
      s.value = value == null ? '' : value;
      parent.replaceChild(s, b); s.focus();
      try { if (s.showPicker) s.showPicker(); } catch (e) { /* picker needs a user gesture */ }
      s.addEventListener('change', function () { var v = s.value; swapBack(parent, s, b); b.focus(); onPick(v); });
      s.addEventListener('blur', function () { swapBack(parent, s, b); });
      s.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { swapBack(parent, s, b); b.focus(); } });
    });
    return b;
  }

  function linkText(parent, value, placeholder, onChange, max, key) {
    var b = fk(h('button', 'elink' + (value ? '' : ' empty'), value || placeholder, parent), key); b.type = 'button';
    b.addEventListener('click', function () {
      var i = fk(h('input', 'elinkin'), key); i.type = 'text'; i.value = value || ''; i.placeholder = placeholder;
      if (max) i.maxLength = max;
      i.size = Math.max(12, Math.min(48, i.value.length + 2));
      parent.replaceChild(i, b); i.focus(); i.select();
      var done = false;
      function finish(commit, refocus) {
        if (done) return; done = true;
        swapBack(parent, i, b);
        if (refocus) b.focus();
        if (commit && i.value !== (value || '')) onChange(i.value);
      }
      i.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); finish(true, true); }
        else if (ev.key === 'Escape') finish(false, true);
        else if (ev.key === 'Tab') tabCommit(ev, i, function () { finish(true); });
      });
      i.addEventListener('blur', function () { finish(true); });
    });
    return b;
  }

  /* Effective colors (declared, else auto-assigned like FlowCore) of groups and of the nodes in them. */
  function colorMaps() {
    var g = {}, n = {}, next = 0, order = [];
    (draft.groups || []).forEach(function (x) { g[x.id] = x.color || null; order.push(x.id); });
    (draft.nodes || []).forEach(function (x) { if (x.group && !(x.group in g)) { g[x.group] = null; order.push(x.group); } });
    order.forEach(function (id) { if (!g[id]) g[id] = Core.AUTO_COLORS[next++ % Core.AUTO_COLORS.length]; });
    (draft.nodes || []).forEach(function (x) { n[x.id] = x.group ? g[x.group] : 'gray'; });
    return { group: g, node: n };
  }

  function nodeLabelOf(id) {
    var n = (draft.nodes || []).filter(function (x) { return x.id === id; })[0];
    return n && n.label ? n.label : id;
  }

  function sentence(row, s, i, ids, nodeColor) {
    var p = cols(h('div', 'esentence', null, row), 11);
    var nodeOpts = ids.map(function (id) { return { value: id, label: nodeLabelOf(id), color: nodeColor[id] }; });
    var kindOpts = KINDS.map(function (k) { return { value: k, label: KIND_WORDS[k] }; });
    function txt(t) { p.appendChild(doc.createTextNode(t)); }
    var k = 's:' + i + ':';
    linkSelect(p, nodeLabelOf(s.from), nodeOpts, s.from, function (v) { edit('update_step', { index: i, from: v }); }, k + 'from');
    txt(' sends ');
    linkText(p, s.label, '(label)', function (v) { edit('update_step', { index: i, label: v }); }, null, k + 'label');
    txt(' to ');
    linkSelect(p, nodeLabelOf(s.to), nodeOpts, s.to, function (v) { edit('update_step', { index: i, to: v }); }, k + 'to');
    txt(' as a ');
    linkSelect(p, KIND_WORDS[s.kind || 'sync'], kindOpts, s.kind || 'sync', function (v) { edit('update_step', { index: i, kind: v }); }, k + 'kind');
    txt('. Detail: ');
    linkText(p, s.detail, '(add detail)', function (v) { edit('update_step', { index: i, detail: nullable(v) }); }, null, k + 'detail');
    txt('. Payload: ');
    linkText(p, s.payload, '(add payload)', function (v) { edit('update_step', { index: i, payload: nullable(v) }); }, null, k + 'payload');
    txt('.');
  }

  function renderPanel() {
    var f = pendingFocus || captureFocus();
    pendingFocus = null;
    if (!mount) return;
    var keepScroll = mount.scrollTop;
    mount.textContent = '';
    items = []; hoverKey = null;
    if (!active) { mount.hidden = true; applyHighlight(); return; }
    mount.hidden = false;
    if (!draft) sync();
    if (!draft) { h('p', null, 'No valid flow loaded to edit.', mount); return; }
    var colors = colorMaps();
    function groupColor(id) { return id ? colors.group[id] : null; }
    function nodeColor(id) { return colors.node[id] || null; }

    var bar = h('div', 'ebar', null, mount);
    iconButton(bar, 'undo', 'Undo', function () { stepHistory(undo, redo); }).disabled = !undo.length;
    iconButton(bar, 'redo', 'Redo', function () { stepHistory(redo, undo); }).disabled = !redo.length;
    if (host.canSave && host.canSave()) {
      iconButton(bar, 'save', 'Save to the server (Ctrl+S)', function () { host.save(); });
      iconButton(bar, 'saveas', 'Save under a new name', function () { host.saveAs(); });
      if (host.canReload && host.canReload()) iconButton(bar, 'reload', 'Discard edits and load the stored version', function () { host.reload(); });
    }
    iconButton(bar, 'download', 'Download as .flow.json', download);
    iconButton(bar, 'copy', 'Copy JSON', function () {
      var t = JSON.stringify(draft, null, 2) + '\n';
      if (win.navigator && win.navigator.clipboard) win.navigator.clipboard.writeText(t);
    });
    h('span', 'edirty', dirty ? 'unsaved changes' : '', bar);

    var mb = section('Flow'), lay = draft.layout || {};
    field(mb, 'Title', draft.title, function (v) { edit('set_meta', { title: v }); }, { key: 'meta:title' });
    field(mb, 'Description', draft.description, function (v) { edit('set_meta', { description: nullable(v) }); }, { key: 'meta:description' });
    fk(select(mb, 'Direction', ['LR', 'TB'], lay.direction || 'LR', function (v) { edit('set_meta', { direction: v }); }), 'meta:direction');
    fk(select(mb, 'Connections', [''].concat(Core.CONNECTIONS), lay.connection, function (v) { edit('set_meta', { connection: nullable(v) }); }), 'meta:connection');

    var gb = section('Groups', (draft.groups || []).length);
    (draft.groups || []).forEach(function (grp) {
      var members = (draft.nodes || []).filter(function (n) { return n.group === grp.id; }).map(function (n) { return n.id; });
      var row = item(gb, 'g:' + grp.id, grp.id + (grp.label && grp.label !== grp.id ? ' — ' + grp.label : ''), members, [], colors.group[grp.id]);
      var k = 'g:' + grp.id + ':';
      cols(h('code', 'eid', grp.id, row), 3);
      field(row, 'Label', grp.label, function (v) { edit('update_group', { id: grp.id, label: nullable(v) }); }, { span: 4, key: k + 'label' });
      fk(select(row, 'Color', [''].concat(Core.COLORS), grp.color, function (v) { edit('update_group', { id: grp.id, color: nullable(v) }); }, 3, function (c) { return c || colors.group[grp.id]; }), k + 'color');
      fk(button(row, 'Remove', function () { edit('remove_group', { id: grp.id, cascade: true }); }), k + 'remove');
    });
    addBtn(gb, '+ Group', function () {
      var id = freshId('group', draft.groups || []);
      edit('add_group', { id: id, label: id });
    }, 'add:group');

    var nb = section('Nodes', (draft.nodes || []).length);
    var groupIds = [''].concat((draft.groups || []).map(function (x) { return x.id; }));
    (draft.nodes || []).forEach(function (node) {
      var row = item(nb, 'n:' + node.id, node.id + (node.label && node.label !== node.id ? ' — ' + node.label : ''), [node.id], [], nodeColor(node.id));
      var k = 'n:' + node.id + ':';
      field(row, 'Id', node.id, function (v) { if (v !== node.id) edit('update_node', { id: node.id, new_id: v }); }, { span: 4, key: k + 'id' });
      field(row, 'Label', node.label, function (v) { edit('update_node', { id: node.id, label: v }); }, { max: 28, span: 4, key: k + 'label' });
      field(row, 'Subtitle', node.subtitle, function (v) { edit('update_node', { id: node.id, subtitle: nullable(v) }); }, { max: 36, span: 4, key: k + 'subtitle' });
      fk(select(row, 'Group', groupIds, node.group, function (v) { edit('update_node', { id: node.id, group: nullable(v) }); }, 4, groupColor), k + 'group');
      fk(select(row, 'Shape', SHAPES, node.shape || 'box', function (v) { edit('update_node', { id: node.id, shape: v }); }, 4), k + 'shape');
      fk(button(row, 'Remove', function () {
        var used = (draft.steps || []).filter(function (s) { return s.from === node.id || s.to === node.id; }).length;
        var message = 'Remove ' + node.id + ' and its ' + used + ' step(s)?';
        var answer = used ? (host.confirm ? host.confirm(message) : (win.confirm ? win.confirm(message) : true)) : true;
        if (answer && typeof answer.then === 'function') answer.then(function (ok) { if (ok) edit('remove_node', { id: node.id, cascade: true }); });
        else if (answer) edit('remove_node', { id: node.id, cascade: true });
      }, null, 4), k + 'remove');
    });
    addBtn(nb, '+ Node', function () {
      var id = freshId('node', draft.nodes || []);
      edit('add_node', { id: id, label: id });
    }, 'add:node');

    var sb = section('Steps', (draft.steps || []).length);
    var ids = (draft.nodes || []).map(function (x) { return x.id; });
    var steps = draft.steps || [];
    var modes = h('div', 'emodes', null, sb);
    [['fields', 'Fields'], ['sentence', 'Sentence']].forEach(function (m) {
      var mb = button(modes, m[1], function () { setStepMode(m[0]); }, 'Edit steps as ' + m[1].toLowerCase());
      mb.setAttribute('aria-pressed', String(stepMode === m[0]));
      fk(mb, 'mode:' + m[0]);
    });
    steps.forEach(function (s, i) {
      var k = 's:' + i + ':';
      var row = item(sb, 's:' + i, (i + 1) + '. ' + s.from + ' → ' + s.to + (s.label ? ' — ' + s.label : ''), [s.from, s.to], [s.from + '>' + s.to]);
      stepDrag(row.parentNode, i);
      var num = fk(button(row, String(i + 1), function () { host.jumpToStep(i); }, 'Show this step'), k + 'num');
      num.className = 'enum'; cols(num, 1);
      if (stepMode === 'sentence') sentence(row, s, i, ids, colors.node);
      else {
        fk(select(row, 'From', ids, s.from, function (v) { edit('update_step', { index: i, from: v }); }, 5, nodeColor), k + 'from');
        fk(select(row, 'To', ids, s.to, function (v) { edit('update_step', { index: i, to: v }); }, 6, nodeColor), k + 'to');
        field(row, 'Label', s.label, function (v) { edit('update_step', { index: i, label: v }); }, { span: 6, key: k + 'label' });
        field(row, 'Detail', s.detail, function (v) { edit('update_step', { index: i, detail: nullable(v) }); }, { span: 6, key: k + 'detail' });
        field(row, 'Payload', s.payload, function (v) { edit('update_step', { index: i, payload: nullable(v) }); }, { span: 3, key: k + 'payload' });
        fk(select(row, 'Kind', [''].concat(KINDS), s.kind, function (v) { edit('update_step', { index: i, kind: nullable(v) }); }, 3), k + 'kind');
      }
      parallelPicker(row, steps, i);
      fk(button(row, '↑', function () { edit('move_step', { index: i, to_index: i - 1 }); }, 'Move up', 1), k + 'up').disabled = i === 0;
      fk(button(row, '↓', function () { edit('move_step', { index: i, to_index: i + 1 }); }, 'Move down', 1), k + 'down').disabled = i === steps.length - 1;
      fk(button(row, '+ After', function () {
        var back = s.from !== s.to ? s.from : ids.filter(function (x) { return x !== s.to; })[0] || s.to;
        edit('add_step', { at: i + 1, from: s.to, to: back, label: 'New step' });
      }, 'Insert a new step after this one', 2), k + 'ins');
      fk(button(row, 'Remove', function () { edit('remove_step', { index: i }); }, null, 2), k + 'remove');
    });
    addBtn(sb, '+ Step', function () {
      edit('add_step', { from: ids[0], to: ids[ids.length > 1 ? 1 : 0], label: 'New step' });
    }, 'add:step').disabled = !ids.length;
    mount.scrollTop = keepScroll;
    restoreFocus(f);
    applyHighlight();
  }

  return {
    mount: function (el) { mount = el; renderPanel(); },
    setActive: function (on) {
      active = !!on;
      if (active) sync();
      renderPanel();
      return active;
    },
    isActive: function () { return active; },
    isDirty: function () { return dirty; },
    /* The Draft equals what is stored (called by the host after a successful save). */
    markClean: function () { dirty = false; renderPanel(); },
    /* Re-render the panel (e.g. when the server became reachable). */
    refresh: function () { renderPanel(); },
    /* Called by the viewer after every load; ignores loads that came from this editor. */
    onLoaded: function (text) {
      if (text === lastEmitted) return;
      if (active) sync();
      renderPanel();
    },
    edit: edit,
    undo: function () { stepHistory(undo, redo); },
    redo: function () { stepHistory(redo, undo); },
    draft: function () { return draft ? JSON.parse(JSON.stringify(draft)) : null; }
  };
});
