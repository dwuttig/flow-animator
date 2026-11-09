/*
 * render-diagram: draws a Flow's Geometry as SVG and shows Playback state (Playback context, browser only).
 *
 *   var d = RenderDiagram.create(document, { svg, stage, legend, steps, cap, core: FlowCore, onPick(stepIdx), wheelZooms() });
 *   d.render(model, geo, keepView)   draw; keepView keeps pan/zoom (same Flow re-rendered)
 *   d.begin(beatIdx) d.move(t) d.hidePackets()   packets of the current Beat; t is eased 0..1
 *   d.paint({ idx, arrived, trail })  edge/node/step-list state, follows the Beat when the stage scrolls
 *   d.select(sel)                     editor selection {nodes, edges, glow:{nodes, edges}}; pans to new glow
 *   d.look({ thick, step })           line thickness and step style
 *   d.zoom(factor) d.fit() d.panTo(gl) d.view()
 *   d.svgText(css)                    standalone SVG markup of the diagram
 * RenderDiagram.SHAPES: shape name -> draw(g, rect, el, metrics) -> label box {cx, cy, avail}; a new shape is one entry.
 * RenderDiagram.paletteCss() -> CSS for the .c-<color> classes (light + dark).
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.RenderDiagram = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  /* palette: [light fill, light stroke, light title, dark stroke, dark title]; dark fill = light title */
  var PAL = {
    gray:   ['#F1EFE8', '#5F5E5A', '#444441', '#B4B2A9', '#D3D1C7'],
    purple: ['#EEEDFE', '#534AB7', '#3C3489', '#AFA9EC', '#CECBF6'],
    teal:   ['#E1F5EE', '#0F6E56', '#085041', '#5DCAA5', '#9FE1CB'],
    coral:  ['#FAECE7', '#993C1D', '#712B13', '#F0997B', '#F5C4B3'],
    pink:   ['#FBEAF0', '#993556', '#72243E', '#ED93B1', '#F4C0D1'],
    blue:   ['#E6F1FB', '#185FA5', '#0C447C', '#85B7EB', '#B5D4F4'],
    green:  ['#EAF3DE', '#3B6D11', '#27500A', '#97C459', '#C0DD97'],
    amber:  ['#FAEEDA', '#854F0B', '#633806', '#EF9F27', '#FAC775'],
    red:    ['#FCEBEB', '#A32D2D', '#791F1F', '#F09595', '#F7C1C1']
  };
  function paletteCss() {
    var light = '', dark = '';
    Object.keys(PAL).forEach(function (k) {
      var p = PAL[k];
      light += '.c-' + k + '{--fill:' + p[0] + ';--stroke:' + p[1] + ';--title:' + p[2] + ';--sub:' + p[1] + '}';
      dark += '.c-' + k + '{--fill:' + p[2] + ';--stroke:' + p[3] + ';--title:' + p[4] + ';--sub:' + p[3] + '}';
    });
    return light + '@media (prefers-color-scheme:dark){' + dark + '}';
  }

  function fit(str, px, per) {
    var max = Math.max(3, Math.floor(px / per));
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  /* Label box for shapes that reserve extra width on the right (SHAPE_METRICS.extraW). */
  function labelBox(r, m) {
    var extra = (m && m.extraW) || 0;
    return { cx: r.x + (r.w - extra) / 2, cy: r.y + r.h / 2, avail: r.w - 20 - extra };
  }
  var SHAPES = {
    box: function (g, r, el, m) {
      el('rect', { 'class': 'body', x: r.x, y: r.y, width: r.w, height: r.h, rx: 8 }, g);
      return labelBox(r, m);
    },
    database: function (g, r, el, m) {
      var ry = 8, rx = r.w / 2;
      el('path', { 'class': 'body', d: 'M' + r.x + ' ' + (r.y + ry) + ' A' + rx + ' ' + ry + ' 0 0 1 ' + (r.x + r.w) + ' ' + (r.y + ry) +
        ' V' + (r.y + r.h - ry) + ' A' + rx + ' ' + ry + ' 0 0 1 ' + r.x + ' ' + (r.y + r.h - ry) + ' Z' }, g);
      el('path', { 'class': 'lip', d: 'M' + r.x + ' ' + (r.y + ry) + ' A' + rx + ' ' + ry + ' 0 0 0 ' + (r.x + r.w) + ' ' + (r.y + ry) }, g);
      var b = labelBox(r, m); b.cy += 5;
      return b;
    },
    queue: function (g, r, el, m) {
      el('rect', { 'class': 'body', x: r.x, y: r.y, width: r.w, height: r.h, rx: 8 }, g);
      [26, 18, 10].forEach(function (d) {
        el('line', { 'class': 'lip', x1: r.x + r.w - d, y1: r.y + 14, x2: r.x + r.w - d, y2: r.y + r.h - 14 }, g);
      });
      return labelBox(r, m || { extraW: 30 });
    }
  };

  function create(doc, o) {
    var svg = o.svg, C = o.core, KIND = (C && C.KIND_INFO) || {}, METRICS = (C && C.SHAPE_METRICS) || {};
    var model = null, geo = null, vp = null, gP = null;
    var nodeEls = {}, edgeEls = {}, lens = {}, packets = [], liEls = [], sel = null, glowKey = '';
    var view = { k: 1, x: 0, y: 0 };

    function el(tag, attrs, parent) {
      var e = doc.createElementNS(NS, tag);
      for (var k in attrs) e.setAttribute(k, attrs[k]);
      if (parent) parent.appendChild(e);
      return e;
    }
    function h(tag, cls, text, parent) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined && text !== null) e.textContent = text;
      if (parent) parent.appendChild(e);
      return e;
    }
    function label(id) { var n = model.nodeById[id]; return n ? n.label : id; }

    function drawNode(parent, n, r) {
      var g = el('g', { 'class': 'node c-' + n.color }, parent);
      var t = el('title', {}, g);
      t.textContent = n.label + (n.subtitle ? ' - ' + n.subtitle : '');
      var b = (SHAPES[n.shape] || SHAPES.box)(g, r, el, METRICS[n.shape]);
      var lbl = el('text', { 'class': 'lbl', x: b.cx, y: b.cy - (n.subtitle ? 8 : 0), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
      lbl.textContent = fit(n.label, b.avail, 8.4);
      if (n.subtitle) {
        var sub = el('text', { 'class': 'sub', x: b.cx, y: b.cy + 10, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
        sub.textContent = fit(n.subtitle, b.avail, 6.8);
      }
      return g;
    }

    function applyView() { if (vp) vp.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')'); }

    /* Zoom by factor around a point in viewBox coordinates (default: the centre). */
    function zoomAt(factor, px, py) {
      if (!geo) return;
      if (px === undefined) { px = geo.width / 2; py = geo.height / 2; }
      var k = Math.min(8, Math.max(0.2, view.k * factor));
      view.x = px - (px - view.x) * k / view.k; view.y = py - (py - view.y) * k / view.k; view.k = k;
      applyView();
    }

    function initPanZoom() {
      if (svg._pz) return;
      svg._pz = true;
      function pt(e) {
        var p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
        return p.matrixTransform(svg.getScreenCTM().inverse());
      }
      // Plain wheel scrolls the page; Ctrl/Cmd+wheel (and trackpad pinch, which sends ctrlKey) zooms, or any wheel when wheelZooms().
      svg.addEventListener('wheel', function (e) {
        if (!(e.ctrlKey || e.metaKey || (o.wheelZooms && o.wheelZooms()))) return;
        e.preventDefault();
        var p = pt(e);
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey && Math.abs(e.deltaY) < 50 ? 0.01 : 0.0015)), p.x, p.y);
      }, { passive: false });
      var drag = null, moved = false;
      svg.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, id: e.pointerId }; moved = false;
      });
      svg.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        if (!moved) { moved = true; svg.setPointerCapture(drag.id); svg.style.cursor = 'grabbing'; }
        var m = svg.getScreenCTM();
        view.x = drag.vx + dx / m.a; view.y = drag.vy + dy / m.d;
        applyView();
      });
      function end() { drag = null; svg.style.cursor = ''; }
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', end);
      svg.addEventListener('click', function (e) { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
      svg.addEventListener('dblclick', function () { d.fit(); });
    }

    function legend() {
      var lg = o.legend; if (!lg) return;
      lg.textContent = '';
      if (model.groups.length > 1) {
        model.groups.forEach(function (g) {
          var c = h('span', 'chip c-' + g.color, null, lg);
          h('i', '', null, c);
          c.appendChild(doc.createTextNode(g.label));
        });
      }
      var kinds = [];
      model.steps.forEach(function (s) { if (kinds.indexOf(s.kind) < 0) kinds.push(s.kind); });
      if (kinds.length > 1) {
        kinds.forEach(function (k) {
          var c = h('span', 'chip', null, lg);
          var s = el('svg', { width: 30, height: 8, viewBox: '0 0 30 8', 'aria-hidden': 'true' }, c);
          el('line', { 'class': 'edge k-' + k, x1: 1, y1: 4, x2: 29, y2: 4 }, s);
          c.appendChild(doc.createTextNode(KIND[k] ? KIND[k].label : k));
        });
      }
    }

    function stepList() {
      var ol = o.steps; if (!ol) { liEls = []; return; }
      ol.textContent = '';
      liEls = model.steps.map(function (s, i) {
        var li = h('li', s.together ? 'par' : '', null, ol);
        li.tabIndex = 0;
        li.appendChild(doc.createTextNode(s.label + '  (' + label(s.from) + ' → ' + label(s.to) + ')'));
        li.addEventListener('click', function () { if (o.onPick) o.onPick(i); });
        li.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); if (o.onPick) o.onPick(i); }
        });
        return li;
      });
    }

    function caption(idx) {
      var box = o.cap; if (!box) return;
      box.textContent = '';
      model.beats[idx].forEach(function (si) {
        var s = model.steps[si];
        var line = h('div', 'line', null, box);
        var head = h('div', null, null, line);
        h('span', 't', (si + 1) + '. ' + s.label, head);
        h('span', 'route', label(s.from) + ' → ' + label(s.to), head);
        if (s.detail) h('div', 'd', s.detail, line);
        if (s.payload) h('code', null, s.payload, line);
      });
    }

    function clearPackets() { packets.forEach(function (p) { p.el.remove(); }); packets = []; }

    /* Scroll the stage so the Beat's nodes are in view; geometry rects + two layout reads instead of one per node. */
    function followBeat(beat) {
      var st = o.stage;
      if (!st || st.scrollWidth <= st.clientWidth + 1) return;
      var lo = Infinity, hi = -Infinity;
      beat.forEach(function (si) {
        var s = model.steps[si];
        [geo.nodes[s.from], geo.nodes[s.to]].forEach(function (r) {
          if (!r) return;
          lo = Math.min(lo, r.x); hi = Math.max(hi, r.x + r.w);
        });
      });
      if (lo === Infinity) return;
      var sr = svg.getBoundingClientRect(), tr = st.getBoundingClientRect();
      var s = Math.min(sr.width / geo.width, sr.height / geo.height) || 1, ox = sr.left + (sr.width - geo.width * s) / 2;
      var mid = ox + (view.x + view.k * (lo + hi) / 2) * s - tr.left + st.scrollLeft;
      st.scrollTo({ left: Math.max(0, mid - st.clientWidth / 2), behavior: 'smooth' });
    }

    function applySel() {
      var s = sel || { nodes: [], edges: [] };
      var gl = s.glow || { nodes: [], edges: [] };
      Object.keys(nodeEls).forEach(function (id) {
        nodeEls[id].classList.toggle('sel', s.nodes.indexOf(id) >= 0);
        nodeEls[id].classList.toggle('glow', gl.nodes.indexOf(id) >= 0);
      });
      Object.keys(edgeEls).forEach(function (id) {
        edgeEls[id].classList.toggle('sel', s.edges.indexOf(id) >= 0);
        edgeEls[id].classList.toggle('glow', gl.edges.indexOf(id) >= 0);
      });
      var key = gl.nodes.join(',') + '|' + gl.edges.join(',');
      if (key !== glowKey) { glowKey = key; if (key !== '|') d.panTo(gl); }
    }

    var d = {
      render: function (m, g, keepView) {
        model = m; geo = g;
        svg.textContent = '';
        svg.setAttribute('viewBox', '0 0 ' + geo.width + ' ' + geo.height);
        svg.style.width = '100%';
        svg.style.minWidth = Math.round(geo.width * 0.9) + 'px';
        svg.setAttribute('aria-label', model.title + ': animated flow diagram');

        var defs = el('defs', {}, svg);
        var mk = el('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 1, refY: 5, markerUnits: 'userSpaceOnUse', markerWidth: 10, markerHeight: 10, orient: 'auto-start-reverse', overflow: 'visible' }, defs);
        el('path', { d: 'M1 1L9 5L1 9z', fill: 'context-stroke', stroke: 'context-stroke', 'stroke-width': 1, 'stroke-linejoin': 'round', 'stroke-dasharray': 'none' }, mk);

        vp = el('g', { id: 'vp' }, svg);
        var gE = el('g', {}, vp), gN = el('g', {}, vp);
        gP = el('g', {}, vp);
        if (!keepView) view = { k: 1, x: 0, y: 0 };
        applyView();
        initPanZoom();
        edgeEls = {}; nodeEls = {}; lens = {}; packets = []; glowKey = '';
        // Geometry edges are already trimmed for the arrow head and carry their length.
        geo.edges.forEach(function (e) {
          var p = el('path', { 'class': 'edge k-' + e.kind, d: e.d, 'marker-end': 'url(#arr)' }, gE);
          edgeEls[e.id] = p;
          lens[e.id] = typeof e.length === 'number' ? e.length : p.getTotalLength();
        });
        model.nodes.forEach(function (n) { nodeEls[n.id] = drawNode(gN, n, geo.nodes[n.id]); });
        legend();
        stepList();
        if (sel) applySel();
      },
      begin: function (idx) {
        clearPackets();
        model.beats[idx].forEach(function (si) {
          var s = model.steps[si];
          var c = el('circle', { 'class': 'pkt' + (s.kind === 'response' ? ' resp' : ''), r: 6, cx: -50, cy: -50 }, gP);
          packets.push({ el: c, edge: s.from + '>' + s.to });
        });
        caption(idx);
      },
      move: function (t) {
        packets.forEach(function (p) {
          var path = edgeEls[p.edge];
          if (!path) return;
          var pt = path.getPointAtLength(lens[p.edge] * t);
          p.el.setAttribute('cx', pt.x); p.el.setAttribute('cy', pt.y);
          p.el.style.display = '';
        });
      },
      hidePackets: function () { packets.forEach(function (p) { p.el.style.display = 'none'; }); },
      paint: function (st) {
        if (!model) return;
        var beat = model.beats[st.idx], act = {}, hl = {}, done = {};
        beat.forEach(function (si) {
          var s = model.steps[si];
          act[s.from + '>' + s.to] = true; hl[s.from] = true;
          if (st.arrived) hl[s.to] = true;
        });
        if (st.trail) {
          for (var b = 0; b < st.idx; b++) model.beats[b].forEach(function (si) { done[model.steps[si].from + '>' + model.steps[si].to] = true; });
        }
        Object.keys(edgeEls).forEach(function (id) {
          edgeEls[id].classList.toggle('active', !!act[id]);
          edgeEls[id].classList.toggle('done', !act[id] && !!done[id]);
        });
        Object.keys(nodeEls).forEach(function (id) { nodeEls[id].classList.toggle('hl', !!hl[id]); });
        liEls.forEach(function (li, si) {
          var bi = model.stepBeat[si];
          li.classList.toggle('active', bi === st.idx);
          li.classList.toggle('past', bi < st.idx);
        });
        followBeat(beat);
      },
      select: function (s) { sel = s; if (model) applySel(); },
      look: function (v) {
        svg.style.setProperty('--ew', String(v.thick));
        svg.classList.remove('ss-solid', 'ss-dashed', 'ss-dotted');
        if (v.step && v.step !== 'kind') svg.classList.add('ss-' + v.step);
      },
      zoom: function (factor) { zoomAt(factor); },
      fit: function () { view = { k: 1, x: 0, y: 0 }; applyView(); },
      view: function () { return { k: view.k, x: view.x, y: view.y }; },
      /* Pan (keeping zoom) so the hovered nodes/edges are fully visible, centered if they were not. */
      panTo: function (gl) {
        if (!vp || !geo) return;
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        function add(r) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.width); y1 = Math.max(y1, r.y + r.height); }
        gl.nodes.forEach(function (id) { var r = geo.nodes[id]; if (r) add({ x: r.x, y: r.y, width: r.w, height: r.h }); });
        gl.edges.forEach(function (id) { if (edgeEls[id]) add(edgeEls[id].getBBox()); });
        if (x0 === Infinity) return;
        x0 = view.x + view.k * x0; x1 = view.x + view.k * x1; y0 = view.y + view.k * y0; y1 = view.y + view.k * y1;
        var pad = 16;
        if (x0 >= pad && y0 >= pad && x1 <= geo.width - pad && y1 <= geo.height - pad) return;
        view.x += geo.width / 2 - (x0 + x1) / 2;
        view.y += geo.height / 2 - (y0 + y1) / 2;
        applyView();
      },
      /* Standalone SVG of the whole diagram (no packets, selection or pan/zoom); css is inlined as a <style>. */
      svgText: function (css) {
        if (!model) return '';
        var c = svg.cloneNode(true);
        c.setAttribute('xmlns', NS);
        c.setAttribute('width', geo.width); c.setAttribute('height', geo.height);
        c.removeAttribute('style'); c.removeAttribute('id'); c.setAttribute('role', 'img');
        if (svg.style.getPropertyValue('--ew')) c.setAttribute('style', '--ew:' + svg.style.getPropertyValue('--ew'));
        Array.prototype.forEach.call(c.querySelectorAll('.pkt'), function (e) { e.remove(); });
        Array.prototype.forEach.call(c.querySelectorAll('.sel,.glow,.hl,.active,.done'), function (e) { e.classList.remove('sel', 'glow', 'hl', 'active', 'done'); });
        var g = c.querySelector('#vp'); if (g) g.removeAttribute('transform');
        var style = doc.createElementNS(NS, 'style'); style.textContent = css || '';
        c.insertBefore(style, c.firstChild);
        var bg = el('rect', { x: 0, y: 0, width: geo.width, height: geo.height, style: 'fill:var(--bg)' });
        c.insertBefore(bg, style.nextSibling);
        return '<?xml version="1.0" encoding="UTF-8"?>\n' + new (doc.defaultView.XMLSerializer)().serializeToString(c);
      }
    };
    return d;
  }

  /* Light-theme CSS for a standalone SVG: page rules that style the diagram, without @media (dark) blocks. */
  function diagramCss(doc) {
    var out = [], RE = /(^|[\s,>+~(])(\.(edge|body|lip|node|lbl|sub|pkt|k-|c-)|#svg|svg)|:root/;
    Array.prototype.forEach.call(doc.styleSheets, function (sh) {
      var rules; try { rules = sh.cssRules; } catch (e) { return; }
      Array.prototype.forEach.call(rules, function (r) {
        if (r.type === 1 && RE.test(r.selectorText)) out.push(r.cssText.replace(/#svg/g, 'svg').replace(/:root/g, 'svg').replace(/color-scheme:[^;}]*/g, 'color-scheme: light'));
        else if (r.type === 7) out.push(r.cssText); // @keyframes
      });
    });
    return out.join('\n');
  }

  return { create: create, SHAPES: SHAPES, PAL: PAL, paletteCss: paletteCss, diagramCss: diagramCss, fit: fit };
});
