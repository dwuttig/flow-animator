'use strict';
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var S = require('../../../flow-store.js');
var SQ = require('./sqlite-store.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'flowdb-')); }
var DOC = { title: 'T', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], steps: [{ from: 'a', to: 'b', label: 'go' }] };
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function newStore() { return new SQ.SqliteStore(path.join(tmp(), 'flows.db')); }

test('sqlite: revision equals the folder store revision for the same flow', function () {
  var a = newStore(), b = new S.Store(tmp());
  assert.strictEqual(a.write('x.flow.json', DOC).revision, b.write('x.flow.json', DOC).revision);
});

test('sqlite: preconditions guard writes and deletes', function () {
  var st = newStore();
  assert.strictEqual(st.revision('x.flow.json'), null);
  var w1 = st.write('x.flow.json', DOC, { ifNoneMatch: '*' });
  assert.ok(w1.ok && w1.created && /^[0-9a-f]{16}$/.test(w1.revision));
  assert.strictEqual(st.write('x.flow.json', DOC, { ifNoneMatch: '*' }).conflict, true);
  var d2 = clone(DOC); d2.title = 'T2';
  var w2 = st.write('x.flow.json', d2, { ifMatch: w1.revision });
  assert.ok(w2.ok && !w2.created && w2.revision !== w1.revision);
  var stale = st.write('x.flow.json', DOC, { ifMatch: w1.revision });
  assert.strictEqual(stale.conflict, true);
  assert.strictEqual(stale.revision, w2.revision);
  assert.strictEqual(st.read('x.flow.json').title, 'T2');
  assert.strictEqual(st.remove('x.flow.json', { ifMatch: w1.revision }).conflict, true);
  assert.ok(st.remove('x.flow.json', { ifMatch: w2.revision }).ok);
  assert.strictEqual(st.exists('x.flow.json'), false);
  assert.throws(function () { st.read('x.flow.json'); }, /no such flow/);
});

test('sqlite: invalid documents are rejected and nothing is stored', function () {
  var st = newStore();
  var r = st.write('bad.flow.json', { nodes: [], steps: [{ from: 'q', to: 'z' }] });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(st.exists('bad.flow.json'), false);
});

test('sqlite: names follow the same rules as files', function () {
  var st = newStore();
  ['../x.flow.json', 'a/b.flow.json', '.hidden.flow.json', '', 'has space'].forEach(function (n) {
    assert.throws(function () { st.write(n, DOC); }, function (e) { return e.userError; }, n);
  });
});

test('sqlite: list gives title, counts, revision, modifiedAt, sorted', function () {
  var st = newStore();
  st.write('b.flow.json', DOC); st.write('a.flow.json', DOC);
  var l = st.list();
  assert.deepStrictEqual(l.map(function (f) { return f.file; }), ['a', 'b']);
  assert.strictEqual(l[0].title, 'T'); assert.strictEqual(l[0].nodes, 2); assert.strictEqual(l[0].steps, 1);
  assert.ok(l[0].revision && l[0].modifiedAt);
});

test('sqlite: edit applies an operation; stale edit is rejected', function () {
  var st = newStore();
  var w = st.write('x.flow.json', DOC);
  assert.ok(st.edit('x.flow.json', 'set_meta', { title: 'other' }).ok);
  var r = st.edit('x.flow.json', 'set_meta', { title: 'mine' }, { ifMatch: w.revision });
  assert.strictEqual(r.conflict, true);
  assert.strictEqual(st.read('x.flow.json').title, 'other');
});

test('sqlite: data survives reopening the file', function () {
  var file = path.join(tmp(), 'flows.db');
  var rev = new SQ.SqliteStore(file).write('x.flow.json', DOC).revision;
  var again = new SQ.SqliteStore(file);
  assert.strictEqual(again.revision('x.flow.json'), rev);
});

