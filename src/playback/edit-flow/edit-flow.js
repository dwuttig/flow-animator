/*
 * edit-flow: editor mode (Playback context, browser only).
 * Owns the Draft, undo/redo and the editing forms. Every change is an Edit
 * from FlowEdits (Flow Library, apply-edit) validated by FlowCore (Flow Modeling)
 * before it is committed or shown. Talks to the viewer through `host` only:
 *   host.getText()           current flow JSON text
 *   host.show(text, name)    render this text
 *   host.jumpToStep(i)       move Playback to the Beat of step i
 *   host.report(errs, warns) show Violations
 *   host.pause()             stop the animation while editing
 * Optional: host.highlight({nodes:[ids], edges:['from>to'], glow:{nodes,edges}}) marks Flow elements in the viewer for the
 *   expanded or focused editor items (groups -> member nodes, nodes, steps -> edge and end nodes).
 * Optional (storage, slice save-flow): host.canSave() -> boolean, host.save(), host.saveAs(),
 *   host.canReload() -> boolean, host.reload(). When canSave() is true the panel shows Save buttons.
 *
 *   var editor = FlowEditor.create(host, document, FlowCore, FlowEdits);
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = { create: factory };
  else root.FlowEditor = { create: factory };
})(typeof self !== 'undefined' ? self : this, function create(host, doc, Core, Edits) {
  'use strict';
  var MAX_HISTORY = 100;
  var KINDS = ['sync', 'async', 'response', 'event'];
  var SHAPES = ['box', 'database', 'queue'];

  var draft = null, undo = [], redo = [], dirty = false, lastEmitted = null, mount = null, active = false;
  var openKeys = {}, focusKey = null, hoverKey = null, items = [];

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
      return { ok: false, errors: ue };
    }
    var res = Core.loadDoc(next);
    if (!res.ok) { host.report(res.errors, res.warnings); return { ok: false, errors: res.errors }; }
    undo.push(snapshot()); if (undo.length > MAX_HISTORY) undo.shift();
    redo = [];
    draft = next; dirty = true;
    emit();
    return { ok: true, errors: [], warnings: res.warnings };
  }

  function emit() {
    lastEmitted = JSON.stringify(draft, null, 2);
    host.pause();
    host.show(lastEmitted, 'draft');
    renderPanel();
  }

  function stepHistory(from, to) {
    if (!from.length) return;
    to.push(snapshot());
    draft = JSON.parse(from.pop());
    dirty = true;
    emit();
  }

  function download() {
    var name = (draft && draft.title ? draft.title : 'flow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flow';
    var blob = new Blob([JSON.stringify(draft, null, 2) + '\n'], { type: 'application/json' });
    var a = h('a'); a.href = URL.createObjectURL(blob); a.download = name + '.flow.json';
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    dirty = false; renderPanel();
  }

  /* ---------- panel ---------- */

  function field(parent, label, value, onChange, opts) {
    var l = h('label', 'ef', null, parent);
    h('span', null, label, l);
    var i = h('input', null, null, l);
    i.type = 'text'; i.value = value == null ? '' : value;
    if (opts && opts.max) i.maxLength = opts.max;
    i.addEventListener('change', function () { onChange(i.value); });
    cols(l, opts && opts.span);
    return i;
  }
  function select(parent, label, options, value, onChange, span) {
    var l = h('label', 'ef', null, parent);
    h('span', null, label, l);
    var s = h('select', null, null, l);
    options.forEach(function (o) {
      var op = h('option', null, o === '' ? '(none)' : o, s); op.value = o;
    });
    s.value = value == null ? '' : value;
    s.addEventListener('change', function () { onChange(s.value); });
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
    var sm = h('summary', null, title, s);
    if (count != null) h('span', 'ecount', String(count), sm);
    return h('div', 'ebody', null, s);
  }

  /* A collapsible editor item (collapsed by default, one-line summary). Expanded or focused items
     highlight their nodes/edges in the viewer. Returns the .erow body. */
  function item(parent, key, summary, nodes, edges) {
    var d = h('details', 'eitem', null, parent); d.open = !!openKeys[key];
    h('summary', null, summary, d);
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

  function addBtn(body, label, fn) {
    var b = button(h('div', 'eadd', null, body), label, fn);
    b.className = 'eaddbtn';
    return b;
  }

  /* Multi-select of the other steps that play in the same Beat as step i (edit set_parallel). */
  function parallelPicker(row, steps, i) {
    var mates = [];
    Core.buildBeats(steps).forEach(function (b) { if (b.indexOf(i) >= 0) mates = b.filter(function (j) { return j !== i; }); });
    var d = cols(h('details', 'ef epar', null, row), 12);
    h('summary', null, 'Together with: ' + (mates.length ? mates.map(function (j) { return j + 1; }).join(', ') : 'none'), d);
    steps.forEach(function (o, j) {
      if (j === i) return;
      var l = h('label', null, null, d);
      var cb = h('input', null, null, l); cb.type = 'checkbox'; cb.checked = mates.indexOf(j) >= 0;
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

  function linkSelect(parent, text, options, value, onPick) {
    var b = h('button', 'elink', text, parent); b.type = 'button';
    b.addEventListener('click', function () {
      var s = h('select', 'elinkin');
      options.forEach(function (o) { h('option', null, o.label, s).value = o.value; });
      s.value = value == null ? '' : value;
      parent.replaceChild(s, b); s.focus();
      try { if (s.showPicker) s.showPicker(); } catch (e) { /* picker needs a user gesture */ }
      s.addEventListener('change', function () { var v = s.value; swapBack(parent, s, b); onPick(v); });
      s.addEventListener('blur', function () { swapBack(parent, s, b); });
      s.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') swapBack(parent, s, b); });
    });
    return b;
  }

  function linkText(parent, value, placeholder, onChange, max) {
    var b = h('button', 'elink' + (value ? '' : ' empty'), value || placeholder, parent); b.type = 'button';
    b.addEventListener('click', function () {
      var i = h('input', 'elinkin'); i.type = 'text'; i.value = value || ''; i.placeholder = placeholder;
      if (max) i.maxLength = max;
      i.size = Math.max(12, Math.min(48, i.value.length + 2));
      parent.replaceChild(i, b); i.focus(); i.select();
      var done = false;
      function finish(commit) {
        if (done) return; done = true;
        swapBack(parent, i, b);
        if (commit && i.value !== (value || '')) onChange(i.value);
      }
      i.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
        else if (ev.key === 'Escape') finish(false);
      });
      i.addEventListener('blur', function () { finish(true); });
    });
    return b;
  }

  function nodeLabelOf(id) {
    var n = (draft.nodes || []).filter(function (x) { return x.id === id; })[0];
    return n && n.label ? n.label : id;
  }

  function sentence(row, s, i, ids) {
    var p = cols(h('div', 'esentence', null, row), 11);
    var nodeOpts = ids.map(function (id) { return { value: id, label: nodeLabelOf(id) }; });
    var kindOpts = KINDS.map(function (k) { return { value: k, label: KIND_WORDS[k] }; });
    function txt(t) { p.appendChild(doc.createTextNode(t)); }
    linkSelect(p, nodeLabelOf(s.from), nodeOpts, s.from, function (v) { edit('update_step', { index: i, from: v }); });
    txt(' sends ');
    linkText(p, s.label, '(label)', function (v) { edit('update_step', { index: i, label: v }); });
    txt(' to ');
    linkSelect(p, nodeLabelOf(s.to), nodeOpts, s.to, function (v) { edit('update_step', { index: i, to: v }); });
    txt(' as a ');
    linkSelect(p, KIND_WORDS[s.kind || 'sync'], kindOpts, s.kind || 'sync', function (v) { edit('update_step', { index: i, kind: v }); });
    txt('. Detail: ');
    linkText(p, s.detail, '(add detail)', function (v) { edit('update_step', { index: i, detail: nullable(v) }); });
    txt('. Payload: ');
    linkText(p, s.payload, '(add payload)', function (v) { edit('update_step', { index: i, payload: nullable(v) }); });
    txt('.');
  }

  function renderPanel() {
    if (!mount) return;
    var keepScroll = mount.scrollTop;
    mount.textContent = '';
    items = []; hoverKey = null;
    if (!active) { mount.hidden = true; applyHighlight(); return; }
    mount.hidden = false;
    if (!draft) sync();
    if (!draft) { h('p', null, 'No valid flow loaded to edit.', mount); return; }

    var bar = h('div', 'ebar', null, mount);
    button(bar, 'Undo', function () { stepHistory(undo, redo); }).disabled = !undo.length;
    button(bar, 'Redo', function () { stepHistory(redo, undo); }).disabled = !redo.length;
    if (host.canSave && host.canSave()) {
      button(bar, 'Save', function () { host.save(); }, 'Save to the server (Ctrl+S)');
      button(bar, 'Save as…', function () { host.saveAs(); }, 'Save under a new name');
      if (host.canReload && host.canReload()) button(bar, 'Reload', function () { host.reload(); }, 'Discard edits and load the stored version');
    }
    button(bar, 'Download', download, 'Save as .flow.json');
    button(bar, 'Copy JSON', function () {
      var t = JSON.stringify(draft, null, 2) + '\n';
      if (root.navigator && root.navigator.clipboard) root.navigator.clipboard.writeText(t);
    });
    h('span', 'edirty', dirty ? 'unsaved changes' : '', bar);

    var mb = section('Flow');
    field(mb, 'Title', draft.title, function (v) { edit('set_meta', { title: v }); });
    field(mb, 'Description', draft.description, function (v) { edit('set_meta', { description: nullable(v) }); });
    select(mb, 'Direction', ['LR', 'TB'], (draft.layout && draft.layout.direction) || 'LR', function (v) { edit('set_meta', { direction: v }); });

    var gb = section('Groups', (draft.groups || []).length);
    (draft.groups || []).forEach(function (grp) {
      var members = (draft.nodes || []).filter(function (n) { return n.group === grp.id; }).map(function (n) { return n.id; });
      var row = item(gb, 'g:' + grp.id, grp.id + (grp.label && grp.label !== grp.id ? ' — ' + grp.label : ''), members, []);
      cols(h('code', 'eid', grp.id, row), 3);
      field(row, 'Label', grp.label, function (v) { edit('update_group', { id: grp.id, label: nullable(v) }); }, { span: 4 });
      select(row, 'Color', [''].concat(Core.COLORS), grp.color, function (v) { edit('update_group', { id: grp.id, color: nullable(v) }); }, 3);
      button(row, 'Remove', function () { edit('remove_group', { id: grp.id, cascade: true }); });
    });
    addBtn(gb, '+ Group', function () {
      var id = freshId('group', draft.groups || []);
      edit('add_group', { id: id, label: id });
    });

    var nb = section('Nodes', (draft.nodes || []).length);
    var groupIds = [''].concat((draft.groups || []).map(function (x) { return x.id; }));
    (draft.nodes || []).forEach(function (node) {
      var row = item(nb, 'n:' + node.id, node.id + (node.label && node.label !== node.id ? ' — ' + node.label : ''), [node.id], []);
      field(row, 'Id', node.id, function (v) { if (v !== node.id) edit('update_node', { id: node.id, new_id: v }); }, { span: 4 });
      field(row, 'Label', node.label, function (v) { edit('update_node', { id: node.id, label: v }); }, { max: 28, span: 4 });
      field(row, 'Subtitle', node.subtitle, function (v) { edit('update_node', { id: node.id, subtitle: nullable(v) }); }, { max: 36, span: 4 });
      select(row, 'Group', groupIds, node.group, function (v) { edit('update_node', { id: node.id, group: nullable(v) }); }, 4);
      select(row, 'Shape', SHAPES, node.shape || 'box', function (v) { edit('update_node', { id: node.id, shape: v }); }, 4);
      button(row, 'Remove', function () {
        var used = (draft.steps || []).filter(function (s) { return s.from === node.id || s.to === node.id; }).length;
        if (used && root.confirm && !root.confirm('Remove ' + node.id + ' and its ' + used + ' step(s)?')) return;
        edit('remove_node', { id: node.id, cascade: true });
      }, null, 4);
    });
    addBtn(nb, '+ Node', function () {
      var id = freshId('node', draft.nodes || []);
      edit('add_node', { id: id, label: id });
    });

    var sb = section('Steps', (draft.steps || []).length);
    var ids = (draft.nodes || []).map(function (x) { return x.id; });
    var steps = draft.steps || [];
    var modes = h('div', 'emodes', null, sb);
    [['fields', 'Fields'], ['sentence', 'Sentence']].forEach(function (m) {
      var mb = button(modes, m[1], function () { setStepMode(m[0]); }, 'Edit steps as ' + m[1].toLowerCase());
      mb.setAttribute('aria-pressed', String(stepMode === m[0]));
    });
    steps.forEach(function (s, i) {
      var row = item(sb, 's:' + i, (i + 1) + '. ' + s.from + ' → ' + s.to + (s.label ? ' — ' + s.label : ''), [s.from, s.to], [s.from + '>' + s.to]);
      var num = button(row, String(i + 1), function () { host.jumpToStep(i); }, 'Show this step');
      num.className = 'enum'; cols(num, 1);
      if (stepMode === 'sentence') sentence(row, s, i, ids);
      else {
        select(row, 'From', ids, s.from, function (v) { edit('update_step', { index: i, from: v }); }, 5);
        select(row, 'To', ids, s.to, function (v) { edit('update_step', { index: i, to: v }); }, 6);
        field(row, 'Label', s.label, function (v) { edit('update_step', { index: i, label: v }); }, { span: 6 });
        field(row, 'Detail', s.detail, function (v) { edit('update_step', { index: i, detail: nullable(v) }); }, { span: 6 });
        field(row, 'Payload', s.payload, function (v) { edit('update_step', { index: i, payload: nullable(v) }); }, { span: 3 });
        select(row, 'Kind', [''].concat(KINDS), s.kind, function (v) { edit('update_step', { index: i, kind: nullable(v) }); }, 3);
      }
      parallelPicker(row, steps, i);
      button(row, '↑', function () { edit('move_step', { index: i, to_index: i - 1 }); }, 'Move up', 1).disabled = i === 0;
      button(row, '↓', function () { edit('move_step', { index: i, to_index: i + 1 }); }, 'Move down', 1).disabled = i === steps.length - 1;
      button(row, 'Remove', function () { edit('remove_step', { index: i }); }, null, 2);
    });
    addBtn(sb, '+ Step', function () {
      edit('add_step', { from: ids[0], to: ids[ids.length > 1 ? 1 : 0], label: 'New step' });
    }).disabled = !ids.length;
    mount.scrollTop = keepScroll;
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
