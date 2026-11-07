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
 *   host.askName(def)         -> name or null
 *   host.askToken()           -> token or null (also stored by the host)
 *   host.confirm(msg)         -> boolean
 *   var saver = FlowSaver.create(host, gateway)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = { create: factory, NAME_RE: /^[A-Za-z0-9][A-Za-z0-9._-]*\.flow\.json$/ };
  else root.FlowSaver = { create: factory, NAME_RE: /^[A-Za-z0-9][A-Za-z0-9._-]*\.flow\.json$/ };
})(typeof self !== 'undefined' ? self : this, function create(host, gw) {
  'use strict';
  var NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.flow\.json$/;
  var name = null, revision = null;

  function normalize(n) {
    n = String(n || '').trim();
    if (n && !/\.flow\.json$/.test(n)) n = n.replace(/\.json$/, '') + '.flow.json';
    return n;
  }

  function suggest() {
    var t; try { t = JSON.parse(host.getText()).title; } catch (e) { t = ''; }
    return (String(t || 'flow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flow') + '.flow.json';
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
      var t = host.askToken();
      if (t) return retry();
      host.notify('Not saved: a token is required'); return r;
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
      var n = normalize(host.askName(name || suggest()));
      if (!n) return Promise.resolve({ ok: false, kind: 'cancelled' });
      if (!NAME_RE.test(n)) { host.notify('Not saved: use letters, digits, dot, dash or underscore, ending in .flow.json'); return Promise.resolve({ ok: false, kind: 'badname' }); }
      return gw.save(n, host.getText(), { create: true }).then(function (r) {
        if (!r.ok && r.kind === 'conflict') {
          host.notify('Not saved: ' + n + ' already exists. Choose another name.');
          return r;
        }
        return handle(r, function () { return saver.saveAs(); }, { name: n });
      });
    }
  };

  /* Stored revision moved on since this Draft was loaded. */
  function conflict(n, r) {
    if (host.confirm('"' + n + '" changed on the server since you opened it.\n\nOK = overwrite it with your version.\nCancel = keep editing (use Save as... or Reload).')) {
      return gw.save(n, host.getText(), {}).then(function (r2) { return handle(r2, saver.save, { name: n }); });
    }
    host.notify('Not saved: the server has a newer version');
    return Promise.resolve(r);
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
});
