---
name: browser-check
description: Verify the flow-animator viewer (index.html) in a real browser: load a flow, play/step/scrub, editor mode, console errors, screenshots. Use after changing index.html, flow-core.js or any src/playback slice.
---

# Browser check of the viewer

The viewer is plain static files with no build. Serve the repo root (so relative scripts and `examples/` load) and drive it with the available browser tools (built-in browser `mcp__Claude_Browser__*`, or Playwright).

## Steps
1. Serve: `python -m http.server 8000` from the repo root (or `npx`-free equivalent), or use Docker (`docker-smoke-test` skill) at `http://localhost:3030`. `/api/flows` exists only with the MCP server behind nginx (Docker); without it the viewer is read-only, which is itself a case to check.
2. Open the page and check the console for errors before doing anything.
3. Load `examples/order-flow.flow.json` (file input, or `/?flow=<name>` when the API is available). Expect title, diagram, legend (2+ groups) and no validation errors.
4. Controls: Play, Pause, step forward/back, scrub the timeline, change speed. The packet moves along arrows, the step `detail` and `payload` text updates, and the trail of completed steps shows.
5. Editor mode (**Edit**): add a node and a step; try an invalid edit (unknown node id) and confirm it is rejected with a message; undo/redo; Download / Copy JSON. With the API: Save (Ctrl+S), Save as, Reload, and stale-revision conflict handling. Layout: editor in the left column, flow in the right; below 960px they stack.
6. A broken file (invalid JSON, unknown node) must show errors, not a blank page. If layout changed, also try `TB` direction and manual `col`/`row`.
7. Take screenshots at desktop and mobile (375x812) sizes when asked or when layout changed; reset viewport emulation afterwards.
8. Stop any server you started.

Report console errors, failed requests and screenshots as evidence; never weaken a check to pass. Run `node --test` first; see also the `tester` agent (`.claude/agents/tester.md`).
