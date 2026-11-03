# Tuya Cloud behavior

- Default authentication is User Code + QR via device-sharing API; developer Access ID/Secret mode uses signed IoT Core v2. No password/legacy skill API fallback.
- Current cloud adapter exposes plugs in cz/pc categories only; unsupported categories log diagnostics. Existing category mappings do not imply modern discovery coverage.
- Only advertised writable Boolean switch/switch_N datapoints receive plug endpoints. Missing Boolean state fails discovery rather than inventing off.
- Tuya ID defines stable primary identity; additional channels use datapoint suffixes. Names do not define identity.
- Current, voltage, power and cumulative energy require recognized units and explicit scale metadata. Convert to mA/mV/mW/mWh, retain zeros, reject nonfinite/unsafe readings. No guessed units or incremental energy accumulation.
- Device-wide metering belongs to primary switch/switch_1 channel only. Child lock, light mode, overcharge, power-on behavior and countdown are not mapped.
- Sharing tokens persist with owner-only file permissions and account binding. Shutdown cancels requests/login waits. Renew tokens on demand with one concurrent auth operation; transient failures retain saved authorization.
- Commands and queries serialize per endpoint. Failed writes preserve cached/Matter state and propagate errors. Unsupported operations never report success.
- Discovery defaults/minimum 615 seconds; state polling defaults/minimum 65 seconds, zero disables. Poll cycles do not overlap. Rate limits back off.
- Only complete, valid successful discovery reconciles removals. Auth/request/malformed errors retain devices and last known attributes. Reachability follows explicit cloud online status.
- Configuration requires restart. Shutdown unregisters endpoints only when unregisterOnShutdown is true.
- Modern light/IR/garage support and real-time subscriptions remain future work. All live cloud/device/controller validation requires separate explicit authorization.
