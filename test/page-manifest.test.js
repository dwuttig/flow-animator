'use strict';
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var X = require('../src/playback/export-flow/export-flow.js');

var ROOT = path.join(__dirname, '..');
var PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var DOCKERFILE = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
var viewer = DOCKERFILE.slice(DOCKERFILE.indexOf('AS viewer'));

test('every script of the page exists and is copied into the viewer image', function () {
  X.scriptsOf(PAGE).forEach(function (f) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists');
    var dir = path.posix.dirname(f) === '.' ? './' : './' + path.posix.dirname(f) + '/';
    assert.ok(viewer.indexOf('COPY ' + f + ' ' + dir) >= 0 || viewer.indexOf('COPY ' + f.split('/')[0] + '/ ') >= 0 || viewer.indexOf('COPY index.html flow-core.js') >= 0 && f === 'flow-core.js', f + ' is copied by the viewer stage');
  });
});

test('scripts load in dependency order: modeling, layout, core, library, playback, viewer last', function () {
  var list = X.scriptsOf(PAGE), at = function (s) { return list.indexOf(s); };
  assert.ok(at('src/flow-modeling/flow-modeling.js') < at('src/layout/layout.js'));
  assert.ok(at('src/layout/layout.js') < at('flow-core.js'));
  assert.ok(at('flow-core.js') < at('src/flow-library/apply-edit/apply-edit.js'));
  assert.ok(at('src/flow-library/flow-name/flow-name.js') < at('src/playback/flow-gateway/flow-gateway.js'));
  assert.strictEqual(list[list.length - 1], 'src/playback/viewer/viewer.js');
  assert.ok(PAGE.indexOf('id="sample-flow"') < PAGE.indexOf('src/playback/viewer/viewer.js'), 'viewer runs after the embedded data');
});
