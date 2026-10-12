import { MatterbridgeEndpoint } from 'matterbridge';
import { WindowCoveringServer, WindowCoveringBaseServer } from 'matterbridge/matter/behaviors';
import { WindowCovering } from 'matterbridge/matter/clusters';
import type { DeviceController } from '../controller.js';
import { CoverState, type DeviceState, type TuyaDevice } from '../api/response.js';
import { boolean, matterCommand, unsupported } from './conversions.js';

export function configureCover(endpoint: MatterbridgeEndpoint, controller: DeviceController, device: TuyaDevice): (state: DeviceState) => Promise<void> {
  const supportsStop = device.config?.cover_characteristics ? device.config.cover_characteristics.includes('Stop') : boolean(device.data.support_stop) === true;
  class TuyaCoverServer extends WindowCoveringServer.with(WindowCovering.Feature.Lift) {
    declare protected internal: WindowCoveringBaseServer.Internal;
    override initialize() {
      this.internal.disableOperationalModeHandling = true;
      return super.initialize();
    }
    override async upOrOpen() { await matterCommand(() => controller.command('turnOnOff', { value: 1 }, { state: CoverState.Opening })); }
    override async downOrClose() { await matterCommand(() => controller.command('turnOnOff', { value: 0 }, { state: CoverState.Closing })); }
    override async stopMotion() {
      if (!supportsStop) unsupported('Tuya cover has no stop capability');
      await matterCommand(() => controller.command('startStop', { value: 0 }, { state: CoverState.Stopped }));
    }
  }
  // No position-aware features: Tuya API reports movement only, never measured position.
  endpoint.behaviors.require(TuyaCoverServer, {
    type: WindowCovering.WindowCoveringType.Rollershade,
    endProductType: WindowCovering.EndProductType.RollerShade,
    configStatus: { operational: true, liftMovementReversed: false, liftPositionAware: false, tiltPositionAware: false, liftEncoderControlled: false, tiltEncoderControlled: false },
    operationalStatus: { global: device.data.state === CoverState.Opening ? WindowCovering.MovementStatus.Opening : device.data.state === CoverState.Closing ? WindowCovering.MovementStatus.Closing : WindowCovering.MovementStatus.Stopped, lift: device.data.state === CoverState.Opening ? WindowCovering.MovementStatus.Opening : device.data.state === CoverState.Closing ? WindowCovering.MovementStatus.Closing : WindowCovering.MovementStatus.Stopped },
    mode: { motorDirectionReversed: false, calibrationMode: false, maintenanceMode: false, ledFeedback: false },
  });
  return async state => {
    const movement = state.state === CoverState.Opening ? WindowCovering.MovementStatus.Opening : state.state === CoverState.Closing ? WindowCovering.MovementStatus.Closing : state.state === CoverState.Stopped ? WindowCovering.MovementStatus.Stopped : undefined;
    if (movement !== undefined) await endpoint.setAttribute(WindowCovering.id, 'operationalStatus', { global: movement, lift: movement });
  };
}
