# Changelog

All notable changes to this project will be documented in this file. This project uses [Semantic Versioning](https://semver.org/)

Releases before v1.1.5 predate this file — see the [GitHub releases](https://github.com/homebridge-plugins/homebridge-tuya-web/releases) for that history.

## v0.1.0 (Pending Release)

Initial experimental release under the new package name. Version 1.0.0 is reserved for completed feature coverage.

### Breaking changes

- Rename package to matterbridge-tuya-cloud; replace Homebridge host with Matterbridge 3.10.13+ (Node 22.13+).
- Replace legacy username/password cloud API with User Code + QR (default) or developer Access ID/Secret authentication.
- Modern cloud discovery initially supports plugs (cz/pc) only; other categories emit diagnostics.

### Added

- Writable plug channels with stable Tuya-derived identity, success-only state commits, serialized polling/commands and shutdown cancellation.
- Metadata-scaled current, voltage, power and energy through standard Matter electrical clusters; preserve zero and omit unknown units.
- QR session persistence and refresh, signed IoT Core v2 project/model/shadow APIs, mocked transport and real endpoint tests.

## v1.1.7 (Historical unreleased changes)

### Changed

- chore: allow dependency install scripts by package name rather than pinned version, so a version bump cannot silently block a native build

## v1.1.6 (2026-07-31)

### Changed

- chore(deps): bump axios from 1.5.1 to 1.6.0
- chore(deps): bump serialize-javascript and mocha
- chore(deps): bump axios from 1.6.0 to 1.7.4
- chore(deps-dev): bump braces from 3.0.2 to 3.0.3
- chore(deps): bump ip and homebridge
- chore(deps-dev): bump lodash from 4.17.21 to 4.17.23
- fix: compile against the service types in the current hap-nodejs
- chore(github): replace the workflows with the shared org ones, and drop the credentials-only test
- chore: publish under the homebridge plugins org
- fix: add request timeout to Tuya Web API calls (@insainty)
- chore: ignore the jetbrains ide folder
- chore: approve the fsevents install script to silence the npm install warning
- chore(deps): update prettier and reformat to match its new style
- chore(deps): update every dependency to its latest, moving to typescript 6 and eslint 10

## v1.1.5 (2023-10-08)

### Changed

- Last release published by the original maintainer, before the plugin moved to the Homebridge Plugins org.
