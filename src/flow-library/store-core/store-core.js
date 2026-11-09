/*
 * store-core: behaviour shared by every Flow store (folder and SQLite): Revisions,
 * validation, preconditions and Edits. Node only, no dependencies. Validation is
 * delegated to flow-core.js so the server and the viewer always agree.
 */
'use strict';
var crypto = require('crypto');
var Core = require('../../../flow-core.js');
var Edits = require('../apply-edit/apply-edit.js');
var FlowName = require('../flow-name/flow-name.js');

var fail = Edits.fail;

/* Revision: first 16 hex chars of the SHA-256 of the stored bytes. */
function revisionOf(raw) { return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16); }

/* Bare, valid Flow name ("orders"; a trailing ".flow.json" is stripped) or a userError. */
function validName(name) {
  if (typeof name !== 'string' || !name) throw fail('flow name must be a non-empty string');
  var n = FlowName.bare(name);
  if (!FlowName.isValid(n)) throw fail('flow name must be 1-100 letters, digits, dot, dash or underscore, starting with a letter or digit, e.g. "orders"');
  return n;
}

function stats(res) {
  return {
    nodes: res.model.nodes.length, steps: res.model.steps.length,
    beats: res.model.beats.length, groups: res.model.groups.length
  };
}

function validate(doc) {
  var res = Core.loadDoc(doc);
  return { ok: res.ok, errors: res.errors, warnings: res.warnings, stats: res.ok ? stats(res) : null };
}

/* Check a precondition: opts.ifMatch (revision) or opts.ifNoneMatch === '*'. */
function checkPrecondition(store, name, opts) {
  opts = opts || {};
  var cur = store.revision(name);
  if (opts.ifNoneMatch === '*' && cur !== null) return { ok: false, conflict: true, revision: cur };
  if (opts.ifMatch !== undefined && opts.ifMatch !== null && opts.ifMatch !== cur) return { ok: false, conflict: true, revision: cur };
  return null;
}

/* Load, apply one operation, validate, write only if valid. */
function edit(store, name, op, args, opts) {
  if (!Edits.has(op)) throw fail('unknown operation ' + op);
  var doc = store.read(name);
  Edits.ops[op](doc, args || {});
  var r = store.write(name, doc, opts);
  if (!r.ok) r.note = 'Change rejected; the file was not modified.';
  if (r.conflict) r.error = 'conflict: the flow changed since revision ' + (opts && opts.ifMatch) + '; read it again.';
  return r;
}

/* Title and node/step counts of a stored body, as shown by list(). */
function summary(doc) {
  return { title: (doc && doc.title) || null, nodes: doc && Array.isArray(doc.nodes) ? doc.nodes.length : 0, steps: doc && Array.isArray(doc.steps) ? doc.steps.length : 0 };
}

module.exports = {
  revisionOf: revisionOf, validName: validName, stats: stats, validate: validate, checkPrecondition: checkPrecondition,
  edit: edit, summary: summary, fail: fail, loadDoc: Core.loadDoc, ops: Edits.ops, SUFFIX: FlowName.SUFFIX
};
