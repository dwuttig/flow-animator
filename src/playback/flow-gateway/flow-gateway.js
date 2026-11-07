/*
 * flow-gateway: browser client for the Flow Library's HTTP API (Playback context).
 * The only place in Playback that knows URLs and status codes. It does not
 * validate Flows; the server (Flow Modeling via Flow Library) has the final word.
 *
 *   var gw = FlowGateway.create({ fetch: fetch, base: 'api/flows', listing: 'flows/', getToken: fn });
 *   gw.available()               -> Promise<boolean>
 *   gw.list()                    -> Promise<[{file,title,nodes,steps,revision,modifiedAt}]>
 *   gw.load(name)                -> Promise<{text, revision}>        (revision null on the static fallback)
 *   gw.save(name, text, {ifMatch|create}) -> Promise<{ok:true,revision,warnings} | {ok:false,kind,...}>
 *   gw.remove(name, {ifMatch})   -> Promise<{ok:true} | {ok:false,kind,...}>
 *   kind: 'invalid' (errors, warnings) | 'conflict' (revision) | 'unauthorized' | 'unavailable' | 'notfound' | 'error'
 * URLs are relative, so the viewer works under any path prefix.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = { create: factory };
  else root.FlowGateway = { create: factory };
})(typeof self !== 'undefined' ? self : this, function create(opts) {
  'use strict';
  opts = opts || {};
  var f = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(typeof self !== 'undefined' ? self : this) : null);
  var base = (opts.base || 'api/flows').replace(/\/$/, '');
  var listing = opts.listing === undefined ? 'flows/' : opts.listing;
  var SUFFIX = '.flow.json';
  var apiUp = null; // cached: null unknown, true, false

  function url(name) { return base + '/' + encodeURIComponent(name); }

  function headers(extra) {
    var h = Object.assign({}, extra || {});
    var t = opts.getToken && opts.getToken();
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }

  function json(r) { return r.text().then(function (t) { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } }); }
  function unavailable(e) { return { ok: false, kind: 'unavailable', message: e && e.message ? e.message : String(e) }; }

  /* Map a failed response to a result kind. */
  function failure(r, body) {
    if (r.status === 401) return { ok: false, kind: 'unauthorized' };
    if (r.status === 404) return { ok: false, kind: 'notfound' };
    if (r.status === 412) return { ok: false, kind: 'conflict', revision: body && body.revision };
    if (r.status === 422) return { ok: false, kind: 'invalid', errors: (body && body.errors) || [], warnings: (body && body.warnings) || [] };
    if (r.status === 502 || r.status === 503 || r.status === 504) return { ok: false, kind: 'unavailable', message: 'HTTP ' + r.status };
    return { ok: false, kind: 'error', message: (body && body.error) || 'HTTP ' + r.status };
  }

  function etag(r) { var e = r.headers.get('ETag'); return e ? e.replace(/^W\//, '').replace(/^"|"$/g, '') : null; }

  var gw = {
    token: function () { return opts.getToken && opts.getToken(); },

    available: function () {
      if (apiUp !== null) return Promise.resolve(apiUp);
      return f(base, { headers: headers(), cache: 'no-store' }).then(function (r) {
        // 401 means the API exists but wants a token.
        if (r.status === 401) { apiUp = true; return true; }
        if (!r.ok) { apiUp = false; return false; }
        return json(r).then(function (b) { apiUp = !!(b && Array.isArray(b.flows)); return apiUp; });
      }).catch(function () { apiUp = false; return false; });
    },

    list: function () {
      return gw.available().then(function (up) {
        if (up) {
          return f(base, { headers: headers(), cache: 'no-store' }).then(function (r) {
            return json(r).then(function (b) { return r.ok && b ? b.flows : []; });
          });
        }
        if (!listing) return [];
        // nginx "autoindex_format json": [{name, type, mtime, size}]
        return f(listing, { cache: 'no-store' }).then(function (r) {
          return r.ok ? json(r) : [];
        }).then(function (a) {
          return (Array.isArray(a) ? a : []).filter(function (e) {
            return e && e.type === 'file' && typeof e.name === 'string' && e.name.slice(-SUFFIX.length) === SUFFIX;
          }).map(function (e) { return { file: e.name.slice(0, -SUFFIX.length), title: null, revision: null, modifiedAt: e.mtime || null }; });
        }).catch(function () { return []; });
      }).catch(function () { return []; });
    },

    load: function (name, o) {
      o = o || {};
      return gw.available().then(function (up) {
        var u = up ? url(name) : (listing || 'flows/') + encodeURIComponent(name.slice(-SUFFIX.length) === SUFFIX ? name : name + SUFFIX);
        var h = headers();
        if (up && o.ifNoneMatch) h['If-None-Match'] = '"' + o.ifNoneMatch + '"';
        return f(u, { headers: h, cache: 'no-store' }).then(function (r) {
          if (r.status === 304) return { ok: true, notModified: true, revision: o.ifNoneMatch };
          if (!r.ok) return json(r).then(function (b) { return failure(r, b); });
          return r.text().then(function (t) { return { ok: true, text: t, revision: up ? etag(r) : null }; });
        });
      }).catch(unavailable);
    },

    save: function (name, text, o) {
      o = o || {};
      var h = headers({ 'Content-Type': 'application/json' });
      if (o.create) h['If-None-Match'] = '*';
      else if (o.ifMatch) h['If-Match'] = '"' + o.ifMatch + '"';
      return f(url(name), { method: 'PUT', headers: h, body: text }).then(function (r) {
        return json(r).then(function (b) {
          if (!r.ok) return failure(r, b);
          return { ok: true, revision: (b && b.revision) || etag(r), warnings: (b && b.warnings) || [], created: r.status === 201 };
        });
      }).catch(unavailable);
    },

    remove: function (name, o) {
      o = o || {};
      var h = headers();
      if (o.ifMatch) h['If-Match'] = '"' + o.ifMatch + '"';
      return f(url(name), { method: 'DELETE', headers: h }).then(function (r) {
        if (r.status === 204) return { ok: true };
        return json(r).then(function (b) { return failure(r, b); });
      }).catch(unavailable);
    },

    /* Forget the cached availability (after a failure that may be temporary). */
    reset: function () { apiUp = null; }
  };
  return gw;
});
