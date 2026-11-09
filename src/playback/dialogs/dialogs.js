/*
 * dialogs: promise-based prompt / confirm / alert on a styled modal <dialog> (Playback context, browser only).
 *
 *   var ask = Dialogs.create(document);
 *   ask.prompt(message, defaultValue, { okLabel, readOnly, type }) -> Promise<string|null>   (null = cancelled)
 *   ask.confirm(message, { okLabel, cancelLabel })          -> Promise<boolean>
 *   ask.alert(message)                                      -> Promise<void>
 * Enter confirms, Escape cancels, Tab stays inside, focus returns to where it was. Requests queue one at a time.
 * Without <dialog> support it falls back to window.prompt/confirm/alert.
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.Dialogs = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var seq = 0;

  function create(doc) {
    var win = doc.defaultView || {}, queue = Promise.resolve();

    function build(kind, message, def, o) {
      var id = 'ask' + (++seq);
      var dlg = doc.createElement('dialog');
      dlg.className = 'askdlg';
      dlg.setAttribute('role', kind === 'prompt' ? 'dialog' : 'alertdialog');
      dlg.setAttribute('aria-labelledby', id);
      var form = doc.createElement('form'); form.method = 'dialog';
      var msg = doc.createElement('p'); msg.id = id; msg.className = 'askmsg'; msg.textContent = message;
      form.appendChild(msg);
      var input = null;
      if (kind === 'prompt') {
        input = doc.createElement('input'); input.type = o.type || 'text'; input.className = 'askin';
        input.value = def == null ? '' : String(def); input.setAttribute('aria-labelledby', id);
        input.spellcheck = false; input.autocomplete = 'off';
        if (o.readOnly) input.readOnly = true;
        form.appendChild(input);
      }
      var row = doc.createElement('div'); row.className = 'row';
      function button(text, value) { var b = doc.createElement('button'); b.type = 'submit'; b.value = value; b.textContent = text; row.appendChild(b); return b; }
      if (kind !== 'alert') button(o.cancelLabel || 'Cancel', 'cancel');
      var ok = button(o.okLabel || 'OK', 'ok');
      ok.className = 'askok';
      form.appendChild(row); dlg.appendChild(form);
      return { dlg: dlg, input: input, ok: ok };
    }

    function show(kind, message, def, o) {
      o = o || {};
      if (!win.HTMLDialogElement || typeof doc.createElement('dialog').showModal !== 'function') {
        if (kind === 'prompt') return Promise.resolve(win.prompt(message, def == null ? '' : def));
        if (kind === 'confirm') return Promise.resolve(!!win.confirm(message));
        win.alert(message); return Promise.resolve();
      }
      return new Promise(function (resolve) {
        var back = doc.activeElement, b = build(kind, message, def, o), dlg = b.dlg;
        dlg.addEventListener('keydown', function (e) {
          e.stopPropagation(); // keep viewer shortcuts out of the dialog
          if (e.key === 'Enter' && e.target === b.input) { e.preventDefault(); dlg.close('ok'); return; }
          if (e.key !== 'Tab') return;
          var f = Array.prototype.filter.call(dlg.querySelectorAll('input,button'), function (x) { return !x.disabled; });
          if (!f.length) return;
          var i = f.indexOf(doc.activeElement);
          if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        });
        dlg.addEventListener('close', function () {
          var yes = dlg.returnValue === 'ok';
          dlg.remove();
          if (back && back.focus && doc.contains(back)) back.focus();
          if (kind === 'prompt') resolve(yes ? b.input.value : null);
          else if (kind === 'confirm') resolve(yes);
          else resolve();
        });
        doc.body.appendChild(dlg);
        dlg.showModal();
        if (b.input) { b.input.focus(); b.input.select(); } else b.ok.focus();
      });
    }

    function enqueue(kind, message, def, o) {
      var p = queue.then(function () { return show(kind, message, def, o); });
      queue = p.then(function () {}, function () {});
      return p;
    }

    return {
      prompt: function (message, def, o) { return enqueue('prompt', message, def, o); },
      confirm: function (message, o) { return enqueue('confirm', message, null, o); },
      alert: function (message) { return enqueue('alert', message, null, {}); }
    };
  }

  return { create: create };
});
