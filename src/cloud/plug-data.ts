import type {DeviceState, TuyaDevice} from '../api/response.js';
import {object, type CloudDevice, type CloudSpecification} from './types.js';
export interface PlugChannel { kind:'plug'; device: CloudDevice; specification: CloudSpecification; code: string; primary: boolean; energyCode?: string; }
export function plugChannels(device: CloudDevice,specification: CloudSpecification): PlugChannel[] {
  if (!['cz','pc'].includes(device.category)) return [];
  const codes = specification.functions.filter(range => /^switch(?:_[1-9][0-9]*)?$/.test(range.code) && range.type.toLowerCase() === 'boolean').map(range=>range.code).sort();
  const primary = codes.includes('switch_1') ? 'switch_1' : 'switch';
  return codes.map(code=>({kind:'plug',device,specification,code,primary:code===primary}));
}
export function plugState(channel: PlugChannel, device = channel.device): DeviceState {
  const points = new Map(device.status.map(point=>[point.code,point.value]));
  const value = points.get(channel.code);
  if (typeof value !== 'boolean') throw new Error('Plug ' + device.id + ' missing Boolean ' + channel.code + ' state');
  const state: DeviceState = {state:value,online:device.online};
  if (!channel.primary) return state; // Device-wide metering belongs to primary channel only.
  const measures = [ ['cur_current','currentMa',{A:1000,mA:1}], ['cur_voltage','voltageMv',{V:1000,mV:1}], ['cur_power','powerMw',{W:1000,kW:1000000,mW:1}], [channel.energyCode ?? 'total_forward_energy','energyMwh',{kWh:1000000,Wh:1000,mWh:1}], ['total_forward_energy','energyMwh',{kWh:1000000,Wh:1000,mWh:1}] ] as const;
  for (const [code,key,units] of measures) {
    if (state[key] !== undefined) continue;
    const raw = points.get(code); const range = channel.specification.status.find(item=>item.code===code);
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || !range || range.type.toLowerCase() !== 'integer') continue;
    const meta = typeof range.values === 'string' ? object(JSON.parse(range.values)) : range.values;
    if (typeof meta.scale !== 'number' || !Number.isInteger(meta.scale) || meta.scale < 0 || meta.scale > 12 || typeof meta.unit !== 'string') continue;
    const multiplier = (units as Record<string,number>)[meta.unit === "kwh" ? "kWh" : meta.unit];
    if (multiplier === undefined) continue; // Missing/unknown unit never guessed.
    const value = Math.round(raw / 10 ** meta.scale * multiplier);
    if (Number.isSafeInteger(value)) state[key] = value;
  }
  return state;
}
export function plugDevice(channel: PlugChannel): TuyaDevice {
  return {id:channel.primary ? channel.device.id : channel.device.id + ':' + channel.code,name:channel.primary ? channel.device.name : channel.device.name + ' ' + channel.code,dev_type:'outlet',ha_type:'outlet',data:plugState(channel)};
}
