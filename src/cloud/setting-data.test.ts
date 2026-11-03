import {test,expect} from 'bun:test';
import {settingChannels,settingDevice,settingState} from './setting-data.js';
import {ModernCloudClient} from './CloudClient.js';
import type {CloudBackend,CloudDevice,CloudSpecification} from './types.js';
const device:CloudDevice={id:'plug',name:'Kitchen',category:'cz',online:true,status:[{code:'switch_1',value:true},{code:'child_lock',value:false},{code:'relay_status',value:'last'}]};
const specification:CloudSpecification={functions:[{code:'switch_1',type:'Boolean',values:'{}'},{code:'child_lock',type:'Boolean',values:'{}'},{code:'relay_status',type:'Enum',values:{range:['power_on','last','power_off']}}],status:[]};
test('settings expose real modes and stable IDs, never relay power',()=>{
  const channels=settingChannels(device,specification);expect(channels.length).toBe(2);const lock=settingDevice(channels[0]!);
  expect(lock.id).toBe('plug:config:child_lock');expect(lock.dev_type).toBe('mode_select');expect(lock.data).toEqual({selected_mode:0,online:true});expect(lock.data.state).toBeUndefined();
  const relay=channels[1]!;expect(relay.modes.map(mode=>mode.value)).toEqual(['last','power_off','power_on']);expect(settingState(relay).selected_mode).toBe(0);
  expect(()=>settingState(relay,{...device,status:[]})).toThrow('Unknown');
  const reversed={...specification,functions:specification.functions.map(range=>range.code==='relay_status'?{...range,values:{range:['power_off','power_on','last']}}:range)};
  expect(settingChannels(device,reversed)[1]!.modes).toEqual(relay.modes);
});
test('optional missing or non-writable settings are omitted',()=>{
  expect(settingChannels({...device,status:device.status.filter(point=>point.code==='switch_1')},specification)).toEqual([]);
  expect(settingChannels(device,{...specification,functions:[]})).toEqual([]);
});
test('selectors send exact Boolean/enum payloads, share polling and invalidate after writes',async()=>{
  let queries=0;const sent:unknown[]=[];
  const backend:CloudBackend={authenticate:async()=>{},devices:async()=>[structuredClone(device)],device:async()=>{queries++;return structuredClone(device);},specification:async()=>specification,commands:async(id,commands)=>{sent.push({id,commands});},shutdown:()=>{}};
  const client=new ModernCloudClient(backend);await client.discoverDevices();client.beginStatePoll();
  await Promise.all([client.getDeviceState('plug'),client.getDeviceState('plug:config:child_lock'),client.getDeviceState('plug:config:relay_status')]);expect(queries).toBe(1);
  await client.setDeviceState('plug:config:child_lock','configurationSet',{value:1});expect(sent[0]).toEqual({id:'plug',commands:[{code:'child_lock',value:true}]});
  await client.getDeviceState('plug');expect(queries).toBe(2);
  await client.setDeviceState('plug:config:relay_status','configurationSet',{value:2});expect(sent[1]).toEqual({id:'plug',commands:[{code:'relay_status',value:'power_on'}]});
  await expect(client.setDeviceState('plug:config:child_lock','configurationSet',{value:8})).rejects.toThrow('Unsupported');expect(sent.length).toBe(2);
  client.endStatePoll();client.shutdown();await expect(client.getDeviceState('plug')).rejects.toThrow('shut down');
});
