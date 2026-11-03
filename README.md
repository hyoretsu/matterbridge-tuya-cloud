# matterbridge-tuya-cloud

Version 0.x tracks incomplete feature development; 1.0.0 is reserved for completed feature coverage.

Experimental Matterbridge plugin for Tuya / Smart Life cloud devices. Current cloud discovery targets smart plugs (Tuya categories cz and pc), with on/off and available electrical readings. This is not a complete LocalTuya replacement: modern light/IR mappings and plug configuration controls are not implemented.

Requires Matterbridge 3.10.13+ and a host-supported Node version (Node 22.13+ baseline). Development and release commands use Bun. The package contains no Matterbridge or @matter dependencies; the host provides them.

## Install

Once published, install **matterbridge-tuya-cloud** through Matterbridge's plugin manager. Version 0.1.0 is prepared locally; this README does not imply it is already available on npm.

For a local checkout:

```sh
bun install --frozen-lockfile
bun run sdk:link /absolute/path/to/matterbridge
bun run build
matterbridge --add /absolute/path/to/this/checkout
```

The development link helper currently checks exactly Matterbridge 3.10.13. Its transitive Matter libraries require a single compatible instance. To provision the recorded development SDK:

```sh
mkdir -p .sdk
cp tools/sdk.package.json .sdk/package.json
bun install --cwd .sdk --ignore-scripts
bun run sdk:link
```

Docker/add-on installations must keep plugin files and runtime dependencies inside persistent storage accessible from the container. Register the container path. Pair Matterbridge with Home Assistant's Matter integration if it is not already paired; preserve bridge storage and pairing across updates.

## User Code authorization (default)

1. In Smart Life or Tuya Smart, open Me → Settings → Account and Security and copy User Code.
2. Configure options.userCode in Matterbridge, then restart plugin.
3. Scan authorization QR with the app's scanner within three minutes. QR appears in terminal logs and is saved as tuya-cloud-login.svg in the plugin's storage directory under Matterbridge data. If frontend logs do not preserve QR layout, open the saved SVG on another screen.
4. Confirm authorization in the app. Discovery continues automatically. Later restarts reuse saved session; expired access tokens renew on demand.

```json
{
  "name": "matterbridge-tuya-cloud",
  "type": "DynamicPlatform",
  "debug": false,
  "unregisterOnShutdown": false,
  "options": {
    "authMode": "userCode",
    "userCode": "YOUR_USER_CODE",
    "pollingInterval": 615,
    "statePollingInterval": 65
  },
  "hiddenAccessories": []
}
```

QR protocol follows Tuya's [device-sharing SDK](https://github.com/tuya/tuya-device-sharing-sdk). Defaults use its public Home Assistant client ID and haauthorize schema, as used in [Home Assistant](https://github.com/home-assistant/core/blob/dev/homeassistant/components/tuya/const.py). This project is independent of Home Assistant/Tuya; standalone authorization acceptance has not been validated. options.sharingClientId and options.sharingSchema allow a separately authorized sharing application. There is no dedicated plugin web login page yet.

Sharing tokens reside in tuya-cloud-session.json with owner-only file permissions. They are secrets; do not commit/share them. If authorization is revoked, stop plugin, remove that session file, and restart to scan a new QR. Transient renewal failures surface errors and retain devices; they do not silently erase the session or remove devices.

## Developer credentials

Create a cloud project on Tuya Developer Platform, link your Smart Life/Tuya account, select its matching data center, and grant access to IoT Core token, project discovery, device details, model, query-property and issue-property APIs. Service availability, quotas and billing depend on your Tuya project; check your console.

```json
{
  "name": "matterbridge-tuya-cloud",
  "type": "DynamicPlatform",
  "options": {
    "authMode": "developer",
    "accessId": "YOUR_ACCESS_ID",
    "accessSecret": "YOUR_ACCESS_SECRET",
    "region": "us",
    "pollingInterval": 615,
    "statePollingInterval": 65
  }
}
```

Regions: us (Western America), usEast (Eastern America), eu (Central Europe), euWest (Western Europe), cn (China), in (India), sg (Singapore). Developer mode discovers devices authorized to the project, not a manually supplied account ID. Use hiddenAccessories with IDs or names to exclude devices.

