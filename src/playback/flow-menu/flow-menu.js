/*
 * flow-menu: the header "Flow" menu (Playback context, browser only).
 * Lists stored Flows and offers every flow-level action. It holds no domain
 * logic: each entry calls a host action.
 *
 *   var menu = FlowMenu.create(document, gateway, actions);
 *   menu.mount(parent); menu.refresh(); menu.select(name|null); menu.setApi(bool);
 *
 * actions: openStored(name) openFile() paste() sample() newFlow() share() remove()
 *          exportJson() exportHtml() mcp()
 * "Share" and "Delete" need a stored Flow (and the Flow API); the entries are
 * disabled otherwise. The stored list is hidden when no list is available.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = { create: factory };
  else root.FlowMenu = { create: factory };
})(typeof self !== 'undefined' ? self : this, function create(doc, gw, actions) {
  'use strict';
  var btn, pop, flows = [], current = null, apiUp = false, openIdx = -1;

  function label(f) {
    var s = f.title ? f.title + ' (' + f.file + ')' : f.file;
    if (typeof f.steps === 'number') s += ' · ' + f.steps + ' steps';
    return s;
  }

  function item(text, fn, o) {
    o = o || {};
    var b = doc.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = text;
    if (o.disabled) { b.disabled = true; if (o.hint) b.title = o.hint; }
    if (o.current) { b.setAttribute('aria-current', 'true'); b.classList.add('cur'); }
    b.addEventListener('click', function () { close(); fn(); });
    return b;
  }
  function heading(text) { var h = doc.createElement('div'); h.className = 'mh'; h.setAttribute('role', 'presentation'); h.textContent = text; return h; }
  function sep() { var s = doc.createElement('div'); s.className = 'ms'; s.setAttribute('role', 'separator'); return s; }

  function build() {
    pop.textContent = '';
    var stored = current !== null, need = 'Needs a stored flow and the Flow API';
    if (flows.length) {
      pop.appendChild(heading('Stored flows'));
      var list = doc.createElement('div'); list.className = 'ml'; list.setAttribute('role', 'group');
      flows.forEach(function (f) { list.appendChild(item(label(f), function () { actions.openStored(f.file); }, { current: f.file === current })); });
      pop.appendChild(list);
      pop.appendChild(sep());
    }
    pop.appendChild(heading('Open'));
    pop.appendChild(item('Open file…', actions.openFile));
    pop.appendChild(item('Paste JSON…', actions.paste));
    pop.appendChild(item('Built-in example', actions.sample));
    pop.appendChild(sep());
    pop.appendChild(item('New flow', actions.newFlow));
    pop.appendChild(item('Share flow (copy link)', actions.share, { disabled: !(stored && apiUp), hint: need }));
    pop.appendChild(item('Delete flow…', actions.remove, { disabled: !(stored && apiUp), hint: need }));
    pop.appendChild(sep());
    pop.appendChild(heading('Export flow'));
    pop.appendChild(item('Download JSON', actions.exportJson));
    pop.appendChild(item('Download standalone HTML', actions.exportHtml));
    pop.appendChild(sep());
    pop.appendChild(item('MCP config…', actions.mcp));
  }

  function items() { return Array.prototype.filter.call(pop.querySelectorAll('button'), function (b) { return !b.disabled; }); }
  function focusAt(i) { var it = items(); if (!it.length) return; openIdx = (i + it.length) % it.length; it[openIdx].focus(); }

  function open() {
    build(); pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
    var cur = pop.querySelector('.cur');
    (cur || items()[0]).focus(); openIdx = items().indexOf(doc.activeElement);
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }
  function close(refocus) {
    if (pop.hidden) return;
    pop.hidden = true; btn.setAttribute('aria-expanded', 'false');
    if (refocus) btn.focus();
  }

  var menu = {
    mount: function (parent) {
      var wrap = doc.createElement('span'); wrap.className = 'menu';
      btn = doc.createElement('button'); btn.type = 'button'; btn.id = 'flowMenuBtn';
      btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
      btn.textContent = 'Flow ▾';
      pop = doc.createElement('div'); pop.id = 'flowMenu'; pop.className = 'menupop'; pop.setAttribute('role', 'menu'); pop.setAttribute('aria-label', 'Flow'); pop.hidden = true;
      btn.addEventListener('click', function () { if (pop.hidden) open(); else close(true); });
      btn.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown' && pop.hidden) { e.preventDefault(); open(); } });
      pop.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); close(true); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(items().indexOf(doc.activeElement) + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(items().indexOf(doc.activeElement) - 1); }
        else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
        else if (e.key === 'End') { e.preventDefault(); focusAt(-1); }
        else if (e.key === 'Tab') close();
      });
      doc.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
      wrap.appendChild(btn); wrap.appendChild(pop); parent.appendChild(wrap);
    },
    refresh: function () {
      return gw.list().then(function (l) { flows = l || []; return flows; });
    },
    /* Which stored Flow is shown (null when local). */
    select: function (name) { current = name || null; },
    setApi: function (up) { apiUp = !!up; },
    isOpen: function () { return !pop.hidden; }
  };
  return menu;
});
