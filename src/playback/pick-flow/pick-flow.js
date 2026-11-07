/*
 * pick-flow: list the Flow Library's flows and open one by name (Playback context).
 *   var picker = FlowPicker.create(document, gateway, function onPick(name) {...});
 *   picker.mount(parentElement); picker.refresh();
 * The control stays hidden when no list is available (e.g. file:// or static hosting).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = { create: factory };
  else root.FlowPicker = { create: factory };
})(typeof self !== 'undefined' ? self : this, function create(doc, gw, onPick) {
  'use strict';
  var sel = null, current = null;

  function label(f) {
    var s = f.title ? f.title + ' (' + f.file + ')' : f.file;
    if (typeof f.steps === 'number') s += ' · ' + f.steps + ' steps';
    return s;
  }

  var picker = {
    mount: function (parent) {
      sel = doc.createElement('select');
      sel.id = 'flowPick';
      sel.setAttribute('aria-label', 'Stored flows');
      sel.hidden = true;
      sel.addEventListener('change', function () {
        var v = sel.value;
        if (v) onPick(v);
        else picker.select(current);
      });
      parent.appendChild(sel);
    },
    refresh: function () {
      return gw.list().then(function (flows) {
        sel.textContent = '';
        var o = doc.createElement('option'); o.value = ''; o.textContent = 'Stored flows…'; sel.appendChild(o);
        flows.forEach(function (f) {
          var e = doc.createElement('option'); e.value = f.file; e.textContent = label(f); sel.appendChild(e);
        });
        sel.hidden = !flows.length;
        picker.select(current);
        return flows;
      });
    },
    /* Reflect which stored flow is shown (null when local). */
    select: function (name) {
      current = name || null;
      if (!sel) return;
      var has = false;
      for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === current) has = true;
      sel.value = has ? current : '';
    }
  };
  return picker;
});
