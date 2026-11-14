---
name: docker-smoke-test
description: Build and smoke-test the flow-animator Docker images (viewer on host :3030, MCP + Flow API on :8081) with docker compose. Use after changing the Dockerfile, .dockerignore, docker/nginx.conf, docker-compose.yml, src/ files, or before a release.
---

# Docker smoke test

Dockerfile stages: `mcp` (node:22-alpine, port 8081) and `viewer` (nginx-unprivileged, container port 8080, published on host 3030 by compose, the default last stage). Compose file: `docker-compose.yml`; nginx config: `docker/nginx.conf`. The `./flows` folder is mounted into both (viewer serves `/flows/<name>.flow.json`; MCP uses `/flows`).

## Steps
1. Pre-check: `node --test` and `node validate.js examples/order-flow.flow.json`.
2. Build and start from the repo root: `docker compose up --build -d` (slow; use a long timeout or background).
3. Health: `curl -fsS http://localhost:3030/healthz` and `curl -fsS http://localhost:8081/healthz`.
4. Viewer: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3030/` must print 200 (nginx `try_files` falls back to `index.html`). Fetch `/examples/order-flow.flow.json` and every script `index.html` references (for example `/flow-core.js`, `/src/playback/flow-gateway/flow-gateway.js`); all must be 200.
5. Flow API through nginx: `curl -fsS http://localhost:3030/api/flows` returns a JSON list with revisions. Round trip: `PUT /api/flows/smoke` with a valid flow, `GET` it and note the `ETag`, `PUT` with a wrong `If-Match` expecting 412, then `DELETE /api/flows/smoke`. If `MCP_TOKEN` is set, add `Authorization: Bearer <token>`.
6. MCP: `POST http://localhost:8081/mcp` with JSON-RPC `initialize`, then `tools/list` (headers `Content-Type: application/json`, `Accept: application/json, text/event-stream`). GET on `/mcp` failing is expected (POST only).
7. `docker compose ps` shows both services healthy; then `docker compose down`.

## Common failures
- Blank viewer or 404 on a script: the `.dockerignore` allowlist (`*` then `!path`) or a missing `COPY` in the matching Dockerfile stage.
- `/` returns 404: the nginx `try_files` fallback to `index.html`.
- MCP cannot write flows on Linux: `chmod a+w flows` (the container runs as non-root).
- Port 8081 is bound to `127.0.0.1` by design.

Report exact commands and output for failures. Do not push images or change hosting without approval. The `deployment` agent (`.claude/agents/deployment.md`) owns this area.
