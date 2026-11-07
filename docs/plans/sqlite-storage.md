# Plan: SQLite flow storage

- Status: done
- Spec: `docs/features/sqlite-storage.md`
- Bounded context / slice(s): Flow Library `sqlite-store`

## Approach
Second implementation of the existing Store interface using `node:sqlite`, reusing `checkPrecondition` and `edit` from the folder store. `flow-store.js` gets `openStore(env)` to pick the backend; `mcp-server.js` only calls it. No change to tools or HTTP API.

## Steps
1. [x] Tests (contract run against both backends, import, persistence, concurrency of preconditions).
2. [x] `src/flow-library/sqlite-store/sqlite-store.js` plus `openStore` and `validName` in `flow-store.js`.
3. [x] `mcp-server.js`: use `openStore`, `--import` command.
4. [x] Docker: `COPY` the slice, `/data` volume owned by `node`, compose named volume, `FLOW_DB`.
5. [x] Docs, CHANGELOG, `docker-smoke-test`.

## Files touched
`flow-store.js`, `mcp-server.js`, new slice, `Dockerfile`, `docker-compose.yml`, `.dockerignore` (already allows `src/**`), `README.md`, `docs/`, `CHANGELOG.md`.

## Risks
- `node:sqlite` is experimental (prints a warning once); mitigated by `FLOW_STORE=files`.
- Alpine Node 22 older than 22.13 would lack it unflagged; image uses the latest 22.x.

## Verification
`node --test`; docker smoke test incl. restart persistence and import from `./flows`.

## Changelog entry
Added: SQLite storage (default) with one-time import; `FLOW_STORE=files` keeps the folder.
