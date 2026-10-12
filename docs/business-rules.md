# Tuya Matterbridge behavior

- Tuya cloud device ID defines stable Matter identity. Name changes never change serial, endpoint ID or unique ID.
- Scenes require explicit enablement. On runs once and resets false only after success; Off has no cloud effect.
- Discovery defaults/minimum 615 seconds. Device queries default/minimum 65 seconds; zero disables queries. Queries run sequentially without overlapping polling cycles. Rate limits cause bounded backoff.
- Only valid successful discovery can remove devices. Authentication, malformed responses and request failures retain endpoints/state. Reachability reflects explicit Tuya online status, never inferred from transient HTTP failure.
- Cloud commands serialize with queries. Failed writes retain prior cached state and return Matter errors. Unsupported operations never return success.
- Capability overrides and numerical limits/factors preserve legacy configuration. Invalid configuration fails before cloud authentication.
- Covers expose movement and supported stop. No measured position exists in legacy response; do not synthesize percentages or completion.
- Native Closure Control only for garage. Current legacy data lacks mandatory error/safety state, so garage receives unsupported-device diagnostic. Never map garage to Window Covering.
- Thermostat requires current/target temperature and mode capability. Missing mandatory state/capabilities produces diagnostic.
- Configuration changes require restart. Shutdown stops polling, cancels requests and timers, disposes controllers/listeners. Endpoints unregister only when `unregisterOnShutdown` is true.
- All hardware/controller validation requires separate explicit authorization; local fixture acceptance does not imply hardware compatibility.
