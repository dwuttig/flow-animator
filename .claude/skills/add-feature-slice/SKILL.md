---
name: add-feature-slice
description: Add a feature to flow-animator the project's DDD way: spec in docs/features, plan in docs/plans, then a vertical slice with tests, changelog and docs. Use when starting any non-trivial feature, format change or new capability.
---

# Add a feature as a vertical slice

Read `docs/architecture.md` first (bounded contexts: Flow Modeling, Layout, Playback, Flow Library, Distribution; dependency rule; contributor rules) and `docs/ubiquitous-language.md`. Hard constraints: zero runtime dependencies, no build step, one JSON file per Flow, agents never specify coordinates, domain code runs in browser and Node.

For a vague idea, run `grill-with-docs` first.

## Steps
1. **Spec**: copy `docs/features/TEMPLATE.md` to `docs/features/<short-name>.md`. Name the bounded context and slice; fill Problem, Goals/Non-goals, Behaviour, new domain terms, file-format impact (none / additive / breaking). Index it in `docs/features/README.md`. The `architect` agent (`.claude/agents/architect.md`) can write spec and plan; it only writes to `docs/`.
2. **Plan**: copy `docs/plans/TEMPLATE.md` to `docs/plans/<short-name>.md` (approach, ordered steps by slice, files touched, risks, verification, changelog line). Index it in `docs/plans/README.md`. Resolve open questions, or flag them to the user, before coding.
3. **Implement** (the `software-engineer` agent follows the same rules):
   - One folder per use case: `src/<context>/<slice>/<slice>.js` plus `<slice>.test.js`. Existing examples: `src/flow-library/apply-edit/`, `src/playback/flow-gateway/`, `src/playback/save-flow/`.
   - Plain script files, with a UMD wrapper if used in both browser and Node. Domain logic imports no DOM/fs/HTTP/stdio; I/O sits at the slice edge.
   - Cross-context calls only via public APIs. Validation lives only in Flow Modeling (`flow-core.js`); never copy rules into UI or transports.
   - Add behaviour as a new slice instead of stretching a shared helper.
   - Format changes: update `flow.schema.json`, `flow-core.js` validation, `validate.js` and the README format section together.
   - Use the `tdd` skill for the code.
4. **Wire up**: a browser slice needs a `<script>` tag in `index.html` (dependency order), a `COPY` line in the `viewer` stage of `Dockerfile`, and, if it is outside the current allowlist, an entry in `.dockerignore` (it starts with `*`; `src/**` is already allowed). A Node slice used by the MCP server needs a `COPY` in the `mcp` stage. Check `build-standalone.js` includes it.
5. **Test**: `node --test` (node:test + node:assert, no dependencies). Slice tests sit next to the slice; cross-context contract tests go in `test/`.
6. **Docs**: add terms to `docs/ubiquitous-language.md`, update `README.md` if user-facing, and add an entry under `## [Unreleased]` in `CHANGELOG.md` (Added / Changed / Fixed).
7. Set the spec and plan Status to done. Verify with `docker-smoke-test` and `browser-check` when Distribution or Playback is touched.

Project rule: commit and merge directly to `main`, no PRs.