Developer mode uses signed [IoT Core v2 APIs](https://developer.tuya.com/en/docs/cloud/device-connection-service?id=Kb0b8geg6o761): project device list, device details, thing model, shadow properties, and immediate property issue. The older /homeassistant/skill API and password login are removed. A permission error is reported explicitly; no silent legacy fallback.

## Plug behavior

| Capability | Behavior |
| --- | --- |
| On/off | Writable Boolean switch or switch_N datapoints; each channel gets a stable endpoint |
| Current | cur_current converted to Matter milliamps |
| Voltage | cur_voltage converted to Matter millivolts |
| Power | cur_power converted to Matter milliwatts |
| Energy | total_forward_energy (or explicitly verified configured counter) converted to cumulative imported milliwatt-hours |
| Reachability | Explicit Tuya online flag |

Only recognized units and explicit scale metadata produce readings. Missing/unknown metadata omits that measurement instead of guessing. Metering is attached to primary switch/switch_1 channel only, avoiding duplicate energy totals on multi-channel devices. Primary channel retains Tuya device ID; other channels use device ID plus datapoint code. Names never determine identity. Controller support determines presentation of standard Matter electrical clusters.

No child lock, indicator/light mode, overcharge protection setting, power-on behavior, countdown, raw/phase-packed metering, or daily/monthly energy history mapping yet. Energy is the reported cumulative counter; the plugin does not invent totals from incremental reports. add_ele is not assumed cumulative: if your device is verified to report a cumulative value there, configure energyCounters: [{"id":"DEVICE_ID","code":"add_ele"}]. Incorrectly treating increments as totals corrupts energy statistics. Category/device variants require fixtures and hardware validation before claiming support. Existing light/fan/thermostat/cover mapping code remains tested in isolation but modern cloud adapter does not discover those categories yet. IR and garage remain unsupported.

Discovery defaults/minimum 615 seconds. State polling defaults/minimum 65 seconds; 0 disables state queries. Queries are sequential and polling cycles never overlap. Rate limits back off; transient errors retain devices and last-known attributes. Only complete successful discovery reconciles removals. Commands commit cached state only after cloud success; unsupported operations return errors. Configuration changes require restart. Shutdown cancels network requests and timers; unregisterOnShutdown defaults false.

This is cloud control: server or Tuya cloud/internet outages interrupt Home Assistant control through this plugin. Smart Life/Tuya Smart app can still operate independently when server is down, provided devices and cloud remain online. LocalTuya can remain installed while testing; entity IDs and automations do not migrate automatically.

## Validation and release

```sh
bun run build
bun run test
bun run test:package
```

Tests use mocked cloud HTTP and simulated Matter networking with real endpoints. Neither login mode, physical plug readings, pairing, nor full host/controller restart has been validated on hardware. No live Tuya account requests occur during tests.

The **Build and release plugin** workflow builds/tests pushes to main, pull requests and manual runs. Successful runs provide a downloadable matterbridge-tuya-cloud artifact containing the tested .tgz (30-day retention).

To enable npm releases, configure GitHub Actions secret NPM_TOKEN with publish permission for matterbridge-tuya-cloud. The publication job uses the npm environment, where you can require approval. Bun uses NPM_CONFIG_TOKEN; no npm CLI is used. [Bun publishing documentation](https://bun.sh/docs/pm/cli/publish).

After reviewing and pushing the prepared code yourself, create/push a stable version tag matching package.json (for this release, v0.1.0). Tag pushes build and test first, verify the exact version, then publish that same tarball to npm with latest tag. Branch pushes, pull requests and manual build runs never publish. Only trigger a release after confirming account rights and live compatibility appropriate for your release.

No GitHub push, remote workflow execution or npm publication is performed by local builds/tests. npm authentication was unavailable during implementation, so publication remains pending. Business rules: [docs/business-rules.md](docs/business-rules.md). Execution record: [plans/0002-tuya-cloud-plugs.md](plans/0002-tuya-cloud-plugs.md).

Original project MIT copyright/license retained. Device-sharing protocol interoperability is based on Tuya's Apache-2.0 SDK; see [NOTICE](NOTICE).
