---
name: release
description: Cut a flow-animator release: choose the semver version, move CHANGELOG Unreleased entries under a dated heading, verify (tests, validator, bundle, Docker), and prepare the tag. Use when the user asks to release, version, or tag.
---

# Release

Follow the `deployment` agent's rules (`.claude/agents/deployment.md`). `CHANGELOG.md` uses Keep a Changelog and semver; history starts at `0.1.0 - 2026-11-07`.

## Steps
1. Be on `main`, up to date, with a clean tree. Git network commands on this machine need `git -c http.sslBackend=schannel ...`.
2. Verify:
   - `node --test`
   - `node validate.js examples/order-flow.flow.json` and every committed `flows/*.flow.json`
   - `node build-standalone.js`, then open the single-file bundle offline and load an example (`browser-check`)
   - the `docker-smoke-test` skill
3. Pick the version from `## [Unreleased]`: breaking format/API change is major (minor while 0.x), Added is minor, Fixed or internal Changed is patch. A change to the `flow-animator/1` format needs the user's decision.
4. Edit `CHANGELOG.md`: put the Unreleased entries under `## [X.Y.Z] - YYYY-MM-DD` (today) and leave a fresh empty `## [Unreleased]` above. Keep the Added/Changed/Fixed groups. Grep for the old version string elsewhere.
5. Commit directly to `main` (project rule: no PRs), message `Release X.Y.Z`.
6. Ask for explicit approval before `git tag vX.Y.Z`, pushing tags, publishing images, or creating a GitHub release. Once approved: `git -c http.sslBackend=schannel push origin main --tags`. Release notes = the new CHANGELOG section.
