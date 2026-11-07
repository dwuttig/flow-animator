# Plan: Docker deployment

- Status: draft
- Spec: `docs/features/docker-deployment.md`

## Approach
Static files behind nginx-unprivileged. No build stage, matching the project's zero-dependency rule. A bind-mounted `flows/` directory is the shared contract with the future MCP server. Node-based tools stay out of the image.

## Steps
1. [x] `Dockerfile`, `docker/nginx.conf`, `.dockerignore`
2. [x] `docker-compose.yml` with `./flows` mount and an MCP placeholder
3. [x] Update `deployment` agent, `CHANGELOG.md`, README run instructions
4. [ ] Build and smoke-test the image (not yet done: Docker Hub rate limit in the authoring sandbox)
5. [ ] Add the MCP service to compose once it exists

## Files touched
`Dockerfile`, `docker-compose.yml`, `docker/nginx.conf`, `.dockerignore`, `.gitignore`, `flows/.gitkeep`, `.claude/agents/deployment.md`, `CHANGELOG.md`, `README.md`

## Risks
- nginx config unverified until step 4.
- A host-mounted `flows/` may have permissions the non-root nginx user cannot read.

## Verification
`docker compose up --build`, then `curl localhost:8080/healthz`, open `/` and load `/examples/order-flow.flow.json`, drop a file in `./flows` and `curl localhost:8080/flows/`.

## Changelog entry
Docker image and compose file serving the viewer.
