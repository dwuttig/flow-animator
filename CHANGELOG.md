# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Docker: `/` returned 404 because the nginx `try_files` did not fall back to `index.html`.

### Added
- Docker deployment: `Dockerfile`, `docker-compose.yml`, nginx config; `./flows` volume for user flows (see `docs/features/docker-deployment.md`).
- Claude Code subagents in `.claude/agents/`: software-engineer, architect, deployment, tester.
- `CHANGELOG.md` to track changes.
- `docs/features/` for feature specs and `docs/plans/` for implementation plans, each with a template.

## [0.1.0] - 2026-11-07

### Added
- Initial viewer (`index.html`), shared core (`flow-core.js`), JSON schema, CLI validator, standalone bundler and an example flow.
