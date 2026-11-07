# Flow menu

- Status: implemented
- Plan: none (small, UI only)
- Bounded context: Playback (uses Flow Library's HTTP API through `flow-gateway`)
- Slice(s): `flow-menu` (replaces `pick-flow`), `export-flow`, `mcp-config`

## Problem
The header had four separate buttons plus a dropdown, and no way to start a new Flow, delete or share a stored one, export it, or find out how to connect an AI agent over MCP.

## Goals
- One **Flow** menu in the header with every flow-level action.
- Copy-ready MCP client configuration.

## Non-goals
- No new server endpoints; Delete and Share use the existing Flow API.
- Edit stays its own header button (it is a mode, not an action).

## Behaviour
- **Stored flows**: list from `GET /api/flows` (static listing fallback). Selecting one opens it; the open one is marked. Hidden when no list exists.
- **Open file / Paste JSON / Built-in example**: as before; all ask before discarding unsaved edits.
- **New flow**: loads a minimal two-Node Flow as a local Draft and turns on editor mode. Store it with Save as.
- **Share flow (copy link)**: copies `<viewer URL>?flow=<name>`. Enabled only for a stored Flow when the Flow API is available.
- **Delete flow**: confirms, then `DELETE /api/flows/<name>` with `If-Match` the loaded Revision (a changed Flow is not deleted). Afterwards the built-in example is shown. Same enabling rule as Share.
- **Export flow**: *Download JSON* saves the shown Flow text; *Download standalone HTML* fetches the viewer's own files and inlines them with the Flow (same result as `build-standalone.js`). Needs the viewer served over http.
- **MCP config**: dialog with a stdio-via-Docker tab (`docker run -i --rm -v <folder>:/flows flow-animator-mcp:latest node mcp-server.js`; the folder is typed in) and an HTTP tab (`http://<host>:8081/mcp`, optional `Authorization: Bearer <token>`). Each shows the JSON for `mcpServers` and a `claude mcp add` command, with Copy buttons.
- Keyboard: Down opens, arrows/Home/End move, Escape closes.

## Domain language
None.

## File-format impact
None.

## Open questions
- The MCP dialog assumes the default image name and port 8081; both are fixed in `docker-compose.yml`.
