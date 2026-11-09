'use strict';
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SRC = path.join(ROOT, 'src');
var BUILTIN = /^(fs|path|crypto|http|events|os|node:.*)$/;

/* Which module paths (relative to the repo, no extension needed) each context may require. */
var ALLOWED = {
  'flow-modeling': [],
  'layout': ['src/flow-modeling/'],
  'flow-library': ['src/flow-modeling/', 'src/layout/', 'src/flow-library/', 'flow-core.js'],
  'playback': ['src/flow-modeling/', 'src/layout/', 'flow-core.js', 'src/flow-library/apply-edit/', 'src/flow-library/flow-name/', 'src/playback/']
};

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce(function (all, e) {
    var p = path.join(dir, e.name);
    return all.concat(e.isDirectory() ? files(p) : /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [p] : []);
  }, []);
}

test('contexts only require what the dependency rule allows', function () {
  files(SRC).forEach(function (file) {
    var rel = path.relative(SRC, file).split(path.sep), ctx = rel[0], from = path.relative(ROOT, file).split(path.sep).join('/');
    assert.ok(ALLOWED[ctx], 'unknown context folder: ' + ctx);
    var re = /require\(\s*'([^']+)'\s*\)/g, m, text = fs.readFileSync(file, 'utf8');
    while ((m = re.exec(text))) {
      if (BUILTIN.test(m[1])) continue;
      var target = path.relative(ROOT, path.resolve(path.dirname(file), m[1])).split(path.sep).join('/');
      var ok = ALLOWED[ctx].some(function (a) { return target === a || target.indexOf(a) === 0 && a.slice(-1) === '/'; });
      assert.ok(ok, from + ' must not require ' + target);
    }
  });
});

test('Flow Modeling imports nothing', function () {
  files(path.join(SRC, 'flow-modeling')).forEach(function (file) {
    assert.ok(!/require\(\s*'\./.test(fs.readFileSync(file, 'utf8')), path.basename(file));
  });
});
