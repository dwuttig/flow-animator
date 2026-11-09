/*
 * flow-core.js: parsing, validation, normalisation and auto-layout for
 * flow-animator files (format "flow-animator/1").
 *
 * Pure functions, no DOM. Works in the browser (window.FlowCore) and in
 * Node (require('./flow-core.js')).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./src/flow-modeling/flow-modeling.js'), require('./src/layout/layout.js'));
  } else root.FlowCore = factory(root.FlowModeling, root.FlowLayout);
})(typeof self !== 'undefined' ? self : this, function (M, L) {
  'use strict';

  if (!M || !L) throw new Error('flow-core.js needs src/flow-modeling/flow-modeling.js and src/layout/layout.js loaded first');

  /* ---------- convenience ---------- */

  // text -> {ok, errors, warnings, model, geometry}
  function load(text) {
    var p = M.parse(text);
    if (p.errors.length) return { ok: false, errors: p.errors, warnings: [], model: null, geometry: null };
    return loadDoc(p.doc);
  }

  function loadDoc(doc) {
    var mg = M.migrate(doc), pre = [];
    if (mg.migrated) {
      doc = mg.doc;
      pre.push({ path: '$.format', message: 'migrated from ' + JSON.stringify(mg.from) + ' to "' + M.FORMAT + '"' });
    }
    var v = M.validate(doc);
    if (v.errors.length) return { ok: false, errors: v.errors, warnings: pre.concat(v.warnings), model: null, geometry: null };
    var model = M.normalize(doc);
    var geometry = L.layout(model);
    var warnings = pre.concat(v.warnings, geometry.warnings.map(function (m) { return { path: 'layout', message: m }; }));
    return { ok: true, errors: [], warnings: warnings, model: model, geometry: geometry };
  }

  return {
    FORMAT: M.FORMAT, CONNECTIONS: M.CONNECTIONS, COLORS: M.COLORS, AUTO_COLORS: M.AUTO_COLORS, SHAPES: M.SHAPES, KINDS: M.KINDS,
    KIND_INFO: M.KIND_INFO, MIGRATIONS: M.MIGRATIONS, SHAPE_METRICS: L.SHAPE_METRICS,
    parse: M.parse, validate: M.validate, normalize: M.normalize, layout: L.layout, migrate: M.migrate,
    buildBeats: M.buildBeats, load: load, loadDoc: loadDoc, nodeWidth: L.nodeWidth, NODE_H: L.NODE_H
  };
});
