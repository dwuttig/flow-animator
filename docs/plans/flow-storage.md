# Plan: Flow storage and loading

- Status: draft
- Spec: `docs/features/flow-storage.md`
- Bounded context / slice(s): Flow Library (`flow-revision`, `flow-http-api`), Playback (`flow-gateway`, `pick-flow`, `save-flow`), Distribution (`nginx-api-proxy`)

## Approach
Keep the folder of `*.flow.json` files and add a thin HTTP API in the Flow Library, hosted by the existing MCP server process, so MCP and browser share one validated write path. The viewer reaches it through a single gateway module and degrades to read-only. Optimistic concurrency uses a content-hash Revision as ETag. Alternatives not chosen: a database (no need), nginx WebDAV or `PUT` (no validation, no atomicity), a separate API process (more moving parts for one user).

Implementation lands after the DDD restructure (`plans/ddd-restructure.md`) puts the Flow Library under `src/flow-library/`; until then the same slices are added at today's paths (`flow-store.js`, `mcp-server.js`, `index.html`) and moved with it.

## Steps
1. [ ] **flow-revision** (Flow Library): `Store.revision(name)` and `Store.stat(name)`; `list()` adds `revision` and `modifiedAt`; `read` can return the revision. Unit tests (`node --test`): same bytes give the same revision, any change gives a new one.
2. [ ] **Store precondition support**: `Store.write(name, doc, { ifMatch, ifNoneMatch })` and `remove(name, { ifMatch })` returning a `conflict` result; no write on conflict. Tests including create-only and stale revision.
3. [ ] **flow-http-api** (Flow Library): routes `GET/PUT/DELETE /api/flows[/:name]` in `mcp-server.js` (later `src/flow-library/flow-http-api/`), reusing the token check, 1 MB limit and `Store`. Status mapping: 200/201/204/304/401/404/412/413/422. Reuse `Core.loadDoc` through the Store only. HTTP tests with an ephemeral port and a temp `FLOW_DIR`.
4. [ ] **MCP parity** (Edit operations now live in the Flow Library slice `apply-edit`; keep revision handling in the Store, not in `apply-edit`): add optional `expected_revision` to `create_flow` and edit Tools, and `revision` in results. Update tool descriptions.
5. [ ] **flow-gateway** (Playback): `FlowGateway` as in the spec, plain script, no dependencies, fetch based, status codes mapped to result kinds; fallback listing from `/flows/` autoindex JSON. Tested in Node against the step 3 server and against a stub with no `/api/`.
6. [ ] **pick-flow** (Playback): picker UI, `?flow=` deep link, `?watch` with `If-None-Match`, source line with name and revision, "Copy link", "Download". Hidden when neither API nor listing is reachable.
7. [ ] **save-flow** (Playback): the contract the editor consumes: working Flow state (`name`, `revision`, `dirty`), `save`, `saveAs`, conflict dialog (Reload theirs, Overwrite, Save as), token prompt on 401, leave-page guard. Coordinate with the editor-mode thread: if its code exists, wire to it; if not, ship `save-flow` as a module with the documented API and a minimal Save button.
8. [ ] **nginx-api-proxy** (Distribution): `location /api/` with lazy upstream resolution (`resolver 127.0.0.11` and a variable in `proxy_pass`), pass `Authorization`, `If-Match`, `If-None-Match`, `ETag`; keep `/flows/` autoindex. Update `docker-compose.yml` comments and README (storage and API section, agent-facing).
9. [ ] **Docs**: glossary terms, `docs/architecture.md` Flow Library slice list, README, CHANGELOG, feature status to `accepted` then `implemented`.

Order: 1, 2, 3, 4 (server side, shippable alone) then 5, 6, 8 (read path in the browser) then 7 (needs editor). Each step is its own commit and keeps `node validate.js` and tests green.

## Files touched
- `flow-store.js` (later `src/flow-library/flow-store/`), `mcp-server.js` (later `.../flow-http-api/`, `.../mcp-transport/`)
- new `flow-gateway.js` (later `src/playback/flow-gateway/`), `index.html`
- `docker/nginx.conf`, `docker-compose.yml`, `Dockerfile` (viewer stage copies `flow-gateway.js`)
- `test/` and slice tests, `README.md`, `CHANGELOG.md`, `docs/ubiquitous-language.md`, `docs/architecture.md`

## Risks
- Editor thread diverges from `FlowGateway`: mitigated by agreeing the contract in the spec first and implementing step 7 against whatever it has built.
- nginx fails at startup if `mcp` is not resolvable: mitigated by variable-based `proxy_pass`; verify the viewer-only image still boots.
- Windows bind mounts and case-insensitive names: covered by the open question and a lowercase-collision check in `Store.resolve` if accepted.
- Facade moves from the DDD restructure may conflict: land after, or rebase.

## Verification
- `node --test` (store, HTTP API, gateway).
- `docker compose up --build`, then `curl localhost:8080/api/flows`; `PUT` with a stale `If-Match` returns 412; an invalid body returns 422 and the file is unchanged; with `MCP_TOKEN` set, calls without it return 401.
- Browser: picker lists flows, `?flow=` loads, Save then edit the file via MCP, then Save again shows the conflict dialog; viewer-only image and `file://` stay read-only with Download.
- `node validate.js examples/*.flow.json` still passes; standalone bundle unchanged.

## Changelog entry
Added: browser flow picker, `?flow=` links, and an HTTP API (`/api/flows`) with revision-based conflict detection for saving flows from the viewer and editor.
