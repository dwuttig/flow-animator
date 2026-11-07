# Plan: Editor mode

- Status: draft
- Spec: `docs/features/editor-mode.md`

## Approach
Keep the no-build, no-dependency rule. The editor works on the **raw flow document** (a plain JS object), not on the normalized model, so unknown fields survive. Every edit produces a new document, pushes the old one on an undo stack, then re-runs `FlowCore.loadDoc()` and re-renders. The viewer's render path is reused unchanged; the editor only adds overlays (selection, drag handles, grid hint) and an editing panel.

Code layout:
- `flow-edit.js` (new): pure, DOM-free operations on the raw document (`addNode`, `renameNode` with step rewrite, `deleteNode`, `moveNode`, `addStep`, `moveStep`, `setGroup`, ...) plus the undo/redo history. Testable in Node, UMD like `flow-core.js`.
- `index.html`: editor UI (toolbar toggle, side panel, drag handling, validation panel) that calls `flow-edit.js`.
- `build-standalone.js`: inline `flow-edit.js` next to `flow-core.js`.

Alternatives not chosen: a separate `editor.html` (duplicates rendering and splits maintenance); free x/y positions (format change, conflicts with grid layout).

## Steps
1. [ ] Create `flow-edit.js` with pure document operations and history (undo/redo, max 100), including renaming a node id and rewriting `steps[].from/to`, and deleting a node with its steps.
2. [ ] Add node-drag math: pointer position to snapped `col`/`row` using the geometry from `FlowCore.layout`; reject occupied cells; handle `TB` direction (col/row meaning swaps).
3. [ ] Add Node tests (`node --test`) for `flow-edit.js`: every operation yields a document that still passes `FlowCore.validate`, unknown fields are preserved, undo/redo round-trips.
4. [ ] Viewer: Edit toggle (button, key `E`), side panel layout, selection state, and re-render hook that keeps selection and playback position.
5. [ ] Viewer: node and step forms (label, subtitle, shape, group; step fields), add/duplicate/delete buttons.
6. [ ] Viewer: drag nodes with snap-to-grid and grid highlight; "Reset position" and "Reset layout".
7. [ ] Viewer: connector handle and drag-to-create-step; step list drag-reorder (pointer and keyboard alternative: move up/down buttons).
8. [ ] Viewer: groups editor (create, rename, colour, assign, delete).
9. [ ] Viewer: live validation panel based on `FlowCore.validate`, with click-to-select.
10. [ ] Save: download via Blob, File System Access API (`showSaveFilePicker`) when available; pretty-print with 2 spaces; dirty flag; `beforeunload` and load-confirmation prompt; undo/redo keys.
11. [ ] Watch mode: stop polling while editing, show notice, resume on leaving edit mode (reload only if not dirty). Extend `FlowAnimator.state()` with `editing` and `dirty`.
12. [ ] `build-standalone.js`: inline `flow-edit.js`; fail clearly if the script tag is missing.
13. [ ] Docs: README (viewing and editing section, files table, page API), schema unchanged, CHANGELOG, set spec status to `accepted`/`implemented`.

## Files touched
- `flow-edit.js` (new)
- `tests/flow-edit.test.js` (new)
- `index.html`
- `build-standalone.js`
- `README.md`, `CHANGELOG.md`
- `docs/features/editor-mode.md` (status)

## Risks
- `index.html` is about 560 lines of dense inline script; the editor roughly doubles it. Mitigate by keeping logic in `flow-edit.js` and the UI code in a clearly separated block.
- `FlowCore.normalize` may drop unknown properties; the editor must keep the raw doc as the source of truth and never export the normalized model.
- Renaming a node id must rewrite steps and any `col`/`row` collisions must be re-checked; covered by tests.
- Drag handling on SVG with `viewBox` scaling: convert pointer coordinates correctly or snapping will be off.
- Accessibility: drag-only interactions need keyboard alternatives (reorder buttons, form fields for `col`/`row`).
- Standalone files become editable: recipients may export changed copies. Accepted by design.
- The File System Access API is Chromium-only; the download fallback must always work.

## Verification
- `node --test tests/` passes (new tests for `flow-edit.js`).
- `node validate.js` on a flow exported after edits reports `OK`, and `examples/order-flow.flow.json` round-trips with no diff when nothing was changed.
- Manual in the viewer (Chrome and Firefox): drag a node and confirm only its `col`/`row` change; create a step by dragging; reorder steps; delete a used node (confirmation, steps removed); undo/redo through all of these; unsaved-changes prompt; `?watch=1` pauses while editing.
- `node build-standalone.js examples/order-flow.flow.json out.html`, open `out.html` from `file://`, edit and save.
- Check dark mode and `prefers-reduced-motion`.

## Changelog entry
- Editor mode in the viewer: edit nodes, steps and groups, drag nodes to position (stored as `col`/`row`), create and reorder steps, undo/redo, live validation, save as file. Included in standalone bundles.
