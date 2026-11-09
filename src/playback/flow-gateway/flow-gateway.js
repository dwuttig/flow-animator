/*
 * flow-gateway: browser client for the Flow Library's HTTP API (Playback context).
 * The only place in Playback that knows URLs and status codes. It does not
 * validate Flows; the server (Flow Modeling via Flow Library) has the final word.
 *
 *   var gw = FlowGateway.create({ fetch: fetch, base: 'api/flows', listing: 'flows/', getToken: fn, offline: bool });
 *   gw.available()               -> Promise<boolean>
 *   gw.list()                    -> Promise<[{file,title,nodes,steps,revision,modifiedAt}]>
 *   gw.load(name)                -> Promise<{text, revision}>        (revision null on the static fallback)
 *   gw.save(name, text, {ifMatch|create}) -> Promise<{ok:true,revision,warnings} | {ok:false,kind,...}>
 *   gw.remove(name, {ifMatch})   -> Promise<{ok:true} | {ok:false,kind,...}>
 *   gw.watch(name, onRevision, {known, interval, backoff, timers}) -> stop()
 *     onRevision({revision, deleted, text?}) when the stored revision differs from known(); Server-Sent Events
 *     (GET <base>/<name>/events) with reconnect backoff, else If-None-Match polling every interval ms (1.5 s).
 *   kind: 'invalid' (errors, warnings) | 'conflict' (revision) | 'unauthorized' | 'unavailable' | 'notfound' | 'error'
 *   FlowGateway.parseSse(buffer) -> {events: [{event, data, id}], rest}   (pure)
 * URLs are relative, so the viewer works under any path prefix. Needs FlowName loaded first.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../flow-library/flow-name/flow-name.js'));
  else root.FlowGateway = factory(root.FlowName);
})(typeof self !== 'undefined' ? self : this, function (FN) {
  'use strict';
  var SUFFIX = FN.SUFFIX;

  /* Split complete Server-Sent Events off the front of buffer; comments (": ping") are skipped. */
  function parseSse(buf) {
    var s = String(buf).replace(/\r\n?/g, '\n'), events = [], i;
    while ((i = s.indexOf('\n\n')) >= 0) {
      var block = s.slice(0, i), ev = { event: 'message', data: [], id: null };
      s = s.slice(i + 2);
      block.split('\n').forEach(function (line) {
        if (!line || line.charAt(0) === ':') return;
        var c = line.indexOf(':'), k = c < 0 ? line : line.slice(0, c), v = c < 0 ? '' : line.slice(c + 1);
        if (v.charAt(0) === ' ') v = v.slice(1);
        if (k === 'event') ev.event = v;
        else if (k === 'data') ev.data.push(v);
        else if (k === 'id') ev.id = v;
      });
      if (ev.data.length) events.push({ event: ev.event, data: ev.data.join('\n'), id: ev.id });
    }
    return { events: events, rest: s };
  }

  return { create: create, parseSse: parseSse };

function create(opts) {
  opts = opts || {};
  var f = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(typeof self !== 'undefined' ? self : this) : null);
  var base = (opts.base || 'api/flows').replace(/\/$/, '');
  var listing = opts.listing === undefined ? 'flows/' : opts.listing;
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
      if (opts.offline) apiUp = false; // e.g. a file:// page: no server to ask
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
          }).map(function (e) { return { file: FN.bare(e.name), title: null, revision: null, modifiedAt: e.mtime || null }; });
        }).catch(function () { return []; });
      }).catch(function () { return []; });
    },

    load: function (name, o) {
      o = o || {};
      return gw.available().then(function (up) {
        var u = up ? url(name) : (listing || 'flows/') + encodeURIComponent(FN.bare(name) + SUFFIX);
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
    reset: function () { apiUp = null; },

    watch: function (name, onRevision, o) {
      o = o || {};
      var T = o.timers || { set: function (fn, ms) { return setTimeout(fn, ms); }, clear: function (id) { clearTimeout(id); } };
      var interval = o.interval || 1500, delays = o.backoff || [1000, 2000, 5000, 10000, 30000];
      var last = null, lastText = null, gone = false, stopped = false, timer = null, ctrl = null, tries = 0, failures = 0;
      var known = o.known || function () { return last; };
      function emit(ev) {
        if (stopped) return;
        if (ev.deleted) { if (gone) return; gone = true; }
        else { if (ev.revision !== null && ev.revision === known()) return; gone = false; }
        last = ev.revision;
        onRevision(ev);
      }
      function later(fn, ms) { T.clear(timer); timer = T.set(fn, ms); }
      function poll() {
        if (stopped) return;
        gw.load(name, { ifNoneMatch: known() }).then(function (r) {
          if (stopped) return;
          if (r.ok && !r.notModified && typeof r.text === 'string') {
            // The static fallback has no revision: compare the text instead.
            if (r.revision === null) { if (lastText !== null && r.text !== lastText) emit({ revision: null, text: r.text, deleted: false }); lastText = r.text; }
            else emit({ revision: r.revision, text: r.text, deleted: false });
          } else if (!r.ok && r.kind === 'notfound') emit({ revision: null, deleted: true });
        }, function () {}).then(function () { if (!stopped) later(poll, interval); });
      }
      function retry() { later(connect, delays[Math.min(tries++, delays.length - 1)]); }
      function connect() {
        if (stopped) return;
        ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        f(url(name) + '/events', { headers: headers({ Accept: 'text/event-stream' }), cache: 'no-store', signal: ctrl ? ctrl.signal : undefined }).then(function (r) {
          if (stopped) return;
          failures = 0;
          if (r.status === 401 || r.status === 429 || r.status >= 500) return retry();
          if (!r.ok || !r.body || typeof r.body.getReader !== 'function' || typeof TextDecoder === 'undefined') return poll();
          var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
          function pump() {
            return reader.read().then(function (c) {
              if (stopped) return;
              if (c.done) return retry();
              var p = parseSse(buf + dec.decode(c.value, { stream: true }));
              buf = p.rest;
              p.events.forEach(function (ev) {
                if (ev.event !== 'revision') return;
                var d; try { d = JSON.parse(ev.data); } catch (e) { return; }
                tries = 0;
                emit({ revision: d && d.revision != null ? String(d.revision) : null, deleted: !!(d && d.deleted) });
              });
              return pump();
            });
          }
          return pump();
        }).catch(function () {
          if (stopped) return;
          // Never got a response three times in a row: the stream is not reachable here, poll instead.
          if (++failures >= 3) poll(); else retry();
        });
      }
      gw.available().then(function (up) {
        if (stopped) return;
        if (up && f) connect(); else poll();
      });
      return function stop() {
        stopped = true; T.clear(timer);
        if (ctrl) try { ctrl.abort(); } catch (e) {}
      };
    }
  };
  return gw;
}
});
