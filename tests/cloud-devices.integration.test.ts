import {beforeAll,afterAll,test,expect} from 'bun:test';
import {setupTest,resetTest} from 'matterbridge/test-utils/buntest/setup';
import {addMatterbridge,createTestEnvironment,createServerNode,destroyTestEnvironment,getMatterbridge,server} from 'matterbridge/test-utils/buntest/matter';
import {AnsiLogger} from 'matterbridge/logger';
import {Network,NetworkSimulator} from 'matterbridge/matter';
import {OnOffServer,LevelControlServer,ColorControlServer,ModeSelectServer} from 'matterbridge/matter/behaviors';
import {OnOff,LevelControl,ColorControl} from 'matterbridge/matter/clusters';
import {TuyaPlatform} from '../src/platform.js';
import {OpenApi} from '../src/cloud/OpenApi.js';
import {ModernCloudClient} from '../src/cloud/CloudClient.js';
import type {CloudDevice,CloudSpecification,CloudTransport} from '../src/cloud/types.js';
import {light,lightSpec,kelvinRange} from './fixtures/cloud-light.js';
const sources:CloudDevice[]=[structuredClone(light),{id:'onoff',name:'Simple light',category:'dj',online:true,status:[{code:'switch_led',value:false}]},{id:'plug',name:'Kitchen',category:'cz',online:true,status:[{code:'switch_1',value:true},{code:'child_lock',value:false}]}];
const specs:Record<string,CloudSpecification>={'light-a':lightSpec,onoff:{functions:[lightSpec.functions[0]!],status:[]},plug:{functions:[{code:'switch_1',type:'Boolean',values:{}},{code:'child_lock',type:'Boolean',values:{}}],status:[]}};
const sent:{id:string;properties:Record<string,unknown>}[]=[];let fail=false;let queries=0;let platform:TuyaPlatform;
const reply=(result:unknown)=>Response.json({success:true,result});
const transport:CloudTransport=async(url,init)=>{
  const route=new URL(url).pathname;
  if(route==='/v1.0/token')return reply({access_token:'fixture',expire_time:7200});
  if(route==='/v2.0/cloud/thing/device')return reply(sources.map(device=>({...device,isOnline:device.online})));
  const parts=route.split('/');const id=decodeURIComponent(parts[4]!);const device=sources.find(device=>device.id===id);if(!device)throw new Error('unexpected fixture request '+route);
  if(route.endsWith('/model'))return reply({model:JSON.stringify({services:[{code:'',properties:specs[id]!.functions.map(range=>({code:range.code,accessMode:'rw',typeSpec:{...(range.values as object),type:range.type==='Boolean'?'bool':range.type==='Integer'?'value':range.type==='Json'?'string':range.type.toLowerCase()}}))}]})});
  if(route.endsWith('/shadow/properties/issue')) {
    const body=JSON.parse(String(init.body));const properties=JSON.parse(body.properties);sent.push({id,properties});
    if(fail)return Response.json({success:false,code:2008});
    for(const [code,value] of Object.entries(properties)){const point=device.status.find(point=>point.code===code);if(point)point.value=value;else device.status.push({code,value});}return reply({});
  }
  if(route.endsWith('/shadow/properties')){queries++;return reply({properties:structuredClone(device.status)});}
  return reply({...device,is_online:device.online});
};
beforeAll(async()=>{
  await setupTest('TuyaCloudDeviceIntegration');const env=await createTestEnvironment();env.set(Network,new NetworkSimulator().addHost(1));await createServerNode(0);
  const cloud=new ModernCloudClient(new OpenApi({accessId:'id',accessSecret:'secret',region:'eu'},transport),()=>{},[],[kelvinRange]);
  platform=new TuyaPlatform(getMatterbridge(),new AnsiLogger({logName:'TuyaCloud'}),{name:'matterbridge-tuya-cloud',type:'DynamicPlatform',version:'0.1.0',debug:false,unregisterOnShutdown:true,options:{userCodeAuth:{userCode:'fixture'},polling:{statePollingInterval:0}}},()=>cloud);
  addMatterbridge(platform);await platform.onStart();await platform.onConfigure();
},60000);
afterAll(async()=>{await platform?.onShutdown();await server?.close();await destroyTestEnvironment();resetTest();});
test('modern signed HTTP discovery registers capability-specific real endpoints',()=>{
  expect(platform.devices.size).toBe(4);const color=platform.devices.get('light-a')!.binding.endpoint;expect(color.hasClusterServer(ColorControl.id)).toBe(true);expect(color.hasClusterServer(LevelControl.id)).toBe(true);expect(color.state.levelControl.currentLevel).toBe(126);expect(color.state.colorControl.colorTemperatureMireds).toBe(370);
  const simple=platform.devices.get('onoff')!.binding.endpoint;expect(simple.hasClusterServer(OnOff.id)).toBe(true);expect(simple.hasClusterServer(LevelControl.id)).toBe(false);expect(simple.hasClusterServer(ColorControl.id)).toBe(false);
  expect(platform.devices.get('plug:config:child_lock')!.binding.endpoint.hasClusterServer(OnOff.id)).toBe(false);
});
test('Matter level+power command becomes one quantized cloud batch',async()=>{
  const entry=platform.devices.get('light-a')!;const before=sent.length;
  await entry.binding.endpoint.act(async agent=>{await agent.get(LevelControlServer).moveToLevelWithOnOff({level:128,transitionTime:0});});await entry.updates;
  expect(sent.length-before).toBe(1);expect(sent.at(-1)).toEqual({id:'light-a',properties:{work_mode:'white',bright_value_v2:510,switch_led:true}});expect(entry.controller.state.brightness).toBe(510);expect(entry.binding.endpoint.state.levelControl.currentLevel).toBe(129);expect(entry.controller.state.state).toBe(true);expect(entry.binding.endpoint.state.onOff.onOff).toBe(true);
});
test('RGB and Kelvin commands reach typed v2 properties; rejected writes retain cache',async()=>{
  const entry=platform.devices.get('light-a')!;
  await entry.binding.endpoint.act(async agent=>{await agent.get(ColorControlServer).moveToHueAndSaturation({hue:254,saturation:127,transitionTime:0,optionsMask:{executeIfOff:true},optionsOverride:{executeIfOff:true}});});await entry.updates;
  expect(sent.at(-1)).toEqual({id:'light-a',properties:{work_mode:'colour',colour_data_v2:'{"h":360,"s":500,"v":700}'}});expect(entry.controller.state.color_mode).toBe('colour');expect(entry.controller.state.color?.hue).toBe('360');
  const previous=entry.controller.state;fail=true;try{await expect(entry.binding.endpoint.act(async agent=>{await agent.get(ColorControlServer).moveToColorTemperature({colorTemperatureMireds:200,transitionTime:0,optionsMask:{executeIfOff:true},optionsOverride:{executeIfOff:true}});})).rejects.toThrow('2008');}finally{fail=false;}
  expect(entry.controller.state).toEqual(previous);
  await entry.binding.endpoint.act(async agent=>{await agent.get(ColorControlServer).moveToColorTemperature({colorTemperatureMireds:200,transitionTime:0,optionsMask:{executeIfOff:true},optionsOverride:{executeIfOff:true}});});await entry.updates;
  expect(sent.at(-1)?.properties.work_mode).toBe('white');expect(sent.at(-1)?.properties.temp_value_v2).toBe(605);
});
test('settings, on/off-only lights and shared cloud polling work through real endpoints',async()=>{
  const setting=platform.devices.get('plug:config:child_lock')!;await setting.binding.endpoint.act(async agent=>{await agent.get(ModeSelectServer).changeToMode({newMode:1});});expect(sent.at(-1)).toEqual({id:'plug',properties:{child_lock:true}});
  const simple=platform.devices.get('onoff')!;await simple.binding.endpoint.act(async agent=>{await agent.get(OnOffServer).on();});expect(sent.at(-1)).toEqual({id:'onoff',properties:{switch_led:true}});
  await simple.binding.endpoint.act(async agent=>{await agent.get(OnOffServer).toggle();});await simple.updates;expect(simple.controller.state.state).toBe(false);expect(simple.binding.endpoint.state.onOff.onOff).toBe(false);
  queries=0;sources.find(device=>device.id==='plug')!.online=false;await platform.pollDeviceStates();expect(queries).toBe(3);expect(setting.binding.endpoint.state.bridgedDeviceBasicInformation.reachable).toBe(false);expect(platform.devices.get('plug')!.binding.endpoint.state.bridgedDeviceBasicInformation.reachable).toBe(false);
});

test('unsupported light transitions do not send cloud commands',async()=>{
  const entry=platform.devices.get('light-a')!;const before=sent.length;
  await expect(entry.binding.endpoint.act(async agent=>{await agent.get(LevelControlServer).moveToLevel({level:100,transitionTime:10});})).rejects.toThrow('transitions unavailable');
  expect(sent.length).toBe(before);
});
