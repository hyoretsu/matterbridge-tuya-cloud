import {join} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import QRCode from 'qrcode';
import type {ValidatedConfig} from '../config.js';
interface Logger { info(message:string): void; warn(message:string): void; }
import {SharingApi} from './SharingApi.js';
import {OpenApi} from './OpenApi.js';
import {ModernCloudClient} from './CloudClient.js';
export function createCloudClient(config: ValidatedConfig,directory: string,log: Logger): ModernCloudClient {
  const options = config.options;
  const backend = options.authMode === 'developer' ? new OpenApi({accessId:options.accessId,accessSecret:options.accessSecret,region:options.region}) : new SharingApi({userCode:options.userCode,clientId:options.sharingClientId,schema:options.sharingSchema,tokenFile:join(directory,'tuya-cloud-session.json')},async payload=>{
    await mkdir(directory,{recursive:true,mode:0o700});
    const file = join(directory,'tuya-cloud-login.svg');
    await writeFile(file,await QRCode.toString(payload,{type:'svg',width:320}),{mode:0o600});
    log.info('Scan Tuya authorization QR with Smart Life/Tuya Smart within 3 minutes. QR saved to ' + file);
    log.info(await QRCode.toString(payload,{type:'terminal',small:true}));
  });
  return new ModernCloudClient(backend,message=>log.warn(message),config.energyCounters);
}
