---
name: write-flow
description: Write a new flow-animator `*.flow.json` file that explains a system or scenario, then validate it. Use when asked to model, diagram, animate or document an architecture, request path, or process as a Flow.
---

# Write a Flow

Produce one `<topic>.flow.json` in format `flow-animator/1`. Never specify coordinates; layout is automatic. The full format is the README section "File format"; the schema is `flow.schema.json`. Vocabulary: `docs/ubiquitous-language.md`.

## Procedure
1. List the participating components (aim for 4 to 12) as `nodes`. Use `shape: "database"` for stores and `"queue"` for brokers/topics. Labels under 28 chars, subtitles under 36, ids unique (`[A-Za-z0-9_.-]`).
2. Optionally add `groups` (colour categories; `color` is one of gray, purple, teal, coral, pink, blue, green, amber, red).
3. Walk through the scenario in time order; each arrow becomes one `steps` entry with a verb-first `label`. Add `payload` for what is sent and `detail` for one or two sentences. Replies are separate steps with `kind: "response"`; async hops use `kind: "async"` or `"event"`; parallel fan-out uses `together: true` on the following steps.
4. Write raw JSON (no fences, comments or trailing commas) with `"format": "flow-animator/1"` and a `title`.
5. Save to `flows/<topic>.flow.json` (the `./flows` folder shared by viewer and MCP server), or to `examples/` if it is a sample.
6. Validate: `node validate.js flows/<topic>.flow.json` (`--json` for machine output). Exit 0 = valid, 1 = errors, 2 = bad usage. Fix every ERROR and reconsider every WARNING (unused nodes, undeclared groups, unknown properties).
7. Run the README checklist ("Checklist before you hand over the file").

## Alternative: MCP
If the `flow-animator` MCP server is connected (stdio, or `http://localhost:8081/mcp`), prefer its tools: `create_flow`, then `add_node` / `add_step` / `move_step` etc. Each edit is validated and rejected if invalid. Pass `expected_revision` (from `read_flow` with `with_revision`) when editing a flow someone else may have changed.

## Tell the user how to view it
- Docker: `docker compose up --build`, then `http://localhost:8080/?flow=<topic>` (add `&watch=1` to follow changes).
- Without Docker: open `index.html` and load the file, or `node build-standalone.js` for a single HTML file.

Fix the flow, never `flow-core.js` or the schema, to make validation pass.
