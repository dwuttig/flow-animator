# SQLite flow storage

- Status: implemented
- Plan: `docs/plans/sqlite-storage.md`
- Bounded context: Flow Library (Distribution wires the volume)
- Slice(s): new `sqlite-store` in Flow Library; `flow-store.js` gains `openStore`

## Problem
Flows live as loose `*.flow.json` files in a folder. That works for one person, but a database file is easier to back up and move, gives atomic read-check-write for Revisions, and does not depend on host folder permissions (the Linux `chmod a+w flows` problem).

## Decisions
1. **Same interface**: the Flow store contract (`list`, `read`, `readWithRevision`, `revision`, `exists`, `write`, `remove`, `edit`, `resolve`) is unchanged. MCP tools and the Flow API are untouched; both backends are interchangeable.
2. **No dependency**: Node's built-in `node:sqlite` (Node 22.13+, the Docker image is `node:22-alpine`). It is required lazily, so the folder store still runs on older Node.
3. **SQLite is the default**, the folder store stays selectable with `FLOW_STORE=files`.
4. **Revision is identical in both backends**: SHA-256 of the stored text (`JSON.stringify(doc, null, 2) + "\n"`), first 16 hex chars. Importing a folder therefore keeps Revisions of files written by this server.
5. **One-time import**: when the database is created empty and `FLOW_DIR` holds `*.flow.json` files, they are imported once (never overwriting, invalid files skipped with a message). It is recorded in the database, so a flow deleted later does not come back. `FLOW_IMPORT=0` disables it; `node mcp-server.js --import [dir]` imports on demand (existing names are kept).

## Goals
- Default storage is a single database file on a Docker volume.
- Folder store still available and unchanged.
- Existing flow files can be moved into the database without manual steps.

## Non-goals
- Version history, accounts, multiple users, schema migrations beyond `user_version`.
- Keeping the folder in sync with the database afterwards (the folder becomes an import source or a backup you export from the viewer).

## Behaviour
Environment of `mcp-server.js`:

| Variable | Default | Meaning |
|---|---|---|
| `FLOW_STORE` | `sqlite` | `sqlite` or `files` |
| `FLOW_DB` | `<FLOW_DIR>/flows.db` (Docker: `/data/flows.db`) | database file (sqlite) |
| `FLOW_DIR` | `./flows` | folder (files), and import source (sqlite) |
| `FLOW_IMPORT` | on | `0` disables the first-start import |

Table `flows(name PRIMARY KEY, body, revision, modified_at)`; write, delete and precondition check run in one `BEGIN IMMEDIATE` transaction, so a Conflict cannot slip between check and write. WAL mode and a busy timeout let the stdio and HTTP servers share one file.

Docker: the `mcp` service keeps `./flows:/flows` (import source, or the store with `FLOW_STORE=files`) and adds a named volume `flow-data:/data` for the database. The viewer's static `/flows/` listing shows the folder only; with SQLite the viewer uses the Flow API.

## Domain language
**Flow store** now means the persistence behind the Flow Library: a SQLite database (default) or a directory of flow files. **Import** is moving flow files into the database.

## File-format impact
None.

## Open questions
- Should the static `/flows/` fallback be dropped when SQLite is the default? Kept for now (still used by `?src=` links and read-only deployments).
