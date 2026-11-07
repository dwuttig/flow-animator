# Plan: Editor mode

- Status: draft
- Spec: `docs/features/editor-mode.md`
- Bounded context / slice(s): Flow Library `apply-edit` (upstream of the editor); Playback `edit-flow`

## Approach
Edits already exist in `flow-store.js` mixed with file access. Extract them unchanged into the pure slice `src/flow-library/apply-edit/apply-edit.js` (UMD: Node and browser). `flow-store.js` and the editor both call it, so rules for "what an Edit does" live once. Validation is never copied: the editor calls `FlowCore.loadDoc` (Flow Modeling) on every result.

The editor slice `src/playback/edit-flow/edit-flow.js` is browser only and builds the panel with DOM calls. It owns the Draft, the undo/redo stacks and the forms; it talks to the viewer through a small host object (`getText`, `show`, `jumpToStep`, `report`) so it does not reach into viewer internals.

Dependency rule: Playback may call Flow Library's pure `apply-edit` public API only (architecture.md updated). Alternative rejected: re-implement Edits in the browser (two sources of truth), or give the viewer a server round trip (needs a backend the viewer does not have).

## Steps
1. [x] Flow Library: extract `ops` from `flow-store.js` into `apply-edit`, add `apply(doc, op, args)` returning a copy. Tests in `src/flow-library/apply-edit/apply-edit.test.js`.
2. [x] Playback: `edit-flow` slice (Draft, commit with validation, undo/redo, forms, download/copy).
3. [x] `index.html`: script tags, Edit button, panel mount, host object, `FlowAnimator.edit`.
4. [x] Distribution: standalone bundler inlines the new scripts; Dockerfile copies `src/` into both images.
5. [x] Docs: architecture edge, glossary, README, CHANGELOG.

## Files touched
`flow-store.js`, `index.html`, `build-standalone.js`, `Dockerfile`, `README.md`, `CHANGELOG.md`, `docs/architecture.md`, `docs/ubiquitous-language.md`, new `src/flow-library/apply-edit/`, `src/playback/edit-flow/`, `test/editor.test.js`.

## Risks
- Re-rendering the panel after each commit loses input focus; mitigated by committing on change, not on keystroke.
- A load from `?watch=1` would overwrite the Draft; the editor ignores reloads when it has unsaved Edits.
- Docker images forget `src/`: check both builds.

## Verification
- `node --test` (apply-edit unit tests, editor flow in a DOM-less harness, MCP tests unchanged)
- Playwright: open `index.html`, toggle Edit, add a Node and a Step, undo, check console clean
- `node build-standalone.js examples/order-flow.flow.json /tmp/o.html` and open offline

## Changelog entry
Editor mode in the viewer: edit meta, Groups, Nodes and Steps with live validation, undo/redo, download or copy the result. Edits now live in a shared `apply-edit` module used by the editor and the MCP server.
