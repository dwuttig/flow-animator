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

var X = require(path.join(__dirname, 'src/playback/export-flow/export-flow.js'));
var sources = {};
X.SCRIPTS.forEach(function (f) { sources[f] = fs.readFileSync(path.join(__dirname, f), 'utf8'); });
var html;
try { html = X.standaloneHtml(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), sources, flowText); }
catch (e) { console.error('Could not bundle: ' + e.message); process.exit(1); }

fs.writeFileSync(out, html);
console.log('wrote ' + out + ' (' + Math.round(html.length / 1024) + ' KB), self-contained');
