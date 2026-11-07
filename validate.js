#!/usr/bin/env node
/*
 * validate.js: check a flow-animator file without opening a browser.
 *
 *   node validate.js path/to/file.flow.json          human-readable report
 *   node validate.js path/to/file.flow.json --json   machine-readable report
 *
 * Exit code: 0 = file is valid (warnings allowed), 1 = errors, 2 = bad usage.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var C = require(path.join(__dirname, 'flow-core.js'));

var args = process.argv.slice(2);
var asJson = args.indexOf('--json') >= 0;
var file = args.filter(function (a) { return a.charAt(0) !== '-'; })[0];

if (!file) {
  console.error('usage: node validate.js <file.flow.json> [--json]');
  process.exit(2);
}

var text;
try { text = fs.readFileSync(file, 'utf8'); }
catch (e) { console.error('cannot read ' + file + ': ' + e.message); process.exit(2); }

var res = C.load(text);
var stats = res.ok ? {
  nodes: res.model.nodes.length,
  steps: res.model.steps.length,
  beats: res.model.beats.length,
  groups: res.model.groups.length,
  canvas: res.geometry.width + 'x' + res.geometry.height
} : null;

if (asJson) {
  console.log(JSON.stringify({ ok: res.ok, errors: res.errors, warnings: res.warnings, stats: stats }, null, 2));
} else {
  res.errors.forEach(function (e) { console.log('ERROR   ' + e.path + '  ' + e.message); });
  res.warnings.forEach(function (w) { console.log('WARNING ' + w.path + '  ' + w.message); });
  if (res.ok) {
    console.log('OK  ' + file + ': ' + stats.nodes + ' nodes, ' + stats.steps + ' steps (' + stats.beats +
      ' animation beats), canvas ' + stats.canvas + (res.warnings.length ? ', ' + res.warnings.length + ' warning(s)' : ''));
  } else {
    console.log('FAILED  ' + file + ': ' + res.errors.length + ' error(s). Fix them and run again.');
  }
}
process.exit(res.ok ? 0 : 1);
