import type {DeviceState,TuyaDevice} from '../api/response.js';
import {object,type CloudDevice,type CloudSpecification,type CloudRange} from './types.js';
export const LIGHT_CATEGORIES=['dj','xdd','dd','fwd','dc','tgq','tgkg'] as const;
export interface KelvinRange {id:string;minKelvin:number;maxKelvin:number;}
export interface IntegerRange {code:string;min:number;max:number;step:number;scale:number;unit:string;}
export interface LightChannel {kind:'light';device:CloudDevice;power:string;brightness?:IntegerRange;color?:string;mode?:{code:string;values:string[]};temperature? :IntegerRange & {minKelvin:number;maxKelvin:number;direct:boolean};}
export function metadata(range:CloudRange):Record<string,unknown> {return typeof range.values==='string'?object(JSON.parse(range.values)):object(range.values);}
export function integerRange(range:CloudRange|undefined):IntegerRange|undefined {
  if(!range||range.type.toLowerCase()!=='integer')return;
  const data=metadata(range);
  if(typeof data.min!=='number'||typeof data.max!=='number'||!Number.isSafeInteger(data.min)||!Number.isSafeInteger(data.max)||data.max<=data.min||typeof data.scale!=='number'||!Number.isInteger(data.scale)||data.scale<0||data.scale>12||typeof data.step!=='number'||!Number.isSafeInteger(data.step)||data.step<=0||typeof data.unit!=='string')return;
  return {code:range.code,min:data.min,max:data.max,step:data.step,scale:data.scale,unit:data.unit};
}
export function hsv(value:unknown):{h:number;s:number;v:number}|undefined {
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{return;}}
  if(!value||typeof value!=='object'||Array.isArray(value))return;
  const color=value as Record<string,unknown>;
  if(typeof color.h!=='number'||typeof color.s!=='number'||typeof color.v!=='number'||!Number.isFinite(color.h)||!Number.isFinite(color.s)||!Number.isFinite(color.v)||color.h<0||color.h>360||color.s<0||color.s>1000||color.v<0||color.v>1000)return;
  return {h:color.h,s:color.s,v:color.v};
}
export function lightChannel(device:CloudDevice,specification:CloudSpecification,kelvin?:KelvinRange,diagnostic:(message:string)=>void=()=>{}):LightChannel|undefined {
  const writable=specification.functions;
  const power=['switch_led','switch_1','switch'].find(code=>writable.some(item=>item.code===code&&item.type.toLowerCase()==='boolean'));
  if(!power)return;
  const channel:LightChannel={kind:'light',device,power};
  const find=(codes:string[])=>codes.map(code=>writable.find(item=>item.code===code)).find(Boolean);
  const bright=find(['bright_value_v2','bright_value']);channel.brightness=integerRange(bright);
  if(bright&&!channel.brightness)diagnostic('Light '+device.id+': invalid brightness metadata; dimming omitted');
  const mode=writable.find(item=>item.code==='work_mode'&&item.type.toLowerCase()==='enum');
  if(mode){const values=metadata(mode).range;if(!Array.isArray(values)||values.some(value=>typeof value!=='string'))throw new Error('Malformed light work modes');channel.mode={code:mode.code,values:values as string[]};}
  const color=writable.find(item=>item.code==='colour_data_v2'&&['json','string'].includes(item.type.toLowerCase()));
  const hasColorState=color&&hsv(device.status.find(point=>point.code===color.code)?.value);
  if(hasColorState&&(!channel.mode||channel.mode.values.includes('colour')))channel.color=color!.code;
  else if(color)diagnostic('Light '+device.id+': unsupported/missing v2 HSV state or colour mode; RGB omitted');
  const temp=integerRange(find(['temp_value_v2','temp_value']));
  if(temp&&(!channel.mode||channel.mode.values.includes('white'))) {
    const direct=temp.unit==='K';
    const range=direct?{minKelvin:temp.min/10**temp.scale,maxKelvin:temp.max/10**temp.scale}:kelvin;
    if(range&&range.minKelvin>0&&range.maxKelvin>range.minKelvin&&(direct||temp.unit===''))channel.temperature={...temp,...range,direct};
    else diagnostic('Light '+device.id+': Kelvin bounds unknown; configure lightTemperatureRanges to expose color temperature');
  }
  if(channel.temperature&&!channel.brightness&&!channel.color){diagnostic('Light '+device.id+': color-temperature light requires dimming; exposing on/off only');channel.temperature=undefined;}
  return channel;
}
export function lightState(channel:LightChannel,device=channel.device):DeviceState {
  const points=new Map(device.status.map(point=>[point.code,point.value]));const on=points.get(channel.power);
  if(typeof on!=='boolean')throw new Error('Light '+device.id+' missing Boolean power state');
  const state:DeviceState={state:on,online:device.online};
  const mode=channel.mode?points.get(channel.mode.code):channel.color&&!channel.brightness?'colour':undefined;
  if(mode==='white'||mode==='colour')state.color_mode=mode;
  if(channel.brightness){const value=points.get(channel.brightness.code);if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=channel.brightness.max)state.brightness=value;}
  if(channel.color){const color=hsv(points.get(channel.color));if(!color)throw new Error('Missing/malformed light HSV state');state.color={hue:String(color.h),saturation:String(color.s/10),brightness:String(color.v)};}
  if(channel.temperature){const value=points.get(channel.temperature.code);const temp=channel.temperature;
    if(typeof value==='number'&&Number.isFinite(value)&&value>=temp.min&&value<=temp.max)state.color_temp=temp.direct?value/10**temp.scale:temp.minKelvin+(value-temp.min)/(temp.max-temp.min)*(temp.maxKelvin-temp.minKelvin);
  }
  return state;
}
export function lightDevice(channel:LightChannel):TuyaDevice {
  const state=lightState(channel);const range=channel.brightness;
  return {id:channel.device.id,name:channel.device.name,dev_type:'light',ha_type:'light',data:state,lightRanges:{...(range?{whiteBrightness:{min:range.min,max:range.max}}:{}),...(channel.color?{colorBrightness:{min:0,max:1000}}:{}),...(channel.temperature?{kelvin:{min:channel.temperature.minKelvin,max:channel.temperature.maxKelvin}}:{})}};
}
