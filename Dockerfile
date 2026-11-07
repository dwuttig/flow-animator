# flow-animator images. No build step, no runtime dependencies.
#   docker build .                    -> viewer (default, last stage)
#   docker build --target mcp .       -> MCP server for creating/editing flows

# ---- MCP server: Node, HTTP on 8081 (stdio also works: docker run -i ... node mcp-server.js) ----
FROM node:22-alpine AS mcp
WORKDIR /app
COPY flow-core.js flow-store.js mcp-server.js flow.schema.json README.md ./
COPY src/flow-library/apply-edit/apply-edit.js ./src/flow-library/apply-edit/
ENV FLOW_DIR=/flows MCP_HOST=0.0.0.0 PORT=8081
# Flow files are shared with the viewer through this volume.
VOLUME /flows
USER node
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8081/healthz || exit 1
CMD ["node", "mcp-server.js", "--http"]

# ---- Viewer: static files served by nginx ----
FROM nginxinc/nginx-unprivileged:1.27-alpine AS viewer

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

WORKDIR /usr/share/nginx/html
COPY index.html flow-core.js flow.schema.json ./
COPY src/flow-library/apply-edit/apply-edit.js ./src/flow-library/apply-edit/
COPY src/playback/edit-flow/edit-flow.js ./src/playback/edit-flow/
COPY examples/ ./examples/

# User flow files live here. Mount a volume to serve your own *.flow.json
# (the MCP server writes to the same volume).
VOLUME /usr/share/nginx/html/flows

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
