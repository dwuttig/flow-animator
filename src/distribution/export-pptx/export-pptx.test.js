'use strict';
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var X = require('./export-pptx.js');
var M = require('../../flow-modeling/flow-modeling.js');
var L = require('../../layout/layout.js');

var ROOT = path.join(__dirname, '..', '..', '..');

/* ---------- helpers: read a zip back, check xml, count shapes ---------- */

function unzip(bytes) {
  var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dec = new TextDecoder(), at = bytes.length - 22;
  assert.strictEqual(dv.getUint32(at, true), 0x06054b50, 'end of central directory signature');
  var count = dv.getUint16(at + 10, true), p = dv.getUint32(at + 16, true), files = {}, order = [];
  assert.strictEqual(dv.getUint32(at + 12, true) + dv.getUint32(at + 16, true), at, 'central directory ends where EOCD starts');
  for (var i = 0; i < count; i++) {
    assert.strictEqual(dv.getUint32(p, true), 0x02014b50, 'central header signature');
    var method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    var nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    var name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    assert.strictEqual(dv.getUint32(off, true), 0x04034b50, 'local header signature of ' + name);
    var lname = dv.getUint16(off + 26, true), lextra = dv.getUint16(off + 28, true), start = off + 30 + lname + lextra;
    assert.strictEqual(dec.decode(bytes.subarray(off + 30, off + 30 + lname)), name, 'local name matches central name');
    assert.strictEqual(dv.getUint32(off + 14, true), crc, 'local crc matches central crc');
    var data = bytes.subarray(start, start + csize);
    files[name] = { method: method, crc: crc, size: usize, csize: csize, data: data, text: dec.decode(data) };
    order.push(name);
    p += 46 + nlen + elen + clen;
  }
  return { files: files, names: order };
}

/* Tiny well-formedness check: balanced tags, one root, only known entities, quoted attributes. */
function checkXml(text, label) {
  var s = text.replace(/^\uFEFF/, ''), re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<\?xml[^>]*\?>/g;
  var stack = [], roots = 0, last = 0, m;
  while ((m = re.exec(s))) {
    var between = s.slice(last, m.index);
    assert.ok(!/</.test(between) && !/>/.test(between), label + ': stray angle bracket near ' + m.index);
    assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);)/.test(between + m[3]), label + ': bad entity near ' + m.index);
    last = re.lastIndex;
    if (m[0].indexOf('<?xml') === 0) continue;
    if (m[1]) {
      assert.strictEqual(stack.pop(), m[2], label + ': mismatched </' + m[2] + '> near ' + m.index);
    } else if (!m[4]) {
      if (!stack.length) roots++;
      stack.push(m[2]);
    } else if (!stack.length) roots++;
  }
  assert.strictEqual(s.slice(last).trim(), '', label + ': trailing text');
  assert.deepStrictEqual(stack, [], label + ': unclosed tags');
  assert.strictEqual(roots, 1, label + ': exactly one root element');
}

function names(xml, prefix) {
  var out = [], re = /<p:cNvPr id="(\d+)" name="([^"]*)"/g, m;
  while ((m = re.exec(xml))) {
    var n = m[2].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    if (n.indexOf(prefix) === 0) out.push({ id: +m[1], name: n });
  }
  return out;
}
function count(text, needle) { return text.split(needle).length - 1; }

function prepare(doc, opts) {
  var model = M.normalize(doc), geo = L.layout(model, opts || {});
  return { model: model, geo: geo, beats: model.beats };
}
function slideOf(doc, extra, opts) {
  var p = prepare(doc, opts), bytes = X.build(Object.assign({ model: p.model, geo: p.geo, beats: p.beats, theme: 'light', title: p.model.title }, extra || {}));
  return unzip(bytes).files['ppt/slides/slide1.xml'].text;
}

var SMALL = {
  title: 'Small', groups: [{ id: 'g', label: 'Group G', color: 'blue' }],
  nodes: [
    { id: 'a', label: 'A', group: 'g' },
    { id: 'b', label: 'B', shape: 'database', group: 'g' },
    { id: 'q', label: 'Q', shape: 'queue' },
    { id: 'c', label: 'C' }
  ],
  steps: [
    { from: 'a', to: 'b', label: 'one' },
    { from: 'b', to: 'a', label: 'two', kind: 'response' },
    { from: 'a', to: 'q', label: 'three', kind: 'async' },
    { from: 'q', to: 'c', label: 'four', together: true },
    { from: 'c', to: 'c', label: 'five' }
  ]
};

/* ---------- zip + crc32 ---------- */

