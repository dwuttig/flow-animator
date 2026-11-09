/*
 * save-flow: persist the Draft to the Flow Library (Playback context, browser only).
 * Tracks which stored Flow (name + revision) the viewer currently shows, and
 * saves with conflict detection through FlowGateway.
 *
 *   host.getText()            current Flow JSON text (the Draft)
 *   host.show(text, name)     render this text
 *   host.markClean()          the Draft equals what is stored
 *   host.report(errs, warns)  show Violations
 *   host.notify(msg)          short status line
 *   host.askName(def)         -> name or null, or a Promise of it
 *   host.askToken()           -> token or null (also stored by the host), or a Promise of it
 *   host.confirm(msg)         -> boolean, or a Promise of it
 *   var saver = FlowSaver.create(host, gateway)
 * Needs FlowName (Flow Library, flow-name) loaded first.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = { create: factory(require('../../flow-library/flow-name/flow-name.js')) };
  else root.FlowSaver = { create: factory(root.FlowName) };
})(typeof self !== 'undefined' ? self : this, function (FN) { return function create(host, gw) {
  'use strict';
  var name = null, revision = null;

  function normalize(n) { return FN.bare(String(n || '')).replace(/\.json$/i, ''); }

  function suggest() {
    var t; try { t = JSON.parse(host.getText()).title; } catch (e) { t = ''; }
    return FN.slug(t);
  }

  function handle(r, retry, what) {
    if (r.ok) {
      name = what.name; revision = r.revision;
      host.markClean(); host.changed && host.changed(name, revision);
      host.notify('Saved ' + name + (r.warnings && r.warnings.length ? ' with ' + r.warnings.length + ' warning(s)' : ''));
      return r;
    }
    if (r.kind === 'invalid') { host.report(r.errors, r.warnings); host.notify('Not saved: the flow has errors'); return r; }
    if (r.kind === 'unauthorized') {
      return Promise.resolve(host.askToken()).then(function (t) {
        if (t) return retry();
        host.notify('Not saved: a token is required'); return r;
      });
    }
    if (r.kind === 'unavailable') { host.notify('Not saved: the server is not reachable. Use Download.'); return r; }
    host.notify('Not saved: ' + (r.message || r.kind));
    return r;
  }

  var saver = {
    name: function () { return name; },
    revision: function () { return revision; },
    /* The viewer loaded a stored Flow (revision may be null on the static fallback). */
    setSource: function (n, rev) { name = n; revision = rev || null; },
    /* The viewer loaded something local (file, paste, example). */
    clearSource: function () { name = null; revision = null; },

    save: function () {
      if (!name) return saver.saveAs();
      var n = name;
      return gw.save(n, host.getText(), revision ? { ifMatch: revision } : {}).then(function (r) {
        if (!r.ok && r.kind === 'conflict') return conflict(n, r);
        return handle(r, saver.save, { name: n });
      });
    },

    saveAs: function () {
      return Promise.resolve(host.askName(name || suggest())).then(function (answer) {
        var n = normalize(answer);
        if (!n) return { ok: false, kind: 'cancelled' };
        if (!FN.isValid(n)) { host.notify('Not saved: use letters, digits, dot, dash or underscore'); return { ok: false, kind: 'badname' }; }
        return gw.save(n, host.getText(), { create: true }).then(function (r) {
          if (!r.ok && r.kind === 'conflict') {
            host.notify('Not saved: ' + n + ' already exists. Choose another name.');
            return r;
          }
          return handle(r, function () { return saver.saveAs(); }, { name: n });
        });
      });
    }
  };

  /* Stored revision moved on since this Draft was loaded. */
  function conflict(n, r) {
    return Promise.resolve(host.confirm('"' + n + '" changed on the server since you opened it.\n\nOK = overwrite it with your version.\nCancel = keep editing (use Save as... or Reload).')).then(function (yes) {
      if (yes) return gw.save(n, host.getText(), {}).then(function (r2) { return handle(r2, saver.save, { name: n }); });
      host.notify('Not saved: the server has a newer version');
      return r;
    });
  }

  /* Discard the Draft and take the stored version. */
  saver.reload = function () {
    if (!name) return Promise.resolve({ ok: false, kind: 'nosource' });
    var n = name;
    return gw.load(n).then(function (r) {
      if (!r.ok) { host.notify('Could not reload: ' + (r.message || r.kind)); return r; }
      host.show(r.text, n); saver.setSource(n, r.revision); host.markClean();
      return r;
    });
  };
  return saver;
}; });
