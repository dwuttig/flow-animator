# flow-animator images. No build step, no runtime dependencies.
#   docker build .                    -> viewer (default, last stage)
#   docker build --target mcp .       -> MCP server for creating/editing flows

# ---- MCP server: Node, HTTP on 8081 (stdio also works: docker run -i ... node mcp-server.js) ----
FROM node:22-alpine AS mcp
WORKDIR /app
COPY flow-core.js flow-store.js mcp-server.js flow.schema.json README.md ./
COPY src/flow-library/ ./src/flow-library/
COPY src/flow-modeling/ ./src/flow-modeling/
COPY src/layout/ ./src/layout/
# Flows are stored in a SQLite database (FLOW_STORE=files switches back to a folder).
# /flows is the import source for existing *.flow.json files (or the store itself with FLOW_STORE=files).
ENV FLOW_STORE=sqlite FLOW_DB=/data/flows.db FLOW_DIR=/flows MCP_HOST=0.0.0.0 PORT=8081
RUN mkdir -p /data /flows && chown node:node /data /flows
VOLUME /data
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
COPY src/flow-modeling/flow-modeling.js ./src/flow-modeling/
COPY src/layout/layout.js ./src/layout/
COPY src/flow-library/flow-name/flow-name.js ./src/flow-library/flow-name/
COPY src/flow-library/apply-edit/apply-edit.js ./src/flow-library/apply-edit/
COPY src/playback/dialogs/dialogs.js ./src/playback/dialogs/
COPY src/playback/play-flow/play-flow.js ./src/playback/play-flow/
COPY src/playback/render-diagram/render-diagram.js ./src/playback/render-diagram/
COPY src/playback/view-options/view-options.js ./src/playback/view-options/
COPY src/playback/viewer/viewer.js ./src/playback/viewer/
COPY src/playback/edit-flow/edit-flow.js ./src/playback/edit-flow/
COPY src/playback/flow-gateway/flow-gateway.js ./src/playback/flow-gateway/
COPY src/playback/save-flow/save-flow.js ./src/playback/save-flow/
COPY src/playback/mcp-config/mcp-config.js ./src/playback/mcp-config/
COPY src/playback/export-flow/export-flow.js ./src/playback/export-flow/
COPY src/playback/record-video/record-video.js ./src/playback/record-video/
COPY src/playback/flow-menu/flow-menu.js ./src/playback/flow-menu/
COPY examples/ ./examples/

# User flow files live here. Mount a volume to serve your own *.flow.json
# (the MCP server writes to the same volume).
VOLUME /usr/share/nginx/html/flows

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