test('crc32 matches the standard check values', function () {
  assert.strictEqual(X.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  assert.strictEqual(X.crc32(new Uint8Array(0)), 0);
  assert.strictEqual(X.crc32(new TextEncoder().encode('a')), 0xE8B7BE43);
});

test('zip: round trip with names, sizes, CRCs and UTF-8 data', function () {
  var bin = Uint8Array.from([0, 1, 2, 250, 255]);
  var out = X.zip([{ name: 'a.txt', data: 'hello' }, { name: 'd/\u00E9.bin', data: bin }, { name: 'empty', data: '' }]);
  var z = unzip(out);
  assert.deepStrictEqual(z.names, ['a.txt', 'd/\u00E9.bin', 'empty']);
  assert.strictEqual(z.files['a.txt'].text, 'hello');
  assert.strictEqual(z.files['a.txt'].size, 5);
  assert.strictEqual(z.files['a.txt'].crc, 0x3610A686);
  assert.strictEqual(z.files['a.txt'].method, 0);
  assert.strictEqual(z.files['a.txt'].csize, 5);
  assert.deepStrictEqual(Array.from(z.files['d/\u00E9.bin'].data), [0, 1, 2, 250, 255]);
  assert.strictEqual(z.files['d/\u00E9.bin'].crc, X.crc32(bin));
  assert.strictEqual(z.files.empty.size, 0);
  assert.strictEqual(z.files.empty.crc, 0);
});

/* ---------- build ---------- */

test('build: required parts are present, [Content_Types].xml first, every xml part well-formed', function () {
  var p = prepare(SMALL), bytes = X.build({ model: p.model, geo: p.geo, beats: p.beats, theme: 'light', title: 'Small' });
  assert.ok(bytes instanceof Uint8Array);
  var z = unzip(bytes);
  assert.strictEqual(z.names[0], '[Content_Types].xml');
  ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels', 'ppt/slides/slide1.xml', 'ppt/slides/_rels/slide1.xml.rels',
    'ppt/slideLayouts/slideLayout1.xml', 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    'ppt/theme/theme1.xml'].forEach(function (n) { assert.ok(z.files[n], n + ' present'); });
  z.names.forEach(function (n) {
    assert.strictEqual(z.files[n].crc, X.crc32(z.files[n].data), n + ' crc');
    if (/\.(xml|rels)$/.test(n)) checkXml(z.files[n].text, n);
  });
  var ct = z.files['[Content_Types].xml'].text;
  assert.ok(ct.indexOf('/ppt/slides/slide1.xml') > 0 && ct.indexOf('presentationml.slide+xml') > 0);
  assert.ok(z.files['ppt/presentation.xml'].text.indexOf('cx="12192000" cy="6858000"') > 0, '16:9 slide size');
  assert.ok(z.files['ppt/slides/_rels/slide1.xml.rels'].text.indexOf('../slideLayouts/slideLayout1.xml') > 0);
});

test('build: one shape per Node, Group, Edge, Trail, Step label and Packet', function () {
  var xml = slideOf(SMALL);
  assert.strictEqual(names(xml, 'Node: ').length, 4);
  assert.strictEqual(names(xml, 'Group: ').length, 1);
  assert.strictEqual(names(xml, 'Edge: ').length, 5);
  assert.strictEqual(names(xml, 'Trail: ').length, 5);
  assert.strictEqual(names(xml, 'Step label: ').length, 5);
  assert.strictEqual(names(xml, 'Packet: ').length, 5);
  assert.strictEqual(names(xml, 'Slot: ').length, 3);
  assert.strictEqual(names(xml, 'Title').length, 1);
  var ids = names(xml, '').map(function (x) { return x.id; });
  assert.strictEqual(new Set(ids).size, ids.length, 'shape ids are unique');
  assert.ok(xml.indexOf('prst="roundRect"') > 0 && xml.indexOf('prst="can"') > 0, 'box and database presets');
  assert.strictEqual(count(xml, '<p:grpSp>'), 1, 'only the queue is a group');
  assert.ok(/<p:grpSp>[\s\S]*Node: q[\s\S]*Slot: q 3[\s\S]*<\/p:grpSp>/.test(xml));
});

test('build: Steps without a label get no Step label shape', function () {
  var doc = { title: 'T', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], steps: [{ from: 'a', to: 'b', label: 'x' }] };
  var p = prepare(doc);
  p.model.steps[0].label = '';
  var xml = unzip(X.build({ model: p.model, geo: p.geo, beats: p.beats })).files['ppt/slides/slide1.xml'].text;
  assert.strictEqual(names(xml, 'Step label: ').length, 0);
  assert.strictEqual(names(xml, 'Packet: ').length, 1);
});

