import {randomUUID, createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, rename, chmod} from 'node:fs/promises';
import {dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {HttpClient} from './HttpClient.js';
import {sharingKeys, sharingSignature, encryptSharing, decryptSharing} from './sharing-crypto.js';
import {cloudDevice, cloudSpecification, list, object, type CloudBackend, type CloudPoint, type CloudTransport} from './types.js';
export const SHARING_CLIENT_ID = 'HA_3y9q4ak7g4ephrvke';
export const SHARING_SCHEMA = 'haauthorize';
export interface SharingOptions { userCode: string; tokenFile: string; clientId?: string; schema?: string; }
interface SharingSession { access_token: string; refresh_token: string; uid: string; expires: number; endpoint: string; account: string; }
export function sharingEndpoint(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Missing Tuya sharing endpoint');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !['tuyaus.com','tuyaeu.com','tuyacn.com','tuyain.com','iotbing.com'].some(domain => url.hostname.endsWith('.' + domain))) throw new Error('Invalid Tuya sharing endpoint');
  return url.origin;
}
export class SharingApi implements CloudBackend {
  private http: HttpClient;
  private session?: SharingSession;
  private loading?: Promise<void>;
  private abort = new AbortController();
  constructor(private options: SharingOptions, private showQr: (payload: string) => Promise<void>, transport?: CloudTransport, private pause: (signal: AbortSignal)=>Promise<unknown> = signal=>delay(2000,undefined,{signal})) { this.http = new HttpClient(transport); }
  private get account(): string { return createHash('sha256').update(this.options.userCode + ':' + (this.options.clientId ?? SHARING_CLIENT_ID)).digest('hex'); }
  private async save(): Promise<void> {
    await mkdir(dirname(this.options.tokenFile), {recursive:true,mode:0o700});
    const temporary = this.options.tokenFile + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(this.session), {mode:0o600});
    await rename(temporary, this.options.tokenFile); await chmod(this.options.tokenFile,0o600);
  }
  async authenticate(): Promise<void> {
    if (this.abort.signal.aborted) throw new Error('Tuya client is shut down');
    if (this.session && this.session.expires > Date.now() + 60000) return;
    if (this.loading) return this.loading;
    this.loading = this.login();
    try { await this.loading; } finally { this.loading = undefined; }
  }
  private async login(): Promise<void> {
    if (!this.session) {
      try {
        const saved = object(JSON.parse(await readFile(this.options.tokenFile,'utf8')));
        if (saved.account === this.account && typeof saved.access_token === 'string' && typeof saved.refresh_token === 'string' && typeof saved.uid === 'string' && typeof saved.expires === 'number') this.session = {...saved,endpoint:sharingEndpoint(saved.endpoint)} as unknown as SharingSession;
      } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw new Error('Cannot read Tuya session; remove invalid session file and authorize again'); }
    }
    if (this.session) {
      if (this.session.expires > Date.now() + 60000) return;
      // Never silently fall back to interactive login after transient cloud failures.
      const result = object(await this.request('GET','/v1.0/m/token/' + encodeURIComponent(this.session.refresh_token),undefined,undefined,false));
      this.acceptToken({access_token:result.accessToken, refresh_token:result.refreshToken, uid:result.uid, expire_time:result.expireTime}, this.session.endpoint);
      await this.save(); return;
    }
    const query = new URLSearchParams({clientid:this.options.clientId ?? SHARING_CLIENT_ID,usercode:this.options.userCode,schema:this.options.schema ?? SHARING_SCHEMA});
    const response = await this.http.request('https://apigw.iotbing.com/v1.0/m/life/home-assistant/qrcode/tokens?' + query, {method:'POST'});
    const result = object(response.result);
    if (typeof result.qrcode !== 'string' || !result.qrcode) throw new Error('Malformed Tuya QR response');
    await this.showQr('tuyaSmart--qrLogin?token=' + result.qrcode);
    const deadline = Date.now() + 180000;
    const loginQuery = new URLSearchParams({clientid:this.options.clientId ?? SHARING_CLIENT_ID,usercode:this.options.userCode});
    while (Date.now() < deadline) {
      await this.pause(this.abort.signal);
      const login = await this.http.request('https://apigw.iotbing.com/v1.0/m/life/home-assistant/qrcode/tokens/' + encodeURIComponent(result.qrcode) + '?' + loginQuery, {}, true);
      if (login.success !== true) {
        // QR remains pending until confirmed; deadline bounds retries.
        continue;
      }
      const info = object(login.result); this.acceptToken(info,sharingEndpoint(info.endpoint)); await this.save(); return;
    }
    throw new Error('Tuya QR authorization expired; restart plugin to request a new code');
  }
  private acceptToken(result: Record<string,unknown>, endpoint: string): void {
    if (typeof result.access_token !== 'string' || !result.access_token || typeof result.refresh_token !== 'string' || !result.refresh_token || typeof result.uid !== 'string' || typeof result.expire_time !== 'number' || !Number.isFinite(result.expire_time) || result.expire_time <= 0) throw new Error('Malformed Tuya sharing token');
    this.session = {access_token:result.access_token,refresh_token:result.refresh_token,uid:result.uid,expires:Date.now()+result.expire_time*1000,endpoint,account:this.account};
  }
  private async request(method: string,path: string,params?: Record<string,unknown>,data?: unknown,authenticated = true): Promise<unknown> {
    if (authenticated) await this.authenticate();
    if (!this.session) throw new Error('Tuya QR authorization required');
    const id = randomUUID(); const {hash,secret} = sharingKeys(id,this.session.refresh_token);
    const query = params ? encryptSharing(params,secret) : ''; const body = data ? encryptSharing(data,secret) : '';
    const headers: Record<string,string> = {'X-appKey':this.options.clientId ?? SHARING_CLIENT_ID,'X-requestId':id,'X-sid':'','X-time':String(Date.now()),'X-token':this.session.access_token,'Content-Type':'application/json'};
    headers['X-sign'] = sharingSignature(headers,hash,query,body);
    const result = await this.http.request(this.session.endpoint + path + (query ? '?encdata=' + encodeURIComponent(query) : ''), {method,headers,...(body ? {body:JSON.stringify({encdata:body})} : {})});
    if (typeof result.result !== 'string') throw new Error('Malformed encrypted Tuya result');
    return decryptSharing(result.result,secret);
  }
  async devices() {
    const homes = list(await this.request('GET','/v1.0/m/life/users/homes'));
    const devices = new Map<string,ReturnType<typeof cloudDevice>>();
    for (const value of homes) { const home = object(value); if (typeof home.ownerId !== 'string' && typeof home.ownerId !== 'number') throw new Error('Malformed Tuya home'); for (const value of list(await this.request('GET','/v1.0/m/life/ha/home/devices',{homeId:String(home.ownerId)}))) {const device = cloudDevice(value); devices.set(device.id,device);} }
    return [...devices.values()];
  }
  async device(id: string) { const result = list(await this.request('GET','/v1.0/m/life/ha/devices/detail',{devIds:id})); const found = result.map(cloudDevice).find(device=>device.id===id); if (!found) throw new Error('Tuya device missing from response'); return found; }
  async specification(id: string) { return cloudSpecification(await this.request('GET','/v1.1/m/life/' + encodeURIComponent(id) + '/specifications')); }
  async commands(id: string,commands: CloudPoint[]): Promise<void> { const result = await this.request('POST','/v1.1/m/thing/' + encodeURIComponent(id) + '/commands',undefined,{commands}); if (result === false || result === null) throw new Error('Tuya did not accept command'); }
  shutdown(): void { this.abort.abort(); this.http.shutdown(); this.session = undefined; }
}
