'use strict';
var test = require('node:test');
var assert = require('node:assert');
var Core = require('../flow-core.js');
var Edits = require('../src/flow-library/apply-edit/apply-edit.js');
var Editor = require('../src/playback/edit-flow/edit-flow.js');

/* ---------- minimal DOM shim: only what edit-flow.js touches ---------- */

function Doc() { this._active = null; this.body = this.createElement('body'); this.defaultView = {}; }
Doc.prototype.createElement = function (tag) { return new El(this, tag.toUpperCase()); };
Doc.prototype.createTextNode = function (t) { var e = new El(this, '#text'); e._text = String(t); return e; };
Object.defineProperty(Doc.prototype, 'activeElement', {
  get: function () { return this._active && this.body.contains(this._active) ? this._active : this.body; }
});

function El(doc, tag) {
  this.ownerDocument = doc; this.tagName = tag; this.childNodes = []; this.parentNode = null;
  this.attrs = {}; this.listeners = {}; this.style = {}; this.className = ''; this.value = '';
  this.disabled = false; this.hidden = false; this.open = false; this.scrollTop = 0; this._text = '';
  this.selectionStart = null; this.selectionEnd = null;
}
Object.defineProperty(El.prototype, 'children', { get: function () { return this.childNodes.filter(function (c) { return c.tagName !== '#text'; }); } });
Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
Object.defineProperty(El.prototype, 'textContent', {
  get: function () { return this.tagName === '#text' ? this._text : this.childNodes.map(function (c) { return c.textContent; }).join(''); },
  set: function (t) { this._clear(); if (t !== '') this.appendChild(this.ownerDocument.createTextNode(t)); }
});
Object.defineProperty(El.prototype, 'innerHTML', { set: function () { this._clear(); } });
El.prototype._clear = function () { this.childNodes.forEach(function (c) { c.parentNode = null; }); this.childNodes = []; };
El.prototype.appendChild = function (c) { return this.insertBefore(c, null); };
El.prototype.insertBefore = function (c, ref) {
  if (c.parentNode) c.parentNode.removeChild(c);
  var i = ref ? this.childNodes.indexOf(ref) : -1;
  if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
  c.parentNode = this; return c;
};
El.prototype.removeChild = function (c) { this.childNodes.splice(this.childNodes.indexOf(c), 1); c.parentNode = null; return c; };
El.prototype.replaceChild = function (n, o) { this.insertBefore(n, o); return this.removeChild(o); };
El.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
El.prototype.contains = function (x) { for (; x; x = x.parentNode) if (x === this) return true; return false; };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
El.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
El.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
El.prototype.dispatchEvent = function (ev) {
  ev.target = ev.target || this;
  for (var n = this; n; n = n.parentNode) {
    ev.currentTarget = n;
    (n.listeners[ev.type] || []).slice().forEach(function (fn) { fn.call(n, ev); });
    if (ev.bubbles === false) break;
  }
  return !ev.defaultPrevented;
};
El.prototype.focus = function () {
  var d = this.ownerDocument, old = d.activeElement;
  if (this.disabled || !d.body.contains(this) || old === this) return;
  d._active = this;
  if (old) fire(old, 'focusout', { relatedTarget: this });
  fire(this, 'focusin', { relatedTarget: old });
};
El.prototype.select = function () { this.selectionStart = 0; this.selectionEnd = this.value.length; };
El.prototype.setSelectionRange = function (a, b) { this.selectionStart = a; this.selectionEnd = b; };
El.prototype.click = function () { if (!this.disabled) fire(this, 'click'); };
El.prototype.getBoundingClientRect = function () { return { top: 0, height: 20, left: 0, width: 100 }; };

function fire(el, type, props) {
  var ev = { type: type, defaultPrevented: false, preventDefault: function () { this.defaultPrevented = true; } };
  Object.keys(props || {}).forEach(function (k) { ev[k] = props[k]; });
  el.dispatchEvent(ev);
  return ev;
}
function all(el, out) { out = out || []; el.children.forEach(function (c) { out.push(c); all(c, out); }); return out; }

/* ---------- harness ---------- */

var FLOW = {
  title: 'T',
  nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
  steps: [{ from: 'a', to: 'b', label: 'one' }, { from: 'b', to: 'c', label: 'two' }, { from: 'c', to: 'a', label: 'three' }]
};

