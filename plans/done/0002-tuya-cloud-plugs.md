# Tuya Cloud plug-first implementation

Status: code complete for the experimental plug/light milestone; npm publication and live validation pending. Supersedes [legacy cloud port](../discarded/0001-tuya-matterbridge-port.md).

User scope: rename package to matterbridge-tuya-cloud; npm release with proper version bump; current Tuya cloud APIs; both User Code/QR (default) and developer credentials; plugs first, including electrical readings shown in screenshot. No pushes/remote CI or live account/device tests performed.

- [x] Rename package/config/schema/runtime identity; prepare initial experimental version 0.1.0; reserve 1.0.0 for completed feature coverage.
- [x] Replace legacy cloud runtime with signed OpenAPI and encrypted device-sharing QR authentication; private persisted sharing sessions, cancellation, on-demand token renewal.
- [x] Normalize writable plug channels and metadata-scaled current/voltage/power/energy; reject unsupported categories explicitly. Add standard Matter electrical clusters when readings available.
- [x] Complete protocol/lifecycle, metering endpoint and package validation; document setup and limitations.
- [x] Finish GitHub build and tag-based npm publication configuration; commit/integrate locally.

Initial milestone boundaries (historical): no live cloud authentication, cloud writes, pairing or controller tests authorized. Default QR flow uses public Home Assistant device-sharing client ID/schema from upstream; service acceptance for standalone use must be validated. Developer IoT Core v2 endpoints require matching project region, linked project devices and permissions. No realtime push subscription yet. Plug configuration features (child lock, light mode, overcharge, power-on behavior, countdown), lights and IR are not mapped in modern adapter. Energy requires explicit recognized unit and scale; no guessed readings or incremental accumulation.

Initial milestone integration (historical): implementation committed and fast-forward integrated into original main branch at /home/hyoretsu/Projects/matterbridge-tuya. Isolated task worktree and merged branch removed; working tree clean. npm login check returned 401; publication requires credentials/package ownership and workflow availability. Build/tests use Bun and locally downloaded Matterbridge 3.10.13 SDK. No active project hooks found; do not manually lint/format/typecheck before commit.

Validation so far: 49 full-suite fixture tests passed before final energy/auth regression additions; 20 targeted tests passed after additions. Real metering endpoints update zero values. QR SVG fixture visually inspected in browser at 1280×800 and 390×844; no live QR/account, actual Matterbridge configuration frontend, or controller validation. Final full build passed; 52 tests / 273 assertions across 8 files passed; 91-file package verified with clean ESM loading against linked SDK. Release guard accepts v0.1.0 and rejects mismatched tags/branches. npm package name lookup returned 404 (available at check time).

Pending developer validation: actual Tuya QR acceptance for standalone public sharing client, developer-project permissions, physical switch/meters, Node/full Matterbridge loader, pairing/controller UI, persisted host restart, polling cadence/backoff and complete resource audit. No claim of production readiness. npm publication pending authentication (local whoami 401), configured NPM_TOKEN and user push/tag; no remote release performed.

Release correction: user requested v0 while features remain incomplete. Package/runtime/test metadata and release instructions now use 0.1.0; 1.0.0 reserved for completed feature coverage. npm authentication rechecked: 401 Unauthorized; no publication performed.

## Continued implementation

- [x] Correct developer request-signature LF separators; previous mock duplicated the same literal-escape bug. Add fixed golden-vector regression.
- [x] Map supported plug configuration using standard Matter controls; never mislabel configuration as relay power.
- [x] Add modern light datapoints and metadata-based conversions with mocked protocol and real endpoint validation.
- [x] Update scope documentation, run build/tests/package acceptance, commit/integrate locally and archive this record again.

Current isolated task worktree: ~/.local/share/worktrees/matterbridge-tuya/cloud-controls, branch feat/cloud-controls. No live cloud requests/writes or remote release authorized for this continuation.

Plug-setting step: added capability-checked Mode Select endpoints for writable Boolean/enum settings, stable enum ordering, failure rollback, per-physical-device serialization and query sharing. Build and 57 tests / 304 assertions passed. Countdown remains unmapped; controller display/hardware not validated.


Continued milestone: modern light discovery now maps Boolean power, metadata-scaled/stepped brightness, JSON v2 HSV and explicitly bounded Kelvin temperature. Atomic light batches preserve latest queued color components and commit quantized reported state. Native OnOff/ModeSelect use Matter transaction phase one to avoid nested toggle conflicts and roll back failed writes; unsupported fades/startup/timer writes fail explicitly.

Validation: local build passed; full mocked suite passed 72 tests / 377 assertions across 12 files, including native toggle/startup rejection, physical-device query sharing, stale discovery/write races, partial color updates and real endpoint HTTP-to-Matter light commands. No live Tuya, physical light or controller UI acceptance performed. Countdown, IR, modern fan/climate/cover, raw/hex HSV and push subscriptions remain outside this milestone. Version remains unpublished 0.1.0. Package acceptance passed: 103 files; clean ESM factory loads against the host SDK. Post-commit pre-merge type check passed. Continued milestone integrated locally into main; refreshed artifacts/matterbridge-tuya-cloud-0.1.0.tgz from the verified build. No remote actions performed.
