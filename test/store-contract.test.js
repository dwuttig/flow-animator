'use strict';
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var S = require('../flow-store.js');
var SQ = require('../src/flow-library/sqlite-store/sqlite-store.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'contract-')); }
var DOC = { title: 'T', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], steps: [{ from: 'a', to: 'b', label: 'go' }] };
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function isUser(e) { return e.userError === true; }

var KINDS = {
  files: function () { return new S.Store(tmp()); },
  sqlite: function () { return new SQ.SqliteStore(path.join(tmp(), 'flows.db')); }
};

Object.keys(KINDS).forEach(function (kind) {
  var make = KINDS[kind];

  test(kind + ': list is sorted with title, counts, revision, modifiedAt', function () {
    var st = make();
    assert.deepStrictEqual(st.list(), []);
    st.write('b', DOC);
    var d = clone(DOC); d.title = 'Second'; d.nodes.push({ id: 'c', label: 'C' });
    st.write('a', d);
    var l = st.list();
    assert.deepStrictEqual(l.map(function (f) { return f.file; }), ['a', 'b']);
    assert.strictEqual(l[0].title, 'Second'); assert.strictEqual(l[0].nodes, 3); assert.strictEqual(l[0].steps, 1);
    assert.strictEqual(l[1].revision, st.revision('b'));
    assert.ok(!isNaN(Date.parse(l[1].modifiedAt)));
  });

  test(kind + ': read and readWithRevision', function () {
    var st = make();
    var w = st.write('x', DOC);
    assert.deepStrictEqual(st.read('x'), DOC);
    var r = st.readWithRevision('x');
    assert.strictEqual(r.revision, w.revision);
    assert.deepStrictEqual(JSON.parse(r.text), DOC);
    assert.strictEqual(r.revision, S.revisionOf(r.text));
    assert.throws(function () { st.read('missing'); }, /no such flow/);
    assert.throws(function () { st.readWithRevision('missing'); }, isUser);
  });

  test(kind + ': write preconditions (ifNoneMatch, ifMatch) report conflicts and keep data', function () {
    var st = make();
    assert.strictEqual(st.revision('x'), null);
    var w1 = st.write('x', DOC, { ifNoneMatch: '*' });
    assert.ok(w1.ok && w1.created && /^[0-9a-f]{16}$/.test(w1.revision));
    var c = st.write('x', DOC, { ifNoneMatch: '*' });
    assert.strictEqual(c.conflict, true); assert.strictEqual(c.revision, w1.revision);
    var d2 = clone(DOC); d2.title = 'T2';
    var w2 = st.write('x', d2, { ifMatch: w1.revision });
    assert.ok(w2.ok && !w2.created && w2.revision !== w1.revision);
    var stale = st.write('x', DOC, { ifMatch: w1.revision });
    assert.strictEqual(stale.conflict, true); assert.strictEqual(stale.revision, w2.revision);
    assert.strictEqual(st.read('x').title, 'T2');
  });

  test(kind + ': invalid documents are rejected and nothing is stored', function () {
    var st = make();
    var r = st.write('bad', { nodes: [], steps: [{ from: 'q', to: 'z', label: 'l' }] });
    assert.strictEqual(r.ok, false); assert.ok(r.errors.length);
    assert.strictEqual(st.exists('bad'), false);
    assert.deepStrictEqual(st.list(), []);
  });

  test(kind + ': remove honours ifMatch; missing flow throws', function () {
    var st = make();
    var w = st.write('x', DOC);
    assert.strictEqual(st.remove('x', { ifMatch: 'deadbeefdeadbeef' }).conflict, true);
    assert.ok(st.remove('x', { ifMatch: w.revision }).ok);
    assert.strictEqual(st.exists('x'), false);
    assert.throws(function () { st.remove('x'); }, /no such flow/);
  });

  test(kind + ': edit applies one operation, rejects stale, invalid and unknown edits', function () {
    var st = make();
    var w = st.write('x', DOC);
    var e = st.edit('x', 'set_meta', { title: 'other' });
    assert.ok(e.ok); assert.strictEqual(e.stats.nodes, 2);
    var stale = st.edit('x', 'set_meta', { title: 'mine' }, { ifMatch: w.revision });
    assert.strictEqual(stale.conflict, true); assert.ok(/conflict/.test(stale.error));
    var bad = st.edit('x', 'add_step', { from: 'a', to: 'nope', label: 'z' });
    assert.strictEqual(bad.ok, false); assert.ok(bad.note);
    assert.throws(function () { st.edit('x', 'nope', {}); }, isUser);
    assert.strictEqual(st.read('x').title, 'other');
  });

  test(kind + ': names are bare, the suffix is optional, lookups ignore case, bad names throw', function () {
    var st = make();
    assert.ok(st.write('Orders.flow.json', DOC).ok);
    assert.deepStrictEqual(st.list().map(function (f) { return f.file; }), ['Orders']);
    assert.strictEqual(st.exists('orders'), true);
    assert.strictEqual(st.read('ORDERS.flow.json').title, 'T');
    assert.strictEqual(st.write('orders', DOC, { ifNoneMatch: '*' }).conflict, true);
    ['../x', 'a/b', '.hidden', '', 'has space', 'x.json', '.flow.json'].forEach(function (n) {
      assert.throws(function () { st.write(n, DOC); }, isUser, n);
    });
  });

  test(kind + ': revisions and readRevision give the current revision', function () {
    var st = make();
    var w = st.write('x', DOC);
    var rs = st.revisions('x');
    assert.strictEqual(rs[0].revision, w.revision);
    assert.ok(rs[0].modifiedAt);
    var r = st.readRevision('x', w.revision);
    assert.deepStrictEqual(r.doc, DOC); assert.strictEqual(r.revision, w.revision);
    assert.throws(function () { st.readRevision('x', 'ffffffffffffffff'); }, isUser);
    assert.throws(function () { st.revisions('missing'); }, isUser);
  });
});
