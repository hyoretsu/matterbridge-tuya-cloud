# matterbridge-tuya

Matterbridge dynamic platform for Tuya / Smart Life devices through legacy Home Assistant Tuya Web API. Matterbridge-only; replaces original Homebridge plugin.

Requires **Matterbridge 3.10.13 or newer**. Plugin baseline Node 22.12+; selected Matterbridge host requires **22.13+** on Node 22 (or supported Node 24/26). Development commands use Bun.

## Install locally

Build this checkout, then add its absolute directory through Matterbridge plugin manager. Host resolves `matterbridge` and Matter libraries; neither appears in plugin dependencies.

```sh
bun install --frozen-lockfile
bun run sdk:link /absolute/path/to/installed/matterbridge
bun run build
```

A separate development SDK can live under ignored `.sdk/`. Matterbridge 3.10.13 references both Matter 0.17.6 and 0.17.9 transitively; Bun must resolve a single Matter instance for endpoint/behavior constructors. Use `tools/sdk.package.json` as `.sdk/package.json` before installing:

```sh
mkdir -p .sdk
cp tools/sdk.package.json .sdk/package.json
bun install --cwd .sdk --ignore-scripts
bun run sdk:link
```

These install commands download packages. No live Tuya calls occur during build/tests; starting configured plugin authenticates against Tuya cloud.

## Configure

Matterbridge uses `matterbridge-tuya.config.json` and matching schema. Enter credentials under nested `options`; restart plugin after every configuration change.

```json
{
  "name": "matterbridge-tuya",
  "type": "DynamicPlatform",
  "version": "1.1.6",
  "debug": false,
  "unregisterOnShutdown": false,
  "options": {
    "username": "you@example.com",
    "password": "your-account-password",
    "countryCode": "55",
    "platform": "smart_life",
    "pollingInterval": 615,
    "statePollingInterval": 65
  },
  "defaults": [],
  "hiddenAccessories": [],
  "scenes": false,
  "scenesWhitelist": []
}
```

Supported platforms: `tuya`, `smart_life`, `jinvoo_smart`. Country code matches account registration. Existing API regional token routing retained.

`pollingInterval` controls discovery, default/minimum 615 seconds. `statePollingInterval` controls sequential device queries, default/minimum 65 seconds; `0` disables periodic queries. Polling cycles never overlap. Rate limits defer further requests; temporary errors retain endpoints and attributes. Cloud discovery reconciles additions/removals only after valid successful response. Scene devices receive no periodic query.

`hiddenAccessories` and `scenesWhitelist` accept device IDs or names. Scenes disabled by default; enable with `scenes: true`. Legacy `scenes: ["ID-or-name"]` whitelist also supported. Prefer IDs for durable configuration.

Each `defaults` entry accepts `id` (ID/name), optional `device_type`, temperature limits/factors, brightness/Kelvin limits and feature lists. Factors multiply cloud temperature readings; outgoing target-temperature commands retain legacy Celsius payload. Empty feature list disables those features. Example:

```json
{
  "defaults": [{
    "id": "your-device-id",
    "device_type": "light",
    "light_characteristics": ["Brightness", "Color Temperature"],
    "min_brightness": 10,
    "max_brightness": 100,
    "min_kelvin": 2000,
    "max_kelvin": 6500
  }]
}
```

Feature lists: `dimmer_characteristics: ["Brightness"]`, `fan_characteristics: ["Speed"]`, `light_characteristics: ["Brightness", "Color", "Color Temperature"]`, `cover_characteristics: ["Stop"]`. Temperature settings: `min_temper`, `max_temper`, `current_temperature_factor`, `target_temperature_factor`.

## Device presentation

| Tuya category | Matter endpoint |
| --- | --- |
| switch / outlet | On/Off Plug-in Unit (controllers commonly show outlet) |
| dimmer | Dimmable Light |
| light | On/Off, dimmable, color-temperature or extended-color light according to features |
| temperature_sensor | Temperature Sensor |
| fan | Fan, power and available speed |
| climate | Thermostat, when required temperatures and mode capability exist |
| cover / window | Window Covering, open/close and supported stop; no invented position |
| scene | Momentary On/Off Plug-in Unit; On executes once then resets; Off has no cloud action |
| garage | Unsupported with explicit diagnostic: legacy API lacks mandatory native Closure Control safety/error data |

SDK contains native closure support, but legacy Tuya response has no mandatory `currentErrorList` safety state. Garage exposure remains blocked; no Window Covering fallback. Likewise, climate devices missing required temperatures/mode, and dimmable/color lights missing required brightness capability, receive diagnostics rather than false feature claims. Continuous light/color movement and unsupported cover operations return Matter errors. Lowest Matter light level is 1; cloud zero values parse correctly and clamp to valid light range.

Endpoint IDs, serials and unique IDs derive from Tuya ID; renaming preserves identity. Tuya `online` drives reachability. Transient HTTP/auth errors do not imply offline. `unregisterOnShutdown` defaults false; true removes registered endpoints on shutdown.

## Migrate from Homebridge

Copy nested `options`, `defaults`, `hiddenAccessories`, `scenes` and `scenesWhitelist` to new configuration. Remove Homebridge `platform`, `accessory`, bridge and cached-accessory metadata; set Matterbridge `name`/`type` as above. Homebridge pairing records cannot migrate; pair Matterbridge through chosen Matter controller. Controller appearance and HomeKit-specific semantics may differ. Replace old discovery polling `0`/values below 615 with 615; disable device queries using new `statePollingInterval: 0`.

## Local validation

```sh
bun run build
bun run test
bun run test:package
```

Tests use mocked HTTP and simulated Matter networking with real endpoints; no live credentials, pairing or controller tests. Hardware validation remains outstanding for every category. Business behavior source: [docs/business-rules.md](docs/business-rules.md). Execution progress: [plans/0001-tuya-matterbridge-port.md](plans/0001-tuya-matterbridge-port.md).

Original Tuya Web client copyright and MIT license retained.
