import type { MatterbridgeEndpoint } from 'matterbridge';
import type { DeviceController } from '../controller.js';
import type { DeviceState, TuyaDevice } from '../api/response.js';
export interface DeviceBinding {
  endpoint: MatterbridgeEndpoint;
  addChild?(controller: DeviceController, device: TuyaDevice): DeviceBinding;
  update(state: DeviceState): Promise<void>;
  dispose(): void;
}
export class UnsupportedDeviceError extends Error {}
