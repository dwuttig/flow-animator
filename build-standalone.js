#!/usr/bin/env node
/*
 * build-standalone.js: bundle viewer + flow into ONE html file that can be
 * emailed, attached to a ticket or opened from a share, with no other files.
 *
 *   node build-standalone.js path/to/file.flow.json out.html
 */
'use strict';
var fs = require('fs');
var path = require('path');
var C = require(path.join(__dirname, 'flow-core.js'));

var flowFile = process.argv[2], out = process.argv[3];
if (!flowFile || !out) {
  console.error('usage: node build-standalone.js <file.flow.json> <out.html>');
  process.exit(2);
}

var flowText = fs.readFileSync(flowFile, 'utf8');
var res = C.load(flowText);
if (!res.ok) {
  res.errors.forEach(function (e) { console.error('ERROR ' + e.path + '  ' + e.message); });
  console.error('Refusing to bundle an invalid flow. Fix the errors first (node validate.js ' + flowFile + ').');
  process.exit(1);
}

var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
// Scripts in the order index.html loads them (dependency order).
var SCRIPTS = ['flow-core.js', 'src/flow-library/apply-edit/apply-edit.js', 'src/playback/edit-flow/edit-flow.js'];

function safe(s) { return s.replace(/<\//g, '<\\/'); } // keep "</script" out of inline data

var tags = SCRIPTS.map(function (f) { return '<script src="' + f + '"></script>'; });
var coreTag = tags.join('\n');
if (html.indexOf(coreTag) < 0) { console.error('index.html no longer contains the script tags ' + coreTag); process.exit(1); }
html = html.replace(coreTag, function () {
  var inline = SCRIPTS.map(function (f) {
    return '<script>\n' + safe(fs.readFileSync(path.join(__dirname, f), 'utf8')) + '\n</script>';
  }).join('\n');
  return inline + '\n<script id="flow-data" type="application/json">' + safe(JSON.stringify(JSON.parse(flowText))) + '</script>';
});

fs.writeFileSync(out, html);
console.log('wrote ' + out + ' (' + Math.round(html.length / 1024) + ' KB), self-contained');
