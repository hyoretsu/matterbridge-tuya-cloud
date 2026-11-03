import type {DeviceState,TuyaApiMethod,TuyaApiPayload,TuyaDevice} from '../api/response.js';
import {UnsupportedOperationError} from '../errors/index.js';
import type {CloudBackend} from './types.js';
import {plugChannels,plugDevice,plugState,type PlugChannel} from './plug-data.js';
export class ModernCloudClient {
  private channels = new Map<string,PlugChannel>();
  constructor(private backend: CloudBackend, private diagnostic: (message:string)=>void = ()=>{}, private energyCounters: {id:string;code:string}[] = []) {}
  async getOrRefreshToken(): Promise<void> {await this.backend.authenticate();}
  async discoverDevices(): Promise<TuyaDevice[]> {
    const channels = new Map<string,PlugChannel>(); const devices: TuyaDevice[] = [];
    for (const device of await this.backend.devices()) {
      if (!['cz','pc'].includes(device.category)) {this.diagnostic('Unsupported Tuya category ' + device.category + ' for ' + device.id + '; current cloud release targets plugs'); continue;}
      const specification = await this.backend.specification(device.id);
      const mappings = plugChannels(device,specification);
      if (!mappings.length) throw new Error('Plug ' + device.id + ' lacks supported writable switch datapoints; retaining discovery');
      for (const mapping of mappings) { mapping.energyCode = this.energyCounters.find(item=>item.id===device.id)?.code; const endpoint = plugDevice(mapping); channels.set(endpoint.id,mapping); devices.push(endpoint); }
    }
    this.channels = channels; return devices;
  }
  async getDeviceState(id: string): Promise<DeviceState> {
    const channel = this.channel(id); return plugState(channel,await this.backend.device(channel.device.id));
  }
  async setDeviceState<Method extends TuyaApiMethod>(id: string,method: Method,payload: TuyaApiPayload<Method>): Promise<void> {
    const channel = this.channel(id);
    if (method !== 'turnOnOff' || !('value' in payload) || (payload.value !== 0 && payload.value !== 1)) throw new UnsupportedOperationError('Only plug on/off supported by modern cloud client');
    await this.backend.commands(channel.device.id,[{code:channel.code,value:payload.value===1}]);
  }
  private channel(id: string): PlugChannel { const channel = this.channels.get(id); if (!channel) throw new Error('Unknown Tuya plug channel ' + id); return channel; }
  shutdown(): void {this.channels.clear(); this.backend.shutdown();}
}
