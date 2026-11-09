# Flow storage and loading

- Status: implemented (browser Download stays in the editor panel; a separate viewer-only Download and a Copy link action were not added)
- Plan: `docs/plans/flow-storage.md`
- Bounded context: Flow Library (upstream). Consumed by Playback (viewer and editor mode) and wired by Distribution.
- Slice(s): new `flow-http-api` and `flow-revision` in Flow Library; new `flow-gateway`, `flow-menu`, `save-flow` in Playback; `nginx-api-proxy` in Distribution.

## Problem
Flows can be written by agents through MCP and served read-only by nginx, but the browser cannot list the server's Flows by name, save an edited Flow back, or notice that someone else changed it. The editor mode being built in parallel needs exactly this. Today a person must hand-type `?src=flows/x.flow.json` and can only get a changed Flow out of the browser by copy and paste.

## Decisions (confirmed by Daniel, 2026-11-07)
1. **Backend**: a folder of `*.flow.json` files, the same `FLOW_DIR` the MCP server and Docker mount already use. The Flow store stays behind its existing interface (`list`, `read`, `write`, `remove`), so a database could replace it later without touching callers.
2. **Users and auth**: single user or trusted network. No accounts. The optional `MCP_TOKEN` bearer token stays and now also guards writes through the HTTP API.
3. **Versioning**: every save creates a Revision and keeps the newest 50 revisions per flow in SQLite. Saves use an optimistic check when a Revision is supplied.
4. **Browser UX**: the viewer lists the server's Flows and loads one by name; the editor saves back to the server. "Open file..." and a new "Download" remain as fallbacks, and the viewer still works with no server API (read-only).
5. **Write path**: one small HTTP API in the Flow Library, served by the existing MCP server process. nginx proxies `/api/` to it. MCP tools and the browser share one write path and one validation.
6. **Sharing**: a link `?flow=<name>` plus the existing standalone bundle.

Concurrency (default accepted): last write wins, softened by an optimistic check so a stale editor is warned instead of silently overwriting.

## Goals
- Load any stored Flow in the browser by name, with a picker.
- Save an edited Flow back, validated, atomically, with conflict detection.
- One shared contract the editor mode can build on.
- Keep working when the API is absent (static hosting, `file://`, standalone bundle).

## Non-goals
- Accounts, roles, per-user folders, sharing permissions.
- Version history or restore.
- Subfolders or tags. Names stay flat (`orders.flow.json`).
- Real-time collaboration is out of scope, but stored-flow watch uses Server-Sent Events with polling fallback.
- Changing the format `flow-animator/1`.

## Behaviour

### Flow name
The file name, e.g. `orders.flow.json`. Same rules as today (`Store.resolve`): ends in `.flow.json`, no folders, no leading dot.

### Revision
A string identifying the exact bytes of a stored Flow: the SHA-256 of the file contents, first 16 hex characters. Sent as the HTTP `ETag` (quoted) and as `revision` in JSON. Changes whenever the file changes, including edits made through MCP or by hand.

### HTTP API (Flow Library, `flow-http-api` slice)
Served by `mcp-server.js --http` on the same port (8081), next to `/mcp` and `/healthz`. Via nginx it appears on the viewer origin at `/api/`, so no CORS is needed.

| Request | Result |
|---|---|
| `GET /api/flows` | `{ "flows": [{ file, title, nodes, steps, revision, modifiedAt }] }`. Reuses `Store.list()` plus revision and mtime. |
| `GET /api/flows/:name` | The Flow JSON. Headers `ETag`, `Cache-Control: no-store`. Honors `If-None-Match` (304). 404 if missing. |
| `PUT /api/flows/:name` | Body is the whole Flow. Validated by Flow Modeling; invalid means `422 { errors, warnings }` and the file is untouched. Success: `200` (or `201` if new) with `{ ok, revision, warnings, stats }` and the new `ETag`. |
| `PATCH /api/flows/:name` | Body is `{ "op": "...", "args": { ... } }`; applies one Edit, validates it, and returns the new Revision. It accepts the same `If-Match` precondition. |
| `DELETE /api/flows/:name` | `204`. Requires the same precondition as PUT. |
| `GET /api/flows/:name/revisions` | Lists the newest 50 saved revisions for the Flow. |
| `GET /api/flows/:name?revision=<revision>` | Reads a historical revision instead of the current body. |
| `GET /api/flows/:name/events` | Opens an SSE stream. A save sends `event: revision` with `{ "revision": "<revision>", "deleted": false }`; deletion sends `{ "revision": "<last revision>", "deleted": true }`. The server sends `: ping` every 25 seconds and performs a 2-second cross-process check. |

Preconditions on `PUT` and `DELETE`:
- `If-Match: "<revision>"` is how an editor says "I loaded this revision". If the file changed since, the answer is `412 { error: "conflict", revision: "<current>" }` and nothing is written.
- `If-None-Match: *` means "create only"; `412` if the name exists.
- Neither header means unconditional overwrite (last write wins). Scripts and agents may use this.

