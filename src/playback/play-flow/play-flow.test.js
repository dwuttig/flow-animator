'use strict';
var test = require('node:test');
var assert = require('node:assert');
var P = require('./play-flow.js');

function setup(o) {
  var log = [];
  var p = P.create({
    begin: function (i) { log.push('begin ' + i); },
    move: function (t) { log.push('move ' + Math.round(t * 100) / 100); },
    arrive: function (i) { log.push('arrive ' + i); },
    change: function () { log.push('change'); }
  }, o);
  return { p: p, log: log };
}
function run(p, ms) { var going = true; for (var t = 0; t < ms && going; t += 50) going = p.tick(50); return going; }

test('ease is 0 at 0, 0.5 at the middle, 1 at 1 and monotonic', function () {
  assert.strictEqual(P.ease(0), 0); assert.strictEqual(P.ease(0.5), 0.5); assert.strictEqual(P.ease(1), 1);
  for (var t = 0; t < 1; t += 0.05) assert.ok(P.ease(t + 0.05) >= P.ease(t));
});

test('setBeats begins at Beat 0 with packets at the start', function () {
  var t = setup();
  t.p.setBeats(3);
  assert.deepStrictEqual(t.log, ['begin 0', 'move 0']);
  var s = t.p.state();
  assert.strictEqual(s.beats, 3); assert.strictEqual(s.idx, 0); assert.strictEqual(s.arrived, false); assert.strictEqual(s.playing, true);
  assert.strictEqual(s.DUR, 1300); assert.strictEqual(s.HOLD, 500);
});

test('tick moves, arrives after DUR, holds HOLD, then begins the next Beat', function () {
  var t = setup();
  t.p.setBeats(2); t.log.length = 0;
  t.p.tick(100);
  assert.deepStrictEqual(t.log, ['move ' + Math.round(P.ease(100 / 1300) * 100) / 100]);
  for (var i = 0; i < 12; i++) t.p.tick(100);
  assert.strictEqual(t.p.state().arrived, true);
  assert.strictEqual(t.log[t.log.length - 1], 'arrive 0');
  var n = t.log.length;
  for (i = 0; i < 4; i++) t.p.tick(100);
  assert.strictEqual(t.log.length, n, 'holding: no more hooks');
  t.p.tick(100);
  assert.deepStrictEqual(t.log.slice(n), ['begin 1', 'move 0']);
  assert.strictEqual(t.p.state().idx, 1);
});

test('dt is clamped to 100 ms and scaled by speed', function () {
  var t = setup();
  t.p.setBeats(1);
  t.p.tick(5000);
  assert.strictEqual(t.p.state().elapsed, 100);
  t.p.setSpeed(2); t.p.tick(50);
  assert.strictEqual(t.p.state().elapsed, 200);
  t.p.setSpeed(0); assert.strictEqual(t.p.state().speed, 2, 'ignores non-positive speed');
  t.p.tick(-20); assert.strictEqual(t.p.state().elapsed, 200);
});

test('loop wraps to Beat 0; without loop it finishes and stops', function () {
  var t = setup();
  t.p.setBeats(2);
  run(t.p, 3700);
  assert.strictEqual(t.p.state().idx, 0, 'looped');
  assert.ok(t.log.indexOf('begin 1') > 0);
  var u = setup({ loop: false });
  u.p.setBeats(2);
  assert.strictEqual(run(u.p, 10000), false);
  var s = u.p.state();
  assert.strictEqual(s.finished, true); assert.strictEqual(s.playing, false); assert.strictEqual(s.idx, 1);
  assert.strictEqual(u.log[u.log.length - 1], 'change');
  assert.strictEqual(u.p.tick(100), false, 'no ticks after finishing');
});

test('togglePlay pauses, resumes, and replays from 0 when finished', function () {
  var t = setup({ loop: false });
  t.p.setBeats(2);
  t.p.togglePlay();
  assert.strictEqual(t.p.state().playing, false);
  assert.strictEqual(t.p.tick(100), false);
  assert.strictEqual(t.p.state().elapsed, 0, 'paused does not advance');
  t.p.togglePlay();
  run(t.p, 10000);
  assert.strictEqual(t.p.state().finished, true);
  t.log.length = 0;
  t.p.togglePlay();
  assert.deepStrictEqual(t.log, ['begin 0', 'move 0', 'change']);
  var s = t.p.state();
  assert.strictEqual(s.playing, true); assert.strictEqual(s.finished, false); assert.strictEqual(s.idx, 0);
});

