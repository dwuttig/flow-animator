# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- MCP: tool schemas no longer put `null` in `enum` lists (strict clients rejected the whole tool list); clearing a field with null still works. MCP config dialog uses `docker.exe` on Windows (CreateProcess error 193).
- Editor mode layout: the editing panel is now a left column next to the animated flow (right column) instead of stacked above it, and Group, Node and Step rows use a 12-column grid so labels, inputs, selects and buttons line up (stacked on screens narrower than 960px).
- Docker: `/` returned 404 because the nginx `try_files` did not fall back to `index.html`.

### Changed
- Viewer layout: the page is centered with a 1440px maximum width and all sections share the same width; the diagram scales to that width but never below 90% of its natural size (wide flows scroll horizontally and follow the active step); the step details panel has a fixed height (scrolls); control alignment fixed.
- **Flow names have no `.json` suffix**: Save as asks only for a unique name (a typed `.flow.json` is stripped), the picker, `?flow=` links, `/api/flows/<name>` and MCP show bare names; the old `name.flow.json` form is still accepted, and SQLite databases created earlier are migrated. Names are unique ignoring case. Downloads are still `.flow.json` files.
- **Default flow storage is now SQLite** (`node:sqlite`, no new dependency; Docker volume `flow-animator-data`, `/data/flows.db`). Set `FLOW_STORE=files` for the old folder of `*.flow.json`. The MCP config dialog's stdio command now mounts that volume instead of the flows folder.
- `build-standalone.js` now shares its bundling code with the viewer's export (`src/playback/export-flow/`) and works with CRLF checkouts. The `pick-flow` slice is replaced by `flow-menu`.
- Project now follows Domain-Driven Design: bounded contexts and vertical slices documented in `docs/architecture.md` and `docs/ubiquitous-language.md`; agents, spec and plan templates updated. Code restructuring is proposed in `docs/features/ddd-restructure.md`.

### Added
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
