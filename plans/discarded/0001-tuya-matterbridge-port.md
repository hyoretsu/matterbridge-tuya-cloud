# Port Tuya Web to Matterbridge

Status: superseded by [modern cloud plug work](../0002-tuya-cloud-plugs.md). Previous local-completion claim overstated production acceptance; timer/backoff scheduling, full persisted restart and hardware coverage were incomplete. Garage remains unavailable because legacy Tuya data lacks mandatory closure error/safety state. Hardware acceptance outstanding for every category.

## Approved scope

Convert repository to Matterbridge-only `matterbridge-tuya`. Preserve Tuya cloud client, existing categories, configuration and available capabilities. Garage uses native Closure Control only; never substitute Window Covering. Node baseline 22.12+. No publishing, pushes, remote jobs or live cloud tests without explicit per-instance authorization.

## Execution steps

- [x] 1. Verify concrete Matterbridge SDK version and Closure Control support; record minimum version. Convert entrypoint to ESM dynamic-platform factory, NodeNext and explicit import extensions. Use documented `matterbridge/*` exports and locally linked host SDK; exclude host and `@matter/*` dependencies. Rename metadata, packaging, installation and scripts.
- [x] 2. Remove Homebridge coupling from cloud client; extract shared modes. Preserve authentication, regions, commands, timeouts and conversions. Add cancellation and bounded refresh retries. Add serialized, disposable device controllers with cached state/subscriptions; failed commands preserve state and propagate errors. Configuration/helper replacement lands with host conversion.
- [x] 3. Implement start/configure/shutdown and stable Tuya-ID identity. Add default config/schema, overrides/filtering/scenes. Discovery interval defaults/minimum 615 seconds; state interval defaults/minimum 65 seconds, zero disables. Sequential nonoverlapping polling with rate-limit backoff. Reconcile only valid successful discoveries; transient failures retain devices/state. Unregister only when configured.
- [x] 4. Map switch/outlet to On/Off Plug-in Unit; dimmer/light to capability-dependent lights; temperature sensor, fan, thermostat, window covering, momentary scene. Garage native closure gate produces explicit unsupported-data diagnostic, never substitute endpoint. Advertise supported features only. Preserve limits/factors/overrides/whitelists. Correct conversions and zero handling. Scenes reset after successful On; Off makes no request. Unknown cover positions stay unknown. Tuya online state controls reachability; transient errors do not imply offline.
- [x] 5. Add colocated mocked client/controller/conversion tests and local integration tests under `tests/` with real endpoints for usable categories and garage diagnostics. Validate lifecycle cleanup, identity, reconciliation, clusters, handlers, polling and failed commands. Verify schema/default agreement, migrations, clean ESM loading and tarball. Build and functional tests; normal hook-driven commits with local user identity and Codex trailer. Document restart-required configuration and controller differences.

Each coherent step updates this file and receives a local Conventional Commit. User adjustments amend preceding delivery where appropriate.

## Acceptance

Local: plugin loads; fixture endpoints register; correct command payloads and failure propagation; state polling updates attributes; repeated shutdown leaves no active resources. Authentication/refresh, cancellation, rate limits, malformed responses and boundary conversions covered. Hardware/controller acceptance remains separate and requires explicit authorization for each external test. Report every untested category; full garage coverage requires verified native SDK and mandatory device state.

## Progress / resume notes

- Initial worktree clean. Original project was CommonJS Homebridge plugin, version 1.1.6, without installed project dependencies.
- Local Git identity: Aran Leite <hyoretsu@gmail.com>. Repository has sample hooks only; no active commit hook found.
- Initial SDK search found no Matterbridge installation or npm cache entries.
- SDK download explicitly authorized; all development commands use Bun. Downloaded Matterbridge 3.10.13, confirmed native Closure Control exports. Host needs Node 22.13+ on Node 22; plugin keeps 22.12+ metadata baseline.
- SDK transitives contain Matter 0.17.6/0.17.9 duplicates. Development setup aligns Matter dependencies to 0.17.9; `tools/sdk.package.json` records overrides and `sdk:link` checks Endpoint compatibility.
- Client/controller unit acceptance: 10 tests / 30 assertions pass. Cancellable HTTP/auth wait, refresh timers/backoff, malformed responses, regions, zero commands, HTTP429, unsupported commands, serialization, failed-write retention and disposal covered.
- Runtime host conversion complete: original Homebridge accessories/helpers removed, ESM factory/platform and capability-specific bindings added. Bun lockfile replaces npm lockfile; no host or Matter dependency declarations. Source/package work forms one coherent conversion commit because ESM, replacement platform and mappings must change together.
- Attached tests found synchronous Matter change-event constraint. Fan/thermostat cloud writes now join transaction commit phase one; cloud failures roll back Matter state. Local attribute polling never triggers cloud writes.
- Final functional run: `bun run test` passed 44 tests, 219 assertions across seven files. Real ServerNode endpoints use simulated networking, not live mDNS/pairing. Includes remote-write branch transactions, failed writes, scene/cover commands, sequential queries, reconciliation, rename identity, duplicate names, retained/default shutdown, idempotent shutdown and new-instance restart.
- `bun run build` passed after final runtime changes. `bun run test:package` passed after final build: 72 files, clean ESM factory loading with linked host SDK, required config/schema included, no host dependency declarations or unwanted bundled files.
- No live Tuya requests, hardware/controller tests, publishing, pushes, deployments or remote CI execution performed. All categories remain hardware-untested; garage full coverage blocked by absent mandatory data. Climate/light instances missing required data/capabilities produce explicit diagnostics.
- Resume only for authorized hardware acceptance or newly supplied mandatory device data. SDK provisioning is documented in README; configuration changes require restart.
