import {join} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import QRCode from 'qrcode';
import type {ValidatedConfig} from '../config.js';
interface Logger { info(message:string): void; warn(message:string): void; }
import {SharingApi} from './SharingApi.js';
import {OpenApi} from './OpenApi.js';
import {ModernCloudClient} from './CloudClient.js';
// One log line per QR row, two full-block characters per module: half-block glyphs break under web log viewers' line spacing.
// Light modules are drawn as blocks (and dark ones as no-break spaces, which HTML does not collapse) for dark log backgrounds.
function renderQr(payload: string): string[] {
  const {size,data} = QRCode.create(payload,{errorCorrectionLevel:'L'}).modules;
  const quiet = 2;
  const cell = (x: number,y: number) => x >= 0 && y >= 0 && x < size && y < size && data[y * size + x] ? '\u00a0\u00a0' : '\u2588\u2588';
  const lines: string[] = [];
  for (let y = -quiet; y < size + quiet; y++) {
    let line = '';
    for (let x = -quiet; x < size + quiet; x++) line += cell(x,y);
    lines.push(line);
  }
  return lines;
}
export function createCloudClient(config: ValidatedConfig,directory: string,log: Logger): ModernCloudClient {
  const options = config.options;
  const backend = options.authMode === 'developer' ? new OpenApi({accessId:options.accessId,accessSecret:options.accessSecret,region:options.region}) : new SharingApi({userCode:options.userCode,clientId:options.sharingClientId,schema:options.sharingSchema,tokenFile:join(directory,'tuya-cloud-session.json')},async payload=>{
    await mkdir(directory,{recursive:true,mode:0o700});
    const file = join(directory,'tuya-cloud-login.svg');
    await writeFile(file,await QRCode.toString(payload,{type:'svg',width:320}),{mode:0o600});
    log.info('Scan Tuya authorization QR with Smart Life/Tuya Smart within 3 minutes. QR saved to ' + file);
    for (const line of renderQr(payload)) log.info(line);
  });
  return new ModernCloudClient(backend,message=>log.warn(message),config.energyCounters,config.lightTemperatureRanges);
}
