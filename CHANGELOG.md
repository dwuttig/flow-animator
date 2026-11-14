# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Flow menu > Export flow... > **PowerPoint slide (.pptx)** and MCP tool `export_pptx`: one native, editable slide whose click-driven animation plays the Flow Beat by Beat. The viewer export keeps your line thickness, step style, labels on/off and Step label placement.
- Viewer: **Ctrl + mouse wheel** zooms and **Ctrl + left-drag** pans the diagram; the plain wheel scrolls the page.
- View panel: **Optimize layout** reorders nodes within their columns to reduce edge crossings and edges through nodes, and places step labels with less overlap; **Node spacing** (0.5x to 3x) scales the gaps between nodes. Both are viewer-only settings and are remembered.
- Playback: **Download SVG** in the Flow menu (Export).

### Fixed
- Docker: the `mcp` image crashed on start (`MODULE_NOT_FOUND`) and the viewer lost its Flow menu because the new `src/` modules were neither copied nor loaded by the page.
- Standalone bundle and browser export read the page's own script list, so new slices can no longer be missing from the bundle.
- MCP: tool schemas no longer put `null` in `enum` lists (strict clients rejected the whole tool list); clearing a field with null still works. MCP config dialog uses `docker.exe` on Windows (CreateProcess error 193).
- Editor mode layout: the editing panel is now a left column next to the animated flow (right column) instead of stacked above it, and Group, Node and Step rows use a 12-column grid so labels, inputs, selects and buttons line up (stacked on screens narrower than 960px).
- Docker: `/` returned 404 because the nginx `try_files` did not fall back to `index.html`.
- `set_meta` no longer wipes `layout.connection`; editor Copy JSON and Remove node no longer raise `ReferenceError`; rejected edits reset the form; edits reset pan/zoom correctly; and Tab focus is restored.

### Changed
- Viewer layout: the page is centered with a 1440px maximum width and all sections share the same width; the diagram scales to that width but never below 90% of its natural size (wide flows scroll horizontally and follow the active step); the step details panel has a fixed height (scrolls); control alignment fixed.
- **Flow names have no `.json` suffix**: Save as asks only for a unique name (a typed `.flow.json` is stripped), the picker, `?flow=` links, `/api/flows/<name>` and MCP show bare names; the old `name.flow.json` form is still accepted, and SQLite databases created earlier are migrated. Names are unique ignoring case. Downloads are still `.flow.json` files.
- **Default flow storage is now SQLite** (`node:sqlite`, no new dependency; Docker volume `flow-animator-data`, `/data/flows.db`). Set `FLOW_STORE=files` for the old folder of `*.flow.json`. The MCP config dialog's stdio command now mounts that volume instead of the flows folder.
- `build-standalone.js` now shares its bundling code with the viewer's export (`src/playback/export-flow/`) and works with CRLF checkouts. The `pick-flow` slice is replaced by `flow-menu`.
- Project now follows Domain-Driven Design: bounded contexts and vertical slices documented in `docs/architecture.md` and `docs/ubiquitous-language.md`; agents, spec and plan templates updated. The code now follows it: Playback is split into slices (`play-flow`, `render-diagram`, `view-options`, `dialogs`, `viewer` wiring, ...), `index.html` holds only markup, styles and the built-in example, and `test/architecture.test.js` enforces the dependency rule (see `docs/features/ddd-restructure.md`).
- File-store name lookup is case-insensitive and names are trimmed. MCP tool list order changed, and open SSE connections delay server close.

### Performance
- Each edit performs one validation/layout pass; edges are no longer resampled. Animation uses `requestAnimationFrame` only while playing, and model step/beat and node maps speed playback and lookup.
- SQLite list columns and a prepared-statement cache reduce storage overhead; live watch uses SSE instead of polling when available.

### UX
- The View ▾ toolbar keeps zoom controls above the stage without covering Nodes, with Flow default options, remembered orientation, SVG export, editor drag-and-drop reorder, + After, Connections, styled confirmation dialogs and restored focus.

### Extensibility
- Operation descriptors drive MCP tools; Modeling and Layout registries centralize kind and shape metadata; the migration hook, Revision history, PATCH API and SVG export are public extension points.

### Maintainability
- Modeling, Layout, Playback and Flow Library were split into vertical slices, including `store-core` and `flow-name`. Standalone/export script manifests come from page tags, package scripts document supported commands, and the MCP store is lazy-loaded.

