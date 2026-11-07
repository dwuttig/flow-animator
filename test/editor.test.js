'use strict';
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var Core = require('../flow-core.js');
var Edits = require('../src/flow-library/apply-edit/apply-edit.js');
var Editor = require('../src/playback/edit-flow/edit-flow.js');

var ROOT = path.join(__dirname, '..');
var EXAMPLE = fs.readFileSync(path.join(ROOT, 'examples', 'order-flow.flow.json'), 'utf8');

function make(text) {
  var state = { text: text, reports: [], shown: 0 };
  var host = {
    getText: function () { return state.text; },
    show: function (t) { state.text = t; state.shown++; },
    jumpToStep: function () {}, pause: function () {},
    report: function (errs) { state.reports.push(errs); }
  };
  var ed = Editor.create(host, null, Core, Edits);
  ed.setActive(true);
  return { ed: ed, state: state };
}

test('valid edit is committed, shown and undoable', function () {
  var m = make(EXAMPLE), before = JSON.parse(EXAMPLE).nodes.length;
  var r = m.ed.edit('add_node', { id: 'extra', label: 'Extra' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(JSON.parse(m.state.text).nodes.length, before + 1);
  assert.strictEqual(m.ed.isDirty(), true);
  m.ed.undo();
  assert.strictEqual(JSON.parse(m.state.text).nodes.length, before);
  m.ed.redo();
  assert.strictEqual(JSON.parse(m.state.text).nodes.length, before + 1);
});

test('invalid edit is rejected and the draft is unchanged', function () {
  var m = make(EXAMPLE), shown = m.state.shown;
  var r = m.ed.edit('add_step', { from: 'ghost', to: 'ghost2', label: 'x' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.length > 0);
  assert.strictEqual(m.state.shown, shown);
  assert.deepStrictEqual(m.ed.draft(), JSON.parse(EXAMPLE));
  assert.strictEqual(m.ed.isDirty(), false);
});

test('misused edit reports a message instead of throwing', function () {
  var m = make(EXAMPLE);
  var r = m.ed.edit('remove_node', { id: JSON.parse(EXAMPLE).nodes[0].id });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(m.state.reports.length, 1);
});

test('loads that did not come from the editor resync the draft', function () {
  var m = make(EXAMPLE);
  m.ed.edit('set_meta', { title: 'Changed' });
  var other = JSON.stringify({ title: 'Other', nodes: [{ id: 'a', label: 'A' }], steps: [] });
  m.state.text = other;
  m.ed.onLoaded(other);
  assert.strictEqual(m.ed.draft().title, 'Other');
  assert.strictEqual(m.ed.isDirty(), false);
});

test('standalone bundle inlines viewer, edits and editor', function () {
  var out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-')), 'o.html');
  cp.execFileSync(process.execPath, [path.join(ROOT, 'build-standalone.js'), path.join(ROOT, 'examples', 'order-flow.flow.json'), out]);
  var html = fs.readFileSync(out, 'utf8');
  assert.ok(html.indexOf('FlowEdits') >= 0 && html.indexOf('FlowEditor') >= 0);
  assert.ok(html.indexOf('src="src/') < 0, 'no external script references remain');
});
