import {createHash, createHmac} from 'node:crypto';
import {HttpClient} from './HttpClient.js';
import {cloudDevice, cloudSpecification, list, object, type CloudBackend, type CloudPoint, type CloudTransport} from './types.js';
export const REGIONS = {us: 'https://openapi.tuyaus.com', usEast: 'https://openapi-ueaz.tuyaus.com', eu: 'https://openapi.tuyaeu.com', euWest: 'https://openapi-weaz.tuyaeu.com', cn: 'https://openapi.tuyacn.com', in: 'https://openapi.tuyain.com', sg: 'https://openapi-sg.iotbing.com'} as const;
export interface OpenApiOptions { accessId: string; accessSecret: string; region: keyof typeof REGIONS; }
export function openApiSignature(id: string, secret: string, token: string, time: string, method: string, path: string, body: string): string {
  const stringToSign = [method, createHash('sha256').update(body).digest('hex'), '', path].join(String.fromCharCode(10));
  return createHmac('sha256', secret).update(id + token + time + stringToSign).digest('hex').toUpperCase();
}
export class OpenApi implements CloudBackend {
  private http: HttpClient;
  private token = '';
  private expires = 0;
  private authenticating?: Promise<void>;
  constructor(private options: OpenApiOptions, transport?: CloudTransport) { this.http = new HttpClient(transport); }
  async authenticate(): Promise<void> {
    if (this.expires > Date.now() + 60000) return;
    if (this.authenticating) return this.authenticating;
    this.authenticating = (async () => {
      const result = object(await this.request('GET', '/v1.0/token?grant_type=1', undefined, false));
      if (typeof result.access_token !== 'string' || !result.access_token || typeof result.expire_time !== 'number' || !Number.isFinite(result.expire_time) || result.expire_time <= 0) throw new Error('Malformed Tuya token');
      this.token = result.access_token; this.expires = Date.now() + result.expire_time * 1000;
    })();
    try { await this.authenticating; } finally { this.authenticating = undefined; }
  }
  private async request(method: string, path: string, data?: unknown, authenticated = true): Promise<unknown> {
    if (authenticated) await this.authenticate();
    const body = data === undefined ? '' : JSON.stringify(data);
    const time = String(Date.now()); const token = authenticated ? this.token : '';
    const headers: Record<string,string> = {client_id:this.options.accessId, t:time, sign_method:'HMAC-SHA256', sign:openApiSignature(this.options.accessId,this.options.accessSecret,token,time,method,path,body), 'Content-Type':'application/json'};
    if (token) headers.access_token = token;
    const response = await this.http.request(REGIONS[this.options.region] + path, {method, headers, ...(body ? {body} : {})});
    return response.result;
  }
  private path(id: string): string {return '/v2.0/cloud/thing/' + encodeURIComponent(id);}
  private async properties(id: string) {
    return list(object(await this.request('GET',this.path(id)+'/shadow/properties')).properties);
  }
  async devices() {
    const devices = new Map<string, ReturnType<typeof cloudDevice>>();let last = '';
    for (let page = 0;page < 1000;page++) {
      const query = new URLSearchParams();if(last) query.set('last_id',last);query.set('page_size','20');
      const result = list(await this.request('GET','/v2.0/cloud/thing/device?' + query));
      for(const value of result) {
        const data = object(value);
        if(typeof data.id !== 'string' || !data.id)throw new Error('Malformed Tuya project device');
        if(devices.has(data.id))throw new Error('Repeated Tuya discovery page');
        const status = ['cz','pc'].includes(String(data.category)) ? await this.properties(data.id) : [];
        const device = cloudDevice({...data,name:data.customName || data.name,online:data.isOnline,status});devices.set(device.id,device);last=device.id;
      }
      if(result.length<20)return [...devices.values()];
    }
    throw new Error('Tuya discovery pagination limit exceeded');
  }
  async device(id: string) {
    const data = object(await this.request('GET',this.path(id)));
    return cloudDevice({...data,name:data.custom_name || data.name,online:data.is_online,status:await this.properties(id)});
  }
  async specification(id: string) {
    const response = object(await this.request('GET',this.path(id)+'/model'));
    if(typeof response.model !== 'string')throw new Error('Malformed Tuya model');
    const model = object(JSON.parse(response.model));
    const functions: unknown[]=[];const status: unknown[]=[];
    for(const value of list(model.services)) {
      const service = object(value);if(service.code !== '')continue;
      for(const value of list(service.properties)) {
        const property = object(value);const spec=object(property.typeSpec);
        if(typeof property.code !== 'string' || typeof property.accessMode !== 'string')throw new Error('Malformed Tuya model property');
        const range={code:property.code,type:spec.type==='bool'?'Boolean':spec.type==='value'?'Integer':String(spec.type),values:spec};
        if(property.accessMode.includes('w'))functions.push(range);
        if(property.accessMode.includes('r'))status.push(range);
      }
    }
    return cloudSpecification({functions,status});
  }
  async commands(id: string,commands: CloudPoint[]): Promise<void> {
    await this.request('POST',this.path(id)+'/shadow/properties/issue',{properties:JSON.stringify(Object.fromEntries(commands.map(point=>[point.code,point.value])))});
  }
  shutdown(): void { this.http.shutdown(); this.token = ''; this.expires = 0; }
}