test('build: Steps that share an Edge share one Edge shape but get their own Trail, label and Packet', function () {
  var doc = { title: 'T', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], steps: [{ from: 'a', to: 'b', label: 'x' }, { from: 'a', to: 'b', label: 'y' }] };
  var xml = slideOf(doc);
  assert.strictEqual(names(xml, 'Edge: ').length, 1);
  assert.strictEqual(names(xml, 'Trail: ').length, 2);
  assert.strictEqual(names(xml, 'Step label: ').length, 2);
  assert.strictEqual(names(xml, 'Packet: ').length, 2);
});

test('build: Edges are freeform paths with the routed segment types and an arrowhead', function () {
  var xml = slideOf(SMALL, null, { connection: 'bezier' });
  assert.ok(count(xml, '<a:cubicBezTo>') >= 4, 'bezier connection uses cubic curves');
  assert.ok(xml.indexOf('<a:tailEnd type="triangle"') > 0);
  var lin = slideOf(SMALL, null, { connection: 'linear' });
  assert.ok(count(lin, '<a:lnTo>') >= 4 && count(lin, '<a:quadBezTo>') === 0);
  var auto = slideOf({ title: 'T', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'x', label: 'X', col: 1, row: 0 }, { id: 'b', label: 'B', col: 2, row: 0 }],
    steps: [{ from: 'a', to: 'b', label: 'over' }, { from: 'a', to: 'x', label: 'in' }] });
  assert.ok(count(auto, '<a:quadBezTo>') === 2, 'auto routing (Edge and its Trail) bows around a node with a quadratic curve');
  assert.ok(xml.indexOf('prstDash val="dash"') > 0 && xml.indexOf('prstDash val="sysDot"') > 0, 'response is dashed, async dotted');
});

test('build: everything is scaled into the 16:9 slide', function () {
  var wide = { title: 'Wide', nodes: [], steps: [] };
  for (var i = 0; i < 12; i++) wide.nodes.push({ id: 'n' + i, label: 'Node number ' + i });
  for (i = 0; i < 11; i++) wide.steps.push({ from: 'n' + i, to: 'n' + (i + 1), label: 's' + i });
  [SMALL, wide].forEach(function (doc) {
    var xml = slideOf(doc), re = /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/g, m, n = 0;
    while ((m = re.exec(xml))) {
      var x = +m[1], y = +m[2], w = +m[3], h = +m[4];
      if (!w && !h) continue;
      n++;
      assert.ok(x >= 0 && y >= 0 && x + w <= 12192000 && y + h <= 6858000, 'inside the slide: ' + m[0]);
    }
    assert.ok(n > 10);
  });
});

test('build: one click per Beat, Steps of a together Beat share the click', function () {
  var xml = slideOf(SMALL);
  assert.strictEqual(count(xml, '<p:cond delay="indefinite"/>'), 4, '5 Steps in 4 Beats');
  assert.strictEqual(count(xml, 'nodeType="clickEffect"'), 4);
  var clicks = xml.split('<p:cond delay="indefinite"/>').slice(1);
  var ids = function (chunk) { return (chunk.match(/presetClass="path"[\s\S]*?<p:spTgt spid="(\d+)"/g) || []).length; };
  assert.deepStrictEqual(clicks.map(ids), [1, 1, 2, 1], 'Packets moved per click');
  var third = clicks[2], pk = names(xml, 'Packet: ');
  assert.ok(third.indexOf('spid="' + pk[2].id + '"') > 0 && third.indexOf('spid="' + pk[3].id + '"') > 0, 'Steps 3 and 4 are in the same click');
  assert.ok(clicks[1].indexOf('spid="' + pk[2].id + '"') < 0);
  assert.strictEqual(count(xml, 'presetClass="path"'), 5);
});

