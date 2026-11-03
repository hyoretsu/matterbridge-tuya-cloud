import {test,expect} from 'bun:test';
import {createHmac,createHash} from 'node:crypto';
import {OpenApi} from './OpenApi.js';
import {HttpClient} from './HttpClient.js';
import {RateLimitError} from '../errors/index.js';
import type {CloudTransport} from './types.js';
const options={accessId:'client',accessSecret:'secret',region:'eu' as const};
const reply=(result:unknown)=>Response.json({success:true,result});
test('OpenAPI signs token, GET and command body; shares concurrent token request',async()=>{
  const calls:{url:string;init:RequestInit}[]=[];
  const transport:CloudTransport=async(url,init)=>{
    calls.push({url,init});const headers=init.headers as Record<string,string>;const method=init.method!;const body=String(init.body??'');
    const path=url.slice('https://openapi.tuyaeu.com'.length);
    const content=createHash('sha256').update(body).digest('hex');
    const signed=options.accessId+(headers.access_token??'')+headers.t+method+'\n'+content+'\n\n'+path;
    expect(headers.sign).toBe(createHmac('sha256',options.accessSecret).update(signed).digest('hex').toUpperCase());
    if(path.startsWith('/v1.0/token')){expect(headers.access_token).toBeUndefined();return reply({access_token:'token',expire_time:7200});}
    expect(headers.access_token).toBe('token');
    if(method==='POST'){expect(JSON.parse(body)).toEqual({properties:JSON.stringify({switch_1:false})});return reply({});}
    return reply([]);
  };
  const client=new OpenApi(options,transport);await Promise.all([client.authenticate(),client.authenticate()]);expect(calls.length).toBe(1);
  expect(await client.devices()).toEqual([]);await client.commands('plug',[{code:'switch_1',value:false}]);expect(calls.length).toBe(3);client.shutdown();await expect(client.devices()).rejects.toThrow('shut down');
});
test('OpenAPI rejects malformed discovery and negative command acknowledgement',async()=>{
  let result:unknown={access_token:'token',expire_time:7200};
  const client=new OpenApi(options,async()=>reply(result));await client.authenticate();result={not:'devices'};
  await expect(client.devices()).rejects.toThrow('Malformed');result=false;await expect(client.specification('plug')).rejects.toThrow('Malformed');client.shutdown();
});
test('HTTP rate limits, API errors and malformed JSON retain explicit failures',async()=>{
  for(const response of [new Response('',{status:429}),Response.json({success:false,code:1015})]){const http=new HttpClient(async()=>response);await expect(http.request('https://example.test')).rejects.toBeInstanceOf(RateLimitError);http.shutdown();}
  const http=new HttpClient(async()=>Response.json({success:false,code:1106,msg:'sensitive information'}));await expect(http.request('https://example.test')).rejects.toThrow('1106');http.shutdown();
});
test('shutdown cancels outstanding request',async()=>{
  let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
  const http=new HttpClient(async(_url,init)=>new Promise((_resolve,reject)=>{init.signal!.addEventListener('abort',()=>reject(new Error('aborted')));started();}));
  const request=http.request('https://example.test');await ready;http.shutdown();await expect(request).rejects.toThrow('aborted');
});

test('IoT Core v2 project pagination, model metadata and shadow readings',async()=>{
  const paths:string[]=[];const client=new OpenApi(options,async(url,init)=>{
    const path=new URL(url).pathname;paths.push(path);
    if(path==='/v1.0/token')return reply({access_token:'token',expire_time:7200});
    if(path==='/v2.0/cloud/thing/device')return reply(new URL(url).searchParams.has('last_id')?[]:Array.from({length:20},(_,i)=>({id:'id'+i,name:'Plug'+i,category:i===0?'cz':'unsupported',isOnline:true})));
    if(path.endsWith('/shadow/properties'))return reply({properties:[{code:'switch_1',value:false},{code:'cur_power',value:0}]});
    if(path.endsWith('/model'))return reply({model:JSON.stringify({services:[{code:'',properties:[{code:'switch_1',accessMode:'rw',typeSpec:{type:'bool'}},{code:'cur_power',accessMode:'ro',typeSpec:{type:'value',scale:1,unit:'W'}}]}]})});
    return reply({id:'id0',name:'Plug',category:'cz',is_online:false});
  });
  const devices=await client.devices();expect(devices.length).toBe(20);expect(devices[0]!.status[0]).toEqual({code:'switch_1',value:false});expect(paths.filter(path=>path==='/v2.0/cloud/thing/device').length).toBe(2);
  const specs=await client.specification('id0');expect(specs.functions.map(p=>p.code)).toEqual(['switch_1']);expect(specs.status[1]!.values).toEqual({type:'value',scale:1,unit:'W'});
  expect((await client.device('id0')).online).toBe(false);client.shutdown();
});
