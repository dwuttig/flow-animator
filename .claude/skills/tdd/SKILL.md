---
name: tdd
description: Build a feature or fix a bug test-first in flow-animator with node:test, one failing test at a time. Use when implementing a concrete behaviour with observable inputs and outputs, or reproducing a bug. Adapted from the aihero.dev tdd skill.
---

# Test-driven development

Loop: write one failing test, write just enough code to pass it, repeat for the next behaviour. No bulk-writing tests ahead of the code (horizontal slicing).

## Rules
1. **Agree the seam first.** Before the first test, name the public boundary you will test at (a slice's exported function, `flow-core.js` `load`/`validate`, an MCP tool result, an HTTP endpoint of the Flow API, the `validate.js` exit code) and tell the user. Don't test at an unagreed seam.
2. **Where tests live:** next to the slice as `src/<context>/<slice>/<slice>.test.js`; cross-context contracts in `test/`. Run with `node --test` (built-in `node:test` and `node:assert`, no dependencies). Existing examples: `test/mcp.test.js`, `test/flow-api.test.js`, `src/playback/flow-gateway/flow-gateway.test.js`.
3. **Test behaviour, not internals.** A refactor that keeps behaviour must not break tests.
4. **No tautologies:** expected values are literals, not computed the way the code computes them.
5. **Mocks only at system boundaries** (network, clock, randomness, filesystem outside a temp dir). Never mock your own modules. Prefer a real temp `FLOW_DIR` and a real HTTP server on port 0.
6. For a bug, first write a failing test that reproduces it, then fix.
7. Run the new test and see it fail for the right reason before implementing; run the whole suite before finishing.
8. Refactor only after green, in small steps, keeping tests green. Do not weaken or skip a test to make it pass.

Fits concrete behaviours. For pure visual/layout feel, use `browser-check` instead. See `tester` agent (`.claude/agents/tester.md`).