test('build: effects follow the PowerPoint presets and the Beat timing', function () {
  var xml = slideOf(SMALL);
  assert.strictEqual(count(xml, 'presetID="1" presetClass="entr"'), 10, 'Appear: 5 Packets + 5 Step labels');
  assert.strictEqual(count(xml, 'presetID="10" presetClass="entr"'), 5, 'Fade in: 5 Trails');
  assert.strictEqual(count(xml, 'presetID="10" presetClass="exit"'), 5, 'Fade out: 5 Packets');
  assert.strictEqual(count(xml, 'presetID="0" presetClass="path"'), 5);
  assert.ok(/<p:animMotion origin="layout" path="M 0 0 L [-\d.]+ [-\d.]+ E" pathEditMode="relative"/.test(xml), 'relative motion path starting at the origin');
  assert.ok(xml.indexOf('<p:cond delay="1300"/>') > 0, 'second block starts when the Packet has arrived');
  assert.strictEqual(count(xml, '<p:bldP '), 20, 'Trail, label and Packet build 0, plus Packet exit build 1');
  names(xml, 'Packet: ').forEach(function (pk) {
    assert.strictEqual(count(xml, '<p:bldP spid="' + pk.id + '" grpId="0" animBg="1"/>'), 1, pk.name + ' build 0');
    assert.strictEqual(count(xml, '<p:bldP spid="' + pk.id + '" grpId="1" animBg="1"/>'), 1, pk.name + ' build 1');
  });
  assert.strictEqual(count(xml, 'presetClass="exit" presetSubtype="0" fill="hold" grpId="1"'), 5, 'exit effects use build 1');
  var rctr = xml.match(/<p:rCtr x="[^"]*" y="[^"]*"\/>/g) || [];
  assert.strictEqual(rctr.length, 5);
  rctr.forEach(function (r) {
    var m = /x="([^"]*)" y="([^"]*)"/.exec(r);
    assert.ok(/^-?\d+$/.test(m[1]) && /^-?\d+$/.test(m[2]), 'rCtr is integer 1/1000 percent: ' + r);
  });
  assert.ok(xml.indexOf('<p:attrName>style.visibility</p:attrName>') > 0);
  assert.ok(xml.indexOf('nodeType="mainSeq"') > 0 && xml.indexOf('nodeType="tmRoot"') > 0);
  var cn = (xml.match(/<p:cTn id="(\d+)"/g) || []).map(function (s) { return +s.match(/\d+/)[0]; });
  assert.strictEqual(new Set(cn).size, cn.length, 'time node ids are unique');
  var spids = (xml.match(/spid="(\d+)"/g) || []).map(function (s) { return +s.match(/\d+/)[0]; });
  var known = names(xml, '').map(function (x) { return x.id; });
  spids.forEach(function (id) { assert.ok(known.indexOf(id) >= 0, 'animation targets an existing shape: ' + id); });
});

test('build: the motion path converts a quadratic curve to a cubic and stays relative to the slide size', function () {
  var doc = { title: 'T', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'x', label: 'X', col: 1, row: 0 }, { id: 'b', label: 'B', col: 2, row: 0 }],
    steps: [{ from: 'a', to: 'b', label: 'over' }] };
  var xml = slideOf(doc, null, {});
  var m = /path="(M 0 0 C [^"]+ E)"/.exec(xml);
  assert.ok(m, 'cubic motion path: ' + (xml.match(/path="[^"]*"/) || [''])[0]);
  var n = m[1].replace(/[MCE]/g, '').trim().split(/\s+/).map(Number);
  assert.strictEqual(n.length, 8);
  n.forEach(function (v) { assert.ok(Math.abs(v) < 1, 'fractions of the slide: ' + v); });
});

test('build: no animation block for a Flow without Steps on any Edge', function () {
  var p = prepare(SMALL);
  var xml = unzip(X.build({ model: p.model, geo: p.geo, beats: [] })).files['ppt/slides/slide1.xml'].text;
  assert.ok(xml.indexOf('<p:timing>') < 0);
  checkXml(xml, 'slide');
});

test('build: light and dark themes use the RenderDiagram palette mapping', function () {
  var light = slideOf(SMALL, { theme: 'light' }), dark = slideOf(SMALL, { theme: 'dark' });
  assert.ok(light.indexOf('<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/>') > 0);
  assert.ok(dark.indexOf('<p:bg><p:bgPr><a:solidFill><a:srgbClr val="1F1E1D"/>') > 0);
  var node = function (xml) { return /name="Node: a"[\s\S]*?<\/p:sp>/.exec(xml)[0]; };
  assert.ok(node(light).indexOf('<a:solidFill><a:srgbClr val="E6F1FB"/>') > 0, 'blue light fill');
  assert.ok(node(light).indexOf('<a:srgbClr val="185FA5"/>') > 0, 'blue light stroke');
  assert.ok(node(light).indexOf('<a:srgbClr val="0C447C"/>') > 0, 'blue light title');
  assert.ok(node(dark).indexOf('<a:solidFill><a:srgbClr val="0C447C"/>') > 0, 'blue dark fill is the light title');
  assert.ok(node(dark).indexOf('<a:srgbClr val="85B7EB"/>') > 0, 'blue dark stroke');
  assert.ok(node(dark).indexOf('<a:srgbClr val="B5D4F4"/>') > 0, 'blue dark title');
  assert.ok(light.indexOf('<a:srgbClr val="EF9F27"/>') > 0, 'Trail uses the highlight colour');
  assert.notStrictEqual(slideOf(SMALL), dark, 'default theme is light');
  assert.strictEqual(slideOf(SMALL), light);
});

