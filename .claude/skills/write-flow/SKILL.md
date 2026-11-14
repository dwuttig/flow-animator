---
name: write-flow
description: Write a new flow-animator `*.flow.json` file that explains a system or scenario, then validate it. Use when asked to model, diagram, animate or document an architecture, request path, or process as a Flow.
---

# Write a Flow

Produce one `<topic>.flow.json` in format `flow-animator/1`. Never specify coordinates; layout is automatic. The full format is the README section "File format"; the schema is `flow.schema.json`. Vocabulary: `docs/ubiquitous-language.md`.

## Create via the MCP server (preferred)
Use the `flow-animator` MCP server (stdio, or `http://localhost:8081/mcp`). Files land in the `./flows` folder shared with the viewer. Every write is validated and rejected if invalid, so no separate validation step is needed.

1. Read the resource `flow://guide` first.
2. `list_flows` to avoid name clashes. Pick a unique `<topic>` name (no suffix).
3. Model the content (see "Modelling rules" below), then call `create_flow` with `file` and the complete `document`. Pass `overwrite: true` only when replacing on purpose.
4. Refine with the granular tools instead of rewriting the file: `set_meta`, `add_group` / `update_group`, `add_node`, `add_step`, `move_step`, and their update/remove counterparts. Call `mcp_list_tools` for the exact names and schemas.
5. Check the result with `validate_flow` (`file` or inline `document`) and reconsider every WARNING (unused nodes, undeclared groups, unknown properties).
6. Pass `expected_revision` (from `read_flow` with `with_revision`) when editing a flow someone else may have changed.
7. Run the README checklist ("Checklist before you hand over the file").

## Fallback: write the file directly
Only when the MCP server is not connected.
1. Write raw JSON (no fences, comments or trailing commas) with `"format": "flow-animator/1"` and a `title`.
2. Save to `flows/<topic>.flow.json`, or to `examples/` if it is a sample.
3. Validate: `node validate.js flows/<topic>.flow.json` (`--json` for machine output). Exit 0 = valid, 1 = errors, 2 = bad usage. Fix every ERROR and reconsider every WARNING.
4. Run the README checklist.

## Modelling rules
1. List the participating components (aim for 4 to 12; the viewer warns above ~14) as `nodes`. Use `shape: "database"` for stores and `"queue"` for brokers/topics. Labels under 28 chars, subtitles under 36, ids unique (`[A-Za-z0-9_.-]`).
2. Optionally add `groups` (colour categories; `color` is one of gray, purple, teal, coral, pink, blue, green, amber, red).
3. Walk through the scenario in time order; each arrow becomes one `steps` entry with a verb-first `label`. Add `payload` for what is sent and `detail` for one or two sentences. Replies are separate steps with `kind: "response"`; async hops use `kind: "async"` or `"event"`; parallel fan-out uses `together: true` on the following steps.

## Tell the user how to view it
- Docker: `docker compose up --build`, then `http://localhost:3030/?flow=<topic>` (add `&watch=1` to follow changes).
- Without Docker: open `index.html` and load the file, or `node build-standalone.js` for a single HTML file.

Fix the flow, never `flow-core.js` or the schema, to make validation pass.
