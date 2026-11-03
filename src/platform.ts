import { MatterbridgeDynamicPlatform, type PlatformConfig, type PlatformMatterbridge } from "matterbridge";
import type { AnsiLogger } from "matterbridge/logger";
import { createCloudClient } from "./cloud/create-client.js";
import type { ModernCloudClient } from "./cloud/CloudClient.js";
import { join } from "node:path";
import { DeviceController } from "./controller.js";
import { applyDeviceConfiguration, validateConfig, type ValidatedConfig } from "./config.js";
import type { TuyaDevice } from "./api/response.js";
import { RateLimitError } from "./errors/index.js";
import { buildDevice, deviceIdentity, type DeviceBinding } from "./devices/index.js";
import { MIN_MATTERBRIDGE_VERSION } from "./settings.js";

export type CloudClient = Pick<ModernCloudClient, "getOrRefreshToken" | "discoverDevices" | "getDeviceState" | "setDeviceState" | "shutdown"> & Partial<Pick<ModernCloudClient,"beginStatePoll"|"endStatePoll">>;
interface RegisteredDevice {
  controller: DeviceController;
  binding: DeviceBinding;
  unsubscribe: () => void;
  updates: Promise<void>;
  revision: number;
  children: ChildEntry[];
}
interface ChildEntry {
  id: string;
  controller: DeviceController;
  binding: DeviceBinding;
  unsubscribe: () => void;
  updates: Promise<void>;
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
    try {
      this.settings = validateConfig(this.config);
    } catch (error) {
      this.log.error(`${error instanceof Error ? error.message : String(error)}. Configure the plugin and restart it.`);
      return;
    }
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
    for (const entry of this.devices.values()) { await entry.binding.update(entry.controller.state); for (const child of entry.children) await child.binding.update(child.controller.state); }
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
      const all = applyDeviceConfiguration(discovered, this.settings!);
      const ids = new Set(all.map(device => device.id));
      // Settings are nested under their parent device; orphans stay standalone.
      const isChild = (device: TuyaDevice) => device.parentId !== undefined && ids.has(device.parentId);
      const devices = all.filter(device => !isChild(device));
      const childrenOf = (id: string) => all.filter(device => device.parentId === id && isChild(device));
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
          for (const child of childrenOf(device.id)) existing.children.find(entry => entry.id === child.id)?.controller.update(child.data);
          await existing.updates;
          for (const child of existing.children) await child.updates;
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
        const entry: RegisteredDevice = { controller, binding, updates: Promise.resolve(), revision: 0, unsubscribe: () => undefined, children: [] };
        for (const childDevice of childrenOf(device.id)) {
          const childController = new DeviceController(childDevice, this.client!);
          try {
            const childBinding = binding.addChild!(childController, childDevice);
            entry.children.push({ id: childDevice.id, controller: childController, binding: childBinding, unsubscribe: () => undefined, updates: Promise.resolve() });
          } catch (error) {
            childController.dispose();
            this.log.warn(`Unsupported Tuya setting ${childDevice.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        try {
          await this.registerDevice(binding.endpoint);
          if (this.configured) {
            await binding.update(controller.state);
            for (const child of entry.children) await child.binding.update(child.controller.state);
          }
          for (const child of entry.children) {
            child.unsubscribe = child.controller.subscribe(state => {
              child.updates = child.updates.then(() => child.binding.update(state)).catch(error => {
                this.log.error(`Matter attribute update failed for ${child.id}: ${error instanceof Error ? error.message : String(error)}`);
              });
            });
          }
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
    this.client?.beginStatePoll?.();
    this.operation = (async () => {
      for (const [id, entry] of this.devices) {
        if (!this.running) break;
        if (entry.controller.device.dev_type === "scene") continue;
        try {
          await entry.controller.query(); await entry.updates;
          for (const child of entry.children) { await child.controller.query(); await child.updates; }
        }
        catch (error) {
          if (error instanceof RateLimitError) throw error;
          if (this.running) this.log.warn(`Tuya query failed for ${id}; retaining state: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    })();
    try { await this.operation; } finally { this.client?.endStatePoll?.(); this.operation = undefined; }
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
    for (const child of entry.children) {
      child.unsubscribe();
      child.controller.dispose();
      child.binding.dispose();
    }
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