test('build: labels are escaped (& < > " \' and non-ASCII as UTF-8)', function () {
  var label = 'R&D <x> "q" it\'s \u00E9\u4E2D\uD83D\uDE00';
  var doc = { title: 'T&C <1>', nodes: [{ id: 'a', label: label, subtitle: 'sub & <b>' }, { id: 'b', label: 'B' }], steps: [{ from: 'a', to: 'b', label: label }] };
  var p = prepare(doc), z = unzip(X.build({ model: p.model, geo: p.geo, beats: p.beats, title: 'T&C <1>' }));
  var xml = z.files['ppt/slides/slide1.xml'].text;
  checkXml(xml, 'slide');
  checkXml(z.files['docProps/core.xml'].text, 'core');
  assert.ok(xml.indexOf('R&amp;D &lt;x&gt; &quot;q&quot; it&apos;s \u00E9\u4E2D\uD83D\uDE00') > 0, 'node label');
  assert.ok(xml.indexOf('sub &amp; &lt;b&gt;') > 0);
  assert.ok(xml.indexOf('T&amp;C &lt;1&gt;') > 0, 'title');
  assert.ok(z.files['docProps/core.xml'].text.indexOf('T&amp;C &lt;1&gt;') > 0);
  assert.strictEqual(z.files['ppt/slides/slide1.xml'].size, Buffer.byteLength(xml, 'utf8'), 'stored as UTF-8 bytes');
  assert.ok(z.files['ppt/slides/slide1.xml'].data.length > xml.length, 'non-ASCII takes more than one byte');
  var dflt = names(xml, 'Node: ')[0].name;
  assert.strictEqual(dflt, 'Node: a');
});

test('build: control characters that XML forbids are dropped', function () {
  var doc = { title: 'T', nodes: [{ id: 'a', label: 'A\u0001B' }, { id: 'b', label: 'B' }], steps: [{ from: 'a', to: 'b', label: 'go' }] };
  var xml = slideOf(doc);
  checkXml(xml, 'slide');
  assert.ok(xml.indexOf('AB') > 0 && xml.indexOf('\u0001') < 0);
});

/* ---------- fromFlow ---------- */

test('fromFlow builds the example Flow', function () {
  var doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'order-flow.flow.json'), 'utf8'));
  var model = M.normalize(doc);
  var z = unzip(X.fromFlow(doc, { theme: 'light' })), xml = z.files['ppt/slides/slide1.xml'].text;
  z.names.forEach(function (n) { if (/\.(xml|rels)$/.test(n)) checkXml(z.files[n].text, n); });
  assert.strictEqual(names(xml, 'Node: ').length, model.nodes.length);
  assert.strictEqual(names(xml, 'Packet: ').length, model.steps.length);
  assert.strictEqual(count(xml, '<p:cond delay="indefinite"/>'), model.beats.length);
  assert.ok(xml.indexOf(model.title.replace(/&/g, '&amp;')) > 0, 'title text');
  var out = path.join(os.tmpdir(), 'order-flow.pptx');
  fs.writeFileSync(out, X.fromFlow(doc, { theme: 'light' }));
  assert.ok(fs.statSync(out).size > 5000);
  console.log('# wrote ' + out);
});

test('fromFlow: layout options and the dark theme are honoured, invalid flows are rejected', function () {
  var doc = JSON.parse(JSON.stringify(SMALL));
  var lr = unzip(X.fromFlow(doc, { layout: { direction: 'LR' } })).files['ppt/slides/slide1.xml'].text;
  var tb = unzip(X.fromFlow(doc, { layout: { direction: 'TB' } })).files['ppt/slides/slide1.xml'].text;
  assert.notStrictEqual(lr, tb);
  var dark = unzip(X.fromFlow(doc, { theme: 'dark' })).files['ppt/slides/slide1.xml'].text;
  assert.ok(dark.indexOf('val="1F1E1D"/>') > 0);
  assert.throws(function () { X.fromFlow({ title: 'x', nodes: [], steps: [{ from: 'a', to: 'b', label: 'z' }] }); }, /Invalid flow/);
});

test('MIME is the PowerPoint presentation type', function () {
  assert.strictEqual(X.MIME, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
});
