import type { MatterbridgeEndpoint } from 'matterbridge';
import type { DeviceState } from '../api/response.js';
export interface DeviceBinding {
  endpoint: MatterbridgeEndpoint;
  update(state: DeviceState): Promise<void>;
  dispose(): void;
}
export class UnsupportedDeviceError extends Error {}
