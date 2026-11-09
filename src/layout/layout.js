/*
 * layout.js: Layout context. Turns a normalized Flow model into geometry
 * (node rects, routed and trimmed edges, size). Pure and deterministic.
 *
 * No DOM, no dependencies. Works in the browser (window.FlowLayout) and in
 * Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlowLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NODE_H = 60, GAP_X = 72, GAP_Y = 44, TB_GAP_X = 36, TB_GAP_Y = 70, PAD = 40;
  var EDGE_GAP = 3, ARROW = 8;
  var SHAPE_METRICS = {
    box: { extraW: 0 },
    database: { extraW: 0 },
    queue: { extraW: 30 } // room for the slot dividers
  };

  /* ---------- layout ---------- */

  function nodeWidth(n) {
    var a = n.label.length * 8.4, b = (n.subtitle || '').length * 6.8;
    var extra = SHAPE_METRICS[n.shape] ? SHAPE_METRICS[n.shape].extraW : 0;
    return Math.max(120, Math.min(220, Math.ceil(Math.max(a, b) + 36 + extra)));
  }

  function rayExit(o, r, p, gap) {
    var dx = p.x - o.x, dy = p.y - o.y;
    if (!dx && !dy) return { x: o.x, y: o.y };
    var tx = dx > 0 ? (r.x + r.w + gap - o.x) / dx : dx < 0 ? (r.x - gap - o.x) / dx : Infinity;
    var ty = dy > 0 ? (r.y + r.h + gap - o.y) / dy : dy < 0 ? (r.y - gap - o.y) / dy : Infinity;
    var t = Math.min(tx, ty);
    return { x: o.x + dx * t, y: o.y + dy * t };
  }

  function insideRect(pt, r, m) {
    return pt.x > r.x - m && pt.x < r.x + r.w + m && pt.y > r.y - m && pt.y < r.y + r.h + m;
  }

  function f(n) { return Math.round(n * 10) / 10; }

  function route(rects, model, dir, conn) {
    var edges = [], byKey = {};
    model.steps.forEach(function (s) {
      var k = s.from + '>' + s.to;
      if (!byKey[k]) { byKey[k] = { id: k, from: s.from, to: s.to, kind: s.kind }; edges.push(byKey[k]); }
    });
    var warnings = [];
    var b = { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 };
    function grow(x, y) {
      if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
    }
    Object.keys(rects).forEach(function (id) {
      var r = rects[id]; grow(r.x, r.y); grow(r.x + r.w, r.y + r.h);
    });

    edges.forEach(function (e) {
      var a = rects[e.from], z = rects[e.to], p, i;
      if (e.from === e.to) {
        if (dir === 'TB') {
          // flow arrives from above, so the loop goes on the right-hand side
          var rx = a.x + a.w + 2, ya = a.y + a.h * 0.28, yb = a.y + a.h * 0.72;
          e.d = 'M' + f(rx) + ' ' + f(ya) + ' C' + f(rx + 48) + ' ' + f(ya) + ' ' + f(rx + 48) + ' ' + f(yb) + ' ' + f(rx + 2) + ' ' + f(yb);
          grow(rx + 40, ya); grow(rx + 40, yb);
        } else {
          var x1 = a.x + a.w * 0.68, x2 = a.x + a.w * 0.32, y = a.y;
          e.d = 'M' + f(x1) + ' ' + f(y - 2) + ' C' + f(x1) + ' ' + f(y - 38) + ' ' + f(x2) + ' ' + f(y - 38) + ' ' + f(x2) + ' ' + f(y - 4);
          grow(x1, y - 36); grow(x2, y - 36);
        }
        return;
      }
      var c0 = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, c1 = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
      var dx = c1.x - c0.x, dy = c1.y - c0.y, len = Math.hypot(dx, dy) || 1;
      var nrm = { x: -dy / len, y: dx / len };
      var off = byKey[e.to + '>' + e.from] ? 9 : 0;
      if (conn === 'bezier' || conn === 'orthogonal') {
        var horiz = Math.abs(dx) * (dir === 'TB' ? 0.5 : 1.5) >= Math.abs(dy);
        var sx = dx >= 0 ? 1 : -1, sy = dy >= 0 ? 1 : -1, q0, q1;
        if (horiz) {
          q0 = { x: sx > 0 ? a.x + a.w + 2 : a.x - 2, y: c0.y + nrm.y * off };
          q1 = { x: sx > 0 ? z.x - 4 : z.x + z.w + 4, y: c1.y + nrm.y * off };
        } else {
          q0 = { x: c0.x + nrm.x * off, y: sy > 0 ? a.y + a.h + 2 : a.y - 2 };
          q1 = { x: c1.x + nrm.x * off, y: sy > 0 ? z.y - 4 : z.y + z.h + 4 };
        }
        var mx = (q0.x + q1.x) / 2, my = (q0.y + q1.y) / 2;
        if (conn === 'bezier') {
          e.d = horiz
            ? 'M' + f(q0.x) + ' ' + f(q0.y) + ' C' + f(mx) + ' ' + f(q0.y) + ' ' + f(mx) + ' ' + f(q1.y) + ' ' + f(q1.x) + ' ' + f(q1.y)
            : 'M' + f(q0.x) + ' ' + f(q0.y) + ' C' + f(q0.x) + ' ' + f(my) + ' ' + f(q1.x) + ' ' + f(my) + ' ' + f(q1.x) + ' ' + f(q1.y);
        } else {
          e.d = horiz
            ? 'M' + f(q0.x) + ' ' + f(q0.y) + ' L' + f(mx) + ' ' + f(q0.y) + ' L' + f(mx) + ' ' + f(q1.y) + ' L' + f(q1.x) + ' ' + f(q1.y)
            : 'M' + f(q0.x) + ' ' + f(q0.y) + ' L' + f(q0.x) + ' ' + f(my) + ' L' + f(q1.x) + ' ' + f(my) + ' L' + f(q1.x) + ' ' + f(q1.y);
        }
        grow(q0.x, q0.y); grow(q1.x, q1.y); grow(mx, my);
        return;
      }
      var o0 = { x: c0.x + nrm.x * off, y: c0.y + nrm.y * off };
      var o1 = { x: c1.x + nrm.x * off, y: c1.y + nrm.y * off };
      var mid = { x: (o0.x + o1.x) / 2, y: (o0.y + o1.y) / 2 };
      var others = Object.keys(rects).filter(function (id) { return id !== e.from && id !== e.to; });
      var bows = conn === 'linear' ? [0] : [0, 50, -50, 100, -100, 160, -160];
      var chosen = null, firstBlocker = null;

      for (var bi = 0; bi < bows.length && !chosen; bi++) {
        var bow = bows[bi], p0, p1, ctrl = null, pts = [];
        if (bow === 0) {
          p0 = rayExit(o0, a, o1, 4); p1 = rayExit(o1, z, o0, 4);
          for (i = 0; i <= 24; i++) pts.push({ x: p0.x + (p1.x - p0.x) * i / 24, y: p0.y + (p1.y - p0.y) * i / 24 });
        } else {
          ctrl = { x: mid.x + nrm.x * bow * 2, y: mid.y + nrm.y * bow * 2 };
          p0 = rayExit(o0, a, ctrl, 4); p1 = rayExit(o1, z, ctrl, 4);
          for (i = 0; i <= 24; i++) {
            var t = i / 24, u = 1 - t;
            pts.push({ x: u * u * p0.x + 2 * u * t * ctrl.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * ctrl.y + t * t * p1.y });
          }
        }
        var blocker = null;
        for (i = 2; i < pts.length - 2 && !blocker; i++) {
          for (var oi = 0; oi < others.length; oi++) {
            if (insideRect(pts[i], rects[others[oi]], 8)) { blocker = others[oi]; break; }
          }
        }
        if (bow === 0) firstBlocker = blocker;
        if (!blocker || conn === 'linear') chosen = { p0: p0, p1: p1, ctrl: ctrl, pts: pts };
      }
      if (!chosen) {
        p0 = rayExit(o0, a, o1, 4); p1 = rayExit(o1, z, o0, 4);
        chosen = { p0: p0, p1: p1, ctrl: null, pts: [p0, p1] };
        warnings.push('Edge ' + e.from + ' -> ' + e.to + ' runs through node "' + firstBlocker + '". Move nodes with "col"/"row" to clear the path.');
      }
      e.d = chosen.ctrl
        ? 'M' + f(chosen.p0.x) + ' ' + f(chosen.p0.y) + ' Q' + f(chosen.ctrl.x) + ' ' + f(chosen.ctrl.y) + ' ' + f(chosen.p1.x) + ' ' + f(chosen.p1.y)
        : 'M' + f(chosen.p0.x) + ' ' + f(chosen.p0.y) + ' L' + f(chosen.p1.x) + ' ' + f(chosen.p1.y);
      chosen.pts.forEach(function (q) { grow(q.x, q.y); });
    });

    return { edges: edges, bounds: b, warnings: warnings };
  }

  /* ---------- optimize: order nodes inside their layers to cut crossings and edges through nodes ---------- */

  function ccw(a, b, c) { return (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x); }
  function crosses(a, b, c, d) {
    var d1 = ccw(a, b, c), d2 = ccw(a, b, d), d3 = ccw(c, d, a), d4 = ccw(c, d, b);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }

  function optimizeOrder(layers, by, steps, dir, sp) {
    var GAP_X = 72 * sp, GAP_Y = 44 * sp, TB_GAP_X = 36 * sp, TB_GAP_Y = 70 * sp;
    var seenPair = {}, pairs = [];
    steps.forEach(function (s) {
      var k = s.from + '>' + s.to;
      if (s.from !== s.to && !seenPair[k]) { seenPair[k] = true; pairs.push([s.from, s.to]); }
    });
    var nums = Object.keys(layers).map(Number).sort(function (a, b) { return a - b; });
    var free = nums.filter(function (l) { return layers[l].length > 1 && layers[l].every(function (id) { return by[id].row === null; }); });
    if (!free.length || !pairs.length) return;
    var neigh = {};
    pairs.forEach(function (p) { (neigh[p[0]] = neigh[p[0]] || []).push(p[1]); (neigh[p[1]] = neigh[p[1]] || []).push(p[0]); });
    var layerOf = {};
    nums.forEach(function (l) { layers[l].forEach(function (id) { layerOf[id] = l; }); });

    function rects() {
      var maxRows = Math.max.apply(null, nums.map(function (l) { return layers[l].length; }));
      var cw = 0, r = {}, x = 0;
      Object.keys(by).forEach(function (id) { cw = Math.max(cw, nodeWidth(by[id])); });
      nums.forEach(function (l) {
        var lw = Math.max.apply(null, layers[l].map(function (id) { return nodeWidth(by[id]); }));
        layers[l].forEach(function (id, i) {
          var w = nodeWidth(by[id]), row = i + (maxRows - layers[l].length) / 2;
          r[id] = dir === 'LR'
            ? { x: x + (lw - w) / 2, y: row * (NODE_H + GAP_Y), w: w, h: NODE_H }
            : { x: row * (cw + TB_GAP_X) + (cw - w) / 2, y: l * (NODE_H + TB_GAP_Y), w: w, h: NODE_H };
        });
        x += lw + GAP_X;
      });
      return r;
    }
    function cost() {
      var r = rects(), c = {}, total = 0, i, j, k;
      Object.keys(r).forEach(function (id) { c[id] = { x: r[id].x + r[id].w / 2, y: r[id].y + r[id].h / 2 }; });
      for (i = 0; i < pairs.length; i++) {
        var a = c[pairs[i][0]], b = c[pairs[i][1]];
        total += 0.002 * Math.hypot(b.x - a.x, b.y - a.y);
        for (k in r) {
          if (k === pairs[i][0] || k === pairs[i][1]) continue;
          for (j = 1; j < 20; j++) {
            if (insideRect({ x: a.x + (b.x - a.x) * j / 20, y: a.y + (b.y - a.y) * j / 20 }, r[k], 8)) { total += 10; break; }
          }
        }
        for (j = i + 1; j < pairs.length; j++) {
          var p = pairs[j];
          if (p[0] === pairs[i][0] || p[0] === pairs[i][1] || p[1] === pairs[i][0] || p[1] === pairs[i][1]) continue;
          if (crosses(a, b, c[p[0]], c[p[1]])) total += 3;
        }
      }
      return total;
    }
    function snapshot() { var s = {}; nums.forEach(function (l) { s[l] = layers[l].slice(); }); return s; }
    function restore(s) { nums.forEach(function (l) { layers[l] = s[l].slice(); }); }

    var best = snapshot(), bestCost = cost();
    function consider() { var c = cost(); if (c < bestCost - 1e-9) { bestCost = c; best = snapshot(); } }

    // barycenter sweeps, alternating direction
    for (var it = 0; it < 8; it++) {
      var seq = it % 2 ? free.slice().reverse() : free;
      seq.forEach(function (l) {
        var pos = {};
        nums.forEach(function (m) { layers[m].forEach(function (id, i) { pos[id] = i + (Math.max.apply(null, nums.map(function (q) { return layers[q].length; })) - layers[m].length) / 2; }); });
        var key = {};
        layers[l].forEach(function (id) {
          var ns = (neigh[id] || []).filter(function (n) { return layerOf[n] !== l; });
          key[id] = ns.length ? ns.reduce(function (s, n) { return s + pos[n]; }, 0) / ns.length : pos[id];
        });
        var idx = {}; layers[l].forEach(function (id, i) { idx[id] = i; });
        layers[l].sort(function (a, b) { return key[a] - key[b] || idx[a] - idx[b]; });
      });
      consider();
    }
    restore(best);

    // hill climb: swap two nodes of a layer while the cost drops
    for (var pass = 0, improved = true; pass < 12 && improved; pass++) {
      improved = false;
      free.forEach(function (l) {
        var arr = layers[l];
        for (var i = 0; i < arr.length; i++) {
          for (var j = i + 1; j < arr.length; j++) {
            var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
            var c = cost();
            if (c < bestCost - 1e-9) { bestCost = c; improved = true; } else { t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
          }
        }
      });
    }
  }

  function layout(model, opts) {
    opts = opts || {};
    var dir = opts.direction || model.direction, conn = opts.connection || model.connection || 'auto', nodes = model.nodes, steps = model.steps;
    var by = {};
    nodes.forEach(function (n) { by[n.id] = n; });

    // 1. layers (columns for LR, rows for TB): follow the order of the steps
    var layer = {}, order = [], seen = {};
    function see(id) { if (!seen[id]) { seen[id] = true; order.push(id); } }
    nodes.forEach(function (n) { if (n.col !== null) layer[n.id] = n.col; });
    steps.forEach(function (s) {
      see(s.from); see(s.to);
      var a = layer[s.from], z = layer[s.to];
      if (a === undefined && z === undefined) { layer[s.from] = 0; layer[s.to] = s.from === s.to ? 0 : 1; }
      else if (a === undefined) layer[s.from] = Math.max(0, z - 1);
      else if (z === undefined) layer[s.to] = a + 1;
    });
    nodes.forEach(function (n) { see(n.id); if (layer[n.id] === undefined) layer[n.id] = 0; });

    // 2. position inside the layer
    var layers = {};
    order.forEach(function (id) { (layers[layer[id]] = layers[layer[id]] || []).push(id); });
    var layerNums = Object.keys(layers).map(Number);
    var maxLayer = Math.max.apply(null, layerNums);
    var sp = opts.spacing > 0 ? Math.min(3, Math.max(0.5, +opts.spacing)) : 1;
    var GAP_X = 72 * sp, GAP_Y = 44 * sp, TB_GAP_X = 36 * sp, TB_GAP_Y = 70 * sp;
    if (opts.optimize) optimizeOrder(layers, by, steps, dir, sp);
    var rowOf = {}, explicit = {}, rowCount = {}, maxRows = 0;
    layerNums.forEach(function (l) {
      var ids = layers[l], taken = {}, has = false, r = 0;
      ids.forEach(function (id) {
        if (by[id].row !== null) { rowOf[id] = by[id].row; taken[by[id].row] = true; has = true; }
      });
      ids.forEach(function (id) {
        if (rowOf[id] === undefined) { while (taken[r]) r++; rowOf[id] = r; taken[r] = true; }
      });
      explicit[l] = has;
      rowCount[l] = Math.max.apply(null, ids.map(function (id) { return rowOf[id]; })) + 1;
      if (rowCount[l] > maxRows) maxRows = rowCount[l];
    });

    // 3. coordinates
    var rects = {};
    nodes.forEach(function (n) { rects[n.id] = { x: 0, y: 0, w: nodeWidth(n), h: NODE_H }; });
    var hasLoop = steps.some(function (s) { return s.from === s.to; });
    var top = PAD + (hasLoop && dir === 'LR' ? 36 : 0);
    var l, cellW = 0;
    nodes.forEach(function (n) { if (rects[n.id].w > cellW) cellW = rects[n.id].w; });

    if (dir === 'LR') {
      var layerW = {}, layerX = {}, x = PAD;
      for (l = 0; l <= maxLayer; l++) {
        layerW[l] = layers[l] ? Math.max.apply(null, layers[l].map(function (id) { return rects[id].w; })) : 120;
        layerX[l] = x;
        x += layerW[l] + GAP_X;
      }
      nodes.forEach(function (n) {
        var r = rects[n.id], ly = layer[n.id];
        var offRows = explicit[ly] ? 0 : (maxRows - rowCount[ly]) / 2;
        r.x = layerX[ly] + (layerW[ly] - r.w) / 2;
        r.y = top + (rowOf[n.id] + offRows) * (NODE_H + GAP_Y);
      });
    } else {
      nodes.forEach(function (n) {
        var r = rects[n.id], ly = layer[n.id];
        var offRows = explicit[ly] ? 0 : (maxRows - rowCount[ly]) / 2;
        r.x = PAD + (rowOf[n.id] + offRows) * (cellW + TB_GAP_X) + (cellW - r.w) / 2;
        r.y = top + ly * (NODE_H + TB_GAP_Y);
      });
    }

    // 4. route edges; shift everything if a curve left the canvas
    var res = route(rects, model, dir, conn);
    var dx = Math.max(0, PAD - res.bounds.minX), dy = Math.max(0, PAD - res.bounds.minY);
    if (dx || dy) {
      Object.keys(rects).forEach(function (id) { rects[id].x += dx; rects[id].y += dy; });
      res = route(rects, model, dir, conn);
    }
    res.edges.forEach(function (e) {
      var t = trimPath(e.d, EDGE_GAP, ARROW + EDGE_GAP);
      e.d = t.d; e.length = t.length;
    });

    return {
      width: Math.ceil(res.bounds.maxX + PAD),
      height: Math.ceil(res.bounds.maxY + PAD),
      nodes: rects,
      edges: res.edges,
      warnings: res.warnings,
      optimized: !!opts.optimize
    };
  }

  /* ---------- trim edges ---------- */

  function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

  // De Casteljau split of a line/quadratic/cubic (2-4 points) at t -> [left points, right points].
  function split(pts, t) {
    var left = [pts[0]], right = [pts[pts.length - 1]], cur = pts;
    while (cur.length > 1) {
      var nxt = [];
      for (var i = 0; i < cur.length - 1; i++) nxt.push(lerp(cur[i], cur[i + 1], t));
      left.push(nxt[0]); right.unshift(nxt[nxt.length - 1]);
      cur = nxt;
    }
    return [left, right];
  }

  // Absolute "M ... L/Q/C ..." path -> segments [{pts: [start, controls..., end]}].
  function parsePath(d) {
    var tok = String(d).match(/[MLQC]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [], segs = [], pos = null, cmd = null, i = 0;
    var need = { M: 1, L: 1, Q: 2, C: 3 };
    while (i < tok.length) {
      if (/[MLQC]/.test(tok[i])) { cmd = tok[i++]; continue; }
      var pts = [];
      for (var k = 0; k < need[cmd]; k++, i += 2) pts.push({ x: +tok[i], y: +tok[i + 1] });
      if (cmd === 'M') { pos = pts[0]; cmd = 'L'; }
      else { segs.push({ pts: [pos].concat(pts) }); pos = pts[pts.length - 1]; }
    }
    return segs;
  }

  // Arc-length tables per segment (sampled for curves); returns the total length.
  function measure(segs) {
    var total = 0;
    segs.forEach(function (sg) {
      var n = sg.pts.length === 2 ? 1 : 24, prev = sg.pts[0], tab = [{ t: 0, s: total }];
      for (var i = 1; i <= n; i++) {
        var p = split(sg.pts, i / n)[0].pop();
        total += Math.hypot(p.x - prev.x, p.y - prev.y);
        tab.push({ t: i / n, s: total }); prev = p;
      }
      sg.tab = tab;
    });
    return total;
  }

  // Arc length s -> {i: segment index, t: parameter}.
  function locate(segs, s) {
    for (var i = 0; i < segs.length; i++) {
      var tab = segs[i].tab;
      if (s > tab[tab.length - 1].s && i < segs.length - 1) continue;
      for (var j = 1; j < tab.length; j++) {
        if (s > tab[j].s && j < tab.length - 1) continue;
        var a = tab[j - 1], b = tab[j], k = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
        return { i: i, t: Math.max(0, Math.min(1, a.t + (b.t - a.t) * k)) };
      }
    }
  }

  // Cut `head` px off the start and `tail` px off the end of a path, keeping its segment types -> {d, length}.
  function trimPath(d, head, tail) {
    var segs = parsePath(d), total = measure(segs);
    if (!segs.length || total - head - tail <= 4) return { d: d, length: f(total) };
    var a = locate(segs, head), z = locate(segs, total - tail), out = [];
    for (var i = a.i; i <= z.i; i++) {
      var pts = segs[i].pts, t0 = i === a.i ? a.t : 0, t1 = i === z.i ? z.t : 1;
      if (t1 < 1) pts = split(pts, t1)[0];
      if (t0 > 0) pts = split(pts, t1 > 0 ? Math.min(1, t0 / t1) : 0)[1];
      out.push(pts);
    }
    var s = 'M' + f(out[0][0].x) + ' ' + f(out[0][0].y);
    out.forEach(function (pts) {
      s += ' ' + ' LQC'[pts.length - 1];
      for (var k = 1; k < pts.length; k++) s += (k > 1 ? ' ' : '') + f(pts[k].x) + ' ' + f(pts[k].y);
    });
    return { d: s, length: f(total - head - tail) };
  }

  return {
    NODE_H: NODE_H, SHAPE_METRICS: SHAPE_METRICS,
    layout: layout, route: route, nodeWidth: nodeWidth, trimPath: trimPath
  };
});

