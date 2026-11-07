# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Editor mode layout: the editing panel is now a left column next to the animated flow (right column) instead of stacked above it, and Group, Node and Step rows use a 12-column grid so labels, inputs, selects and buttons line up (stacked on screens narrower than 960px).
- Docker: `/` returned 404 because the nginx `try_files` did not fall back to `index.html`.

### Changed
- Project now follows Domain-Driven Design: bounded contexts and vertical slices documented in `docs/architecture.md` and `docs/ubiquitous-language.md`; agents, spec and plan templates updated. Code restructuring is proposed in `docs/features/ddd-restructure.md`.

### Added
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
