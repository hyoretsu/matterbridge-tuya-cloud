import { createHash } from 'node:crypto';
import { MatterbridgeEndpoint, electricalSensor, modeSelect, onOffPlugInUnit, onOffLight, dimmableLight, colorTemperatureLight, extendedColorLight, temperatureSensor, fan, thermostat, windowCovering } from 'matterbridge';
import { OnOffServer, ScenesManagementServer } from 'matterbridge/matter/behaviors';
import { BridgedDeviceBasicInformation, OnOff, TemperatureMeasurement } from 'matterbridge/matter/clusters';
import type { DeviceController } from '../controller.js';
import { TuyaDeviceTypes, type DeviceState, type TuyaDevice } from '../api/response.js';
import { boolean, numeric, matterCommand, unsupported, unsupportedWrite, cloudWrite } from './conversions.js';
import { configureLight, lightCapabilities } from './light.js';
import { configureCover } from './cover.js';
import { configureFan } from './fan.js';
import { configureModeSelect } from './mode-select.js';
import { configurePlug } from './plug.js';
import { configureClimate } from './climate.js';
import { UnsupportedDeviceError, type DeviceBinding } from './types.js';
export { UnsupportedDeviceError, type DeviceBinding } from './types.js';

export function deviceIdentity(id: string): string { return `tuya-${createHash('sha256').update(id).digest('hex').slice(0, 24)}`; }

