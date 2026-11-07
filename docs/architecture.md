# Architecture

flow-animator follows Domain-Driven Design with a vertical slice architecture. This file is the reference for the architect and software-engineer agents; specs and plans must name the context and slice they touch.

Hard constraints stay as they were: zero runtime dependencies, no build step, one JSON file per Flow, agents never specify coordinates, domain code runs in both browser and Node.

## Domain in one paragraph
A person or AI agent describes a system as a **Flow** (Nodes, Groups, ordered Steps). The system validates it, lays it out automatically, and plays it back as an animation. Agents can also create and edit Flows through MCP. Vocabulary: [ubiquitous-language.md](ubiquitous-language.md).

## Bounded contexts

| Context | Type | Responsibility | Today's code |
|---|---|---|---|
| **Flow Modeling** | Core | What a valid Flow is: parse, validate, normalize, derive Beats. Owns the format `flow-animator/1` and `flow.schema.json`. | `parse`, `validate`, `normalize`, `buildBeats` in `flow-core.js` |
| **Layout** | Supporting | Turn a normalized Flow into Geometry (positions, routed Edges, bounds). Pure, deterministic. | `layout`, `route`, helpers in `flow-core.js` |
| **Playback** | Supporting | Show a Flow as an animation and handle user controls. Browser only. | `index.html` |
| **Flow Library** | Supporting | Persist Flows (SQLite database, or a directory) and apply Edits safely; expose them over MCP (stdio, HTTP). | `flow-store.js`, `mcp-server.js` |
| **Distribution** | Generic | Package and host: standalone bundle, CLI validator, Docker/nginx. | `build-standalone.js`, `validate.js`, `Dockerfile`, `docker/`, `docker-compose.yml` |

### Context map
```
            Published Language: format "flow-animator/1" (+ schema)
 Flow Modeling ───────────────┬──────────────┬──────────────┐
   (core, upstream)           │              │              │
        │ model               ▼              ▼              ▼
        ▼                 Flow Library     Playback     Distribution
     Layout ──geometry──────────────────────▶ (conformist)  (CLI, bundle)
```
- **Flow Modeling → everyone**: upstream. Others are *conformists*: they consume the model and the published format as is and never redefine it.
- **Layout → Playback**: customer/supplier. Playback consumes Geometry; Layout does not know about Playback.
- **Flow Library → Flow Modeling**: calls the `validate` public API for every Edit; never re-implements rules. Its MCP layer is an *open host service* with its own vocabulary of Tools, translated to Edits by an anti-corruption mapping in the slice.
- **Playback → Flow Library (apply-edit, Flow API)**: editor mode reuses the pure Edit engine so Edits behave the same in the browser and over MCP. To list, load and save stored Flows Playback calls the Flow Library's HTTP API (`/api/flows`) only through its `flow-gateway` slice, as a conformist. Playback never touches the Flow store or MCP transport directly.
- **Distribution** only wires and packages; it contains no domain rules.

Dependency rule: contexts depend only on another context's public API (its `index` entry), never on internals. No cycles. Allowed edges: Layout → Modeling, Playback → Modeling/Layout, Playback → Library's pure `apply-edit` (editor mode), Library → Modeling, Distribution → any public API. Modeling depends on nothing.

## Vertical slices
Inside a context, code is organised by use case (slice), not by technical layer. A slice holds everything for one capability: its input handling, domain logic, and tests. Shared kernel inside a context is allowed only for genuinely shared domain types.

Examples:
- Flow Modeling: `parse-flow`, `validate-flow`, `derive-beats`
- Layout: `layout-flow`, `route-edges`
- Playback: `load-flow`, `play-flow`, `scrub-timeline`, `render-diagram`, `edit-flow`, `flow-menu`, `export-flow`, `mcp-config`
- Flow Library: `sqlite-store`, `list-flows`, `read-flow`, `create-flow`, `add-node`, `add-step`, `move-step`... `flow-revision`, `flow-http-api` (list, read, save, delete over HTTP with revision checks), plus `mcp-transport`
- Distribution: `bundle-standalone`, `validate-cli`, `docker-image`

Layering within a slice stays light: domain logic must not import transport (HTTP, stdio, DOM, fs). I/O sits at the slice edge.

## Target folder layout
```
src/
  flow-modeling/
    index.js                  public API: parse, validate, normalize, buildBeats
    parse-flow/  validate-flow/  derive-beats/
  layout/
    index.js                  public API: layout
    layout-flow/  route-edges/
  playback/                   browser only
    index.js
    load-flow/  play-flow/  scrub-timeline/  render-diagram/
  flow-library/               Node only
    index.js
    flow-store/  edit-flow/<edit>/  mcp-transport/
  distribution/
    bundle-standalone/  validate-cli/
index.html  Dockerfile  docker-compose.yml  docker/  examples/  test/
```
- Plain script files, no bundler. Modeling and Layout keep the UMD wrapper so a browser `<script>` tag and Node `require` both work; `index.html` lists the script tags in dependency order.
- Existing entry points (`flow-core.js`, `validate.js`, `build-standalone.js`, `mcp-server.js`, `index.html`) stay as thin facades while the migration lands, so Docker, README and clients keep working. See [features/ddd-restructure.md](features/ddd-restructure.md) and [plans/ddd-restructure.md](plans/ddd-restructure.md).
- Tests live next to the slice (`*.test.js`, `node --test`) plus cross-context contract tests in `test/`.

## Rules for contributors and agents
1. Every spec and plan names its **bounded context** and **slice**. A change touching two contexts says which is upstream and what changes in the published language.
2. Use the ubiquitous language in names, messages and docs; update the glossary when adding a term.
3. Keep rules in the domain: validation lives only in Flow Modeling; layout only in Layout. Transports and UI call them, never copy them.
4. Format changes belong to Flow Modeling and bump or extend `flow-animator/1` deliberately; `flow.schema.json`, validator and README format section change together.
5. Add behaviour as a new slice rather than extending a shared helper.
6. Cross-context calls go through public APIs only.
