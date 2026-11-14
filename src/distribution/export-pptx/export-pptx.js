/*
 * export-pptx: turn a Flow into a one-slide PowerPoint file (Distribution context).
 * Zero dependencies, pure, works in the browser and in Node. The animation is native PowerPoint
 * animation: one click plays one Beat (Packets move along the Edges, Trails and Step labels stay).
 *
 *   ExportPptx.build({ model, geo, beats, theme, title }) -> Uint8Array   theme 'light' | 'dark'
 *   ExportPptx.fromFlow(doc, { theme, layout })          -> Uint8Array   migrate, validate, normalize, layout + build
 *   ExportPptx.zip([{ name, data: string | Uint8Array }]) -> Uint8Array  STORE (no compression)
 *   ExportPptx.crc32(Uint8Array) -> number
 *   ExportPptx.MIME
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../../playback/render-diagram/render-diagram.js'),
      require('../../flow-modeling/flow-modeling.js'),
      require('../../layout/layout.js')
    );
  } else root.ExportPptx = factory(root.RenderDiagram, root.FlowModeling, root.FlowLayout);
})(typeof self !== 'undefined' ? self : this, function (R, M, L) {
  'use strict';

  var MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  /* ---------- zip (STORE) ---------- */

  var CRC_TABLE = (function () {
    var t = [], c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function toBytes(d) { return typeof d === 'string' ? new TextEncoder().encode(d) : d; }

  function zip(entries) {
    var DOS_DATE = 0x0021, parts = [], central = [], offset = 0;
    function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
    function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }
    function push(list, arr) { list.push(Uint8Array.from(arr)); }
    entries.forEach(function (e) {
      var name = new TextEncoder().encode(e.name), data = toBytes(e.data), crc = crc32(data);
      var common = [].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(DOS_DATE), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      push(parts, [0x50, 0x4B, 0x03, 0x04].concat(common));
      parts.push(name, data);
      push(central, [0x50, 0x4B, 0x01, 0x02].concat(u16(20), common.slice(0, 26), u16(0), u16(0), u16(0), u32(0), u32(offset)));
      central.push(name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (n, b) { return n + b.length; }, 0);
    push(central, [0x50, 0x4B, 0x05, 0x06].concat(u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cdSize), u32(offset), u16(0)));
    var all = parts.concat(central), total = all.reduce(function (n, b) { return n + b.length; }, 0);
    var out = new Uint8Array(total), at = 0;
    all.forEach(function (b) { out.set(b, at); at += b.length; });
    return out;
  }

  /* ---------- xml helpers ---------- */

  var NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  var XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

  function esc(s) {
    return String(s)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function num(v) { return String(Math.round(v * 100000) / 100000); }

  /* ---------- colours (same light / dark mapping as RenderDiagram.paletteCss) ---------- */

  var HOT = 'EF9F27', HOT_D = '854F0B';
  var THEMES = {
    light: { dark: false, bg: 'FFFFFF', text: '1F1E1D', text2: '5F5E5A', edge: '8A8982' },
    dark: { dark: true, bg: '1F1E1D', text: 'EEECE6', text2: 'B4B2A9', edge: '888780' }
  };

  function hex(c) { return String(c).replace('#', '').toUpperCase(); }

  function paletteOf(color, dark) {
    var p = R.PAL[color] || R.PAL.gray;
    return dark
      ? { fill: hex(p[2]), stroke: hex(p[3]), title: hex(p[4]), sub: hex(p[3]) }
      : { fill: hex(p[0]), stroke: hex(p[1]), title: hex(p[2]), sub: hex(p[1]) };
  }

  /* ---------- drawing xml ---------- */

  function solid(c, alpha) {
    return '<a:solidFill><a:srgbClr val="' + c + '"' + (alpha ? '><a:alpha val="' + alpha + '"/></a:srgbClr>' : '/>') + '</a:solidFill>';
  }
  function xfrm(x, y, w, h) { return '<a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + w + '" cy="' + h + '"/></a:xfrm>'; }
  function prst(name, adj) {
    return '<a:prstGeom prst="' + name + '"><a:avLst>' + (adj === undefined ? '' : '<a:gd name="adj" fmla="val ' + adj + '"/>') + '</a:avLst></a:prstGeom>';
  }
  function line(w, c, o) {
    o = o || {};
    return '<a:ln w="' + w + '"' + (o.round ? ' cap="rnd"' : '') + '>' + solid(c) + (o.dash ? '<a:prstDash val="' + o.dash + '"/>' : '') + '<a:round/>' +
      (o.arrow ? '<a:tailEnd type="triangle" w="med" len="med"/>' : '') + '</a:ln>';
  }
  function run(text, o) {
    return '<a:r><a:rPr lang="en-US" sz="' + o.sz + '"' + (o.bold ? ' b="1"' : '') + ' dirty="0">' + solid(o.color) + '</a:rPr><a:t>' + esc(text) + '</a:t></a:r>';
  }
  function para(text, o) { return '<a:p><a:pPr algn="' + (o.algn || 'ctr') + '"/>' + run(text, o) + '</a:p>'; }
  function textBody(paras, o) {
    o = o || {};
    return '<p:txBody><a:bodyPr wrap="' + (o.wrap || 'square') + '" lIns="' + (o.l || 0) + '" tIns="' + (o.t || 0) + '" rIns="' + (o.r || 0) + '" bIns="' + (o.b || 0) +
      '" rtlCol="0" anchor="' + (o.anchor || 'ctr') + '"><a:noAutofit/></a:bodyPr><a:lstStyle/>' + paras + '</p:txBody>';
  }
  function shape(id, name, o) {
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + esc(name) + '"/><p:cNvSpPr' + (o.txBox ? ' txBox="1"' : '') + '/><p:nvPr/></p:nvSpPr><p:spPr>' +
      xfrm(o.x, o.y, o.w, o.h) + o.geom + (o.fill || '<a:noFill/>') + (o.line || '<a:ln><a:noFill/></a:ln>') + '</p:spPr>' + (o.text || '') + '</p:sp>';
  }
  function connector(id, name, x, y, w, h, ln) {
    return '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="' + id + '" name="' + esc(name) + '"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>' +
      xfrm(x, y, w, h) + prst('line') + ln + '</p:spPr></p:cxnSp>';
  }
  function group(id, name, x, y, w, h, children) {
    return '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="' + id + '" name="' + esc(name) + '"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>' +
      '<a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + w + '" cy="' + h + '"/><a:chOff x="' + x + '" y="' + y + '"/><a:chExt cx="' + w + '" cy="' + h + '"/></a:xfrm>' +
      '</p:grpSpPr>' + children + '</p:grpSp>';
  }

  /* ---------- paths ---------- */

  /* Absolute "M ... L/Q/C ..." (the form Layout emits) -> { start, segs: [{ pts: [controls..., end] }] }. */
  function parsePath(d) {
    var tok = String(d).match(/[MLQC]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [], segs = [], start = null, cur = null, cmd = null, i = 0;
    var need = { M: 1, L: 1, Q: 2, C: 3 };
    while (i < tok.length) {
      if (/[MLQC]/.test(tok[i])) { cmd = tok[i++]; continue; }
      var pts = [];
      for (var k = 0; k < need[cmd]; k++, i += 2) pts.push({ x: +tok[i], y: +tok[i + 1] });
      if (cmd === 'M') { start = cur = pts[0]; cmd = 'L'; }
      else { segs.push({ cmd: cmd, from: cur, pts: pts }); cur = pts[pts.length - 1]; }
    }
    return { start: start, segs: segs };
  }

  function bezier(pts, t) {
    var cur = pts;
    while (cur.length > 1) {
      var nxt = [];
      for (var i = 0; i < cur.length - 1; i++) nxt.push({ x: cur[i].x + (cur[i + 1].x - cur[i].x) * t, y: cur[i].y + (cur[i + 1].y - cur[i].y) * t });
      cur = nxt;
    }
    return cur[0];
  }

  /* Point and direction at fraction f (0..1) of the path's arc length. */
  function pointAt(path, f) {
    var samples = [path.start];
    path.segs.forEach(function (sg) {
      var n = sg.cmd === 'L' ? 1 : 24;
      for (var i = 1; i <= n; i++) samples.push(bezier([sg.from].concat(sg.pts), i / n));
    });
    var lens = [0], total = 0, i;
    for (i = 1; i < samples.length; i++) { total += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y); lens.push(total); }
    var want = total * f;
    i = 1;
    while (i < samples.length - 1 && lens[i] < want) i++;
    var a = samples[i - 1], b = samples[i], span = lens[i] - lens[i - 1] || 1, k = Math.max(0, Math.min(1, (want - lens[i - 1]) / span));
    var dx = b.x - a.x, dy = b.y - a.y, dd = Math.hypot(dx, dy) || 1;
    return { x: a.x + dx * k, y: a.y + dy * k, tx: dx / dd, ty: dy / dd };
  }

  function bounds(path) {
    var b = { x0: path.start.x, y0: path.start.y, x1: path.start.x, y1: path.start.y };
    path.segs.forEach(function (sg) {
      sg.pts.forEach(function (p) { b.x0 = Math.min(b.x0, p.x); b.y0 = Math.min(b.y0, p.y); b.x1 = Math.max(b.x1, p.x); b.y1 = Math.max(b.y1, p.y); });
    });
    return b;
  }

  /* ---------- the slide ---------- */

  var SLIDE_W = 12192000, SLIDE_H = 6858000;
  var MOVE_MS = 1300, FADE_MS = 500, OUT_MS = 300;

  function sizeOf(px, s) { return Math.max(500, Math.round(px * s / 127)); }

  function buildSlide(model, geo, beats, th, title) {
    var margin = 300000, top = 900000, bottom = 250000;
    var aw = SLIDE_W - 2 * margin, ah = SLIDE_H - top - bottom;
    var s = Math.min(aw / geo.width, ah / geo.height, 15240);
    var ox = (SLIDE_W - geo.width * s) / 2, oy = top + (ah - geo.height * s) / 2;
    function X(px) { return Math.round(ox + px * s); }
    function Y(px) { return Math.round(oy + px * s); }
    function D(px) { return Math.round(px * s); }

    var nextId = 2;
    function id() { return nextId++; }
    var groupsXml = '', edgesXml = '', trailsXml = '', nodesXml = '', labelsXml = '', packetsXml = '', animated = [];

    var titleId = id();
    var titleXml = shape(titleId, 'Title', {
      x: 400000, y: 180000, w: SLIDE_W - 800000, h: 560000, txBox: true, geom: prst('rect'),
      text: textBody(para(title, { sz: 2400, bold: true, color: th.text, algn: 'l' }), { wrap: 'square', anchor: 'ctr' })
    });

    model.groups.forEach(function (g) {
      var members = model.nodes.filter(function (n) { return n.group === g.id && geo.nodes[n.id]; });
      if (!members.length) return;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      members.forEach(function (n) {
        var r = geo.nodes[n.id];
        x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
      });
      var c = paletteOf(g.color, th.dark);
      groupsXml += shape(id(), 'Group: ' + g.id, {
        x: X(x0 - 14), y: Y(y0 - 30), w: D(x1 - x0 + 28), h: D(y1 - y0 + 44), geom: prst('rect'),
        fill: solid(c.fill, 45000), line: line(Math.max(1, D(0.75)), c.stroke, { dash: 'dash' }),
        text: textBody(para(g.label, { sz: sizeOf(12, s), bold: true, color: c.title, algn: 'l' }), { anchor: 't', l: D(8), t: D(6) })
      });
    });

    var edgeKey = {}, shared = {};
    geo.edges.forEach(function (e) {
      var path = parsePath(e.d), b = bounds(path);
      var ex = X(b.x0), ey = Y(b.y0), ew = Math.max(1, D(b.x1 - b.x0)), eh = Math.max(1, D(b.y1 - b.y0));
      function pt(p) { return '<a:pt x="' + Math.round((p.x - b.x0) * s) + '" y="' + Math.round((p.y - b.y0) * s) + '"/>'; }
      var cmds = '<a:moveTo>' + pt(path.start) + '</a:moveTo>';
      path.segs.forEach(function (sg) {
        var tag = sg.cmd === 'L' ? 'lnTo' : sg.cmd === 'Q' ? 'quadBezTo' : 'cubicBezTo';
        cmds += '<a:' + tag + '>' + sg.pts.map(pt).join('') + '</a:' + tag + '>';
      });
      var geom = '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="' + ew + '" h="' + eh + '" fill="none">' + cmds + '</a:path></a:pathLst></a:custGeom>';
      var dash = e.kind === 'response' ? 'dash' : e.kind === 'async' || e.kind === 'event' ? 'sysDot' : null, round = dash === 'sysDot';
      edgeKey[e.id] = { path: path, e: e, ex: ex, ey: ey, ew: ew, eh: eh, geom: geom, dash: dash, round: round };
      edgesXml += shape(id(), 'Edge: ' + e.id, { x: ex, y: ey, w: ew, h: eh, geom: geom, line: line(Math.max(1, D(1.5)), th.edge, { dash: dash, round: round, arrow: true }) });
    });

    model.nodes.forEach(function (n) {
      var r = geo.nodes[n.id];
      if (!r) return;
      var c = paletteOf(n.color, th.dark), extra = n.shape === 'queue' ? 30 : 0;
      var x = X(r.x), y = Y(r.y), w = D(r.w), h = D(r.h), border = line(Math.max(1, D(0.75)), c.stroke);
      var paras = para(n.label, { sz: sizeOf(14, s), bold: true, color: c.title }) + (n.subtitle ? para(n.subtitle, { sz: sizeOf(12, s), color: c.sub }) : '');
      var tb = textBody(paras, { l: D(10), r: D(10 + extra), t: n.shape === 'database' ? D(14) : 0, b: 0 });
      if (n.shape === 'database') {
        nodesXml += shape(id(), 'Node: ' + n.id, { x: x, y: y, w: w, h: h, geom: prst('can', 26667), fill: solid(c.fill), line: border, text: tb });
      } else if (n.shape === 'queue') {
        var gid = id(), body = shape(id(), 'Node body: ' + n.id, { x: x, y: y, w: w, h: h, geom: prst('rect'), fill: solid(c.fill), line: border, text: tb });
        [26, 18, 10].forEach(function (d, i) {
          body += connector(id(), 'Slot: ' + n.id + ' ' + (i + 1), X(r.x + r.w - d), Y(r.y + 14), 0, D(r.h - 28), border);
        });
        nodesXml += group(gid, 'Node: ' + n.id, x, y, w, h, body);
      } else {
        nodesXml += shape(id(), 'Node: ' + n.id, { x: x, y: y, w: w, h: h, geom: prst('roundRect', 13333), fill: solid(c.fill), line: border, text: tb });
      }
    });

    /* One Trail, Step label and Packet per Step. */
    var perStep = [];
    model.steps.forEach(function (st, si) {
      var ek = edgeKey[st.from + '>' + st.to];
      if (!ek) return;
      var rec = { trail: id() }, n = shared[ek.e.id] = (shared[ek.e.id] || 0) + 1;
      perStep[si] = rec;
      trailsXml += shape(rec.trail, 'Trail: ' + (si + 1), { x: ek.ex, y: ek.ey, w: ek.ew, h: ek.eh, geom: ek.geom, line: line(Math.max(1, D(1.5 * 1.8)), HOT, { dash: ek.dash, round: ek.round, arrow: true }) });
      animated.push(rec.trail);

      if (st.label) {
        var txt = st.label.length > 26 ? st.label.slice(0, 25) + '\u2026' : st.label;
        var fracs = [0.5, 0.35, 0.65, 0.25, 0.75], m = pointAt(ek.path, fracs[(n - 1) % fracs.length]);
        var w = txt.length * 6.6 + 8, h = 16, nx = -m.ty, ny = m.tx;
        if (ny > 0 && !edgeKey[st.to + '>' + st.from]) { nx = -nx; ny = -ny; }
        var ext = Math.abs(nx) * w / 2 + Math.abs(ny) * h / 2 + 3;
        var cx = Math.min(geo.width - w / 2 - 2, Math.max(w / 2 + 2, m.x + nx * ext)), cy = Math.min(geo.height - h / 2 - 2, Math.max(h / 2 + 2, m.y + ny * ext));
        rec.label = id();
        labelsXml += shape(rec.label, 'Step label: ' + (si + 1), {
          x: X(cx - w / 2), y: Y(cy - h / 2), w: D(w), h: D(h), txBox: true, geom: prst('rect'), fill: solid(th.bg, 80000),
          text: textBody(para(txt, { sz: sizeOf(11, s), bold: true, color: th.text }), { wrap: 'none' })
        });
        animated.push(rec.label);
      }

      var p0 = ek.path.start, rad = 6;
      rec.packet = id();
      rec.start = p0; rec.path = ek.path;
      packetsXml += shape(rec.packet, 'Packet: ' + (si + 1), {
        x: X(p0.x - rad), y: Y(p0.y - rad), w: D(2 * rad), h: D(2 * rad), geom: prst('ellipse'),
        fill: solid(st.kind === 'response' ? th.bg : HOT), line: line(Math.max(1, D(1)), HOT_D)
      });
      animated.push(rec.packet);
    });

    /* ----- timing: one click per Beat ----- */
    var tid = 2;
    function nid() { return ++tid; }
    function tgt(spid) { return '<p:tgtEl><p:spTgt spid="' + spid + '"/></p:tgtEl>'; }
    function setVisible(spid, value, delay) {
      return '<p:set><p:cBhvr><p:cTn id="' + nid() + '" dur="1" fill="hold"><p:stCondLst><p:cond delay="' + delay + '"/></p:stCondLst></p:cTn>' + tgt(spid) +
        '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="' + value + '"/></p:to></p:set>';
    }
    function effect(attrs, kids) {
      var cid = nid();
      return '<p:par><p:cTn id="' + cid + '" ' + attrs + '><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' + kids() + '</p:childTnLst></p:cTn></p:par>';
    }
    function appear(spid, node) {
      return effect('presetID="1" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="' + node + '"', function () { return setVisible(spid, 'visible', 0); });
    }
    function fade(spid, node, out) {
      return effect('presetID="10" presetClass="' + (out ? 'exit' : 'entr') + '" presetSubtype="0" fill="hold" grpId="' + (out ? 1 : 0) + '" nodeType="' + node + '"', function () {
        var dur = out ? OUT_MS : FADE_MS;
        var fx = '<p:animEffect transition="' + (out ? 'out' : 'in') + '" filter="fade"><p:cBhvr><p:cTn id="' + nid() + '" dur="' + dur + '"/>' + tgt(spid) + '</p:cBhvr></p:animEffect>';
        return out ? fx + setVisible(spid, 'hidden', dur - 1) : setVisible(spid, 'visible', 0) + fx;
      });
    }
    /* Motion path language of PowerPoint knows M, L, C (no Q); coordinates are fractions of the slide, relative to the shape. */
    function motionPath(path) {
      var o = path.start;
      function p(q) { return num((q.x - o.x) * s / SLIDE_W) + ' ' + num((q.y - o.y) * s / SLIDE_H); }
      var d = 'M 0 0', last = o;
      path.segs.forEach(function (sg) {
        var end = sg.pts[sg.pts.length - 1];
        if (sg.cmd === 'L') d += ' L ' + p(end);
        else if (sg.cmd === 'C') d += ' C ' + sg.pts.map(p).join(' ');
        else {
          var q = sg.pts[0];
          var c1 = { x: last.x + 2 / 3 * (q.x - last.x), y: last.y + 2 / 3 * (q.y - last.y) };
          var c2 = { x: end.x + 2 / 3 * (q.x - end.x), y: end.y + 2 / 3 * (q.y - end.y) };
          d += ' C ' + p(c1) + ' ' + p(c2) + ' ' + p(end);
        }
        last = end;
      });
      var e = path.segs.length ? path.segs[path.segs.length - 1].pts.slice(-1)[0] : o;
      return { d: d + ' E', cx: Math.round((e.x - o.x) * s / SLIDE_W / 2 * 100000), cy: Math.round((e.y - o.y) * s / SLIDE_H / 2 * 100000) };
    }
    function motion(spid, path, node) {
      var mp = motionPath(path);
      return effect('presetID="0" presetClass="path" presetSubtype="0" accel="50000" decel="50000" fill="hold" nodeType="' + node + '"', function () {
        return '<p:animMotion origin="layout" path="' + mp.d + '" pathEditMode="relative" rAng="0"><p:cBhvr><p:cTn id="' + nid() + '" dur="' + MOVE_MS + '" fill="hold"/>' + tgt(spid) +
          '<p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr><p:rCtr x="' + mp.cx + '" y="' + mp.cy + '"/></p:animMotion>';
      });
    }
    function block(delay, kids) {
      var bid = nid();
      return '<p:par><p:cTn id="' + bid + '" fill="hold"><p:stCondLst><p:cond delay="' + delay + '"/></p:stCondLst><p:childTnLst>' + kids() + '</p:childTnLst></p:cTn></p:par>';
    }

    var clicks = '';
    beats.forEach(function (beat) {
      var steps = beat.map(function (si) { return perStep[si]; }).filter(Boolean);
      if (!steps.length) return;
      var cid = nid();
      clicks += '<p:par><p:cTn id="' + cid + '" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>' +
        block(0, function () {
          return steps.map(function (r, i) {
            return appear(r.packet, i === 0 ? 'clickEffect' : 'withEffect') + motion(r.packet, r.path, 'withEffect') + fade(r.trail, 'withEffect', false);
          }).join('');
        }) +
        block(MOVE_MS, function () {
          var first = true;
          return steps.map(function (r) {
            var x = '';
            if (r.label) { x += appear(r.label, first ? 'afterEffect' : 'withEffect'); first = false; }
            x += fade(r.packet, first ? 'afterEffect' : 'withEffect', true); first = false;
            return x;
          }).join('');
        }) +
        '</p:childTnLst></p:cTn></p:par>';
    });

    var timing = '';
    if (clicks) {
      timing = '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>' +
        '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>' + clicks + '</p:childTnLst></p:cTn>' +
        '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>' +
        '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>' +
        '</p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst>' +
        animated.map(function (spid) { return '<p:bldP spid="' + spid + '" grpId="0" animBg="1"/>'; }).join('') +
        perStep.map(function (r) { return '<p:bldP spid="' + r.packet + '" grpId="1" animBg="1"/>'; }).join('') +
        '</p:bldLst></p:timing>';
    }

    return XML + '<p:sld xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '"><p:cSld>' +
      '<p:bg><p:bgPr>' + solid(th.bg) + '<a:effectLst/></p:bgPr></p:bg><p:spTree>' + groupProps() +
      titleXml + groupsXml + edgesXml + trailsXml + nodesXml + labelsXml + packetsXml +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>' + timing + '</p:sld>';
  }

  function groupProps() {
    return '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  }

  /* ---------- fixed package parts ---------- */

  var REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  function rels(list) {
    return XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      list.map(function (r) { return '<Relationship Id="' + r[0] + '" Type="' + r[1] + '" Target="' + r[2] + '"/>'; }).join('') + '</Relationships>';
  }
  var OV = 'application/vnd.openxmlformats-officedocument.';

  function contentTypes() {
    var o = [
      ['/ppt/presentation.xml', OV + 'presentationml.presentation.main+xml'],
      ['/ppt/slides/slide1.xml', OV + 'presentationml.slide+xml'],
      ['/ppt/slideLayouts/slideLayout1.xml', OV + 'presentationml.slideLayout+xml'],
      ['/ppt/slideMasters/slideMaster1.xml', OV + 'presentationml.slideMaster+xml'],
      ['/ppt/theme/theme1.xml', OV + 'theme+xml'],
      ['/ppt/presProps.xml', OV + 'presentationml.presProps+xml'],
      ['/ppt/viewProps.xml', OV + 'presentationml.viewProps+xml'],
      ['/ppt/tableStyles.xml', OV + 'presentationml.tableStyles+xml'],
      ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
      ['/docProps/app.xml', OV + 'extended-properties+xml']
    ];
    return XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      o.map(function (x) { return '<Override PartName="' + x[0] + '" ContentType="' + x[1] + '"/>'; }).join('') + '</Types>';
  }

  function presentation() {
    return XML + '<p:presentation xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '" saveSubsetFonts="1">' +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>' +
      '<p:sldSz cx="' + SLIDE_W + '" cy="' + SLIDE_H + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>';
  }

  function theme() {
    var sc = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
    var clr = function (name, v) { return '<a:' + name + '><a:srgbClr val="' + v + '"/></a:' + name + '>'; };
    var fonts = function (tag) { return '<a:' + tag + '><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:' + tag + '>'; };
    var ln = function (w) { return '<a:ln w="' + w + '" cap="flat" cmpd="sng" algn="ctr">' + sc + '<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>'; };
    return XML + '<a:theme xmlns:a="' + NS_A + '" name="Flow animator"><a:themeElements>' +
      '<a:clrScheme name="Flow animator">' + clr('dk1', '1F1E1D') + clr('lt1', 'FFFFFF') + clr('dk2', '444441') + clr('lt2', 'F1EFE8') +
      clr('accent1', '185FA5') + clr('accent2', 'EF9F27') + clr('accent3', '3B6D11') + clr('accent4', '993C1D') + clr('accent5', '534AB7') + clr('accent6', '0F6E56') +
      clr('hlink', '185FA5') + clr('folHlink', '534AB7') + '</a:clrScheme>' +
      '<a:fontScheme name="Flow animator">' + fonts('majorFont') + fonts('minorFont') + '</a:fontScheme>' +
      '<a:fmtScheme name="Flow animator"><a:fillStyleLst>' + sc + sc + sc + '</a:fillStyleLst><a:lnStyleLst>' + ln(6350) + ln(12700) + ln(19050) + '</a:lnStyleLst>' +
      '<a:effectStyleLst>' + '<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3) + '</a:effectStyleLst><a:bgFillStyleLst>' + sc + sc + sc + '</a:bgFillStyleLst></a:fmtScheme>' +
      '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
  }

  function master() {
    var lvl = function (sz) {
      return '<a:lvl1pPr><a:defRPr sz="' + sz + '" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr>';
    };
    return XML + '<p:sldMaster xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>' +
      '<p:spTree>' + groupProps() + '</p:spTree></p:cSld>' +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
      '<p:txStyles><p:titleStyle>' + lvl(4400) + '</p:titleStyle><p:bodyStyle>' + lvl(3200) + '</p:bodyStyle><p:otherStyle>' + lvl(1800) + '</p:otherStyle></p:txStyles></p:sldMaster>';
  }

  function layoutPart() {
    return XML + '<p:sldLayout xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>' + groupProps() +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
  }

  function core(title) {
    return XML + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
      'xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(title) + '</dc:title><dc:creator>flow-animator</dc:creator></cp:coreProperties>';
  }

  /* ---------- public API ---------- */

  function build(o) {
    var model = o.model, th = THEMES[o.theme === 'dark' ? 'dark' : 'light'], title = o.title === undefined ? model.title : o.title;
    var beats = o.beats || model.beats;
    return zip([
      { name: '[Content_Types].xml', data: contentTypes() },
      { name: '_rels/.rels', data: rels([['rId1', REL + 'officeDocument', 'ppt/presentation.xml'], ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'], ['rId3', REL + 'extended-properties', 'docProps/app.xml']]) },
      { name: 'docProps/core.xml', data: core(title) },
      { name: 'docProps/app.xml', data: XML + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>flow-animator</Application><Slides>1</Slides></Properties>' },
      { name: 'ppt/presentation.xml', data: presentation() },
      { name: 'ppt/_rels/presentation.xml.rels', data: rels([['rId1', REL + 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', REL + 'slide', 'slides/slide1.xml'], ['rId3', REL + 'presProps', 'presProps.xml'], ['rId4', REL + 'viewProps', 'viewProps.xml'], ['rId5', REL + 'theme', 'theme/theme1.xml'], ['rId6', REL + 'tableStyles', 'tableStyles.xml']]) },
      { name: 'ppt/presProps.xml', data: XML + '<p:presentationPr xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '"/>' },
      { name: 'ppt/viewProps.xml', data: XML + '<p:viewPr xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '"/>' },
      { name: 'ppt/tableStyles.xml', data: XML + '<a:tblStyleLst xmlns:a="' + NS_A + '" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>' },
      { name: 'ppt/theme/theme1.xml', data: theme() },
      { name: 'ppt/slideMasters/slideMaster1.xml', data: master() },
      { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([['rId1', REL + 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', REL + 'theme', '../theme/theme1.xml']]) },
      { name: 'ppt/slideLayouts/slideLayout1.xml', data: layoutPart() },
      { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([['rId1', REL + 'slideMaster', '../slideMasters/slideMaster1.xml']]) },
      { name: 'ppt/slides/slide1.xml', data: buildSlide(model, o.geo, beats, th, title) },
      { name: 'ppt/slides/_rels/slide1.xml.rels', data: rels([['rId1', REL + 'slideLayout', '../slideLayouts/slideLayout1.xml']]) }
    ]);
  }

  function fromFlow(doc, o) {
    o = o || {};
    if (!M || !L) throw new Error('export-pptx needs flow-modeling.js and layout.js loaded first');
    var mg = M.migrate(doc), d = mg.migrated ? mg.doc : doc, v = M.validate(d);
    if (v.errors.length) throw new Error('Invalid flow: ' + v.errors.map(function (e) { return e.path + ' ' + e.message; }).join('; '));
    var model = M.normalize(d), geo = L.layout(model, o.layout || {});
    return build({ model: model, geo: geo, beats: model.beats, theme: o.theme, title: model.title });
  }

  return { build: build, fromFlow: fromFlow, zip: zip, crc32: crc32, MIME: MIME };
});