test('jump wraps, can land arrived, and clears finished; next/prev/restart', function () {
  var t = setup({ playing: false });
  t.p.setBeats(3);
  t.p.jump(-1, true);
  var s = t.p.state();
  assert.strictEqual(s.idx, 2); assert.strictEqual(s.arrived, true); assert.strictEqual(s.elapsed, 1300);
  assert.strictEqual(t.log[t.log.length - 1], 'arrive 2');
  t.p.next(); assert.strictEqual(t.p.state().idx, 0);
  t.p.prev(); assert.strictEqual(t.p.state().idx, 2);
  t.p.jump(4, false); s = t.p.state();
  assert.strictEqual(s.idx, 1); assert.strictEqual(s.arrived, false); assert.strictEqual(s.elapsed, 0);
  t.p.restart(); assert.strictEqual(t.p.state().idx, 0); assert.strictEqual(t.p.state().arrived, false);
  assert.strictEqual(t.p.state().playing, false, 'jumping does not start playback');
});

test('arrived jump while playing holds, then continues', function () {
  var t = setup();
  t.p.setBeats(3);
  t.p.jump(1, true);
  for (var i = 0; i < 4; i++) t.p.tick(100);
  assert.strictEqual(t.p.state().idx, 1);
  t.p.tick(100);
  assert.strictEqual(t.p.state().idx, 2);
});

test('no Beats: everything is a no-op', function () {
  var t = setup();
  t.p.setBeats(0); t.p.jump(2, true); t.p.togglePlay();
  assert.strictEqual(t.p.tick(100), false);
  assert.deepStrictEqual(t.log, []);
});

test('setPlaying reports a change only when it changes', function () {
  var t = setup();
  t.p.setBeats(1); t.log.length = 0;
  t.p.setPlaying(true); assert.deepStrictEqual(t.log, []);
  t.p.setPlaying(false); assert.deepStrictEqual(t.log, ['change']);
  t.p.setLoop(false); assert.strictEqual(t.p.state().loop, false);
});

test('setBeats with a start Beat keeps the position (re-render)', function () {
  var t = setup();
  t.p.setBeats(4, 2); assert.strictEqual(t.p.state().idx, 2);
  t.p.setBeats(2, 5); assert.strictEqual(t.p.state().idx, 1);
});

test('loop driver requests frames only while playing', function () {
  var queue = [], cancelled = [], nextId = 1;
  function raf(fn) { var id = nextId++; queue.push({ id: id, fn: fn }); return id; }
  function caf(id) { cancelled.push(id); queue = queue.filter(function (q) { return q.id !== id; }); }
  function flush(now) { var q = queue; queue = []; q.forEach(function (f) { f.fn(now); }); }
  var player = P.create({}, { loop: false });
  var l = P.loop(player, { raf: raf, caf: caf });
  player.setBeats(1);
  l.sync(); l.sync();
  assert.strictEqual(queue.length, 1, 'one frame at a time');
  flush(1000);
  assert.strictEqual(player.state().elapsed, 0, 'first frame has dt 0');
  flush(1050);
  assert.strictEqual(player.state().elapsed, 50);
  player.setPlaying(false); l.sync();
  assert.strictEqual(queue.length, 0); assert.strictEqual(l.running(), false); assert.ok(cancelled.length);
  player.setPlaying(true); l.sync();
  flush(9000); flush(9040);
  assert.strictEqual(player.state().elapsed, 90, 'no jump after a pause');
  for (var t = 9100; queue.length && t < 20000; t += 100) flush(t);
  assert.strictEqual(player.state().finished, true);
  assert.strictEqual(queue.length, 0, 'stops when finished');
});

test('loop driver: sync from a hook inside a frame does not double-schedule; custom active()', function () {
  var queue = [], hidden = false;
  function raf(fn) { queue.push(fn); return queue.length; }
  var l;
  var player = P.create({ begin: function () { if (l) l.sync(); } }, { HOLD: 0, DUR: 50 });
  l = P.loop(player, { raf: raf, active: function () { return player.state().playing && !hidden; } });
  player.setBeats(3);
  l.sync();
  for (var t = 0; t < 5; t++) { var q = queue; queue = []; q.forEach(function (f) { f(t * 60); }); assert.ok(queue.length <= 1); }
  hidden = true; l.sync();
  assert.strictEqual(l.running(), false);
});
