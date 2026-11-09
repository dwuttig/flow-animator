/*
 * play-flow: the Playback animation state machine (Playback context, pure, no DOM).
 * A Beat animates for DUR ms (packets travel), holds HOLD ms (arrived), then the next Beat begins.
 *
 *   var p = PlayFlow.create({ begin(idx), move(t), arrive(idx), change() }, { playing, speed, loop, DUR, HOLD });
 *   p.setBeats(n); p.tick(dt) -> still playing?; p.jump(i, arrived); p.next(); p.prev(); p.restart();
 *   p.togglePlay(); p.setPlaying(b); p.setSpeed(s); p.setLoop(b); p.state()
 * hooks: begin(idx) a Beat starts (packets at 0), move(t) eased progress 0..1, arrive(idx) packets reached
 *   their targets, change() playing/finished changed without a begin/arrive.
 *   var loop = PlayFlow.loop(player, { raf, caf, active }); loop.sync()   runs frames only while active().
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.PlayFlow = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DUR = 1300, HOLD = 500, MAX_DT = 100;

  /* ease-in-out (quadratic) */
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function create(hooks, o) {
    hooks = hooks || {}; o = o || {};
    function call(name, a) { if (hooks[name]) hooks[name](a); }
    var S = {
      beats: 0, idx: 0, elapsed: 0, arrived: false,
      playing: o.playing !== false, finished: false,
      speed: o.speed || 1, loop: o.loop !== false, DUR: o.DUR || DUR, HOLD: o.HOLD === undefined ? HOLD : o.HOLD
    };

    function begin(i) {
      S.idx = i; S.elapsed = 0; S.arrived = false;
      call('begin', i);
      call('move', 0);
    }
    function arrive() { S.arrived = true; call('arrive', S.idx); }

    var p = {
      /* New Flow (or re-render): n Beats; starts at Beat 0. */
      setBeats: function (n, start) {
        S.beats = Math.max(0, n | 0); S.finished = false;
        if (S.beats) begin(Math.min(Math.max(0, start | 0), S.beats - 1));
      },
      tick: function (dt) {
        if (!S.playing || !S.beats) return false;
        S.elapsed += Math.min(Math.max(0, dt), MAX_DT) * S.speed;
        if (S.elapsed < S.DUR) call('move', ease(S.elapsed / S.DUR));
        else if (S.elapsed < S.DUR + S.HOLD) { if (!S.arrived) arrive(); }
        else if (S.idx < S.beats - 1) begin(S.idx + 1);
        else if (S.loop) begin(0);
        else { S.playing = false; S.finished = true; call('change'); }
        return S.playing;
      },
      /* Go to Beat i (wraps around); arrived=true shows it settled instead of animating. */
      jump: function (i, arrived) {
        if (!S.beats) return;
        var n = S.beats;
        i = ((i % n) + n) % n;
        S.finished = false;
        begin(i);
        if (arrived) { S.elapsed = S.DUR; arrive(); }
      },
      next: function () { p.jump(S.idx + 1, true); },
      prev: function () { p.jump(S.idx - 1, true); },
      restart: function () { p.jump(0, false); },
      togglePlay: function () {
        if (!S.beats) return;
        if (S.finished) { S.finished = false; S.playing = true; begin(0); }
        else S.playing = !S.playing;
        call('change');
      },
      setPlaying: function (b) { b = !!b; if (b === S.playing) return; S.playing = b; if (b) S.finished = false; call('change'); },
      setSpeed: function (s) { if (s > 0) S.speed = +s; },
      setLoop: function (b) { S.loop = !!b; },
      state: function () {
        return { beats: S.beats, idx: S.idx, elapsed: S.elapsed, arrived: S.arrived, playing: S.playing, finished: S.finished, speed: S.speed, loop: S.loop, DUR: S.DUR, HOLD: S.HOLD };
      }
    };
    return p;
  }

  /* Frame driver: requests animation frames only while active() (default: player is playing). */
  function loop(player, o) {
    var raf = o.raf, caf = o.caf || function () {}, id = null, last = null, inFrame = false;
    var active = o.active || function () { return player.state().playing; };
    function frame(now) {
      id = null; inFrame = true;
      var dt = last === null ? 0 : now - last, go;
      last = now;
      try { go = player.tick(dt) && active(); } finally { inFrame = false; }
      if (go) id = raf(frame);
      else last = null;
    }
    var l = {
      sync: function () {
        if (active()) { if (id === null && !inFrame) id = raf(frame); }
        else l.stop();
      },
      stop: function () { if (id !== null) caf(id); id = null; last = null; },
      running: function () { return id !== null; }
    };
    return l;
  }

  return { create: create, loop: loop, ease: ease, DUR: DUR, HOLD: HOLD };
});
