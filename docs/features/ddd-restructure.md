# Restructure code into bounded contexts and vertical slices

- Status: in progress (Modeling, Layout, Playback done; Library transport and Distribution slices remain)
- Plan: `docs/plans/ddd-restructure.md`
- Bounded context: all (cross-cutting refactor); see [../architecture.md](../architecture.md)

## Problem
The architecture is now documented as DDD (bounded contexts, vertical slices), but the code is still organised by file: `flow-core.js` mixes Flow Modeling and Layout, `index.html` holds all Playback code, and `flow-store.js`/`mcp-server.js` mix Edits, persistence and transport. New work has no obvious home and contexts can reach into each other.

## Goals
- Code layout matches the target layout in `docs/architecture.md`.
- Each context exposes one public API; no imports of another context's internals.
- Behaviour is unchanged: same file format, same CLI output, same MCP tools, same viewer.
- Existing entry points keep working (facades) so Docker, README and MCP clients are not broken.

## Non-goals
- No format change, no new features, no new dependencies, no build step.
- No framework or bundler; plain scripts and UMD stay.

## Behaviour
None visible. `node validate.js`, `node build-standalone.js`, `node --test`, `docker compose up --build` and the viewer behave exactly as before.

## File-format impact
None.

## Open questions
- Keep the root facades permanently, or remove them in a later major version?
- Split `index.html` into multiple script files: done. The page lists the scripts, `viewer.js` wires them, and the standalone bundler and browser export read the page manifest.
- Should the glossary names replace any current identifiers (e.g. "beat" is already used)?
