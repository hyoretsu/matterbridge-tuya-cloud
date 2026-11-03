import {test,expect} from 'bun:test';
import {ModernCloudClient} from '../src/cloud/CloudClient.js';
import {DeviceController} from '../src/controller.js';
import type {CloudBackend,CloudSpecification} from '../src/cloud/types.js';
import {light,lightSpec,kelvinRange} from './fixtures/cloud-light.js';
test('controller commits quantized cloud values and failed commands retain prior state',async()=>{
  let fail=false;const sent:unknown[]=[];
  const backend:CloudBackend={authenticate:async()=>{},devices:async()=>[structuredClone(light)],device:async()=>structuredClone(light),specification:async()=>lightSpec,commands:async(_id,commands)=>{sent.push(commands);if(fail)throw new Error('denied');},shutdown:()=>{}};
  const client=new ModernCloudClient(backend,()=>{},[],[kelvinRange]);const [device]=await client.discoverDevices();const controller=new DeviceController(device!,client);
  await controller.command('brightnessSet',{value:504,onOff:1},{brightness:504,state:true});expect(controller.state.brightness).toBe(500);expect(controller.state.state).toBe(true);
  const before=controller.state;fail=true;await expect(controller.command('colorSet',{color:{hue:300,saturation:1,brightness:900}},{color_mode:'colour'})).rejects.toThrow('denied');expect(controller.state).toEqual(before);
  fail=false;await controller.command('brightnessSet',{value:700});expect(sent.at(-1)).toEqual([{code:'work_mode',value:'white'},{code:'bright_value_v2',value:700}]);controller.dispose();client.shutdown();
});
test('stale discovery cannot erase successful light command state used by next partial write',async()=>{
  let pending:Promise<void>|undefined;let signal!:()=>void;let release!:()=>void;const sent:unknown[]=[];
  const entered=new Promise<void>(resolve=>signal=resolve);
  const backend:CloudBackend={authenticate:async()=>{},devices:async()=>[structuredClone(light)],device:async()=>structuredClone(light),specification:async()=>{if(pending){signal();await pending;}return lightSpec;},commands:async(_id,commands)=>{sent.push(commands);},shutdown:()=>{}};
  const client=new ModernCloudClient(backend,()=>{},[],[kelvinRange]);await client.discoverDevices();pending=new Promise<void>(resolve=>release=resolve);
  const discovery=client.discoverDevices();await entered;await client.setDeviceState('light-a','colorSet',{color:{hue:300,saturation:0.2,brightness:850}});release();const devices=await discovery;
  expect(devices[0]!.data.color_mode).toBe('colour');expect(devices[0]!.data.color?.brightness).toBe('850');
  await client.setDeviceState('light-a','brightnessSet',{value:800});expect(sent.at(-1)).toEqual([{code:'work_mode',value:'colour'},{code:'colour_data_v2',value:'{"h":300,"s":200,"v":800}'}]);client.shutdown();
});
test('unsupported new devices are diagnosed while capability loss retains existing discovery',async()=>{
  let specification:CloudSpecification=lightSpec;const messages:string[]=[];
  const backend:CloudBackend={authenticate:async()=>{},devices:async()=>[structuredClone(light)],device:async()=>structuredClone(light),specification:async()=>specification,commands:async()=>{},shutdown:()=>{}};
  const client=new ModernCloudClient(backend,message=>messages.push(message));specification={functions:[],status:[]};expect(await client.discoverDevices()).toEqual([]);expect(messages.some(message=>message.includes('omitted'))).toBe(true);
  specification=lightSpec;await client.discoverDevices();specification={functions:[],status:[]};await expect(client.discoverDevices()).rejects.toThrow('retaining discovery');
  await client.setDeviceState('light-a','turnOnOff',{value:1});client.shutdown();
});

test('queued partial color writes preserve latest components and normalized level survives mode changes',async()=>{
  const sent:unknown[]=[];const backend:CloudBackend={authenticate:async()=>{},devices:async()=>[structuredClone(light)],device:async()=>structuredClone(light),specification:async()=>lightSpec,commands:async(_id,commands)=>{sent.push(commands);},shutdown:()=>{}};
  const client=new ModernCloudClient(backend,()=>{},[],[kelvinRange]);await client.discoverDevices();
  await Promise.all([client.setDeviceState('light-a','colorSet',{color:{hue:300}}),client.setDeviceState('light-a','colorSet',{color:{saturation:0.2}})]);
  expect(sent.at(-1)).toEqual([{code:'work_mode',value:'colour'},{code:'colour_data_v2',value:'{"h":300,"s":200,"v":700}'}]);
  await client.setDeviceState('light-a','brightnessSet',{value:255,level:254});expect(sent.at(-1)).toEqual([{code:'work_mode',value:'colour'},{code:'colour_data_v2',value:'{"h":300,"s":200,"v":1000}'}]);client.shutdown();
});
