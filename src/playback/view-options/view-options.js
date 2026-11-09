/*
 * view-options: persisted viewer settings and the "View" popover (Playback context).
 * Settings are viewer-only (never written to the Flow): orientation and connection ('' = the Flow's own
 * layout.direction / layout.connection), step style and line thickness.
 *
 *   ViewOptions.load(storage, connections) -> settings     ViewOptions.save(storage, settings)
 *   ViewOptions.layoutOpts(settings, model) -> {direction, connection}
 *   ViewOptions.needsLayout(settings, model) -> true when the model's own geometry cannot be reused
 *   var ui = ViewOptions.mount(doc, parent, settings, { relayout(), look(), change() }); ui.sync(model); ui.close()
 * Pure parts work in Node; mount needs a DOM.
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.ViewOptions = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var KEY = 'flow-animator.view';
  var DIRS = ['LR', 'TB'], STEPS = ['kind', 'solid', 'dashed', 'dotted'], CONNS = ['auto', 'bezier', 'linear', 'orthogonal'];
  var LABELS = { LR: 'Horizontal', TB: 'Vertical', auto: 'Auto', bezier: 'Bezier', linear: 'Linear', orthogonal: 'Orthogonal',
    kind: 'By kind', solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted' };

  function defaults() { return { direction: '', connection: '', step: 'kind', thick: 1.5 }; }

  function load(storage, connections) {
    var v = defaults(), conns = connections || CONNS, saved;
    try { saved = JSON.parse((storage && storage.getItem(KEY)) || '{}') || {}; } catch (e) { saved = {}; }
    if (DIRS.indexOf(saved.direction) >= 0) v.direction = saved.direction;
    if (conns.indexOf(saved.connection) >= 0) v.connection = saved.connection;
    if (STEPS.indexOf(saved.step) >= 0) v.step = saved.step;
    if (saved.thick >= 1 && saved.thick <= 6) v.thick = +saved.thick;
    return v;
  }
  function save(storage, v) {
    try { storage.setItem(KEY, JSON.stringify({ direction: v.direction, connection: v.connection, step: v.step, thick: v.thick })); } catch (e) {}
  }
  function layoutOpts(v, model) {
    return { direction: v.direction || model.direction, connection: v.connection || model.connection };
  }
  function needsLayout(v, model) {
    var lo = layoutOpts(v, model);
    return lo.direction !== model.direction || lo.connection !== model.connection;
  }

  function mount(doc, parent, v, host) {
    var wrap = doc.createElement('span'), btn = doc.createElement('button'), pop = doc.createElement('div'), sel = {}, model = null;
    wrap.className = 'menu viewmenu';
    btn.type = 'button'; btn.id = 'viewBtn'; btn.textContent = 'View ▾'; btn.title = 'View options';
    btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'viewPop');
    pop.id = 'viewPop'; pop.className = 'menupop viewpop'; pop.hidden = true;
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'View options');

    function row(text, control) {
      var l = doc.createElement('label'); l.className = 'vrow';
      var s = doc.createElement('span'); s.textContent = text;
      l.appendChild(s); l.appendChild(control); pop.appendChild(l);
      return control;
    }
    function select(key, text, values, withDefault) {
      var s = doc.createElement('select'); s.id = 'opt' + key;
      if (withDefault) { var d = doc.createElement('option'); d.value = ''; d.textContent = 'Flow default'; s.appendChild(d); }
      values.forEach(function (val) { var op = doc.createElement('option'); op.value = val; op.textContent = LABELS[val] || val; s.appendChild(op); });
      sel[key] = s;
      return row(text, s);
    }
    select('Dir', 'Orientation', DIRS, true).addEventListener('change', function () { v.direction = this.value; host.change(); host.relayout(); });
    select('Conn', 'Connections', CONNS, true).addEventListener('change', function () { v.connection = this.value; host.change(); host.relayout(); });
    select('Step', 'Step style', STEPS, false).addEventListener('change', function () { v.step = this.value; host.change(); host.look(); });
    var th = doc.createElement('span'); th.className = 'vthick';
    var range = doc.createElement('input'); range.type = 'range'; range.id = 'optThick'; range.min = '1'; range.max = '6'; range.step = '0.5';
    range.setAttribute('aria-label', 'Line thickness');
    var out = doc.createElement('output'); out.id = 'optThickL';
    th.appendChild(range); th.appendChild(out);
    row('Thickness', th);
    range.addEventListener('input', function () { v.thick = +this.value; out.textContent = String(v.thick); host.change(); host.look(); });

    function open() { ui.sync(model); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); sel.Dir.focus(); }
    function close(refocus) {
      if (pop.hidden) return;
      pop.hidden = true; btn.setAttribute('aria-expanded', 'false');
      if (refocus) btn.focus();
    }
    btn.addEventListener('click', function () { if (pop.hidden) open(); else close(true); });
    pop.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    });
    pop.addEventListener('focusout', function (e) { if (e.relatedTarget && !wrap.contains(e.relatedTarget)) close(); });
    doc.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    wrap.appendChild(btn); wrap.appendChild(pop); parent.appendChild(wrap);

    var ui = {
      /* Show the settings; "Flow default" names the Flow's own value. */
      sync: function (m) {
        model = m || model;
        if (model) {
          sel.Dir.options[0].textContent = 'Flow default (' + (LABELS[model.direction] || model.direction) + ')';
          sel.Conn.options[0].textContent = 'Flow default (' + (LABELS[model.connection] || model.connection || 'Auto') + ')';
        }
        sel.Dir.value = v.direction; sel.Conn.value = v.connection; sel.Step.value = v.step;
        range.value = String(v.thick); out.textContent = String(v.thick);
      },
      close: close,
      isOpen: function () { return !pop.hidden; },
      button: btn
    };
    return ui;
  }

  return { KEY: KEY, defaults: defaults, load: load, save: save, layoutOpts: layoutOpts, needsLayout: needsLayout, mount: mount };
});
