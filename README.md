# Flow animator

Turns a small JSON file describing an architecture and its interactions into an animated diagram.
Open `index.html` in a browser, load a `*.flow.json` file, and watch a packet travel step by step through the system.

- **People** get the animation: play, pause, step, scrub, speed, trail of completed steps.
- **AI agents** produce one JSON file following the format below. No drawing, no coordinates, no code.

No install, no dependencies, no build step. Node is only needed for the optional command-line tools.

## Docker

```
docker compose up --build   # viewer at http://localhost:8080
```

Flows are stored in a SQLite database on the `flow-animator-data` volume (see "Storing and loading flows"). Existing `*.flow.json` files in `./flows` are imported once when the database is first created.

## Editor mode

Click **Edit** in the viewer to change the flow in the browser: title, groups, nodes and steps, with undo/redo. Every change is validated before it is shown; invalid changes are rejected. Steps support drag-and-drop reorder, **+ After**, and a **Connections** select. Use **Download** or **Copy JSON** to keep the result (the viewer cannot write to your `./flows` folder; agents can, via MCP). Steps can be edited as **Fields** or as a **Sentence** ("Client sends Submit order to API gateway as a call...", click an underlined value to change it); the toggle above the steps remembers your choice. No coordinates to set: layout stays automatic. Script access: `FlowAnimator.edit("add_node", {id:"x", label:"X"})`.

## MCP server (create and edit flows)

`mcp-server.js` lets MCP-capable agents create, read, validate and edit flow files through tools instead of rewriting JSON. Every change is validated with `flow-core.js`; an invalid change is rejected and the file stays untouched. Positions are automatic, so tools never take coordinates.

- Docker: `docker compose up --build` also starts it at `http://localhost:8081/mcp` (Streamable HTTP), sharing the flow database with the viewer. Set `MCP_TOKEN` to require a bearer token.
- Local stdio: `node mcp-server.js` (database `./flows/flows.db`; `FLOW_DB` changes it), or `docker run -i --rm -v flow-animator-data:/data flow-animator-mcp node mcp-server.js` to share the compose volume.
- Local HTTP: `node mcp-server.js --http 8081`.
- Client config (stdio): `{"mcpServers":{"flow-animator":{"command":"node","args":["/path/to/mcp-server.js"],"env":{"FLOW_DB":"/path/to/flows.db"}}}}`. For HTTP use the URL `http://localhost:8081/mcp`.
- Tools: `list_flows`, `list_revisions`, `read_flow` (including a revision), `validate_flow`, `create_flow`, `delete_flow`, `set_meta` (including connection), `add_group`/`update_group`/`remove_group`, `add_node`/`update_node`/`remove_node`, `add_step`/`update_step`/`remove_step`/`move_step`/`set_parallel`. Resources: `flow://schema`, `flow://guide`.
- Tests: `npm test` (`node --test`). Other scripts are `npm run validate`, `npm run mcp`, `npm run mcp:http`, and `npm run build:standalone`.
- Linux note: with `FLOW_STORE=files` the container runs as a non-root user; if `./flows` is not writable by it, run `chmod a+w flows`.

---

