/*
 * record-video: record the shown Flow's animation as a video file that
 * PowerPoint (or any slide tool) can play (Playback context, browser only).
 *
 *   RecordVideo.pickMimeType(isSupported)   -> {mime, ext} | null     (MP4 preferred, WebM fallback; pure)
 *   RecordVideo.fileName(title, ext)        -> 'my-flow.mp4'          (pure)
 *   RecordVideo.frameSize(vw, vh, width, captionH) -> {w, h, svgH}    (even sizes; pure)
 *   RecordVideo.wrapText(measure, text, maxW, maxLines) -> [lines]    (pure)
 *   RecordVideo.supported(win)              -> {mime, ext} | null
 *   RecordVideo.record(win, host, opts)     -> {done: Promise<{blob, mime, ext, ms}>, cancel()}
 *
 * The recorder redraws the host's SVG into a canvas about 30 times a second
 * (real time, while the viewer plays once from the first step) and feeds the
 * canvas to MediaRecorder. It holds no domain logic: the host drives playback.
 *
 * host: svg() -> SVGElement         the diagram
 *       css() -> string             style rules the diagram needs
 *       colors() -> {bg, text, text2, card}
 *       caption() -> [{head, detail}] text of the current beat (optional)
 *       prepare() / restore()       start playback from the first step, no loop / undo that
 *       done() -> bool              playback reached the end
 *       progress() -> string        status text (optional)
 * opts: width (default 1280), fps (30), captions (true), tailMs (900), onProgress(text)
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.RecordVideo = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIMES = [
    ['video/mp4;codecs=avc1.42E01E', 'mp4'], ['video/mp4;codecs=avc1', 'mp4'], ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9', 'webm'], ['video/webm;codecs=vp8', 'webm'], ['video/webm', 'webm']
  ];

  function pickMimeType(isSupported) {
    for (var i = 0; i < MIMES.length; i++) {
      var ok = false;
      try { ok = !!isSupported(MIMES[i][0]); } catch (e) {}
      if (ok) return { mime: MIMES[i][0], ext: MIMES[i][1] };
    }
    return null;
  }

  function fileName(title, ext) {
    var base = String(title || 'flow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flow';
    return base + '.' + (ext || 'mp4');
  }

  function even(n) { n = Math.max(2, Math.round(n)); return n % 2 ? n + 1 : n; }

  /* Canvas size: `width` wide, the diagram keeps its aspect ratio (height capped), caption band below. */
  function frameSize(vw, vh, width, captionH) {
    var w = even(width || 1280), ratio = vw > 0 && vh > 0 ? vh / vw : 0.5625;
    var svgH = even(Math.min(w * ratio, w * 1.5));
    var cap = captionH > 0 ? even(captionH) : 0;
    return { w: w, h: svgH + cap, svgH: svgH };
  }

  /* Greedy word wrap; the last allowed line ends with an ellipsis when text is left over. */
  function wrapText(measure, text, maxW, maxLines) {
    var words = String(text || '').split(/\s+/).filter(Boolean), lines = [], cur = '', i = 0;
    for (; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (measure(t) <= maxW || !cur) { cur = t; continue; }
      if (lines.length + 1 >= maxLines) break;
      lines.push(cur); cur = words[i];
    }
    if (cur) lines.push(cur);
    if (i < words.length && lines.length) {
      var last = lines[lines.length - 1];
      while (last.length > 1 && measure(last + '…') > maxW) last = last.slice(0, -1);
      lines[lines.length - 1] = last.replace(/[\s.,;:]+$/, '') + '…';
    }
    return lines;
  }

  function supported(win) {
    if (!win || typeof win.MediaRecorder !== 'function') return null;
    return pickMimeType(function (m) { return win.MediaRecorder.isTypeSupported(m); });
  }

  /* One standalone SVG document for the current state of the diagram. */
  function svgMarkup(win, svg, css, w, h) {
    var doc = win.document, clone = svg.cloneNode(true);
    var cs = win.getComputedStyle(svg);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', w); clone.setAttribute('height', h);
    clone.removeAttribute('role');
    clone.style.width = ''; clone.style.minWidth = '';
    ['--bg', '--text', '--text2', '--edge', '--sel', '--hot', '--hot-d', '--done', '--ew'].forEach(function (v) {
      var val = cs.getPropertyValue(v);
      if (val) clone.style.setProperty(v, val.trim());
    });
    var style = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = css;
    clone.insertBefore(style, clone.firstChild);
    return new win.XMLSerializer().serializeToString(clone);
  }

  function record(win, host, opts) {
    opts = opts || {};
    var doc = win.document, kind = supported(win);
    var cancelled = false;
    var done = new Promise(function (resolve, reject) {
      if (!kind) { reject(new Error('This browser cannot record video (no MediaRecorder).')); return; }
      var svg = host.svg(), vb = (svg.getAttribute('viewBox') || '0 0 1000 560').split(/\s+/).map(Number);
      var scale = (opts.width || 1280) / 1280;
      var wantCap = opts.captions !== false && typeof host.caption === 'function';
      var size = frameSize(vb[2], vb[3], opts.width, wantCap ? 120 * scale : 0);
      var colors = host.colors(), css = host.css(), fps = opts.fps || 30, tail = opts.tailMs == null ? 900 : opts.tailMs;
      var canvas = doc.createElement('canvas'); canvas.width = size.w; canvas.height = size.h;
      var ctx = canvas.getContext('2d');
      var rec, chunks = [], img = new win.Image(), busy = false, finishing = false, t0 = 0, tEnd = 0, stopped = false;

      function fail(e) {
        if (stopped) return; stopped = true;
        try { host.restore(); } catch (x) {}
        try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (x) {}
        reject(e);
      }

      function drawCaption() {
        var y0 = size.svgH, pad = 16 * scale, fs = 20 * scale, font = 'system-ui, "Segoe UI", sans-serif';
        ctx.fillStyle = colors.card; ctx.fillRect(0, y0, size.w, size.h - y0);
        ctx.fillStyle = colors.text2; ctx.fillRect(0, y0, size.w, Math.max(1, scale));
        var entries = host.caption() || [], y = y0 + pad + fs, shown = 0;
        function measure(t) { return ctx.measureText(t).width; }
        for (var i = 0; i < entries.length && y < size.h - pad; i++) {
          ctx.fillStyle = colors.text; ctx.font = '600 ' + fs + 'px ' + font;
          ctx.fillText(wrapText(measure, entries[i].head, size.w - 2 * pad, 1)[0] || '', pad, y);
          y += fs * 1.35; shown++;
          if (entries[i].detail && y < size.h - pad) {
            ctx.fillStyle = colors.text2; ctx.font = '400 ' + (fs * 0.85) + 'px ' + font;
            ctx.fillText(wrapText(measure, entries[i].detail, size.w - 2 * pad, 1)[0] || '', pad, y);
            y += fs * 1.35;
          }
        }
        if (shown < entries.length) {
          ctx.fillStyle = colors.text2; ctx.font = '400 ' + (fs * 0.8) + 'px ' + font;
          ctx.fillText('+' + (entries.length - shown) + ' more', size.w - pad - 70 * scale, size.h - pad);
        }
      }

      function drawFrame() {
        var markup = svgMarkup(win, svg, css, size.w, size.svgH);
        var url = win.URL.createObjectURL(new win.Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
        img.src = url;
        return img.decode().then(function () {
          ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, size.w, size.h);
          ctx.drawImage(img, 0, 0, size.w, size.svgH);
          if (wantCap) drawCaption();
          win.URL.revokeObjectURL(url);
        }, function (e) {
          win.URL.revokeObjectURL(url);
          throw new Error('Could not render the diagram to an image' + (e && e.message ? ': ' + e.message : ''));
        });
      }

      function finish() {
        if (stopped) return;
        rec.onstop = function () {
          if (stopped) return; stopped = true;
          try { host.restore(); } catch (e) {}
          if (cancelled) { reject(new Error('cancelled')); return; }
          resolve({ blob: new win.Blob(chunks, { type: kind.mime.split(';')[0] }), mime: kind.mime, ext: kind.ext, ms: Math.round(win.performance.now() - t0) });
        };
        try { rec.stop(); } catch (e) { fail(e); }
      }

      function tick() {
        if (stopped || finishing) return;
        if (cancelled) { finishing = true; finish(); return; }
        busy = true;
        drawFrame().then(function () {
          busy = false;
          if (opts.onProgress && host.progress) opts.onProgress(host.progress());
          var now = win.performance.now();
          if (host.done() && !tEnd) tEnd = now;
          if (tEnd && now - tEnd >= tail) { finishing = true; finish(); return; }
          win.setTimeout(function () { win.requestAnimationFrame(tick); }, Math.max(0, 1000 / fps - 5));
        }).catch(fail);
      }

      try {
        var stream = canvas.captureStream(fps);
        rec = new win.MediaRecorder(stream, { mimeType: kind.mime, videoBitsPerSecond: opts.bitrate || 8000000 });
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onerror = function (e) { fail(e.error || new Error('recording failed')); };
        host.prepare();
        // First frame before the recorder starts so the file does not open on black.
        drawFrame().then(function () {
          t0 = win.performance.now();
          rec.start(250);
          win.requestAnimationFrame(tick);
        }).catch(fail);
      } catch (e) { fail(e); }
    });
    return { done: done, cancel: function () { cancelled = true; } };
  }

  return { pickMimeType: pickMimeType, fileName: fileName, frameSize: frameSize, wrapText: wrapText, supported: supported, svgMarkup: svgMarkup, record: record };
});
