import type { MatterbridgeEndpoint } from 'matterbridge';
import { ThermostatServer } from 'matterbridge/matter/behaviors';
import { Thermostat } from 'matterbridge/matter/clusters';
import type { DeviceController } from '../controller.js';
import type { DeviceState, TuyaDevice } from '../api/response.js';
import { boolean, numeric, matterCommand, unsupported, cloudWrite } from './conversions.js';
import { UnsupportedDeviceError } from './types.js';

export function configureClimate(endpoint: MatterbridgeEndpoint, controller: DeviceController, device: TuyaDevice): (state: DeviceState) => Promise<void> {
  const modeRole = {}, temperatureRole = {};
  const currentFactor = numeric(device.config?.current_temperature_factor) ?? 1;
  const targetFactor = numeric(device.config?.target_temperature_factor) ?? 1;
  const local = numeric(device.data.current_temperature);
  const target = numeric(device.data.temperature);
  if (local === undefined || target === undefined) throw new UnsupportedDeviceError(`Climate ${device.id}: current_temperature and temperature required`);
  const canSelect = device.data.mode !== undefined;
  if (!canSelect) throw new UnsupportedDeviceError(`Climate ${device.id}: mode capability absent; cannot safely advertise Matter heating/cooling features`);
  const min = Math.round((numeric(device.config?.min_temper) ?? (numeric(device.data.min_temper) ?? 0) * targetFactor) * 100);
  const max = Math.round((numeric(device.config?.max_temper) ?? (numeric(device.data.max_temper) ?? 100) * targetFactor) * 100);
  async function writeTemperature(value: number) {
    await matterCommand(() => controller.command('temperatureSet', { value: value / 100 }, { temperature: value / 100 / targetFactor }));
  }
  async function writeMode(value: Thermostat.SystemMode) {
    if (value === Thermostat.SystemMode.Off) return matterCommand(() => controller.command('turnOnOff', { value: 0 }, { state: false }));
    const mode = value === Thermostat.SystemMode.Heat ? 'hot' : value === Thermostat.SystemMode.Cool ? 'cold' : value === Thermostat.SystemMode.Auto ? 'auto' : undefined;
    if (!mode || (!canSelect && mode !== 'auto')) unsupported('Thermostat mode unavailable');
    await matterCommand(async () => {
      await controller.command('turnOnOff', { value: 1 }, { state: true });
      if (canSelect) await controller.command('modeSet', { value: mode }, { mode });
    });
  }
  // Tuya legacy API mode availability means heating/cooling selection is supported;
  // absent mode cannot safely advertise heating/cooling support.
  class TuyaThermostatServer extends ThermostatServer.with(Thermostat.Feature.Heating, Thermostat.Feature.Cooling, Thermostat.Feature.AutoMode) {
    override initialize() {
      const result = super.initialize();
      this.reactTo(this.events.systemMode$Changing, function(value, _old, context) {
        if (context.fabric !== undefined) cloudWrite(context.transaction, modeRole, () => writeMode(value));
      });
      this.reactTo(this.events.occupiedHeatingSetpoint$Changing, function(value, _old, context) {
        if (context.fabric !== undefined) cloudWrite(context.transaction, temperatureRole, () => writeTemperature(value));
      });
      this.reactTo(this.events.occupiedCoolingSetpoint$Changing, function(value, _old, context) {
        if (context.fabric !== undefined) cloudWrite(context.transaction, temperatureRole, () => writeTemperature(value));
      });
      return result;
    }
  }
  endpoint.behaviors.require(TuyaThermostatServer, {
    localTemperature: Math.round(local * currentFactor * 100),
    occupiedHeatingSetpoint: Math.round(target * targetFactor * 100),
    occupiedCoolingSetpoint: Math.round(target * targetFactor * 100),
    minHeatSetpointLimit: min, maxHeatSetpointLimit: max, minCoolSetpointLimit: min, maxCoolSetpointLimit: max,
    absMinHeatSetpointLimit: min, absMaxHeatSetpointLimit: max, absMinCoolSetpointLimit: min, absMaxCoolSetpointLimit: max,
    minSetpointDeadBand: 0,
    controlSequenceOfOperation: Thermostat.ControlSequenceOfOperation.CoolingAndHeating,
    systemMode: Thermostat.SystemMode.Off,
  });
  return async state => {
    const temperature = numeric(state.current_temperature);
    if (temperature !== undefined) await endpoint.setAttribute(Thermostat.id, 'localTemperature', Math.round(temperature * currentFactor * 100));
    const setpoint = numeric(state.temperature);
    if (setpoint !== undefined) {
      await endpoint.setAttribute(Thermostat.id, 'occupiedHeatingSetpoint', Math.round(setpoint * targetFactor * 100));
      await endpoint.setAttribute(Thermostat.id, 'occupiedCoolingSetpoint', Math.round(setpoint * targetFactor * 100));
    }
    const on = boolean(state.state);
    if (on !== undefined) await endpoint.setAttribute(Thermostat.id, 'systemMode', on === false ? Thermostat.SystemMode.Off : state.mode === 'hot' ? Thermostat.SystemMode.Heat : state.mode === 'cold' ? Thermostat.SystemMode.Cool : Thermostat.SystemMode.Auto);
  };
}
