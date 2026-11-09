# Plan: Restructure code into bounded contexts and vertical slices

- Status: in progress (steps 5 and 6 remain)
- Spec: `docs/features/ddd-restructure.md`

## Approach
Strangler migration: move one context at a time behind a public `index.js`, keep the old root files as one-line facades that re-export it, and run the full test suite after each step. Order follows dependency direction (upstream first): Flow Modeling, Layout, Flow Library, Distribution, Playback. Each step is a separate commit and can be its own PR.

The MCP server work (PR #5) is already merged, so Flow Library moves from current `main`; no coordination branch is needed. Any open PR touching `flow-core.js`, `flow-store.js` or `mcp-server.js` must land first or be rebased after the relevant step.

Alternative rejected: big-bang move in one PR. It is hard to review and risks breaking Docker and MCP clients at once.

## Steps
1. [x] Add characterization tests for `flow-core.js` (validate, normalize, layout determinism on all `examples/`) so behaviour is pinned before moving code.
2. [x] Flow Modeling: create `src/flow-modeling/` with slices `parse-flow`, `validate-flow`, `derive-beats` and `index.js`; keep UMD wrapper.
3. [x] Layout: create `src/layout/` (`layout-flow`, `route-edges`); depends only on Modeling's public API.
4. [x] Make root `flow-core.js` a facade re-exporting Modeling + Layout (`parse`, `validate`, `normalize`, `layout`, `load`, `loadDoc`) so the browser and `validate.js` are unchanged.
5. [ ] Flow Library: split `flow-store.js` into `flow-store/` and one slice per Edit under `edit-flow/`; move transport to `mcp-transport/`; `mcp-server.js` becomes the entry facade. Tools map to Edits in the slice, not in transport.
6. [ ] Distribution: move `validate.js` and `build-standalone.js` logic into slices, keep root files as entry points; update Dockerfile `COPY` lines and `.dockerignore`.
7. [x] Playback: extract script from `index.html` into `src/playback/` slices once steps 1 to 6 are green; update `index.html` script tags and the standalone bundler to inline them in order.
8. [x] Add a dependency-rule check (`test/architecture.test.js`) that fails if a context requires another context's internals or if Modeling imports anything.
9. [x] Update README "Files" table, `docs/architecture.md` if names changed, and agent files if paths changed.

## Files touched
`flow-core.js`, `flow-store.js`, `mcp-server.js`, `validate.js`, `build-standalone.js`, `index.html`, `Dockerfile`, `.dockerignore`, `README.md`, new `src/**`, new tests.

## Risks
- Docker image forgets to copy `src/`: verify with `docker compose up --build` and `/healthz`, and an MCP call.
- Browser `<script>` ordering and UMD globals break after splitting: verify in headless Chromium.
- Standalone bundle must still work offline; rebuild and open it.
- Merge conflicts with concurrent feature work: keep each step small and merge quickly.

## Verification
- `node --test`
- `for f in examples/*.flow.json; do node validate.js "$f"; done`
- `node build-standalone.js` then open output with no network
- Playwright: load `index.html`, load an example, play/step/scrub, no console errors
- `docker compose up --build`, `/healthz`, MCP `list_flows`

## Changelog entry
Changed: internal code reorganised into bounded contexts and vertical slices (no behaviour change).
