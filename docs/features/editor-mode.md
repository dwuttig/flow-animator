# Editor mode

- Status: proposed
- Plan: `docs/plans/editor-mode.md`

## Problem
Flow files are written by AI agents, but people often need to make small corrections afterwards: rename a node, fix a payload, move a box that the automatic layout placed badly, add a missing step. Today that means hand-editing JSON (`col`/`row` included) in a text editor and reloading. This is slow and error-prone for people who did not write the file, and it is the main reason to re-run an agent for a one-word change.

## Goals
- Edit a loaded flow in the same page: an **Edit** toggle in `index.html` switches between view and edit; the animation can still be played while editing.
- Edit **nodes**: add, rename, change subtitle, shape and group, duplicate, delete.
- Edit **steps**: form for `label`, `detail`, `payload`, `kind`, `from`, `to`, `together`; add, duplicate, delete.
- **Create a step by dragging** from one node to another (`from`/`to` prefilled, then the form opens).
- **Reorder steps** by dragging in the step list (changes animation order).
- **Edit groups**: create, rename, delete, set colour, assign nodes.
- **Drag nodes** to reposition. Positions snap to the existing column/row grid and are stored as `col`/`row` on the moved nodes only.
- **Undo / redo** (Ctrl+Z / Ctrl+Y) over every edit.
- **Live validation panel** showing the same errors and warnings as `validate.js` (same `flow-core.js`).
- **Save** as a download (`<name>.flow.json`); use the File System Access API to save in place where the browser supports it. Works from `file://`, no server.
- **Unsaved-changes warning** before closing the page or loading another flow.
- **Round-trip unknown fields** (`$schema`, future properties) on export, so editing never silently drops data.
- The standalone bundle (`build-standalone.js`) **includes the editor**, so recipients can edit and re-export.

## Non-goals
- Free pixel positioning or new `x`/`y` fields; layout stays grid based.
- Writing back to disk through a server, or any install or build step.
- Multi-user or collaborative editing.
- Editing more than one flow at a time, or merging flows.
- Replacing agents as the main authors: the editor is for corrections, not for drawing from scratch.

## Behaviour
- **Entering edit mode**: the **Edit** button (and key `E`) shows an editing side panel as a left column (sticky, scrolls on its own) with the animated flow in a right column; on narrow screens (<960px) the panel stacks above the flow. Inputs and selects sit in fixed grid columns so rows line up and makes nodes draggable and selectable. Pressing it again returns to the pure viewer. The loaded flow is the starting point; an empty "New flow" is also offered.
- **Selecting**: click a node or an arrow on the canvas, or a step in the list. The panel shows a form for the selection. Changes apply immediately and redraw the diagram.
- **Dragging a node**: while dragging, a snapped grid cell is highlighted. On drop, `col`/`row` are set on that node (and only that node). If the target cell is occupied, the drop is rejected with a short notice (two nodes may not share a `col`/`row`). A "Reset position" action removes `col`/`row` from a node, and "Reset layout" removes them from all nodes.
- **Dragging between nodes** (from a connector handle on a node to another node, or to itself for a self-call) appends a step after the currently selected step (or at the end) and opens its form.
- **Deleting a node** that is used by steps asks for confirmation and removes those steps as well; the confirmation states how many steps go. Deleting a group clears `group` on its nodes.
- **Validation panel**: lists errors and warnings with JSON paths; clicking one selects the offending node or step. Invalid intermediate states are allowed while typing; Save warns when errors exist but does not block, and never writes anything the user did not ask for.
- **Playback while editing**: Play, scrub and step controls keep working on the current edited state. Edits reset playback to the selected step.
- **Watch mode**: with `?watch=1`, file polling is **paused while in edit mode** so external changes cannot overwrite edits. A small notice says "Watching paused while editing".
- **Page API**: `FlowAnimator.load()` while editing with unsaved changes replaces the flow like today (agent-driven use is unchanged); the unsaved-changes warning applies only to user-initiated loads. `FlowAnimator.state()` additionally reports `{ editing, dirty }`.

Example: dragging "Orders DB" to column 3, row 1 only changes that node:

```json
{ "id": "db", "label": "Orders DB", "shape": "database", "col": 3, "row": 1 }
```

## File-format impact
None. Editor mode only reads and writes existing fields (`col`, `row`, `group`, `groups`, and so on). Files produced by the editor stay valid `flow-animator/1`. Output is pretty-printed with 2 spaces and key order preserved where possible, so diffs stay small.

## Open questions
- Should "dragging between nodes" be the only way to create a step, or also an "Add step" button in the list? (Spec assumes both.)
- Adding a node: from a toolbar button with a form, or double-click on the empty canvas?
- When a dragged node's target cell is occupied, reject (assumed above) or swap/push the other node?
- Do we need touch support (drag on tablets)?
- Maximum undo history depth (suggest 100 entries)?
- How is "Save in place" remembered across reloads, or is it per session only?
