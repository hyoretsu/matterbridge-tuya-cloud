import type {MatterbridgeEndpoint} from 'matterbridge';
import {ElectricalPowerMeasurement,ElectricalEnergyMeasurement} from 'matterbridge/matter/clusters';
import type {DeviceState} from '../api/response.js';
export function configurePlug(endpoint: MatterbridgeEndpoint,initial: DeviceState): (state:DeviceState)=>Promise<void> {
  const power = ['voltageMv','currentMa','powerMw'].some(key=>initial[key as keyof DeviceState]!==undefined);
  const energy = initial.energyMwh !== undefined;
  if (power || energy) endpoint.createDefaultPowerTopologyClusterServer();
  if (power) {
    endpoint.createDefaultElectricalPowerMeasurementClusterServer(initial.voltageMv ?? null,initial.currentMa ?? null,initial.powerMw ?? null);
    const options = endpoint.getClusterServerOptions(ElectricalPowerMeasurement.id)!;
    const supported = [initial.voltageMv !== undefined,initial.currentMa !== undefined,initial.powerMw !== undefined,false];
    if (Array.isArray(options.accuracy)) options.accuracy = options.accuracy.filter((_value: unknown,index: number)=>supported[index]);
    options.numberOfMeasurementTypes = supported.filter(Boolean).length;
  }
  if (energy) endpoint.createImportedElectricalEnergyMeasurementClusterServer(initial.energyMwh!);
  return async state => {
    if (power) for (const [key,attribute] of [['voltageMv','voltage'],['currentMa','activeCurrent'],['powerMw','activePower']] as const) {
      if (initial[key] !== undefined && state[key] !== undefined) await endpoint.setAttribute(ElectricalPowerMeasurement.id,attribute,state[key]);
    }
    if (energy && state.energyMwh !== undefined) await endpoint.setAttribute(ElectricalEnergyMeasurement.id,'cumulativeEnergyImported',{energy:state.energyMwh});
  };
}
