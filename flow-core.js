/*
 * flow-core.js: parsing, validation, normalisation and auto-layout for
 * flow-animator files (format "flow-animator/1").
 *
 * Pure functions, no DOM. Works in the browser (window.FlowCore) and in
 * Node (require('./flow-core.js')).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlowCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMAT = 'flow-animator/1';
  var COLORS = ['gray', 'purple', 'teal', 'coral', 'pink', 'blue', 'green', 'amber', 'red'];
  var AUTO_COLORS = ['purple', 'teal', 'coral', 'pink', 'blue', 'green', 'amber'];
  var SHAPES = ['box', 'database', 'queue'];
  var KINDS = ['sync', 'async', 'response', 'event'];
  var DIRS = ['LR', 'TB'];
  var ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
  var KEYS = {
    root: ['$schema', 'format', 'title', 'description', 'layout', 'groups', 'nodes', 'steps'],
    layout: ['direction'],
    group: ['id', 'label', 'color'],
    node: ['id', 'label', 'subtitle', 'group', 'shape', 'col', 'row'],
    step: ['from', 'to', 'label', 'detail', 'payload', 'kind', 'together']
  };

  var NODE_H = 60, GAP_X = 72, GAP_Y = 44, TB_GAP_X = 36, TB_GAP_Y = 70, PAD = 40;

  /* ---------- helpers ---------- */

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isStr(v) { return typeof v === 'string' && v.trim().length > 0; }
  function isIdx(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0; }

  function lev(a, b) {
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function nearest(word, list) {
    var best = null, bd = 4;
    list.forEach(function (c) {
      var d = lev(String(word).toLowerCase(), c.toLowerCase());
      if (d < bd) { bd = d; best = c; }
    });
    return best;
  }

  /* ---------- parse ---------- */

  function parse(text) {
    if (typeof text !== 'string') return { doc: null, errors: [{ path: '$', message: 'input is not text' }] };
    var t = text.replace(/^﻿/, '');
    if (/^\s*```/.test(t)) {
      return { doc: null, errors: [{ path: '$', message: 'the file starts with a markdown code fence; it must contain raw JSON only' }] };
    }
    try {
      return { doc: JSON.parse(t), errors: [] };
    } catch (e) {
      var msg = String(e && e.message ? e.message : e);
      var m = /position (\d+)/.exec(msg);
      if (m && !/line \d+/.test(msg)) {
        var pos = +m[1], before = t.slice(0, pos);
        msg += ' (line ' + before.split('\n').length + ', column ' + (pos - before.lastIndexOf('\n')) + ')';
      }
      return { doc: null, errors: [{ path: '$', message: 'invalid JSON: ' + msg }] };
    }
  }

  /* ---------- validate ---------- */

  function validate(doc) {
    var E = [], W = [];
    function err(p, m) { E.push({ path: p, message: m }); }
    function warn(p, m) { W.push({ path: p, message: m }); }
    function checkKeys(o, kind, path) {
      Object.keys(o).forEach(function (k) {
        if (KEYS[kind].indexOf(k) < 0) {
          var n = nearest(k, KEYS[kind]);
          warn(path + '.' + k, 'unknown property "' + k + '" is ignored' + (n ? ' (did you mean "' + n + '"?)' : '') +
            '; allowed here: ' + KEYS[kind].join(', '));
        }
      });
    }

    if (!isObj(doc)) {
      err('$', 'top level must be a JSON object with "nodes" and "steps"');
      return { errors: E, warnings: W };
    }
    checkKeys(doc, 'root', '$');

    if (doc.format === undefined) warn('$.format', 'missing "format"; add "format": "' + FORMAT + '"');
    else if (doc.format !== FORMAT) err('$.format', 'unsupported format ' + JSON.stringify(doc.format) + '; expected "' + FORMAT + '"');

    if (doc.title === undefined) warn('$.title', 'missing "title"; a short title helps readers');
    else if (!isStr(doc.title)) err('$.title', 'must be a non-empty string');
    if (doc.description !== undefined && typeof doc.description !== 'string') err('$.description', 'must be a string');

    if (doc.layout !== undefined) {
      if (!isObj(doc.layout)) err('$.layout', 'must be an object like {"direction": "LR"}');
      else {
        checkKeys(doc.layout, 'layout', '$.layout');
        if (doc.layout.direction !== undefined && DIRS.indexOf(doc.layout.direction) < 0) {
          err('$.layout.direction', 'must be "LR" (left to right) or "TB" (top to bottom)');
        }
      }
    }

    // groups
    var declared = {};
    if (doc.groups !== undefined) {
      if (!Array.isArray(doc.groups)) err('$.groups', 'must be an array of {id, label, color}');
      else doc.groups.forEach(function (g, i) {
        var p = '$.groups[' + i + ']';
        if (!isObj(g)) { err(p, 'must be an object'); return; }
        checkKeys(g, 'group', p);
        if (!isStr(g.id)) err(p + '.id', 'required non-empty string');
        else if (declared[g.id] !== undefined) err(p + '.id', 'duplicate group id "' + g.id + '"');
        else declared[g.id] = i;
        if (g.label !== undefined && typeof g.label !== 'string') err(p + '.label', 'must be a string');
        if (g.color !== undefined && COLORS.indexOf(g.color) < 0) err(p + '.color', 'unknown color ' + JSON.stringify(g.color) + '; use one of: ' + COLORS.join(', '));
      });
    }

    // nodes
    var ids = {};
    var cells = {};
    if (!Array.isArray(doc.nodes) || !doc.nodes.length) {
      err('$.nodes', 'required: a non-empty array of {"id": "...", "label": "..."}');
    } else {
      doc.nodes.forEach(function (n, i) {
        var p = '$.nodes[' + i + ']';
        if (!isObj(n)) { err(p, 'must be an object like {"id": "api", "label": "API"}'); return; }
        checkKeys(n, 'node', p);
        if (!isStr(n.id)) err(p + '.id', 'required non-empty string');
        else if (!ID_RE.test(n.id)) err(p + '.id', JSON.stringify(n.id) + ' has invalid characters; use letters, digits, "-", "_" or "." and start with a letter or digit');
        else if (ids[n.id] !== undefined) err(p + '.id', 'duplicate id "' + n.id + '" (already used by nodes[' + ids[n.id] + '])');
        else ids[n.id] = i;
        if (!isStr(n.label)) err(p + '.label', 'required non-empty string');
        else if (n.label.length > 28) warn(p + '.label', 'label is long (' + n.label.length + ' chars); it will be truncated in the diagram. Move detail into "subtitle" or the step "detail".');
        if (n.subtitle !== undefined) {
          if (typeof n.subtitle !== 'string') err(p + '.subtitle', 'must be a string');
          else if (n.subtitle.length > 36) warn(p + '.subtitle', 'subtitle is long (' + n.subtitle.length + ' chars); keep it to about 5 words');
        }
        if (n.group !== undefined) {
          if (!isStr(n.group)) err(p + '.group', 'must be a non-empty string');
          else if (doc.groups !== undefined && Array.isArray(doc.groups) && declared[n.group] === undefined) {
            warn(p + '.group', 'group "' + n.group + '" is not declared in "groups"; a colour is assigned automatically');
          }
        }
        if (n.shape !== undefined && SHAPES.indexOf(n.shape) < 0) err(p + '.shape', 'must be one of: ' + SHAPES.join(', '));
        if (n.col !== undefined && !isIdx(n.col)) err(p + '.col', 'must be a whole number >= 0');
        if (n.row !== undefined && !isIdx(n.row)) err(p + '.row', 'must be a whole number >= 0');
        if (isIdx(n.col) && isIdx(n.row)) {
          var key = n.col + ',' + n.row;
          if (cells[key] !== undefined) err(p, 'col ' + n.col + ' / row ' + n.row + ' is already used by nodes[' + cells[key] + ']');
          else cells[key] = i;
        }
      });
      if (doc.nodes.length > 14) warn('$.nodes', doc.nodes.length + ' nodes: the diagram gets crowded above ~14. Merge minor components or split into several files.');
    }

    // steps
    var used = {};
    var known = Object.keys(ids);
    function knownList() {
      var l = known.slice(0, 12).join(', ');
      return known.length > 12 ? l + ', ...' : l;
    }
    if (!Array.isArray(doc.steps) || !doc.steps.length) {
      err('$.steps', 'required: a non-empty array of {"from": "<node id>", "to": "<node id>", "label": "..."}');
    } else {
      doc.steps.forEach(function (s, i) {
        var p = '$.steps[' + i + ']';
        if (!isObj(s)) { err(p, 'must be an object like {"from": "a", "to": "b", "label": "..."}'); return; }
        checkKeys(s, 'step', p);
        ['from', 'to'].forEach(function (k) {
          if (!isStr(s[k])) err(p + '.' + k, 'required node id (string)');
          else if (ids[s[k]] === undefined) {
            var n = nearest(s[k], known);
            err(p + '.' + k, 'unknown node id ' + JSON.stringify(s[k]) + (n ? ' (did you mean "' + n + '"?)' : '') + '; known ids: ' + knownList());
          } else used[s[k]] = true;
        });
        if (!isStr(s.label)) err(p + '.label', 'required non-empty string describing what happens');
        else if (s.label.length > 80) warn(p + '.label', 'label is long; put extra text in "detail"');
        if (s.detail !== undefined && typeof s.detail !== 'string') err(p + '.detail', 'must be a string');
        if (s.payload !== undefined && typeof s.payload !== 'string') err(p + '.payload', 'must be a string');
        if (s.kind !== undefined && KINDS.indexOf(s.kind) < 0) err(p + '.kind', 'must be one of: ' + KINDS.join(', '));
        if (s.together !== undefined) {
          if (typeof s.together !== 'boolean') err(p + '.together', 'must be true or false');
          else if (s.together && i === 0) warn(p + '.together', 'the first step has nothing to run together with; ignored');
        }
      });
      if (doc.steps.length > 40) warn('$.steps', doc.steps.length + ' steps is a long animation. Consider splitting into several files (one scenario each).');
    }

    if (Array.isArray(doc.nodes) && Array.isArray(doc.steps) && !E.length) {
      doc.nodes.forEach(function (n, i) {
        if (!used[n.id]) warn('$.nodes[' + i + ']', 'node "' + n.id + '" is not used by any step; it is drawn but never lit up');
      });
    }

    return { errors: E, warnings: W };
  }

  /* ---------- normalize ---------- */

  function normalize(doc) {
    var groups = [], gmap = {};
    (doc.groups || []).forEach(function (g) {
      gmap[g.id] = { id: g.id, label: g.label || g.id, color: g.color || null };
      groups.push(gmap[g.id]);
    });
    doc.nodes.forEach(function (n) {
      if (n.group && !gmap[n.group]) {
        gmap[n.group] = { id: n.group, label: n.group, color: null };
        groups.push(gmap[n.group]);
      }
    });
    var next = 0;
    groups.forEach(function (g) { if (!g.color) g.color = AUTO_COLORS[next++ % AUTO_COLORS.length]; });

    var nodes = doc.nodes.map(function (n) {
      return {
        id: n.id, label: n.label, subtitle: n.subtitle || '', group: n.group || null,
        color: n.group ? gmap[n.group].color : 'gray',
        shape: n.shape || 'box',
        col: n.col === undefined ? null : n.col,
        row: n.row === undefined ? null : n.row
      };
    });
    var usedGroups = {};
    nodes.forEach(function (n) { if (n.group) usedGroups[n.group] = true; });

    var steps = doc.steps.map(function (s) {
      return {
        from: s.from, to: s.to, label: s.label,
        detail: s.detail || '', payload: s.payload || '',
        kind: s.kind || 'sync', together: s.together === true
      };
    });

    return {
      title: doc.title || 'Untitled flow',
      description: doc.description || '',
      direction: (doc.layout && doc.layout.direction) || 'LR',
      groups: groups.filter(function (g) { return usedGroups[g.id]; }),
      nodes: nodes,
      steps: steps,
      beats: buildBeats(steps)
    };
  }

  // A beat is a list of step indexes that animate at the same time.
  function buildBeats(steps) {
    var beats = [];
    steps.forEach(function (s, i) {
      if (s.together && beats.length) beats[beats.length - 1].push(i);
      else beats.push([i]);
    });
    return beats;
  }

  /* ---------- layout ---------- */

  function nodeWidth(n) {
    var a = n.label.length * 8.4, b = (n.subtitle || '').length * 6.8;
    var extra = n.shape === 'queue' ? 30 : 0; // room for the slot dividers
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

  function route(rects, model) {
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
        if (model.direction === 'TB') {
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
      var o0 = { x: c0.x + nrm.x * off, y: c0.y + nrm.y * off };
      var o1 = { x: c1.x + nrm.x * off, y: c1.y + nrm.y * off };
      var mid = { x: (o0.x + o1.x) / 2, y: (o0.y + o1.y) / 2 };
      var others = Object.keys(rects).filter(function (id) { return id !== e.from && id !== e.to; });
      var bows = [0, 50, -50, 100, -100, 160, -160];
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
        if (!blocker) chosen = { p0: p0, p1: p1, ctrl: ctrl, pts: pts };
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

  function layout(model) {
    var dir = model.direction, nodes = model.nodes, steps = model.steps;
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
    var res = route(rects, model);
    var dx = Math.max(0, PAD - res.bounds.minX), dy = Math.max(0, PAD - res.bounds.minY);
    if (dx || dy) {
      Object.keys(rects).forEach(function (id) { rects[id].x += dx; rects[id].y += dy; });
      res = route(rects, model);
    }

    return {
      width: Math.ceil(res.bounds.maxX + PAD),
      height: Math.ceil(res.bounds.maxY + PAD),
      nodes: rects,
      edges: res.edges,
      warnings: res.warnings
    };
  }

  /* ---------- convenience ---------- */

  // text -> {ok, errors, warnings, model, geometry}
  function load(text) {
    var p = parse(text);
    if (p.errors.length) return { ok: false, errors: p.errors, warnings: [], model: null, geometry: null };
    return loadDoc(p.doc);
  }

  function loadDoc(doc) {
    var v = validate(doc);
    if (v.errors.length) return { ok: false, errors: v.errors, warnings: v.warnings, model: null, geometry: null };
    var model = normalize(doc);
    var geometry = layout(model);
    var warnings = v.warnings.concat(geometry.warnings.map(function (m) { return { path: 'layout', message: m }; }));
    return { ok: true, errors: [], warnings: warnings, model: model, geometry: geometry };
  }

  return {
    FORMAT: FORMAT, COLORS: COLORS, SHAPES: SHAPES, KINDS: KINDS,
    parse: parse, validate: validate, normalize: normalize, layout: layout,
    buildBeats: buildBeats, load: load, loadDoc: loadDoc, nodeWidth: nodeWidth, NODE_H: NODE_H
  };
});