function setup(extra) {
  var doc = new Doc(), m = { doc: doc, text: JSON.stringify(FLOW), shows: [], reports: [], calls: [] };
  var host = {
    getText: function () { return m.text; },
    show: function (t, name, res) { m.text = t; m.shows.push({ text: t, name: name, res: res }); },
    jumpToStep: function () {}, pause: function () {},
    report: function (errs) { m.reports.push(errs); }
  };
  Object.keys(extra || {}).forEach(function (k) { host[k] = extra[k]; });
  var edits = { apply: function (d, op, a) { m.calls.push([op, a]); return Edits.apply(d, op, a); } };
  m.ed = Editor.create(host, doc, Core, edits);
  m.mount = doc.createElement('div'); doc.body.appendChild(m.mount);
  m.ed.mount(m.mount); m.ed.setActive(true);
  m.key = function (k) { return all(m.mount).filter(function (e) { return e.getAttribute('data-fkey') === k; })[0]; };
  m.open = function (k) { var d = m.key(k + ':sum').parentNode; d.open = true; fire(d, 'toggle'); };
  m.activeKey = function () { return doc.activeElement.getAttribute && doc.activeElement.getAttribute('data-fkey'); };
  return m;
}

/* ---------- tests ---------- */

test('rejected edit re-renders the panel and keeps focus on the field', function () {
  var m = setup();
  m.open('n:a');
  var id = m.key('n:a:id'); id.focus(); id.value = 'b';
  fire(id, 'change');
  assert.strictEqual(m.reports.length, 1);
  assert.notStrictEqual(m.key('n:a:id'), id, 'panel was rebuilt');
  assert.strictEqual(m.key('n:a:id').value, 'a');
  assert.strictEqual(m.activeKey(), 'n:a:id');
});

test('Tab after typing commits and moves focus to the next/previous field', function () {
  var m = setup();
  m.open('n:a');
  var label = m.key('n:a:label'); label.focus(); label.value = 'Alpha';
  var ev = fire(label, 'keydown', { key: 'Tab' });
  assert.ok(ev.defaultPrevented);
  assert.strictEqual(m.ed.draft().nodes[0].label, 'Alpha');
  assert.strictEqual(m.activeKey(), 'n:a:subtitle');
  var sub = m.key('n:a:subtitle'); sub.value = 'sub';
  fire(sub, 'keydown', { key: 'Tab', shiftKey: true });
  assert.strictEqual(m.ed.draft().nodes[0].subtitle, 'sub');
  assert.strictEqual(m.activeKey(), 'n:a:label');
  assert.strictEqual(m.calls.length, 2);
});

test('Tab without a change keeps the browser default', function () {
  var m = setup();
  m.open('n:a');
  var label = m.key('n:a:label'); label.focus();
  assert.strictEqual(fire(label, 'keydown', { key: 'Tab' }).defaultPrevented, false);
  assert.strictEqual(m.calls.length, 0);
});

test('focus and caret survive a re-render', function () {
  var m = setup();
  m.open('n:a');
  var label = m.key('n:a:label'); label.focus(); label.value = 'Abc'; label.setSelectionRange(1, 2);
  fire(label, 'change');
  var now = m.doc.activeElement;
  assert.notStrictEqual(now, label);
  assert.strictEqual(m.activeKey(), 'n:a:label');
  assert.deepStrictEqual([now.selectionStart, now.selectionEnd], [1, 2]);
});

test('renaming a node keeps its item open and focus follows the new id', function () {
  var m = setup();
  m.open('n:a');
  var id = m.key('n:a:id'); id.focus(); id.value = 'z';
  fire(id, 'keydown', { key: 'Tab' });
  assert.strictEqual(m.ed.draft().nodes[0].id, 'z');
  assert.strictEqual(m.activeKey(), 'n:z:label');
  assert.strictEqual(m.key('n:z:sum').parentNode.open, true);
});

test('host.show receives the loadDoc result for edits, undo and redo', function () {
  var m = setup();
  m.ed.edit('set_meta', { title: 'X' });
  m.ed.undo(); m.ed.redo();
  assert.strictEqual(m.shows.length, 3);
  m.shows.forEach(function (s) { assert.strictEqual(s.name, 'draft'); assert.ok(s.res && s.res.ok && s.res.model && s.res.geometry); });
  assert.strictEqual(m.shows[1].res.model.title, 'T');
});

test('download goes through host.download when provided', function () {
  var got = null, m = setup({ download: function (t, title) { got = [t, title]; } });
  m.key('bar:download').click();
  assert.deepStrictEqual(JSON.parse(got[0]), FLOW);
  assert.strictEqual(got[1], 'T');
});

