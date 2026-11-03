import type { DeviceState, TuyaApiMethod, TuyaApiPayload, TuyaDevice } from './api/response.js';
import type { ModernCloudClient } from './cloud/CloudClient.js';

/** Serializes commands and queries so late cloud responses cannot overwrite successful writes. */
export class DeviceController {
  private current: DeviceState;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private listeners = new Set<(state: DeviceState) => void>();

  constructor(public readonly device: TuyaDevice, private readonly api: Pick<ModernCloudClient, 'setDeviceState' | 'getDeviceState'>) {
    this.current = structuredClone(device.data);
  }

  get state(): DeviceState { return structuredClone(this.current); }

  subscribe(listener: (state: DeviceState) => void): () => void {
    this.assertActive();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(state: DeviceState): void {
    this.assertActive();
    this.current = { ...this.current, ...structuredClone(state) };
    for (const listener of this.listeners) listener(this.state);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Device controller is disposed');
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(() => { this.assertActive(); return operation(); });
    this.queue = result.catch(() => undefined);
    return result;
  }

  command<Method extends TuyaApiMethod>(method: Method, payload: TuyaApiPayload<Method>, patch: DeviceState = {}): Promise<void> {
    return this.serialize(async () => {
      const committed = await this.api.setDeviceState(this.device.id, method, payload);
      this.assertActive();
      this.update({ ...patch, ...(committed ?? {}) });
    });
  }

  query(): Promise<DeviceState> {
    return this.serialize(async () => {
      const state = await this.api.getDeviceState(this.device.id);
      this.assertActive();
      this.update(state);
      return this.state;
    });
  }

  dispose(): void { this.disposed = true; this.listeners.clear(); }
}