## Storing and loading flows
Flows live in a SQLite database (Node's built-in `node:sqlite`, no dependency): `FLOW_DB`, default `<FLOW_DIR>/flows.db`, in Docker `/data/flows.db` on the named volume `flow-animator-data`. Set `FLOW_STORE=files` to keep plain `*.flow.json` files in `FLOW_DIR` (Docker: `./flows`) instead. When a new database is created, `*.flow.json` files found in `FLOW_DIR` are imported once (`FLOW_IMPORT=0` disables this); import again any time with `node mcp-server.js --import [dir]` (existing names are kept). Back up the database by exporting flows from the viewer or copying the volume. A flow is identified by a unique name without any suffix (`orders`, not `orders.flow.json`; letters, digits, dot, dash, underscore, case-insensitive). Save as asks for just that name, and the API, MCP tools (`file` argument) and `?flow=` links accept the old `orders.flow.json` form too. Existing databases are migrated on start. Revisions are the same in both stores. The viewer's static `/flows/` listing only shows the folder. The MCP server also serves a small HTTP API on its port; nginx exposes it to the viewer at `/api/`:

- `GET /api/flows` lists flows with title, counts, `revision` and `modifiedAt`.
- `GET /api/flows/<name>` returns the flow with an `ETag` (the revision).
- `PUT /api/flows/<name>` validates and saves. `If-Match: "<revision>"` rejects a stale save with `412`; `If-None-Match: *` means create only; an invalid flow returns `422` with the errors. Without these headers the last write wins.
- `DELETE /api/flows/<name>` (same `If-Match` rule). With `MCP_TOKEN` set, send `Authorization: Bearer <token>` on every call.

Viewer: pick a stored flow from the list, or open `/?flow=<name>` (add `&watch=1` to follow changes). In editor mode, **Save** (Ctrl+S), **Save as...** and **Reload** use this API. MCP write tools accept `expected_revision` for the same conflict check. Without the API the viewer stays read-only and you can **Download** the flow instead.

## For AI agents: your task

Produce **one file** named `<topic>.flow.json` that describes the architecture or flow you were asked to explain.
The viewer lays out the diagram and animates it. Your job is to get the **components** (nodes) and the **ordered interactions** (steps) right.

Procedure:

1. List the components that take part (aim for 4 to 12). These become `nodes`.
2. Walk through the scenario in time order. Each arrow in the story becomes one entry in `steps`.
3. Write the file as raw JSON (no markdown fences, no comments, no trailing commas).
4. Validate it: `node validate.js path/to/<topic>.flow.json`. Fix every `ERROR`, then reconsider each `WARNING`.
5. Tell the user how to view it (see "Viewing" below).

If you cannot run Node, apply the checklist at the end of this file by hand.

One file = one scenario. If the system has several distinct scenarios (login, checkout, error handling), write several files rather than one long one.

---

## File format (`flow-animator/1`)

```json
{
  "format": "flow-animator/1",
  "title": "Short title",
  "description": "One or two sentences of context.",
  "layout": { "direction": "LR" },
  "groups": [ { "id": "sync", "label": "Request path", "color": "purple" } ],
  "nodes":  [ { "id": "api", "label": "API gateway", "subtitle": "Auth, routing", "group": "sync" } ],
  "steps":  [ { "from": "client", "to": "api", "label": "Submit order", "payload": "POST /orders" } ]
}
```

### Top level

| Field | Required | Type | Notes |
|---|---|---|---|
| `format` | yes (warning if missing) | string | Always `"flow-animator/1"`. |
| `title` | recommended | string | Shown as the page heading. |
| `description` | no | string | One or two sentences. |
| `layout.direction` | no | `"LR"` or `"TB"` | Left to right (default) or top to bottom. |
| `layout.connection` | no | `"auto"`, `"bezier"`, `"linear"` or `"orthogonal"` | Edge routing style (default `auto`: straight, bending around nodes). The viewer can override direction and connection style at runtime. |
| `groups` | no | array | Colour categories, see below. |
| `nodes` | yes | array | At least one. |
| `steps` | yes | array | At least one. Order is the animation order. |
| `$schema` | no | string | Editor hint only. Use `"./flow.schema.json"`. |

Unknown properties are ignored with a warning (the validator suggests the closest valid name).

### `nodes[]`: the components

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | yes | string | Unique. Letters, digits, `-`, `_`, `.`. Referenced by `steps`. |
| `label` | yes | string | The component name. Keep under 28 characters. |
| `subtitle` | no | string | Role in about 5 words, under 36 characters (`"Auth, routing"`). |
| `group` | no | string | Nodes in the same group share a colour. |
| `shape` | no | `"box"` (default), `"database"`, `"queue"` | Use `database` for stores, `queue` for brokers and topics. |
| `col`, `row` | no | integer >= 0 | Manual grid position, see "Layout". Usually leave out. |

### `groups[]`: colour categories (optional)

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Matches `nodes[].group`. |
| `label` | no | Shown in the legend. |
| `color` | no | One of `gray`, `purple`, `teal`, `coral`, `pink`, `blue`, `green`, `amber`, `red`. Assigned automatically if omitted. |

Nodes without a `group` are gray. The legend appears when there are two or more groups. A group that is used by a node but not declared in `groups` still works (colour assigned automatically, with a warning).

### `steps[]`: the interactions, in order

| Field | Required | Type | Notes |
|---|---|---|---|
| `from` | yes | node id | Where the packet starts. |
| `to` | yes | node id | Where it arrives. May equal `from` (a self-call). |
| `label` | yes | string | Short action phrase, verb first: `"Persist order"`. |
| `detail` | no | string | One or two sentences of explanation shown under the diagram. |
| `payload` | no | string | What is sent, shown in monospace: `"POST /orders"`, `"OrderCreated { id }"`. |
| `kind` | no | `"sync"` (default), `"async"`, `"response"`, `"event"` | Line style: solid, dotted, dashed, dotted. |
| `together` | no | boolean | `true` = starts at the same moment as the previous step (parallel fan-out). Ignored on the first step. |

Notes on behaviour:

- **One arrow per from-to pair.** Two steps with the same `from` and `to` reuse the same arrow; the first step's `kind` sets its line style.
- **Request and response are separate steps.** A reply is its own step with `"kind": "response"` going the other way. Both arrows are drawn side by side.
- **Parallel work** is expressed with `together`: the step joins the beat of the step before it. Chains work (three steps in a row with `together: true` on the 2nd and 3rd all run at once).
- Every node should appear in at least one step. Unused nodes still draw but never light up (warning).

### Layout (automatic)

You normally give no coordinates. The viewer places nodes in **columns** (or rows for `TB`) in the order they first appear in `steps`: the sender of step 1 is column 0, a node first reached from column N goes to column N + 1. Nodes in the same column are stacked in order of appearance and centred. Edges that would cross a node bend around it.

Only if the result is cramped or crossed, set `col` (column, or row of the flow for `TB`) and `row` (position within the column) on some nodes. Both are zero-based and gaps are kept. Two nodes may not share the same `col` and `row`.

---

## How to model a system well

| Do | Avoid |
|---|---|
| 4 to 12 nodes. Merge minor internals into one box. | One node per class or function. |
| Name nodes by role: `API gateway`, `Order service`. | Technology only: `Spring`, `Kafka` (put that in `subtitle`). |
| Put technology or responsibility in `subtitle`: `"Postgres"`, `"Auth, routing"`. | Long labels. They are truncated. |
| One step = one arrow = one message or call. | A step that stands for "several things happen". |
| Order steps as they happen in time. | Grouping steps by component. |
| Add the response as its own step when the return path matters. | Drawing returns for every call (noise). |
| Use `kind: "async"` for queues, events, fire-and-forget. | Marking everything `async`. |
| Use `together: true` for real parallelism (fan-out, concurrent calls). | Using it to save steps that are really sequential. |
| Use `detail` for the "why" and `payload` for the concrete message. | Repeating the label in `detail`. |
| 2 to 4 groups with meaning (request path, async path, external). | A different group for every node. |

Static architecture (no real time order)? Still write steps: pick the most important path through the system, or one step per dependency arrow in reading order. The animation walks the arrows one by one.

---

## Validate

```bash
node validate.js path/to/file.flow.json          # human-readable
node validate.js path/to/file.flow.json --json   # machine-readable
```

Exit code `0` = valid (warnings allowed), `1` = errors, `2` = bad usage. Example output:

```
ERROR   $.steps[3].to  unknown node id "api-gateway" (did you mean "api"?); known ids: client, api, orders
WARNING $.nodes[5]  node "audit" is not used by any step; it is drawn but never lit up
FAILED  order.flow.json: 1 error(s). Fix them and run again.
```

Paths use JSON-path style (`$.steps[3].to` = the `to` of the fourth step, zero-based).

Common errors and fixes:

| Message starts with | Fix |
|---|---|
| `invalid JSON` | Syntax error: missing comma, trailing comma, unquoted key, comments, or a markdown code fence around the JSON. |
| `unknown node id` | `from`/`to` must match a `nodes[].id` exactly (case-sensitive). |
| `duplicate id` | Node ids must be unique. |
| `must be one of` | `shape`, `kind`, `color` or `direction` has a value outside the allowed list above. |
| `already used by nodes[...]` | Two nodes share the same `col` and `row`. Change one. |
| `required` | A mandatory field (`id`, `label`, `from`, `to`) is missing or empty. |

---

## Viewing (for humans)

| How | Command / action |
|---|---|
| Quickest | Open `index.html` in a browser, then **Open file...**, drag a `.flow.json` file onto the page, or **Paste JSON...** |
| Load a file by URL | Serve the folder, then open `index.html?src=examples/order-flow.flow.json`<br>`python3 -m http.server 8000` then `http://localhost:8000/index.html?src=examples/order-flow.flow.json` |
| Live reload while an agent edits the file | Add `&watch=1` to the URL. The viewer re-reads the file every 1.5 s and redraws when it changes. |
| One shareable file | `node build-standalone.js my.flow.json my.html` creates a single self-contained HTML file (viewer + flow) for email, tickets or wikis. |

Browsers block `?src=` on `file://` pages. Use a local server or one of the other options.

Controls live in one **View panel** beside the diagram (see [docs/style-guide.md](docs/style-guide.md)): **Restart** (Home), **Prev/Next** (Left/Right arrows), **Play/Pause** (Space), scrubber, **Speed**, **Loop**, **Trail** (keeps completed arrows tinted); **Orientation**, **Connections** (Auto, Bezier, Linear, Orthogonal), **Step style** (By kind, Solid, Dashed, Dotted) and line **Thickness**; **+**, **−**, **Reset** zoom, **Maximize** (M) and **Fullscreen** (F). Esc leaves Maximize. **Hide/Show** collapses the panel (remembered). Click a step in the list to jump to it. Display settings are viewer settings (not saved in the file, except the default `layout.direction` and `layout.connection`) and are remembered in the browser. The viewer follows the system light/dark theme and starts paused if the OS asks for reduced motion.

Other controls are **Play/Pause** (Space), **Prev/Next** (Left/Right arrows), **Restart** (Home), scrubber, **Speed**, **Loop**, and **Trail** (keeps completed arrows tinted). Click a step in the list to jump to it. **Maximize** (M) fills the window with the visualization and **Fullscreen** (F) uses the whole screen; Esc leaves Maximize. The viewer follows the system light/dark theme and starts paused if the OS asks for reduced motion.

Stored flows opened with `?watch=1` are live through Server-Sent Events, with polling fallback. Agents that drive a browser can use the page API: `FlowAnimator.load(objectOrJsonText)` returns `{ ok, errors, warnings }`; `FlowAnimator.jump(beatIndex, true)` shows a step; `FlowAnimator.state()` reports progress.

The Flow API supports `PATCH {op,args}`, `GET /revisions`, `?revision=`, and `GET /events` in addition to list/read/write/delete.

---

## Complete example

`examples/order-flow.flow.json` (also the built-in example in the viewer) shows groups, shapes, async and response steps, a parallel step, and manual `col`/`row`. Minimal version:

```json
{
  "format": "flow-animator/1",
  "title": "Login",
  "nodes": [
    { "id": "user", "label": "Browser" },
    { "id": "api", "label": "Auth API", "subtitle": "Issues tokens" },
    { "id": "db", "label": "Users", "shape": "database" }
  ],
  "steps": [
    { "from": "user", "to": "api", "label": "Send credentials", "payload": "POST /login" },
    { "from": "api", "to": "db", "label": "Look up user" },
    { "from": "db", "to": "api", "label": "Return user record", "kind": "response" },
    { "from": "api", "to": "user", "label": "Return token", "kind": "response", "payload": "200 { jwt }" }
  ]
}
```

---

## Prompt for users

Paste this to any AI agent that can read files in this folder:

> Read `README.md` in `flow-animator/`. Then create `<name>.flow.json` that shows how `<describe the system or scenario>` works, following the format exactly. Run `node validate.js` on it and fix all errors. Tell me how to open it.

---

## Checklist before you hand over the file

- [ ] The file is raw JSON, `"format": "flow-animator/1"`, with a `title`.
- [ ] 4 to 12 nodes; every `id` unique; labels under 28 characters, subtitles under 36.
- [ ] Every `from` and `to` is an existing node id.
- [ ] Steps are in chronological order; each has a verb-first `label`.
- [ ] Responses and async hops use `kind`; parallel work uses `together`.
- [ ] No node is left unused; no step refers to a node that is not drawn.
- [ ] `node validate.js` reports `OK` (or you applied this checklist by hand).

---

## Architecture

Domain-Driven Design with vertical slices. Bounded contexts: Flow Modeling (core: the format and its validation), Layout, Playback (viewer), Flow Library (store + MCP), Distribution (bundle, CLI, Docker). See [docs/architecture.md](docs/architecture.md) for the context map and target layout, and [docs/ubiquitous-language.md](docs/ubiquitous-language.md) for the shared vocabulary.

## Files

| File | Purpose |
|---|---|
| `index.html` | The viewer. Open it in a browser. |
| `flow-core.js` | Parsing, validation, auto-layout (used by the viewer and the Node tools). |
| `mcp-server.js`, `flow-store.js` | MCP server (stdio and HTTP) and its file/edit logic. |
| `src/flow-modeling/flow-modeling.js` | Flow Modeling public API: parse, validate, normalize, beats, registries and migrations. |
| `src/layout/layout.js` | Automatic geometry and edge routing. |
| `src/flow-library/flow-name/` | Stored Flow name normalization and validation. |
| `src/flow-library/store-core/` | Shared store contract and revision helpers. |
| `src/flow-library/apply-edit/` | Pure Edit operations shared by the MCP server and editor mode. |
| `src/playback/edit-flow/` | Editor mode UI (browser). |
| `src/playback/play-flow/`, `render-diagram/`, `view-options/`, `dialogs/`, `flow-gateway/` | Playback, rendering, View settings, dialogs and live watch. |
| `validate.js` | Command-line validator for agents and CI. |
| `build-standalone.js` | Bundles viewer + one flow into a single HTML file. |
| `flow.schema.json` | JSON Schema for editor autocomplete. `validate.js` is the stricter source of truth. |
| `examples/order-flow.flow.json` | Full example. |

Adding a browser slice means adding its `<script>` tag to `index.html`; the standalone bundle and browser export read that page manifest.

Limits worth knowing: node labels are truncated to the box width, there is no free-form drawing, and automatic layout favours short, readable flows (up to about 14 nodes and 40 steps).
