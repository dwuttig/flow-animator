# flow-animator viewer: static files served by nginx. No build step, no runtime dependencies.
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

WORKDIR /usr/share/nginx/html
COPY index.html flow-core.js flow.schema.json ./
COPY examples/ ./examples/

# User flow files live here. Mount a volume to serve your own *.flow.json
# (the MCP server will write to the same volume).
VOLUME /usr/share/nginx/html/flows

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
