import type { MatterbridgeEndpoint } from 'matterbridge';
import { FanControlServer } from 'matterbridge/matter/behaviors';
import { FanControl } from 'matterbridge/matter/clusters';
import type { DeviceController } from '../controller.js';
import type { DeviceState, TuyaDevice } from '../api/response.js';
import { boolean, numeric, matterCommand, unsupported, cloudWrite } from './conversions.js';

export function configureFan(endpoint: MatterbridgeEndpoint, controller: DeviceController, device: TuyaDevice): (state: DeviceState) => Promise<void> {
  const writeRole = {};
  const speedMax = numeric(device.data.speed_level);
  const speed = numeric(device.data.speed);
  const supportsSpeed = device.config?.fan_characteristics ? device.config.fan_characteristics.includes('Speed') : speed !== undefined && speedMax !== undefined && speedMax > 0;
  async function writePercent(percent: number | null) {
    if (percent === null) unsupported('Automatic fan speed unavailable');
    if (percent === 0) return matterCommand(() => controller.command('turnOnOff', { value: 0 }, { state: false }));
    if (!supportsSpeed) {
      if (percent !== 100) unsupported('Variable fan speed unavailable');
      return matterCommand(() => controller.command('turnOnOff', { value: 1 }, { state: true }));
    }
    await matterCommand(async () => {
      await controller.command('turnOnOff', { value: 1 }, { state: true });
      const value = Math.min(speedMax ?? 1, Math.max(1, Math.ceil(percent * (speedMax ?? 1) / 100)));
      await controller.command('windSpeedSet', { value }, { speed: value });
    });
  }
  class TuyaFanServer extends FanControlServer.with(...(supportsSpeed ? [FanControl.Feature.MultiSpeed] : [])) {
    override initialize() {
      const result = super.initialize();
      this.reactTo(this.events.percentSetting$Changing, function(value, _old, context) {
        if (context.fabric !== undefined) cloudWrite(context.transaction, writeRole, () => writePercent(value), 3);
      });
      if (supportsSpeed) this.maybeReactTo(this.events.speedSetting$Changing, function(value, _old, context) {
        if (context.fabric !== undefined) cloudWrite(context.transaction, writeRole, () => writePercent(value === null ? null : value / (speedMax ?? 1) * 100), 2);
      });
      this.reactTo(this.events.fanMode$Changing, function(value, _old, context) {
        const percent = value === FanControl.FanMode.Off ? 0 : value === FanControl.FanMode.Low ? 33 : value === FanControl.FanMode.Medium ? 66 : value === FanControl.FanMode.High || value === FanControl.FanMode.On ? 100 : null;
        if (context.fabric !== undefined) cloudWrite(context.transaction, writeRole, () => writePercent(percent));
      });
      return result;
    }
  }
  endpoint.behaviors.require(TuyaFanServer, {
    fanMode: boolean(device.data.state) === true ? FanControl.FanMode.High : FanControl.FanMode.Off,
    fanModeSequence: supportsSpeed ? FanControl.FanModeSequence.OffLowMedHigh : FanControl.FanModeSequence.OffHigh,
    percentSetting: 0, percentCurrent: 0,
    ...(supportsSpeed ? { speedMax: speedMax ?? 1, speedSetting: 0, speedCurrent: 0 } : {}),
  });
  return async state => {
    const on = boolean(state.state);
    const currentSpeed = numeric(state.speed);
    const percent = on === false ? 0 : supportsSpeed && currentSpeed !== undefined ? Math.min(100, Math.max(0, Math.round(currentSpeed / (speedMax ?? 1) * 100))) : on === true ? 100 : undefined;
    if (percent === undefined) return;
    await endpoint.setAttribute(FanControl.id, 'percentSetting', percent);
    await endpoint.setAttribute(FanControl.id, 'percentCurrent', percent);
    if (supportsSpeed) {
      const reportedSpeed = on === false ? 0 : Math.max(0, Math.min(speedMax ?? 1, currentSpeed ?? 0));
      await endpoint.setAttribute(FanControl.id, 'speedSetting', reportedSpeed);
      await endpoint.setAttribute(FanControl.id, 'speedCurrent', reportedSpeed);
    }
    await endpoint.setAttribute(FanControl.id, 'fanMode', percent === 0 ? FanControl.FanMode.Off : supportsSpeed && percent <= 33 ? FanControl.FanMode.Low : supportsSpeed && percent <= 66 ? FanControl.FanMode.Medium : FanControl.FanMode.High);
  };
}
