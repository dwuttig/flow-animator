# MCP server for creating and editing flows

- Status: implemented
- Plan: `docs/plans/mcp-server.md`

## Problem
AI agents currently write whole `*.flow.json` files by hand and then run `validate.js`. Small edits (add a step, rename a node) mean rewriting the file, and mistakes are only caught after the fact. Agents that speak MCP should be able to create and edit flows through typed tools that validate every change.

## Goals
- An MCP server, `mcp-server.js`, that exposes tools to create, read, edit and validate flow files in one directory.
- Reuse `flow-core.js` for all validation, so the server and viewer can never disagree.
- Every write is validated first; invalid edits are rejected with the same path/message errors as `validate.js`, and the file on disk is left untouched.
- Agents never specify coordinates (same rule as the file format).
- Runs from the Docker image (see the deployment thread): `docker run -i -v ./flows:/flows flow-animator mcp`.

## Non-goals
- No change to the file format or the viewer.
- No authentication, multi-user locking or remote file access. The server edits a local directory.
- No rendering or screenshots.

## Behaviour
Configuration: env `FLOW_DIR` (default `./flows`, `/flows` in Docker). All file names are relative to it, must end in `.flow.json`, and path traversal is rejected.

Tools (all return the validation result; mutations also return the new stats):

| Tool | Purpose |
|---|---|
| `list_flows` | File names with title, node and step counts |
| `read_flow` | Full JSON of one flow |
| `create_flow` | New file from a complete document; fails if it exists unless `overwrite: true` |
| `validate_flow` | Validate a file or an inline document without writing |
| `set_meta` | Change title, description, layout direction |
| `add_group`, `update_group`, `remove_group` | Manage groups |
| `add_node`, `update_node`, `remove_node` | Manage nodes; `remove_node` refuses if steps reference it unless `cascade: true` |
| `add_step`, `update_step`, `remove_step`, `move_step` | Manage steps by 0-based index; `add_step` takes optional `at` |
| `delete_flow` | Remove a file (requires `confirm: true`) |

Resources: `flow://schema` (flow.schema.json) and `flow://guide` (README format section) so agents can read the rules.

Transports: stdio first (works with `docker run -i` and local clients). Streamable HTTP (`--http PORT`, endpoint `POST /mcp`, stateless JSON responses) is the transport in Docker. Optional `MCP_TOKEN` bearer auth.

## File-format impact
None.

## Decisions (Daniel, 2026-11-07)
- HTTP transport in addition to stdio.
- Dependency: hand-rolled JSON-RPC, no SDK (the recommended option; keeps the zero-dependency rule).
- Previous versions: rely on git, no `.bak` files.
