import type {DeviceState,TuyaApiMethod,TuyaApiPayload,TuyaDevice} from '../api/response.js';
import {UnsupportedOperationError} from '../errors/index.js';
import type {CloudBackend,CloudDevice,CloudPoint} from './types.js';
import {plugChannels,plugDevice,plugState,type PlugChannel} from './plug-data.js';
import {settingChannels,settingDevice,settingState,type SettingChannel} from './setting-data.js';
type Channel=PlugChannel|SettingChannel;
export class ModernCloudClient {
  private channels=new Map<string,Channel>();
  private pollCache?:Map<string,Promise<CloudDevice>>;
  private queues=new Map<string,Promise<unknown>>();
  private closed=false;
  constructor(private backend:CloudBackend,private diagnostic:(message:string)=>void=()=>{},private energyCounters:{id:string;code:string}[]=[]) {}
  async getOrRefreshToken():Promise<void> {this.assertActive();await this.backend.authenticate();}
  async discoverDevices():Promise<TuyaDevice[]> {
    this.assertActive();const channels=new Map<string,Channel>();const devices:TuyaDevice[]=[];
    for(const device of await this.backend.devices()) {
      this.assertActive();
      if(!['cz','pc'].includes(device.category)){this.diagnostic('Unsupported Tuya category '+device.category+' for '+device.id);continue;}
      const specification=await this.backend.specification(device.id);
      const mappings=plugChannels(device,specification);
      if(!mappings.length)throw new Error('Plug '+device.id+' lacks supported writable switch datapoints; retaining discovery');
      for(const mapping of mappings){mapping.energyCode=this.energyCounters.find(item=>item.id===device.id)?.code;const endpoint=plugDevice(mapping);channels.set(endpoint.id,mapping);devices.push(endpoint);}
      for(const mapping of settingChannels(device,specification,this.diagnostic)){const endpoint=settingDevice(mapping);channels.set(endpoint.id,mapping);devices.push(endpoint);}
    }
    this.assertActive();this.channels=channels;return devices;
  }
  beginStatePoll():void {this.pollCache=new Map();}
  endStatePoll():void {this.pollCache=undefined;}
  async getDeviceState(id:string):Promise<DeviceState> {
    const channel=this.channel(id);let query=this.pollCache?.get(channel.device.id);
    if(!query){query=this.serialize(channel.device.id,()=>this.backend.device(channel.device.id));this.pollCache?.set(channel.device.id,query);}
    const device=await query;this.assertActive();return channel.kind==='setting'?settingState(channel,device):plugState(channel,device);
  }
  async setDeviceState<Method extends TuyaApiMethod>(id:string,method:Method,payload:TuyaApiPayload<Method>):Promise<void> {
    const channel=this.channel(id);let commands:CloudPoint[];
    if(channel.kind==='setting') {
      if(method!=='configurationSet'||!('value' in payload)||typeof payload.value!=='number'||!Number.isInteger(payload.value))throw new UnsupportedOperationError('Only configuration mode selection supported');
      const mode=channel.modes.find(mode=>mode.mode===payload.value);if(!mode)throw new UnsupportedOperationError('Unsupported configuration mode');
      commands=[{code:channel.code,value:mode.value}];
    } else {
      if(method!=='turnOnOff'||!('value' in payload)||(payload.value!==0&&payload.value!==1))throw new UnsupportedOperationError('Only plug on/off supported by modern cloud client');
      commands=[{code:channel.code,value:payload.value===1}];
    }
    await this.serialize(channel.device.id,async()=>{this.pollCache?.delete(channel.device.id);await this.backend.commands(channel.device.id,commands);this.pollCache?.delete(channel.device.id);});
  }
  private serialize<T>(id:string,operation:()=>Promise<T>):Promise<T> {
    const result=(this.queues.get(id)??Promise.resolve()).then(()=>{this.assertActive();return operation();});
    const tail=result.catch(()=>undefined);this.queues.set(id,tail);
    void tail.then(()=>{if(this.queues.get(id)===tail)this.queues.delete(id);});return result;
  }
  private assertActive():void {if(this.closed)throw new Error('Tuya client is shut down');}
  private channel(id:string):Channel {this.assertActive();const channel=this.channels.get(id);if(!channel)throw new Error('Unknown Tuya endpoint '+id);return channel;}
  shutdown():void {this.closed=true;this.channels.clear();this.pollCache=undefined;this.queues.clear();this.backend.shutdown();}
}