test('import: copies flow files once, skips invalid, never overwrites', function () {
  var dir = tmp();
  fs.writeFileSync(path.join(dir, 'ok.flow.json'), JSON.stringify(DOC));
  fs.writeFileSync(path.join(dir, 'broken.flow.json'), '{nope');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  var st = newStore();
  var d2 = clone(DOC); d2.title = 'in db';
  st.write('keep.flow.json', d2);
  fs.writeFileSync(path.join(dir, 'keep.flow.json'), JSON.stringify(DOC));
  var r = st.importDir(dir);
  assert.deepStrictEqual(r.imported, ['ok']);
  assert.deepStrictEqual(r.existing, ['keep']);
  assert.strictEqual(r.skipped.length, 1);
  assert.strictEqual(r.skipped[0].file, 'broken.flow.json');
  assert.strictEqual(st.read('keep').title, 'in db');
  assert.strictEqual(st.read('ok').title, 'T');
});

test('openStore: sqlite by default, first-start import happens once', function () {
  var dir = tmp(), data = tmp();
  fs.writeFileSync(path.join(dir, 'a.flow.json'), JSON.stringify(DOC));
  var env = { FLOW_DIR: dir, FLOW_DB: path.join(data, 'flows.db') };
  var st = S.openStore(env);
  assert.ok(st instanceof SQ.SqliteStore);
  assert.deepStrictEqual(st.list().map(function (f) { return f.file; }), ['a']);
  st.remove('a.flow.json');
  var st2 = S.openStore(env); // reopened: must not resurrect the deleted flow
  assert.deepStrictEqual(st2.list(), []);
});

test('openStore: FLOW_IMPORT=0 skips the import; FLOW_STORE=files gives the folder store', function () {
  var dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.flow.json'), JSON.stringify(DOC));
  var st = S.openStore({ FLOW_DIR: dir, FLOW_DB: path.join(tmp(), 'f.db'), FLOW_IMPORT: '0' });
  assert.deepStrictEqual(st.list(), []);
  var fsStore = S.openStore({ FLOW_DIR: dir, FLOW_STORE: 'files' });
  assert.ok(fsStore instanceof S.Store);
  assert.strictEqual(fsStore.list().length, 1);
  assert.throws(function () { S.openStore({ FLOW_DIR: dir, FLOW_STORE: 'mongo' }); }, /FLOW_STORE/);
});

test('names: bare names, a typed .flow.json suffix is stripped, unique ignoring case', function () {
  var st = newStore();
  var w = st.write('Orders', DOC);
  assert.ok(w.ok && w.created);
  assert.deepStrictEqual(st.list().map(function (f) { return f.file; }), ['Orders']);
  assert.strictEqual(st.read('Orders.flow.json').title, 'T');
  assert.strictEqual(st.exists('orders'), true);
  assert.strictEqual(st.write('ORDERS.flow.json', DOC, { ifNoneMatch: '*' }).conflict, true);
  assert.throws(function () { st.write('a b', DOC); }, function (e) { return e.userError; });
  assert.throws(function () { st.write('x/y', DOC); }, function (e) { return e.userError; });
  assert.throws(function () { st.write('.flow.json', DOC); }, function (e) { return e.userError; });
});

test('names: legacy rows with the suffix are renamed when the database is opened', function () {
  var file = path.join(tmp(), 'old.db');
  var DatabaseSync = require('node:sqlite').DatabaseSync;
  var raw = new DatabaseSync(file);
  raw.exec('CREATE TABLE flows (name TEXT PRIMARY KEY, body TEXT NOT NULL, revision TEXT NOT NULL, modified_at TEXT NOT NULL); CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  var text = JSON.stringify(DOC, null, 2) + '\n';
  raw.prepare('INSERT INTO flows VALUES (?,?,?,?)').run('legacy.flow.json', text, S.revisionOf(text), 'now');
  raw.close();
  var st = new SQ.SqliteStore(file);
  assert.deepStrictEqual(st.list().map(function (f) { return f.file; }), ['legacy']);
  assert.strictEqual(st.revision('legacy.flow.json'), S.revisionOf(text));
});

test('names: a name ending in .json is rejected (it would be confused with a file)', function () {
  assert.throws(function () { newStore().write('x.json', DOC); }, function (e) { return e.userError; });
});
