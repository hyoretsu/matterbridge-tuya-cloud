import {test,expect} from 'bun:test';
import {lightChannel,lightState,lightDevice,hsv} from './light-data.js';
import {lightCommands} from './light-commands.js';
import {light,lightSpec,kelvinRange} from '../../tests/fixtures/cloud-light.js';
test('v2 light uses metadata brightness, percent saturation and explicit Kelvin bounds',()=>{
  const channel=lightChannel(light,lightSpec,kelvinRange)!;const state=lightState(channel);
  expect(state).toEqual({state:false,online:true,brightness:500,color_mode:'white',color:{hue:'120',saturation:'50',brightness:'700'},color_temp:2700});
  expect(lightDevice(channel).lightRanges).toEqual({whiteBrightness:{min:10,max:1000},colorBrightness:{min:0,max:1000},kelvin:{min:2700,max:6500}});
  const maximum={...light,status:light.status.map(point=>point.code==='temp_value_v2'?{...point,value:1000}:point)};expect(lightState(channel,maximum).color_temp).toBe(6500);
});
test('temperature without Kelvin metadata is omitted, direct Kelvin and zero HSV remain valid',()=>{
  const messages:string[]=[];const unknown=lightChannel(light,lightSpec,undefined,message=>messages.push(message))!;expect(lightState(unknown).color_temp).toBeUndefined();expect(messages.some(message=>message.includes('Kelvin'))).toBe(true);
  expect(hsv('{"h":0,"s":0,"v":0}')).toEqual({h:0,s:0,v:0});expect(hsv('{"h":0,"s":1001,"v":0}')).toBeUndefined();expect(hsv('001203450678')).toBeUndefined();
  const spec={...lightSpec,functions:lightSpec.functions.map(range=>range.code==='temp_value_v2'?{...range,values:{min:2700,max:6500,step:1,scale:0,unit:'K'}}:range)};
  const source={...light,status:light.status.map(point=>point.code==='temp_value_v2'?{...point,value:4000}:point)};
  expect(lightState(lightChannel(source,spec)!).color_temp).toBe(4000);
});
test('light commands batch mode, quantized brightness and power; off avoids extra writes',()=>{
  const channel=lightChannel(light,lightSpec,kelvinRange)!;
  expect(lightCommands(channel,light,'brightnessSet',{value:504,onOff:1})).toEqual([{code:'work_mode',value:'white'},{code:'bright_value_v2',value:500},{code:'switch_led',value:true}]);
  expect(lightCommands(channel,light,'brightnessSet',{value:10,onOff:0})).toEqual([{code:'switch_led',value:false}]);
  expect(lightCommands(channel,light,'colorSet',{color:{hue:360,saturation:0,brightness:0}})).toEqual([{code:'work_mode',value:'colour'},{code:'colour_data_v2',value:'{"h":360,"s":0,"v":0}'}]);
  expect(lightCommands(channel,light,'colorTemperatureSet',{value:2700})).toEqual([{code:'work_mode',value:'white'},{code:'temp_value_v2',value:0}]);
  expect(lightCommands(channel,light,'colorTemperatureSet',{value:6500}).at(-1)?.value).toBe(1000);
  expect(()=>lightCommands(channel,light,'colorSet',{color:{hue:0,saturation:2,brightness:500}})).toThrow('range');
  expect(()=>lightCommands(channel,light,'colorTemperatureSet',{value:0})).toThrow('range');
});
test('on/off-only lights do not advertise unavailable dimming or color',()=>{
  const source={...light,status:[{code:'switch_led',value:true}]};const channel=lightChannel(source,{functions:[lightSpec.functions[0]!],status:[]})!;
  expect(lightDevice(channel).data).toEqual({state:true,online:true});expect(()=>lightCommands(channel,source,'brightnessSet',{value:20})).toThrow('unavailable');
});
