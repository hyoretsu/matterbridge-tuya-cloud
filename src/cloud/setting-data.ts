import type {DeviceState,TuyaDevice} from '../api/response.js';
import {object,type CloudDevice,type CloudSpecification} from './types.js';
export interface SettingMode {mode:number;label:string;value:boolean|string;}
export interface SettingChannel {kind:'setting';device:CloudDevice;code:string;label:string;modes:SettingMode[];}
const LABELS:Record<string,string>={child_lock:'Child lock',overcharge_switch:'Overcharge protection',overcharge:'Overcharge protection',light_mode:'Indicator mode',relay_status:'Power-on behavior'};
const VALUES:Record<string,string>={power_on:'On',power_off:'Off',last:'Last state',none:'Off',relay:'Follow relay',pos:'Position',state:'State'};
export function settingChannels(device:CloudDevice,specification:CloudSpecification,diagnostic:(message:string)=>void=()=>{}):SettingChannel[] {
  const channels:SettingChannel[]=[];
  for(const range of specification.functions) {
    if(!LABELS[range.code])continue;
    const value=device.status.find(point=>point.code===range.code)?.value;
    let values:(boolean|string)[];
    if(range.type.toLowerCase()==='boolean')values=[false,true];
    else if(range.type.toLowerCase()==='enum') {
      const meta=typeof range.values==='string'?object(JSON.parse(range.values)):object(range.values);
      if(!Array.isArray(meta.range)||meta.range.some(item=>typeof item!=='string'||!item))throw new Error('Malformed Tuya enum '+range.code);
      values=[...new Set(meta.range as string[])].sort();
    } else continue;
    if(!values.length||values.length>256||!values.includes(value as string|boolean)) {diagnostic('Unsupported/missing setting state '+device.id+'/'+range.code);continue;}
    const modes=values.map((value,mode)=>({mode,label:typeof value==='boolean'?(value?'Enabled':'Disabled'):(VALUES[value]??value).slice(0,64),value}));
    channels.push({kind:'setting',device,code:range.code,label:LABELS[range.code]!,modes});
  }
  return channels;
}
export function settingState(channel:SettingChannel,device=channel.device):DeviceState {
  const raw=device.status.find(point=>point.code===channel.code)?.value;
  const mode=channel.modes.find(mode=>mode.value===raw);
  if(!mode)throw new Error('Unknown Tuya setting value '+device.id+'/'+channel.code);
  return {selected_mode:mode.mode,online:device.online};
}
export function settingDevice(channel:SettingChannel):TuyaDevice {
  return {id:channel.device.id+':config:'+channel.code,name:channel.device.name+' '+channel.label,dev_type:'mode_select',ha_type:'switch',data:settingState(channel),setting:{description:channel.label,modes:channel.modes.map(({mode,label})=>({mode,label}))}};
}
