# Tuya Cloud plug-first implementation

Status: code complete; npm publication and live validation pending. Supersedes [legacy cloud port](../discarded/0001-tuya-matterbridge-port.md).

User scope: rename package to matterbridge-tuya-cloud; npm release with proper version bump; current Tuya cloud APIs; both User Code/QR (default) and developer credentials; plugs first, including electrical readings shown in screenshot. No pushes/remote CI or live account/device tests performed.

- [x] Rename package/config/schema/runtime identity; prepare initial experimental version 0.1.0; reserve 1.0.0 for completed feature coverage.
- [x] Replace legacy cloud runtime with signed OpenAPI and encrypted device-sharing QR authentication; private persisted sharing sessions, cancellation, on-demand token renewal.
- [x] Normalize writable plug channels and metadata-scaled current/voltage/power/energy; reject unsupported categories explicitly. Add standard Matter electrical clusters when readings available.
- [x] Complete protocol/lifecycle, metering endpoint and package validation; document setup and limitations.
- [x] Finish GitHub build and tag-based npm publication configuration; commit/integrate locally.

Known boundaries: no live cloud authentication, cloud writes, pairing or controller tests authorized. Default QR flow uses public Home Assistant device-sharing client ID/schema from upstream; service acceptance for standalone use must be validated. Developer IoT Core v2 endpoints require matching project region, linked project devices and permissions. No realtime push subscription yet. Plug configuration features (child lock, light mode, overcharge, power-on behavior, countdown), lights and IR are not mapped in modern adapter. Energy requires explicit recognized unit and scale; no guessed readings or incremental accumulation.

Resumption: implementation committed and fast-forward integrated into original main branch at /home/hyoretsu/Projects/matterbridge-tuya. Isolated task worktree and merged branch removed; working tree clean. npm login check returned 401; publication requires credentials/package ownership and workflow availability. Build/tests use Bun and locally downloaded Matterbridge 3.10.13 SDK. No active project hooks found; do not manually lint/format/typecheck before commit.

Validation so far: 49 full-suite fixture tests passed before final energy/auth regression additions; 20 targeted tests passed after additions. Real metering endpoints update zero values. QR SVG fixture visually inspected in browser at 1280×800 and 390×844; no live QR/account, actual Matterbridge configuration frontend, or controller validation. Final full build passed; 52 tests / 273 assertions across 8 files passed; 91-file package verified with clean ESM loading against linked SDK. Release guard accepts v0.1.0 and rejects mismatched tags/branches. npm package name lookup returned 404 (available at check time).

Pending developer validation: actual Tuya QR acceptance for standalone public sharing client, developer-project permissions, physical switch/meters, Node/full Matterbridge loader, pairing/controller UI, persisted host restart, polling cadence/backoff and complete resource audit. No claim of production readiness. npm publication pending authentication (local whoami 401), configured NPM_TOKEN and user push/tag; no remote release performed.

Release correction: user requested v0 while features remain incomplete. Package/runtime/test metadata and release instructions now use 0.1.0; 1.0.0 reserved for completed feature coverage. npm authentication rechecked: 401 Unauthorized; no publication performed.
