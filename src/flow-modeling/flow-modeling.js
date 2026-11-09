/*
 * flow-modeling.js: Flow Modeling context. Parsing, validation, normalisation
 * and beats for flow-animator files (format "flow-animator/1").
 *
 * Pure functions, no DOM, no dependencies. Works in the browser
 * (window.FlowModeling) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlowModeling = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMAT = 'flow-animator/1';
  var COLORS = ['gray', 'purple', 'teal', 'coral', 'pink', 'blue', 'green', 'amber', 'red'];
  var AUTO_COLORS = ['purple', 'teal', 'coral', 'pink', 'blue', 'green', 'amber'];
  var SHAPES = ['box', 'database', 'queue'];
  var KIND_INFO = {
    sync: { label: 'Call', line: 'solid' },
    async: { label: 'Async', line: 'dotted' },
    response: { label: 'Response', line: 'dashed' },
    event: { label: 'Event', line: 'dotted' }
  };
  var KINDS = Object.keys(KIND_INFO);
  var MIGRATIONS = {};
  var DIRS = ['LR', 'TB'];
  var CONNECTIONS = ['auto', 'bezier', 'linear', 'orthogonal'];
  var ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
  var KEYS = {
    root: ['$schema', 'format', 'title', 'description', 'layout', 'groups', 'nodes', 'steps'],
    layout: ['direction', 'connection'],
    group: ['id', 'label', 'color'],
    node: ['id', 'label', 'subtitle', 'group', 'shape', 'col', 'row'],
    step: ['from', 'to', 'label', 'detail', 'payload', 'kind', 'together']
  };

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
        if (doc.layout.connection !== undefined && CONNECTIONS.indexOf(doc.layout.connection) < 0) {
          err('$.layout.connection', 'must be one of: ' + CONNECTIONS.join(', '));
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
    var usedGroups = {}, nodeById = {};
    nodes.forEach(function (n) { nodeById[n.id] = n; if (n.group) usedGroups[n.group] = true; });

    var steps = doc.steps.map(function (s) {
      return {
        from: s.from, to: s.to, label: s.label,
        detail: s.detail || '', payload: s.payload || '',
        kind: s.kind || 'sync', together: s.together === true
      };
    });
    var beats = buildBeats(steps), stepBeat = [];
    beats.forEach(function (b, bi) { b.forEach(function (si) { stepBeat[si] = bi; }); });

    return {
      title: doc.title || 'Untitled flow',
      description: doc.description || '',
      direction: (doc.layout && doc.layout.direction) || 'LR',
      connection: (doc.layout && doc.layout.connection) || 'auto',
      groups: groups.filter(function (g) { return usedGroups[g.id]; }),
      nodes: nodes,
      steps: steps,
      beats: beats,
      stepBeat: stepBeat,
      nodeById: nodeById
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

  /* ---------- migrate ---------- */

  // Upgrade an older-format doc through MIGRATIONS until FORMAT -> {doc, from, migrated}. Unknown formats are left for validate.
  function migrate(doc) {
    var from = isObj(doc) ? doc.format : undefined, cur = doc, n = 0;
    while (isObj(cur) && typeof cur.format === 'string' && cur.format !== FORMAT &&
      Object.prototype.hasOwnProperty.call(MIGRATIONS, cur.format) && n < 50) {
      cur = MIGRATIONS[cur.format](cur); n++;
    }
    return { doc: cur, from: from, migrated: n > 0 };
  }

  return {
    FORMAT: FORMAT, CONNECTIONS: CONNECTIONS, COLORS: COLORS, AUTO_COLORS: AUTO_COLORS, SHAPES: SHAPES, KINDS: KINDS,
    KIND_INFO: KIND_INFO, DIRS: DIRS, KEYS: KEYS, MIGRATIONS: MIGRATIONS,
    parse: parse, validate: validate, normalize: normalize, buildBeats: buildBeats, migrate: migrate
  };
});