### Added
- **Step labels on connections**: each Step's label is drawn next to its connection line at all times (placed to avoid nodes and other labels); the active Step's label is highlighted (bold, no background box). A **Labels** checkbox in the View panel hides them (remembered). Labels also appear in the recorded video. See `docs/features/step-labels.md`.
- **Record video for PowerPoint**: Flow menu > Export flow... > Record video saves the animation (one pass, with a caption band for each Step) as an MP4 (WebM where the browser cannot record MP4) to insert via Insert > Video > This Device. See `docs/features/record-video.md`.
- **View panel**: one panel beside the diagram (stacked below it on narrow windows or while editing) holds playback (Restart, Prev, Play, Next, scrubber, Speed, Loop, Trail), display (Orientation, Connections, Step style, Labels, Thickness) and zoom (+, −, Reset, Maximize, Fullscreen), in labelled, aligned sections. Hide/Show collapses it and is remembered. The old controls row, options row and top-right bar are removed. See `docs/features/view-panel.md`.
- UI style guide (`docs/style-guide.md`) with spacing, radius, control-height and font tokens; buttons, selects, inputs and editor fields now share one control height and radius.
- Viewer: **Maximize/Minimize** (key `M`) and **Fullscreen** (key `F`) for the visualization; an overlay at the top right of the diagram holds the **Orientation** (Horizontal/Vertical) and Maximize controls. An options row adds **Connections** (Auto, Bezier, Linear, Orthogonal), **Step style** (By kind, Solid, Dashed, Dotted) and a line **Thickness** slider (remembered in the browser, except orientation).
- Flow format: optional `layout.connection` (`auto`, `bezier`, `linear`, `orthogonal`); `FlowCore.layout(model, {direction, connection})` accepts overrides.
- Editor: steps can be edited as a **Sentence** (Outlook rule style: click an underlined node, kind, label, detail or payload to change it); a **Fields | Sentence** toggle above the steps remembers the choice.
- Editor: the step's "Together" checkbox is now a **Together with** multi-select of other steps (new `set_parallel` edit and MCP tool). The file format is unchanged (`together` flags), so existing flows work as before.
- SQLite-backed Flow store (`src/flow-library/sqlite-store/`) behind the same interface: transactional Revision checks, one-time import of existing `*.flow.json` on first start (`FLOW_IMPORT=0` to skip), and `node mcp-server.js --import [dir]` (see `docs/features/sqlite-storage.md`).
- Header **Flow menu** (replaces Open file / Paste JSON / Built-in example and the stored-flows dropdown): stored flows, Open file, Paste JSON, Built-in example, New flow, Share flow (copies a `?flow=` link), Delete flow, Export flow (download JSON or a standalone HTML built in the browser) and an MCP config dialog with copy-ready JSON and a `claude mcp add` command for stdio via Docker and HTTP on :8081 with an optional token (see `docs/features/flow-menu.md`).
- Flow storage and loading: stored flows get a Revision (content hash); HTTP Flow API (`GET/PUT/DELETE /api/flows[/name]`, ETag, `If-Match`, `If-None-Match: *`) on the MCP server; `expected_revision` and `read_flow` `with_revision` in the MCP tools; viewer flow picker, `?flow=name` links (also with `watch`), and Save / Save as / Reload in editor mode with conflict detection; nginx proxies `/api/` (see `docs/features/flow-storage.md`).
- Editor mode in the viewer (**Edit** button): change title, Groups, Nodes and Steps with forms, live validation, undo/redo, download or copy the result. Edits live in the shared `src/flow-library/apply-edit/` module, now also used by the MCP server (see `docs/features/editor-mode.md`).
- Docker deployment: `Dockerfile`, `docker-compose.yml`, nginx config; `./flows` volume for user flows (see `docs/features/docker-deployment.md`).
- MCP server (`mcp-server.js`, stdio and HTTP) with tools to create, read, validate and edit flow files; `mcp` service in `docker-compose.yml` (see `docs/features/mcp-server.md`).
- Claude Code subagents in `.claude/agents/`: software-engineer, architect, deployment, tester.
- `CHANGELOG.md` to track changes.
- `docs/features/` for feature specs and `docs/plans/` for implementation plans, each with a template.

## [0.1.0] - 2026-11-07

### Added
- Initial viewer (`index.html`), shared core (`flow-core.js`), JSON schema, CLI validator, standalone bundler and an example flow.
