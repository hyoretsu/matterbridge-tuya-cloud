import {test,expect} from 'bun:test';
import {plugChannels,plugDevice,plugState} from './plug-data.js';
import {ModernCloudClient} from './CloudClient.js';
import type {CloudDevice,CloudSpecification,CloudBackend} from './types.js';
export const plug: CloudDevice = {id:'plug',name:'Kitchen',category:'cz',online:true,status:[{code:'switch_1',value:false},{code:'cur_current',value:788},{code:'cur_voltage',value:2100},{code:'cur_power',value:1130},{code:'total_forward_energy',value:60}]};
export const specification: CloudSpecification = {functions:[{code:'switch_1',type:'Boolean',values:'{}'}],status:[{code:'cur_current',type:'Integer',values:'{"scale":0,"unit":"mA"}'},{code:'cur_voltage',type:'Integer',values:'{"scale":1,"unit":"V"}'},{code:'cur_power',type:'Integer',values:'{"scale":1,"unit":"W"}'},{code:'total_forward_energy',type:'Integer',values:'{"scale":3,"unit":"kWh"}'}]};
test('plug readings match screenshot physical units, including zero',()=>{
  const channel=plugChannels(plug,specification)[0]!;
  expect(plugState(channel)).toEqual({state:false,online:true,currentMa:788,voltageMv:210000,powerMw:113000,energyMwh:60000});
  expect(plugState(channel,{...plug,status:plug.status.map(p=>({...p,value:p.code==='switch_1'?false:0}))})).toEqual({state:false,online:true,currentMa:0,voltageMv:0,powerMw:0,energyMwh:0});
});
test('unknown units, missing scaling and invalid data never manufacture readings',()=>{
  const modified=structuredClone(specification);modified.status[0]!.values='{"scale":0,"unit":"unknown"}';modified.status[1]!.values='{"unit":"V"}';
  const state=plugState(plugChannels(plug,modified)[0]!);expect(state.currentMa).toBeUndefined();expect(state.voltageMv).toBeUndefined();
  expect(()=>plugState(plugChannels({...plug,status:[]},specification)[0]!)).toThrow('Boolean');
  expect(plugChannels({...plug,category:'wnykq'},specification)).toEqual([]);
});
test('multiple channels keep identities through ordering and send exact writable datapoint',async()=>{
  const multi={...plug,status:[...plug.status,{code:'switch_2',value:true}]};const specs={...specification,functions:[{code:'switch_2',type:'Boolean',values:'{}'},...specification.functions]};
  let fail=false;const calls:unknown[]=[];
  const backend: CloudBackend={authenticate:async()=>{},devices:async()=>[multi],device:async()=>multi,specification:async()=>specs,commands:async(id,commands)=>{calls.push({id,commands});if(fail)throw new Error('denied');},shutdown:()=>{}};
  const client=new ModernCloudClient(backend);const devices=await client.discoverDevices();expect(devices.map(d=>d.id)).toEqual(['plug','plug:switch_2']);expect(devices[1]!.data.energyMwh).toBeUndefined();
  await client.setDeviceState('plug:switch_2','turnOnOff',{value:0});expect(calls).toEqual([{id:'plug',commands:[{code:'switch_2',value:false}]}]);
  fail=true;await expect(client.setDeviceState('plug','turnOnOff',{value:1})).rejects.toThrow('denied');
  await expect(client.setDeviceState('plug','brightnessSet',{value:20})).rejects.toThrow('Only plug');
  expect(plugDevice(plugChannels(plug,specification)[0]!).id).toBe('plug');client.shutdown();
});

test('ambiguous add_ele is omitted unless explicitly verified cumulative',()=>{
  const device={...plug,status:plug.status.map(p=>p.code==='total_forward_energy'?{...p,code:'add_ele'}:p)};
  const specs={...specification,status:specification.status.map(p=>p.code==='total_forward_energy'?{...p,code:'add_ele',values:'{"scale":3,"unit":"kwh"}'}:p)};
  const channel=plugChannels(device,specs)[0]!;
  expect(plugState(channel).energyMwh).toBeUndefined();
  expect(plugState({...channel,energyCode:'add_ele'}).energyMwh).toBe(60000);
});
