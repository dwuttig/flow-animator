/*
 * flow-name: rules for Flow names (Flow Library context, slice flow-name).
 * No dependencies: used by the Flow stores and the MCP server in Node and by
 * Playback in the browser (global FlowName).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlowName = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var SUFFIX = '.flow.json';
var NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/* Trimmed name without a trailing ".flow.json" (any case); '' for non-strings. */
function bare(name) {
  if (typeof name !== 'string') return '';
  var n = name.trim();
  return n.slice(-SUFFIX.length).toLowerCase() === SUFFIX ? n.slice(0, -SUFFIX.length) : n;
}

/* True if the bare name is 1-100 letters, digits, dot, dash or underscore, starts with a letter or digit and does not end in .json. */
function isValid(name) {
  var n = bare(name);
  return NAME_RE.test(n) && !/\.json$/i.test(n);
}

/* A valid name derived from a title, e.g. "Order Checkout" -> "order-checkout"; 'flow' if nothing is left. */
function slug(title) {
  var s = String(title == null ? '' : title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  s = s.slice(0, 100).replace(/-+$/, '');
  return s || 'flow';
}

return { SUFFIX: SUFFIX, NAME_RE: NAME_RE, bare: bare, isValid: isValid, slug: slug };
});
