import type {DeviceState,TuyaApiMethod,TuyaApiPayload,TuyaDevice} from '../api/response.js';
import {UnsupportedOperationError} from '../errors/index.js';
import type {CloudBackend,CloudDevice,CloudPoint} from './types.js';
import {plugChannels,plugDevice,plugState,type PlugChannel} from './plug-data.js';
import {settingChannels,settingDevice,settingState,type SettingChannel} from './setting-data.js';
import {LIGHT_CATEGORIES,lightChannel,lightDevice,lightState,type LightChannel,type KelvinRange} from './light-data.js';
import {lightCommands} from './light-commands.js';
type Channel=PlugChannel|SettingChannel|LightChannel;
function stateFor(channel:Channel,source:CloudDevice):DeviceState {return channel.kind==='setting'?settingState(channel,source):channel.kind==='light'?lightState(channel,source):plugState(channel,source);}
export class ModernCloudClient {
  private channels=new Map<string,Channel>();
  private sources=new Map<string,CloudDevice>();
  private revisions=new Map<string,number>();
  private pollCache?:Map<string,Promise<CloudDevice>>;
  private queues=new Map<string,Promise<unknown>>();
  private closed=false;
  constructor(private backend:CloudBackend,private diagnostic:(message:string)=>void=()=>{},private energyCounters:{id:string;code:string}[]=[],private temperatureRanges:KelvinRange[]=[]) {}
  async getOrRefreshToken():Promise<void> {this.assertActive();await this.backend.authenticate();}
  async discoverDevices():Promise<TuyaDevice[]> {
    this.assertActive();const revisions=new Map(this.revisions);const channels=new Map<string,Channel>();const devices:TuyaDevice[]=[];const present=new Set<string>();
    for(const device of await this.backend.devices()) {
      this.assertActive();present.add(device.id);
      const light=(LIGHT_CATEGORIES as readonly string[]).includes(device.category);
      if(!['cz','pc'].includes(device.category)&&!light){this.diagnostic('Unsupported Tuya category '+device.category+' for '+device.id);continue;}
      const specification=await this.backend.specification(device.id);
      const source={...((this.revisions.get(device.id)??0)===(revisions.get(device.id)??0)?device:this.sources.get(device.id)??device),name:device.name};
      this.sources.set(device.id,source);
      if(light){
        const channel=lightChannel(source,specification,this.temperatureRanges.find(range=>range.id===device.id),this.diagnostic);
        if(!channel){this.unsupportedDevice(device.id);continue;}
        const endpoint=lightDevice(channel);channels.set(endpoint.id,channel);devices.push(endpoint);continue;
      }
      const mappings=plugChannels(source,specification);
      if(!mappings.length){this.unsupportedDevice(device.id);continue;}
      for(const mapping of mappings){mapping.energyCode=this.energyCounters.find(item=>item.id===device.id)?.code;const endpoint=plugDevice(mapping);channels.set(endpoint.id,mapping);devices.push(endpoint);}
      for(const mapping of settingChannels(source,specification,this.diagnostic)){const endpoint=settingDevice(mapping);channels.set(endpoint.id,mapping);devices.push(endpoint);}
    }
    this.assertActive();this.channels=channels;for(const id of this.sources.keys())if(!present.has(id)){this.sources.delete(id);this.revisions.delete(id);}return devices;
  }
  private unsupportedDevice(id:string):void {
    if([...this.channels.values()].some(channel=>channel.device.id===id))throw new Error('Device '+id+' lost writable capabilities; retaining discovery');
    this.diagnostic('Device '+id+' lacks supported writable datapoints; omitted');
  }
  beginStatePoll():void {this.pollCache=new Map();}
  endStatePoll():void {this.pollCache=undefined;}
  async getDeviceState(id:string):Promise<DeviceState> {
    const channel=this.channel(id);let query=this.pollCache?.get(channel.device.id);
    if(!query){query=this.serialize(channel.device.id,async()=>{const source=await this.backend.device(channel.device.id);this.assertActive();this.sources.set(source.id,source);this.bump(source.id);return source;});this.pollCache?.set(channel.device.id,query);}
    const device=await query;this.assertActive();return stateFor(channel,device);
  }
  async setDeviceState<Method extends TuyaApiMethod>(id:string,method:Method,payload:TuyaApiPayload<Method>):Promise<DeviceState|void> {
    const channel=this.channel(id);
    return this.serialize(channel.device.id,async()=>{
      const source=this.sources.get(channel.device.id)??channel.device;let commands:CloudPoint[];
      if(channel.kind==='light')commands=lightCommands(channel,source,method,payload);
      else if(channel.kind==='setting') {
        if(method!=='configurationSet'||!('value' in payload)||typeof payload.value!=='number'||!Number.isInteger(payload.value))throw new UnsupportedOperationError('Only configuration mode selection supported');
        const mode=channel.modes.find(mode=>mode.mode===payload.value);if(!mode)throw new UnsupportedOperationError('Unsupported configuration mode');
        commands=[{code:channel.code,value:mode.value}];
      } else {
        if(method!=='turnOnOff'||!('value' in payload)||(payload.value!==0&&payload.value!==1))throw new UnsupportedOperationError('Only plug on/off supported by modern cloud client');
        commands=[{code:channel.code,value:payload.value===1}];
      }
      this.pollCache?.delete(source.id);await this.backend.commands(source.id,commands);this.assertActive();
      const points=new Map(source.status.map(point=>[point.code,point.value]));for(const point of commands)points.set(point.code,point.value);
      const committed={...source,status:[...points].map(([code,value])=>({code,value}))};this.sources.set(source.id,committed);this.bump(source.id);this.pollCache?.delete(source.id);
      return stateFor(channel,committed);
    });
  }
  private bump(id:string):void {this.revisions.set(id,(this.revisions.get(id)??0)+1);}
  private serialize<T>(id:string,operation:()=>Promise<T>):Promise<T> {
    const result=(this.queues.get(id)??Promise.resolve()).then(()=>{this.assertActive();return operation();});
    const tail=result.catch(()=>undefined);this.queues.set(id,tail);
    void tail.then(()=>{if(this.queues.get(id)===tail)this.queues.delete(id);});return result;
  }
  private assertActive():void {if(this.closed)throw new Error('Tuya client is shut down');}
  private channel(id:string):Channel {this.assertActive();const channel=this.channels.get(id);if(!channel)throw new Error('Unknown Tuya endpoint '+id);return channel;}
  shutdown():void {this.closed=true;this.channels.clear();this.sources.clear();this.revisions.clear();this.pollCache=undefined;this.queues.clear();this.backend.shutdown();}
}
