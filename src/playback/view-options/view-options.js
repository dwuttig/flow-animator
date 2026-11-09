/*
 * view-options: persisted viewer settings and the View panel controls (Playback context).
 * Settings are viewer-only (never written to the Flow): orientation and connection ('' = the Flow's own
 * layout.direction / layout.connection), step style, line thickness, step labels, layout optimization
 * and node spacing.
 *
 *   ViewOptions.load(storage, connections) -> settings     ViewOptions.save(storage, settings)
 *   ViewOptions.layoutOpts(settings, model) -> {direction, connection, optimize, spacing}
 *   ViewOptions.needsLayout(settings, model) -> true when the model's own geometry cannot be reused
 *   var ui = ViewOptions.bind(doc, settings, { relayout(), look(), change() }); ui.sync(model)
 * bind wires the panel controls that are already in the page (ids optDir optConn optStep optThick optThickL
 * optLabels optOpt optSpace optSpaceL). Pure parts work in Node; bind needs a DOM.
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.ViewOptions = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var KEY = 'flow-animator.view';
  var DIRS = ['LR', 'TB'], STEPS = ['kind', 'solid', 'dashed', 'dotted'], CONNS = ['auto', 'bezier', 'linear', 'orthogonal'];
  var SPACING = { min: 0.5, max: 3 };

  function defaults() { return { direction: '', connection: '', step: 'kind', thick: 1.5, labels: true, optimize: false, spacing: 1 }; }

  function load(storage, connections) {
    var v = defaults(), conns = connections || CONNS, saved;
    try { saved = JSON.parse((storage && storage.getItem(KEY)) || '{}') || {}; } catch (e) { saved = {}; }
    if (DIRS.indexOf(saved.direction) >= 0) v.direction = saved.direction;
    if (conns.indexOf(saved.connection) >= 0) v.connection = saved.connection;
    if (STEPS.indexOf(saved.step) >= 0) v.step = saved.step;
    if (saved.thick >= 1 && saved.thick <= 6) v.thick = +saved.thick;
    if (saved.labels === false) v.labels = false;
    if (saved.optimize === true) v.optimize = true;
    if (saved.spacing >= SPACING.min && saved.spacing <= SPACING.max) v.spacing = +saved.spacing;
    return v;
  }
  function save(storage, v) {
    try {
      storage.setItem(KEY, JSON.stringify({ direction: v.direction, connection: v.connection, step: v.step, thick: v.thick, labels: v.labels, optimize: v.optimize, spacing: v.spacing }));
    } catch (e) {}
  }
  function layoutOpts(v, model) {
    return { direction: v.direction || model.direction, connection: v.connection || model.connection, optimize: !!v.optimize, spacing: v.spacing || 1 };
  }
  function needsLayout(v, model) {
    var lo = layoutOpts(v, model);
    return lo.direction !== model.direction || lo.connection !== model.connection || lo.optimize || lo.spacing !== 1;
  }

  function bind(doc, v, host) {
    function $(id) { return doc.getElementById(id); }
    function spacingText() { return (v.spacing || 1).toFixed(1) + 'x'; }
    function on(id, type, fn) { $(id).addEventListener(type, fn); }

    on('optDir', 'change', function () { v.direction = this.value; host.change(); host.relayout(); });
    on('optConn', 'change', function () { v.connection = this.value; host.change(); host.relayout(); });
    on('optStep', 'change', function () { v.step = this.value; host.change(); host.look(); });
    on('optThick', 'input', function () { v.thick = +this.value; $('optThickL').textContent = String(v.thick); host.change(); host.look(); });
    on('optLabels', 'change', function () { v.labels = this.checked; host.change(); host.look(); });
    on('optOpt', 'change', function () { v.optimize = this.checked; host.change(); host.relayout(); });
    on('optSpace', 'input', function () { v.spacing = +this.value; $('optSpaceL').textContent = spacingText(); host.change(); host.relayout(); });

    return {
      /* Show the settings; orientation and connections show the Flow's own value until overridden. */
      sync: function (model) {
        var o = model ? layoutOpts(v, model) : { direction: v.direction, connection: v.connection };
        $('optDir').value = o.direction; $('optConn').value = o.connection; $('optStep').value = v.step;
        $('optThick').value = String(v.thick); $('optThickL').textContent = String(v.thick);
        $('optLabels').checked = v.labels !== false; $('optOpt').checked = !!v.optimize;
        $('optSpace').value = String(v.spacing || 1); $('optSpaceL').textContent = spacingText();
      }
    };
  }

  return { KEY: KEY, defaults: defaults, load: load, save: save, layoutOpts: layoutOpts, needsLayout: needsLayout, bind: bind };
});
