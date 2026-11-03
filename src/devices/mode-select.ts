import type {MatterbridgeEndpoint} from 'matterbridge';
import {ModeSelectServer} from 'matterbridge/matter/behaviors';
import {ModeSelect} from 'matterbridge/matter/clusters';
import type {DeviceController} from '../controller.js';
import type {DeviceState,TuyaDevice} from '../api/response.js';
import {matterCommand,unsupported,cloudWrite} from './conversions.js';
export function configureModeSelect(endpoint:MatterbridgeEndpoint,controller:DeviceController,device:TuyaDevice):(state:DeviceState)=>Promise<void> {
  const setting=device.setting;
  if(!setting||!setting.modes.some(mode=>mode.mode===device.data.selected_mode))throw new Error('Missing configuration mode definition');
  const role={};
  class TuyaModeSelectServer extends ModeSelectServer {
    override async changeToMode({newMode}:ModeSelect.ChangeToModeRequest) {
      if(!setting!.modes.some(mode=>mode.mode===newMode))unsupported('Unsupported configuration mode');
      this.state.currentMode=newMode;
      cloudWrite(this.context.transaction,role,()=>matterCommand(()=>controller.command('configurationSet',{value:newMode},{selected_mode:newMode})));
    }
  }
  endpoint.behaviors.require(TuyaModeSelectServer,{description:setting.description,standardNamespace:null,supportedModes:setting.modes.map(mode=>({...mode,semanticTags:[]})),currentMode:device.data.selected_mode});
  return async state=>{if(state.selected_mode!==undefined&&setting.modes.some(mode=>mode.mode===state.selected_mode))await endpoint.setAttribute(ModeSelect.id,'currentMode',state.selected_mode);};
}
