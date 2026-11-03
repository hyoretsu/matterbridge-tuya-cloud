import type {TuyaApiMethod,TuyaApiPayload} from '../api/response.js';
import {UnsupportedOperationError} from '../errors/index.js';
import type {CloudDevice,CloudPoint} from './types.js';
import {hsv,lightState,type IntegerRange,type LightChannel} from './light-data.js';
function reject(message:string):never {throw new UnsupportedOperationError(message);}
function value(number:unknown,min:number,max:number):number {if(typeof number!=='number'||!Number.isFinite(number)||number<min||number>max)reject('Light value outside supported range');return number;}
function quantize(number:number,range:IntegerRange):number {return Math.max(range.min,Math.min(range.max,range.min+Math.round((number-range.min)/range.step)*range.step));}
export function lightCommands<Method extends TuyaApiMethod>(channel:LightChannel,device:CloudDevice,method:Method,payload:TuyaApiPayload<Method>):CloudPoint[] {
  const commands:CloudPoint[]=[];
  const mode=(next:'white'|'colour')=>{if(channel.mode){if(!channel.mode.values.includes(next))reject('Light mode unavailable');commands.push({code:channel.mode.code,value:next});}};
  if(method==='turnOnOff'&&'value' in payload&&(payload.value===0||payload.value===1))return [{code:channel.power,value:payload.value===1}];
  if(method==='brightnessSet'&&'value' in payload) {
    const request=payload as {value:number;onOff?:0|1;level?:number};
    if(request.onOff!==undefined&&request.onOff!==0&&request.onOff!==1)reject('Invalid light on/off value');
    if(!channel.brightness&&!channel.color)reject('Light brightness unavailable');
    if(request.onOff===0)return [{code:channel.power,value:false}];
    const state=lightState(channel,device);const colorMode=channel.color&&(state.color_mode==='colour'||!channel.brightness);
    const min=colorMode?0:channel.brightness!.min;const max=colorMode?1000:channel.brightness!.max;
    const requested=request.level===undefined?request.value:Math.round(min+(Math.max(1,value(request.level,0,254))-1)/253*(max-min));
    if(colorMode){const color=hsv(device.status.find(point=>point.code===channel.color)?.value);if(!color)reject('Light color unknown');mode('colour');commands.push({code:channel.color!,value:JSON.stringify({...color,v:Math.round(value(requested,0,1000))})});}
    else {const range=channel.brightness!;mode('white');commands.push({code:range.code,value:quantize(value(requested,range.min,range.max),range)});}
    if(request.onOff===1)commands.push({code:channel.power,value:true});return commands;
  }
  if(method==='colorSet'&&'color' in payload) {
    if(!channel.color)reject('Light RGB unavailable');const previous=hsv(device.status.find(point=>point.code===channel.color)?.value);if(!previous)reject('Light color unknown');const color=payload.color;mode('colour');commands.push({code:channel.color,value:JSON.stringify({h:Math.round(value(color.hue===undefined?previous.h:color.hue,0,360)),s:Math.round(value(color.saturation===undefined?previous.s/1000:color.saturation,0,1)*1000),v:Math.round(value(color.brightness===undefined?previous.v:color.brightness,0,1000))})});return commands;
  }
  if(method==='colorTemperatureSet'&&'value' in payload) {
    const temp=channel.temperature;if(!temp)reject('Light color temperature unavailable');const kelvin=value(payload.value,temp.minKelvin,temp.maxKelvin);mode('white');
    commands.push({code:temp.code,value:quantize(temp.direct?kelvin*10**temp.scale:temp.min+(kelvin-temp.minKelvin)/(temp.maxKelvin-temp.minKelvin)*(temp.max-temp.min),temp)});return commands;
  }
  return reject('Unsupported light operation '+method);
}
