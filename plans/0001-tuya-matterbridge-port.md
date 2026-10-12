# Port Tuya Web to Matterbridge

Status: started; SDK compatibility gate blocked pending local SDK or explicit npm download authorization.

## Approved scope

Convert repository to Matterbridge-only `matterbridge-tuya`. Preserve Tuya cloud client, existing categories, configuration and available capabilities. Garage uses native Closure Control only; never substitute Window Covering. Node baseline 22.12+. No publishing, pushes, remote jobs or live cloud tests without explicit per-instance authorization.

## Execution steps

- [ ] 1. Verify concrete Matterbridge SDK version and Closure Control support; record minimum version. Convert entrypoint to ESM dynamic-platform factory, NodeNext and explicit import extensions. Use documented `matterbridge/*` exports and locally linked host SDK; exclude host and `@matter/*` dependencies. Rename metadata, packaging, installation and scripts.
- [x] 2. Remove Homebridge coupling from cloud client; extract shared modes. Preserve authentication, regions, commands, timeouts and conversions. Add cancellation and bounded refresh retries. Add serialized, disposable device controllers with cached state/subscriptions; failed commands preserve state and propagate errors. Configuration/helper replacement lands with host conversion.
- [ ] 3. Implement start/configure/shutdown and stable Tuya-ID identity. Add default config/schema, overrides/filtering/scenes. Discovery interval defaults/minimum 615 seconds; state interval defaults/minimum 65 seconds, zero disables. Sequential nonoverlapping polling with rate-limit backoff. Reconcile only valid successful discoveries; transient failures retain devices/state. Unregister only when configured.
- [ ] 4. Map switch/outlet to On/Off Plug-in Unit; dimmer/light to capability-dependent lights; temperature sensor, fan, thermostat, window covering, native garage closure, momentary scene. Advertise supported features only. Preserve limits/factors/overrides/whitelists. Correct conversions and zero handling. Scenes reset after successful On; Off makes no request. Unknown cover positions stay unknown. Missing garage SDK/data gives explicit diagnostics. Tuya online state controls reachability; transient errors do not imply offline.
- [ ] 5. Add colocated mocked client/controller/conversion tests and local integration tests under `tests/` with real endpoints for all categories. Validate lifecycle cleanup, identity, reconciliation, clusters, handlers, polling and failed commands. Verify schema/default agreement, migrations, clean ESM loading and tarball. Build and functional tests; normal hook-driven commits with local user identity and Codex trailer. Document restart-required configuration and controller differences.

Each coherent step updates this file and receives a local Conventional Commit. User adjustments amend preceding delivery where appropriate.

## Acceptance

Local: plugin loads; fixture endpoints register; correct command payloads and failure propagation; state polling updates attributes; repeated shutdown leaves no active resources. Authentication/refresh, cancellation, rate limits, malformed responses and boundary conversions covered. Hardware/controller acceptance remains separate and requires explicit authorization for each external test. Report every untested category; full garage coverage requires verified native SDK and mandatory device state.

## Progress / resume notes

- Initial worktree clean. Existing project remains CommonJS Homebridge plugin, version 1.1.6; no installed project dependencies.
- Local Git identity: Aran Leite <hyoretsu@gmail.com>. Repository has sample hooks only; no active commit hook found.
- No Matterbridge installation in global npm directory; no Matterbridge entries in npm cache. Local filesystem SDK search in progress.
- SDK download explicitly authorized; all development commands use Bun. Downloaded Matterbridge 3.10.13, confirmed native Closure Control exports. Host needs Node 22.13+ on Node 22; plugin keeps 22.12+ metadata baseline.
- SDK transitives contain Matter 0.17.6/0.17.9 duplicates. Development setup aligns Matter dependencies to 0.17.9; documented SDK override manifest will accompany host conversion.
- Client/controller unit acceptance: 10 tests / 30 assertions pass. Cancellable HTTP/auth wait, refresh timers/backoff, malformed responses, regions, zero commands, HTTP429, unsupported commands, serialization, failed-write retention and disposal covered.
- Host/config/mapping implementation underway. Garage blocked by missing mandatory Tuya closure error/safety state; explicit diagnostic implemented, no Window Covering fallback. Attached-endpoint tests in progress using simulated Matter network.
