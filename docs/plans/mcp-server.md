# Plan: MCP server for creating and editing flows

- Status: done
- Spec: `docs/features/mcp-server.md`

## Approach
Add `mcp-server.js`, a Node script with no dependencies that speaks MCP (newline-delimited JSON-RPC 2.0) on stdio. A small `flow-store.js` module does the file work (path confinement, read, validate through `flow-core.js`, atomic write via temp file and rename) and the pure edit operations, so they can be tested without MCP. Alternative considered: the official SDK; deferred to Daniel because it breaks the "no dependencies, no build" rule.

Each edit tool: load the file, apply the change to the parsed document, run `FlowCore.loadDoc`, write only if there are no errors, return warnings.

## Steps
1. [x] Confirm dependency choice with Daniel.
2. [x] `flow-store.js`: resolve/confine paths under `FLOW_DIR`, `readFlow`, `writeFlow` (validate then atomic write), list.
3. [x] Edit operations (meta, groups, nodes, steps) as pure functions on the document, with clear errors (unknown id, index out of range, id exists).
4. [x] `mcp-server.js`: JSON-RPC framing, `initialize`, `tools/list`, `tools/call`, `resources/list|read`, error mapping (tool errors as `isError` results).
5. [x] Tests with `node:test` (`test/`): store, operations, and an end-to-end stdio session. Add `npm`-free run command `node --test`.
6. [x] README section "MCP server": client config snippet and tool list.
7. [x] Coordinate with the Docker thread: image includes `mcp-server.js`, `flow-store.js`, `flow-core.js`, `flow.schema.json`; entrypoint option `mcp`; `/flows` volume.
8. [x] CHANGELOG entry.

## Files touched
- new: `mcp-server.js`, `flow-store.js`, `test/*.test.js`
- changed: `README.md`, `CHANGELOG.md`, `Dockerfile` (new `mcp` stage), `docker-compose.yml`, `.dockerignore`

## Risks
- Path traversal or writes outside `FLOW_DIR`: mitigate by resolving and checking the prefix, accept only `*.flow.json`.
- Hand-rolled protocol drifting from the MCP spec: pin the protocol version we implement and cover with an end-to-end test.
- Concurrent edits from viewer and agent: last write wins; atomic rename avoids partial files.

## Verification
- `node --test`
- `printf` an `initialize` plus `tools/list` request into `node mcp-server.js` and check the reply.
- Create a flow via tools, then `node validate.js` it and open it in the viewer.

## Changelog entry
- MCP server (`mcp-server.js`) with tools to create, read, edit and validate flow files.
