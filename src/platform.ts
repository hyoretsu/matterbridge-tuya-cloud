import { MatterbridgeDynamicPlatform, type PlatformConfig, type PlatformMatterbridge } from "matterbridge";
import type { AnsiLogger } from "matterbridge/logger";
import { createCloudClient } from "./cloud/create-client.js";
import type { ModernCloudClient } from "./cloud/CloudClient.js";
import { join } from "node:path";
import { DeviceController } from "./controller.js";
import { applyDeviceConfiguration, validateConfig, type ValidatedConfig } from "./config.js";
import { RateLimitError } from "./errors/index.js";
import { buildDevice, deviceIdentity, type DeviceBinding } from "./devices/index.js";
import { MIN_MATTERBRIDGE_VERSION } from "./settings.js";

export type CloudClient = Pick<ModernCloudClient, "getOrRefreshToken" | "discoverDevices" | "getDeviceState" | "setDeviceState" | "shutdown">;
interface RegisteredDevice {
  controller: DeviceController;
  binding: DeviceBinding;
  unsubscribe: () => void;
  updates: Promise<void>;
  revision: number;
}

export class TuyaPlatform extends MatterbridgeDynamicPlatform {
  readonly devices = new Map<string, RegisteredDevice>();
  private client?: CloudClient;
  private settings?: ValidatedConfig;
  private timer?: ReturnType<typeof setTimeout>;
  private operation?: Promise<void>;
  private running = false;
  private configured = false;
  private nextDiscovery = Infinity;
  private nextState = Infinity;
  private backoff = 65_000;
  private shutdownTask?: Promise<void>;

  constructor(host: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig,
    private readonly createClient: (config: ValidatedConfig) => CloudClient = settings => createCloudClient(settings,join(host.matterbridgeDirectory,"matterbridge-tuya-cloud"),log)) {
    super(host, log, config);
    if (!this.verifyMatterbridgeVersion(MIN_MATTERBRIDGE_VERSION)) throw new Error(`Matterbridge ${MIN_MATTERBRIDGE_VERSION}+ required`);
  }

  override async onStart(): Promise<void> {
    if (this.shutdownTask) throw new Error("A stopped platform must be recreated by the host before restarting");
    if (this.running) return;
    await this.ready;
    this.settings = validateConfig(this.config);
    this.client = this.createClient(this.settings);
    this.running = true;
    try {
      await this.client.getOrRefreshToken();
      if (this.running) await this.discoverDevices();
    } catch (error) {
      this.running = false;
      this.client.shutdown();
      throw error;
    }
  }

  override async onConfigure(): Promise<void> {
    if (!this.running) return;
    await super.onConfigure();
    for (const entry of this.devices.values()) await entry.binding.update(entry.controller.state);
    this.configured = true;
    this.nextDiscovery = Date.now() + this.settings!.options.pollingInterval * 1000;
    this.nextState = this.settings!.options.statePollingInterval === 0 ? Infinity : Date.now() + this.settings!.options.statePollingInterval * 1000;
    this.schedule();
  }

