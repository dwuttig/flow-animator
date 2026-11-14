# Docker deployment

- Status: proposed
- Plan: `docs/plans/docker-deployment.md`

## Problem
The viewer must be hosted somewhere reproducible. Opening `index.html` from disk blocks `fetch()` of flow files, and a later MCP server needs a place to write flows that the viewer can read.

## Goals
- `docker compose up` serves the viewer on http://localhost:3030.
- Flow files in `./flows` are served at `/flows/<name>.flow.json` and appear without rebuilding.
- Leave room for an MCP server container that shares the flows volume.

## Non-goals
- Building the MCP server (separate work).
- TLS, auth, or a hosted deployment target.

## Behaviour
- Image: nginx-unprivileged (non-root, port 8080) serving `index.html`, `flow-core.js`, `flow.schema.json`, `examples/`.
- `/healthz` returns `ok`; `/flows/` returns a JSON directory listing.
- nginx proxies `/api/` to the MCP service with `proxy_buffering off` and `proxy_read_timeout 1h`, so Flow API Server-Sent Events stay open.
- `no-cache` headers so edited flows reload immediately.
- The viewer image copies all of `src/`; tests are excluded by `.dockerignore`.

## File-format impact
None.

## Open questions
- Should the viewer auto-list `/flows/` in its UI? Not part of this change.
- Single compose service per tool, or one container running both viewer and MCP server?