Other rules: body limit 1 MB; `Content-Type: application/json`; writes need `Authorization: Bearer <MCP_TOKEN>` when a token is set; reads need it too when set (keeps the rule simple). Errors use `{ error, errors? }` JSON. No CORS headers.

MCP stays as it is. Optionally `create_flow` and the edit Tools accept `expected_revision` and return `revision` in results; without it they remain last write wins.

### Viewer (Playback)
- **Flow picker**: a dropdown or list of stored Flows (title, file, counts), filled from `GET /api/flows`. If that is unavailable it falls back to the nginx JSON listing at `/flows/`, and if that fails too the picker is hidden.
- **Deep link**: `?flow=orders.flow.json` loads through the API (or `/flows/<name>` as fallback) and keeps the `?watch` behaviour (SSE first, polling fallback; using `If-None-Match` so unchanged Flows cost a 304). The existing `?src=<url>` stays for arbitrary URLs.
- **Source line** shows the name and revision.
- **Open file...**, drag and drop, paste: unchanged, and are *local* Flows with no server name.
- **Download**: saves the current Flow as `<name>.flow.json`. Works with no server.

### Editor mode (contract for the `edit-flow` slice)
The editor holds a *Draft* plus the *revision* it was loaded from, and talks to storage only through `FlowGateway` (below).
- **Save** (Ctrl+S): `PUT` with `If-Match`. On success it stores the new revision. On `422` it shows Violations at their paths and keeps the Draft. On `412` it offers: *Reload theirs* (discard local), *Overwrite* (retry without `If-Match`), or *Save as new name*.
- **Save as...**: asks for a name, `PUT` with `If-None-Match: *`.
- **New flow**: Draft with no name until the first Save as.
- **Dirty marker** and a leave-page warning while unsaved.
- **Delete** only after confirmation.
- **Token**: on `401` the UI asks for the token once and keeps it in `sessionStorage` only (never in the URL or the file).
- If the API is absent, Save is replaced by Download and the UI says why.

### FlowGateway (browser client, Playback `flow-gateway` slice)
```
FlowGateway.available()                       -> Promise<boolean>
FlowGateway.list()                            -> Promise<[{file,title,nodes,steps,revision,modifiedAt}]>
FlowGateway.load(name, {revision})             -> Promise<{doc, revision}>
FlowGateway.save(name, doc, {ifMatch|create}) -> Promise<{ok:true,revision,warnings} | {ok:false,kind:'invalid'|'conflict'|'unauthorized'|'unavailable', errors?, revision?}>
FlowGateway.remove(name, {ifMatch})           -> Promise<{ok}|{ok:false,kind}>
FlowGateway.watch(name, onEvent, {known})     -> unsubscribe function
```
It never validates Flows itself: it relies on Flow Modeling in the browser (`flow-core.js`) for instant feedback and on the server for the final word. It is the only place in Playback that knows URLs and status codes (anti-corruption layer towards the Flow Library's published HTTP API).

### Deployment
- `docker-compose.yml`: the viewer's nginx gets `location /api/ { proxy_pass http://mcp:8081; }` (resolved lazily so the viewer image still starts alone, in which case `/api/` answers 502 and the viewer falls back to read-only).
- `./flows` stays mounted into both containers. nginx keeps serving `/flows/` read-only (used as the fallback listing and by existing links).
- The MCP port stays bound to `127.0.0.1` on the host. Anything beyond a trusted network needs `MCP_TOKEN` and TLS in front, as today.

### Sharing
- Link: `http://host:8080/?flow=orders.flow.json` (needs the server).
- Portable copy: the standalone bundle from `build-standalone.js`, or "Download". No new feature beyond making the link easy to copy (a "Copy link" action in the picker).

## Domain language
Add to `docs/ubiquitous-language.md`, Flow Library section:

| Term | Meaning |
|---|---|
| **Flow name** | The file name that identifies a stored Flow, e.g. `orders.flow.json`. |
| **Revision** | Content hash of a stored Flow, used to detect that it changed since it was loaded. |
| **Conflict** | A save that carried an older Revision than the stored one; rejected, nothing written. |
| **Flow API** | The HTTP interface of the Flow Library (`/api/flows`). |
| **Draft** | Playback term (defined by the editor mode): the in-memory Flow being edited, possibly unsaved. Reused here; not redefined. |

## File-format impact
None. `flow-animator/1` is unchanged; Revision and Flow name live outside the file.

## Risks and trade-offs
- The MCP process now also serves browser traffic. It is small, dependency-free and stateless, and a bug there affects both; acceptable for the single-user scope. Splitting it later is easy because the API is its own slice.
- Token in the browser is weak protection; this is a trusted-network feature by decision 2.
- Hash of file bytes means a reformat by hand creates a new Revision even without semantic change. Fine.
- Read-check-write is not atomic across processes. One server process owns writes; editing files by hand at the same instant is an accepted race.

## Open questions
- Should reads also work without the token when one is set (so links can be shared inside a team)? Default here: token guards everything.
- Should the editor's Save as warn when a name differs only by case? (Matters on Windows and macOS bind mounts.)