  /** Discovery and queries share one nonoverlapping cycle. */
  async discoverDevices(): Promise<void> {
    if (!this.running || !this.client) return;
    if (this.operation) return this.operation;
    const revisions = new Map([...this.devices].map(([id, entry]) => [id, entry.revision]));
    this.operation = (async () => {
      const discovered = await this.client!.discoverDevices();
      if (!this.running) return;
      if (!Array.isArray(discovered)) throw new Error("Malformed Tuya discovery; retaining registered devices");
      const devices = applyDeviceConfiguration(discovered, this.settings!);
      const present = new Set(devices.map(device => device.id));
      for (const [id, entry] of this.devices) {
        if (present.has(id)) continue;
        await this.unregisterDevice(entry.binding.endpoint);
        this.release(entry);
        this.devices.delete(id);
      }
      for (const device of devices) {
        if (!this.running) break;
        const existing = this.devices.get(device.id);
        if (existing) {
          // An intervening command/query is newer than this discovery snapshot.
          if (existing.revision === revisions.get(device.id)) existing.controller.update(device.data);
          await existing.updates;
          continue;
        }
        const controller = new DeviceController(device, this.client!);
        let binding: DeviceBinding;
        try {
          const presentation = this.hasDeviceName(device.name) ? { ...device, name: `${device.name} (${deviceIdentity(device.id).slice(-8)})` } : device;
          binding = buildDevice(controller, presentation);
        }
        catch (error) {
          controller.dispose();
          this.log.warn(`Unsupported Tuya ${device.dev_type} device ${device.id}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        const entry: RegisteredDevice = { controller, binding, updates: Promise.resolve(), revision: 0, unsubscribe: () => undefined };
        try {
          await this.registerDevice(binding.endpoint);
          if (this.configured) await binding.update(controller.state);
          entry.unsubscribe = controller.subscribe(state => {
            entry.revision++;
            entry.updates = entry.updates.then(() => binding.update(state)).catch(error => {
              this.log.error(`Matter attribute update failed for ${device.id}: ${error instanceof Error ? error.message : String(error)}`);
            });
          });
          this.devices.set(device.id, entry);
        } catch (error) {
          this.release(entry);
          await binding.endpoint.close();
          throw error;
        }
      }
    })();
    try { await this.operation; } finally { this.operation = undefined; }
  }

  async pollDeviceStates(): Promise<void> {
    if (!this.running || this.operation) return;
    this.operation = (async () => {
      for (const [id, entry] of this.devices) {
        if (!this.running) break;
        if (entry.controller.device.dev_type === "scene") continue;
        try { await entry.controller.query(); await entry.updates; }
        catch (error) {
          if (error instanceof RateLimitError) throw error;
          if (this.running) this.log.warn(`Tuya query failed for ${id}; retaining state: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    })();
    try { await this.operation; } finally { this.operation = undefined; }
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.running || !this.configured) return;
    this.timer = setTimeout(() => { void this.tick(); }, Math.max(1, Math.min(this.nextDiscovery, this.nextState) - Date.now()));
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    try {
      if (Date.now() >= this.nextDiscovery) {
        this.nextDiscovery = Date.now() + this.settings!.options.pollingInterval * 1000;
        await this.discoverDevices();
      }
      if (Date.now() >= this.nextState) {
        this.nextState = Date.now() + this.settings!.options.statePollingInterval * 1000;
        await this.pollDeviceStates();
      }
      this.backoff = 65_000;
    } catch (error) {
      if (this.running) this.log.warn(`Tuya polling failed; retaining devices/state: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof RateLimitError) {
        this.nextDiscovery = Math.max(this.nextDiscovery, Date.now() + this.backoff);
        if (Number.isFinite(this.nextState)) this.nextState = Math.max(this.nextState, Date.now() + this.backoff);
        this.backoff = Math.min(this.backoff * 2, 3_600_000);
      }
    } finally { this.schedule(); }
  }

  private release(entry: RegisteredDevice): void {
    entry.unsubscribe();
    entry.controller.dispose();
    entry.binding.dispose();
  }

  override async onConfigChanged(): Promise<void> {
    this.log.info("Tuya configuration changes require plugin restart.");
    this.wssSendRestartRequired();
  }

  override onShutdown(reason?: string): Promise<void> {
    return this.shutdownTask ??= this.shutdown(reason);
  }

  private async shutdown(reason?: string): Promise<void> {
    this.running = false;
    this.configured = false;
    clearTimeout(this.timer);
    this.client?.shutdown();
    for (const entry of this.devices.values()) this.release(entry);
    await this.operation?.catch(() => undefined);
    await Promise.all([...this.devices.values()].map(entry => entry.updates));
    try {
      if (this.config.unregisterOnShutdown) await this.unregisterAllDevices();
    } finally {
      this.devices.clear();
      await super.onShutdown(reason);
    }
  }
}