export function buildDevice(controller: DeviceController, device: TuyaDevice): DeviceBinding {
  if (!TuyaDeviceTypes.includes(device.dev_type)) throw new UnsupportedDeviceError(`Unknown Tuya category ${device.dev_type}`);
  if (device.dev_type === 'garage') {
    // Legacy Tuya garage data is movement (opening/closing/stopped), with no
    // closure safety/error state required by Matter. Position may be null,
    // Native Closure exists in SDK 3.10.13, but inventing mandatory error state
    // would falsely report completion/safety. Never substitute WindowCovering.
    throw new UnsupportedDeviceError(`Garage ${device.id}: native Closure Control requires mandatory currentErrorList and closure safety state; Tuya legacy discovery supplies movement only`);
  }
  const capabilities = lightCapabilities(device);
  const type = device.dev_type === 'mode_select' ? modeSelect : device.dev_type === 'light' ? capabilities.color ? extendedColorLight : capabilities.temperature ? colorTemperatureLight : capabilities.brightness ? dimmableLight : onOffLight : device.dev_type === 'dimmer' ? dimmableLight : device.dev_type === 'temperature_sensor' ? temperatureSensor : device.dev_type === 'fan' ? fan : device.dev_type === 'climate' ? thermostat : device.dev_type === 'cover' || device.dev_type === 'window' ? windowCovering : onOffPlugInUnit;
  const identity = deviceIdentity(device.id);
  const metering = ['currentMa','voltageMv','powerMw','energyMwh'].some(key => device.data[key as keyof DeviceState] !== undefined);
  const endpoint = new MatterbridgeEndpoint(device.dev_type === 'outlet' && metering ? [type,electricalSensor] : type, { id: identity });
  endpoint.createDefaultBridgedDeviceBasicInformationClusterServer(device.name, `sn-${identity}`, 0xfff1, 'Tuya', `Tuya ${device.dev_type}`);
  endpoint.originalId = device.id;
  endpoint.uniqueId = identity;
  const basicOptions = endpoint.getClusterServerOptions(BridgedDeviceBasicInformation.id);
  if (basicOptions) { basicOptions.uniqueId = identity; basicOptions.reachable = boolean(device.data.online) ?? true; }
  endpoint.createDefaultIdentifyClusterServer();
  let updateMapping: (state: DeviceState) => Promise<void> = async () => {};
  const hasOnOff = ['light', 'dimmer', 'switch', 'outlet', 'scene'].includes(device.dev_type);
  if (hasOnOff || device.dev_type === 'fan') endpoint.createDefaultGroupsClusterServer();
  if (hasOnOff) {
    class TuyaScenesServer extends ScenesManagementServer {
      override async recallScene() { unsupported('Matter stored scene recall unavailable; use configured Tuya scene endpoint'); }
    }
    endpoint.behaviors.require(TuyaScenesServer);
    if (device.dev_type === 'scene') {
      class TuyaSceneServer extends OnOffServer {
        override async on() { await matterCommand(() => controller.command('turnOnOff', { value: 1 })); this.state.onOff = false; }
        override async off() { this.state.onOff = false; }
        override async toggle() { await this.on(); }
      }
      endpoint.behaviors.require(TuyaSceneServer, { onOff: false });
    } else {
      const lighting = device.dev_type === 'light' || device.dev_type === 'dimmer';
      const powerRole = {};
      const writePower = (on:boolean) => matterCommand(()=>controller.command('turnOnOff',{value:on?1:0},{state:on}));
      class TuyaPowerServer extends OnOffServer.with(...(lighting ? [OnOff.Feature.Lighting] : [])) {
        override initialize() {
          const result = super.initialize();
          if(lighting) for(const event of [this.events.startUpOnOff$Changing,this.events.onTime$Changing,this.events.offWaitTime$Changing])this.maybeReactTo(event,function(_value,_old,context){if(context.fabric!==undefined)unsupportedWrite('Cloud startup/timer attribute writes unavailable; use supported configuration endpoint');});
          return result;
        }
        override async on() {this.state.onOff=true;cloudWrite(this.context.transaction,powerRole,()=>writePower(true));}
        override async off() {this.state.onOff=false;cloudWrite(this.context.transaction,powerRole,()=>writePower(false));}
        override async toggle() {const on=!this.state.onOff;this.state.onOff=on;cloudWrite(this.context.transaction,powerRole,()=>writePower(on));}
        override async offWithEffect() {unsupported('Cloud off effects unavailable');}
        override async onWithRecallGlobalScene() {unsupported('Scene recall unavailable');}
        override async onWithTimedOff() {unsupported('Timed cloud commands unavailable');}
      }
      endpoint.behaviors.require(TuyaPowerServer,{onOff:boolean(device.data.state)??false,...(lighting?{globalSceneControl:false,onTime:0,offWaitTime:0,startUpOnOff:null}:{})});
      endpoint.addCommandHandler('on', async()=>writePower(true));
      endpoint.addCommandHandler('off', async()=>writePower(false));
      endpoint.addCommandHandler('toggle', async()=>writePower(boolean(controller.state.state)!==true));
      endpoint.addCommandHandler('OnOff.onWithRecallGlobalScene', async()=>unsupported('Scene recall unavailable'));
      endpoint.addCommandHandler('OnOff.onWithTimedOff', async()=>unsupported('Timed cloud commands unavailable'));
      endpoint.addCommandHandler('offWithEffect', async()=>unsupported('Cloud off effects unavailable'));
    }
  }
  if (device.dev_type === 'mode_select') updateMapping = configureModeSelect(endpoint,controller,device);
  if (device.dev_type === 'outlet') updateMapping = configurePlug(endpoint,device.data);
  if (device.dev_type === 'light' || device.dev_type === 'dimmer') updateMapping = configureLight(endpoint, controller, device);
  if (device.dev_type === 'cover' || device.dev_type === 'window') updateMapping = configureCover(endpoint, controller, device);
  if (device.dev_type === 'fan') updateMapping = configureFan(endpoint, controller, device);
  if (device.dev_type === 'climate') updateMapping = configureClimate(endpoint, controller, device);
  if (device.dev_type === 'temperature_sensor') {
    const factor = numeric(device.config?.current_temperature_factor) ?? 1;
    endpoint.createDefaultTemperatureMeasurementClusterServer(null);
    updateMapping = async state => {
      const value = numeric(state.temperature ?? state.current_temperature);
      if (value !== undefined) await endpoint.setAttribute(TemperatureMeasurement.id, 'measuredValue', Math.round(value * factor * 100));
    };
  }
  let disposed = false;
  return {
    endpoint,
    async update(state) {
      if (disposed) return;
      const online = boolean(state.online);
      if (online !== undefined) await endpoint.setAttribute(BridgedDeviceBasicInformation.id, 'reachable', online);
      if (hasOnOff && device.dev_type !== 'scene') {
        const on = boolean(state.state);
        if (on !== undefined) await endpoint.setAttribute(OnOff.id, 'onOff', on);
      }
      await updateMapping(state);
    },
    dispose() { disposed = true; },
  };
}
