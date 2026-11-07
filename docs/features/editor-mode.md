# Editor mode

- Status: accepted
- Plan: `docs/plans/editor-mode.md`
- Bounded context: Playback (browser UI), using the pure Edit engine of Flow Library
- Slice(s): `edit-flow` (new, Playback); `apply-edit` (new, Flow Library)

## Problem
People can only view a Flow. To change one they must hand-edit JSON or ask an agent over MCP. Small fixes (rename a Node, reorder a Step) should be possible in the viewer, with the animation updating immediately.

## Goals
- A toggle in the viewer opens an editor panel next to the diagram.
- Edit meta (title, description, direction), Groups, Nodes and Steps with forms; no coordinates, ever.
- Every change is an **Edit** applied to a **Draft** and validated by Flow Modeling before it is shown. Invalid Edits are rejected with Violations and the Draft stays as it was.
- Undo and redo of Edits.
- Leave the editor with the result: download the `*.flow.json` or copy the JSON.
- One implementation of Edits: the MCP server and the editor share `apply-edit`.

## Non-goals
- No drag-and-drop positioning; Layout stays automatic.
- No saving to the server or Docker volume (nginx serves static files). Agents use MCP for that; people download the file.
- No multi-user editing, no history beyond the session.
- No change to the file format.

## Behaviour
- Header gets an **Edit** button. On, the panel shows Flow, Groups, Nodes and Steps sections, plus Undo, Redo, Download, Copy JSON.
- Text fields commit on change (blur or Enter). Selects, checkboxes and buttons commit immediately.
- Nodes: add, edit label/subtitle/group/shape, rename id (Steps follow), remove (removes its Steps after confirmation).
- Steps: add, edit from/to/label/detail/payload/kind/together, move up/down, remove. Selecting a Step row jumps Playback to its Beat.
- Groups: add, edit label/color, remove (Nodes are ungrouped).
- Violations from a rejected Edit are shown in the existing issues box; the diagram keeps the last valid Draft.
- Playback pauses while editing and resumes on request. Loading another Flow replaces the Draft (a confirm appears if there are unsaved Edits).
- `window.FlowAnimator.edit(op, args)` exposes the same Edits to scripts and tests.

## Domain language
New terms: **Editor mode**, **Draft** (the Flow being edited in the browser, not yet downloaded). Added to `docs/ubiquitous-language.md`. **Edit** is reused from Flow Library.

## File-format impact
None.

## Open questions
- Optional write-back to the Flow store over HTTP (a small `PUT /flows/<name>` on the MCP server) if downloading proves too clumsy.