test('kind/shape/connection options come from FlowCore', function () {
  var m = setup();
  m.open('n:a'); m.open('s:0');
  var opts = function (k) { return m.key(k).children.map(function (o) { return o.value; }); };
  assert.deepStrictEqual(opts('n:a:shape'), Core.SHAPES);
  assert.deepStrictEqual(opts('s:0:kind'), [''].concat(Core.KINDS));
  assert.deepStrictEqual(opts('meta:connection'), [''].concat(Core.CONNECTIONS));
  assert.ok(m.key('meta:direction'));
  var c = m.key('meta:connection'); c.value = 'orthogonal'; fire(c, 'change');
  assert.deepStrictEqual(m.calls[0], ['set_meta', { connection: 'orthogonal' }]);
  c = m.key('meta:connection'); c.value = ''; fire(c, 'change');
  assert.deepStrictEqual(m.calls[1], ['set_meta', { connection: null }]);
});

test('dragging a step onto the lower half of another moves it after that step', function () {
  var m = setup(), dt = { setData: function () {} };
  var handle = all(m.key('s:0:sum')).filter(function (e) { return e.className === 'edrag'; })[0];
  assert.ok(handle.draggable && handle.getAttribute('aria-label'));
  fire(handle, 'dragstart', { dataTransfer: dt });
  var target = m.key('s:2:sum').parentNode;
  assert.ok(fire(target, 'dragover', { dataTransfer: dt, clientY: 15 }).defaultPrevented);
  fire(target, 'drop', { dataTransfer: dt, clientY: 15 });
  assert.deepStrictEqual(m.calls[0], ['move_step', { index: 0, to_index: 2 }]);
  assert.deepStrictEqual(m.ed.draft().steps.map(function (s) { return s.label; }), ['two', 'three', 'one']);
});

test('dropping a step onto its own position is a no-op', function () {
  var m = setup(), dt = { setData: function () {} };
  var handle = all(m.key('s:1:sum')).filter(function (e) { return e.className === 'edrag'; })[0];
  fire(handle, 'dragstart', { dataTransfer: dt });
  fire(m.key('s:2:sum').parentNode, 'drop', { dataTransfer: dt, clientY: 5 });
  assert.strictEqual(m.calls.length, 0);
});

test('insert after adds a reversed step below, opens it and focuses its first field', function () {
  var m = setup();
  m.open('s:0'); m.open('s:1');
  var b = m.key('s:0:ins'); b.focus(); b.click();
  assert.deepStrictEqual(m.calls[0], ['add_step', { at: 1, from: 'b', to: 'a', label: 'New step' }]);
  assert.strictEqual(m.key('s:1:sum').parentNode.open, true);
  assert.strictEqual(m.key('s:2:sum').parentNode.open, true, 'old step 2 stays open');
  assert.strictEqual(m.activeKey(), 's:1:from');
});

test('new nodes and groups open and get focus', function () {
  var m = setup();
  var b = m.key('add:node'); b.focus(); b.click();
  assert.strictEqual(m.key('n:node4:sum').parentNode.open, true);
  assert.strictEqual(m.activeKey(), 'n:node4:id');
  b = m.key('add:group'); b.focus(); b.click();
  assert.strictEqual(m.activeKey(), 'g:group1:label');
});

test('programmatic edits do not steal focus', function () {
  var m = setup();
  m.ed.edit('add_node', { id: 'q', label: 'Q' });
  assert.strictEqual(m.doc.activeElement, m.doc.body);
  assert.strictEqual(m.key('n:q:sum').parentNode.open, true);
});

test('moving a step with the keyboard keeps focus and open state on it', function () {
  var m = setup();
  m.open('s:0');
  var down = m.key('s:0:down'); down.focus(); down.click();
  assert.strictEqual(m.activeKey(), 's:1:down');
  assert.strictEqual(m.key('s:1:sum').parentNode.open, true);
  assert.strictEqual(m.key('s:0:sum').parentNode.open, false);
});

test('icon-only buttons have accessible names', function () {
  var m = setup();
  all(m.mount).filter(function (e) { return e.className === 'eicon'; }).forEach(function (b) { assert.ok(b.getAttribute('aria-label')); });
});

test('removing a node with steps honors a synchronous host confirmation', function () {
  var m = setup({ confirm: function () { return false; } });
  m.key('n:a:remove').click();
  assert.strictEqual(m.ed.draft().nodes.some(function (n) { return n.id === 'a'; }), true);
  assert.strictEqual(m.calls.length, 0);
});

test('removing a node with steps honors an asynchronous host confirmation', async function () {
  var m = setup({ confirm: function () { return Promise.resolve(true); } });
  m.key('n:a:remove').click();
  await Promise.resolve();
  assert.strictEqual(m.ed.draft().nodes.some(function (n) { return n.id === 'a'; }), false);
  assert.deepStrictEqual(m.calls[0], ['remove_node', { id: 'a', cascade: true }]);
});
