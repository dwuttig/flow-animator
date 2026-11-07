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
    return i;
  }
  function select(parent, label, options, value, onChange) {
    var l = h('label', 'ef', null, parent);
    h('span', null, label, l);
    var s = h('select', null, null, l);
    options.forEach(function (o) {
      var op = h('option', null, o === '' ? '(none)' : o, s); op.value = o;
    });
    s.value = value == null ? '' : value;
    s.addEventListener('change', function () { onChange(s.value); });
    return s;
  }
  function button(parent, text, onClick, title) {
    var b = h('button', null, text, parent); b.type = 'button';
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }
  function nullable(v) { return v === '' ? null : v; }
  function freshId(prefix, list) {
    var ids = list.map(function (x) { return x.id; }), i = list.length + 1;
    while (ids.indexOf(prefix + i) >= 0) i++;
    return prefix + i;
  }
  function section(title) {
    var s = h('details', 'esec', null, mount); s.open = true;
    h('summary', null, title, s);
    return h('div', 'ebody', null, s);
  }

  function renderPanel() {
    if (!mount) return;
    var keepScroll = mount.scrollTop;
    mount.textContent = '';
    if (!active) { mount.hidden = true; return; }
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

    var gb = section('Groups');
    (draft.groups || []).forEach(function (grp) {
      var row = h('div', 'erow', null, gb);
      h('code', null, grp.id, row);
      field(row, 'Label', grp.label, function (v) { edit('update_group', { id: grp.id, label: nullable(v) }); });
      select(row, 'Color', [''].concat(Core.COLORS), grp.color, function (v) { edit('update_group', { id: grp.id, color: nullable(v) }); });
      button(row, 'Remove', function () { edit('remove_group', { id: grp.id, cascade: true }); });
    });
    button(gb, '+ Group', function () {
      var id = freshId('group', draft.groups || []);
      edit('add_group', { id: id, label: id });
    });

    var nb = section('Nodes');
    var groupIds = [''].concat((draft.groups || []).map(function (x) { return x.id; }));
    (draft.nodes || []).forEach(function (node) {
      var row = h('div', 'erow', null, nb);
      field(row, 'Id', node.id, function (v) { if (v !== node.id) edit('update_node', { id: node.id, new_id: v }); });
      field(row, 'Label', node.label, function (v) { edit('update_node', { id: node.id, label: v }); }, { max: 28 });
      field(row, 'Subtitle', node.subtitle, function (v) { edit('update_node', { id: node.id, subtitle: nullable(v) }); }, { max: 36 });
      select(row, 'Group', groupIds, node.group, function (v) { edit('update_node', { id: node.id, group: nullable(v) }); });
      select(row, 'Shape', SHAPES, node.shape || 'box', function (v) { edit('update_node', { id: node.id, shape: v }); });
      button(row, 'Remove', function () {
        var used = (draft.steps || []).filter(function (s) { return s.from === node.id || s.to === node.id; }).length;
        if (used && root.confirm && !root.confirm('Remove ' + node.id + ' and its ' + used + ' step(s)?')) return;
        edit('remove_node', { id: node.id, cascade: true });
      });
    });
    button(nb, '+ Node', function () {
      var id = freshId('node', draft.nodes || []);
      edit('add_node', { id: id, label: id });
    });

    var sb = section('Steps');
    var ids = (draft.nodes || []).map(function (x) { return x.id; });
    var steps = draft.steps || [];
    steps.forEach(function (s, i) {
      var row = h('div', 'erow', null, sb);
      var num = button(row, String(i + 1), function () { host.jumpToStep(i); }, 'Show this step');
      num.className = 'enum';
      select(row, 'From', ids, s.from, function (v) { edit('update_step', { index: i, from: v }); });
      select(row, 'To', ids, s.to, function (v) { edit('update_step', { index: i, to: v }); });
      field(row, 'Label', s.label, function (v) { edit('update_step', { index: i, label: v }); });
      field(row, 'Detail', s.detail, function (v) { edit('update_step', { index: i, detail: nullable(v) }); });
      field(row, 'Payload', s.payload, function (v) { edit('update_step', { index: i, payload: nullable(v) }); });
      select(row, 'Kind', [''].concat(KINDS), s.kind, function (v) { edit('update_step', { index: i, kind: nullable(v) }); });
      var tl = h('label', 'ef', null, row);
      h('span', null, 'Together', tl);
      var cb = h('input', null, null, tl); cb.type = 'checkbox'; cb.checked = !!s.together;
      cb.addEventListener('change', function () { edit('update_step', { index: i, together: cb.checked ? true : null }); });
      button(row, '↑', function () { edit('move_step', { index: i, to_index: i - 1 }); }, 'Move up').disabled = i === 0;
      button(row, '↓', function () { edit('move_step', { index: i, to_index: i + 1 }); }, 'Move down').disabled = i === steps.length - 1;
      button(row, 'Remove', function () { edit('remove_step', { index: i }); });
    });
    button(sb, '+ Step', function () {
      edit('add_step', { from: ids[0], to: ids[ids.length > 1 ? 1 : 0], label: 'New step' });
    }).disabled = !ids.length;
    mount.scrollTop = keepScroll;
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
