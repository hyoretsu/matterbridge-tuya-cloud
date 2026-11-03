import {test,expect} from 'bun:test';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SharingApi,sharingEndpoint,SHARING_CLIENT_ID} from './SharingApi.js';
import {sharingKeys,encryptSharing,decryptSharing,sharingSignature} from './sharing-crypto.js';
import type {CloudTransport} from './types.js';
test('sharing encryption interoperates with WebCrypto and rejects tampering',async()=>{
  const {secret}=sharingKeys('request','refresh');const encoded=encryptSharing({value:false},secret,Buffer.alloc(12));
  const bytes=Buffer.from(encoded,'base64');const key=await crypto.subtle.importKey('raw',Buffer.from(secret),'AES-GCM',false,['decrypt']);
  const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(0,12)},key,bytes.subarray(12));expect(JSON.parse(Buffer.from(decoded).toString())).toEqual({value:false});
  bytes[15]^=1;expect(()=>decryptSharing(bytes.toString('base64'),secret)).toThrow();
});
test('QR login persists private session, reuses it, encrypts discovery and commands',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'tuya-sharing-'));const tokenFile=join(directory,'token.json');
  let qrCalls=0;let loginCalls=0;let displayed='';let accepted=false;
  const transport:CloudTransport=async(url,init)=>{
    if(url.includes('/qrcode/tokens?')){qrCalls++;return Response.json({success:true,result:{qrcode:'qr-token'}});}
    if(url.includes('/qrcode/tokens/')){loginCalls++;return Response.json({success:true,result:{access_token:'access',refresh_token:'refresh',uid:'uid',expire_time:7200,endpoint:'https://apigw.tuyaus.com'}});}
    const headers=init.headers as Record<string,string>;const {hash,secret}=sharingKeys(headers['X-requestId']!,'refresh');
    const query=new URL(url).searchParams.get('encdata')??'';const body=init.body?JSON.parse(String(init.body)).encdata:'';
    expect(headers['X-sign']).toBe(sharingSignature(headers,hash,query,body));expect(headers['X-appKey']).toBe(SHARING_CLIENT_ID);
    if(body){expect(decryptSharing(body,secret)).toEqual({commands:[{code:'switch_1',value:false}]});accepted=true;}
    return Response.json({success:true,result:encryptSharing(body?true:[{ownerId:'home',name:'Home'}],secret)});
  };
  try{
    const api=new SharingApi({userCode:'code',tokenFile},async qr=>{displayed=qr;},transport,async()=>{});await api.authenticate();expect(displayed).toBe('tuyaSmart--qrLogin?token=qr-token');expect(qrCalls).toBe(1);expect(loginCalls).toBe(1);
    expect((await stat(tokenFile)).mode&0o777).toBe(0o600);expect(JSON.parse(await readFile(tokenFile,'utf8')).refresh_token).toBe('refresh');
    await api.commands('plug',[{code:'switch_1',value:false}]);expect(accepted).toBe(true);api.shutdown();
    const next=new SharingApi({userCode:'code',tokenFile},async()=>{throw new Error('must reuse saved session');},transport);await next.authenticate();expect(qrCalls).toBe(1);next.shutdown();
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('sharing endpoint restricts credentials to Tuya HTTPS hosts',()=>{
  for(const host of ['http://apigw.tuyaus.com','https://evil.test','https://tuyaus.com.evil.test','https://user:pass@apigw.tuyaus.com','https://apigw.tuyaus.com/path'])expect(()=>sharingEndpoint(host)).toThrow();
  expect(sharingEndpoint('https://apigw.tuyaeu.com')).toBe('https://apigw.tuyaeu.com');
});

test('expired sessions refresh once concurrently and failures preserve saved authorization',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'tuya-refresh-'));const tokenFile=join(directory,'session.json');let refreshes=0;let fail=false;
  const transport:CloudTransport=async(url,init)=>{
    if(url.includes('/qrcode/tokens?'))return Response.json({success:true,result:{qrcode:'qr'}});
    if(url.includes('/qrcode/tokens/'))return Response.json({success:true,result:{access_token:'old',refresh_token:'refresh',uid:'u',expire_time:7200,endpoint:'https://apigw.tuyaus.com'}});
    refreshes++;if(fail)return new Response('',{status:503});
    expect(new URL(url).pathname).toBe('/v1.0/m/token/refresh');const headers=init.headers as Record<string,string>;const {secret}=sharingKeys(headers['X-requestId']!,'refresh');
    return Response.json({success:true,result:encryptSharing({accessToken:'new',refreshToken:'new-refresh',uid:'u',expireTime:7200},secret)});
  };
  try{
    const initial=new SharingApi({userCode:'code',tokenFile},async()=>{},transport,async()=>{});await initial.authenticate();initial.shutdown();
    const saved=JSON.parse(await readFile(tokenFile,'utf8'));saved.expires=0;await Bun.write(tokenFile,JSON.stringify(saved));const before=await readFile(tokenFile,'utf8');
    fail=true;const failed=new SharingApi({userCode:'code',tokenFile},async()=>{throw new Error('no new QR');},transport);await expect(failed.authenticate()).rejects.toThrow('503');expect(await readFile(tokenFile,'utf8')).toBe(before);failed.shutdown();
    fail=false;const next=new SharingApi({userCode:'code',tokenFile},async()=>{},transport);await Promise.all([next.authenticate(),next.authenticate()]);expect(refreshes).toBe(2);expect(JSON.parse(await readFile(tokenFile,'utf8')).access_token).toBe('new');next.shutdown();
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('shutdown aborts QR wait and prevents reauthentication',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'tuya-abort-'));let shown!:()=>void;const ready=new Promise<void>(resolve=>shown=resolve);
  const api=new SharingApi({userCode:'code',tokenFile:join(directory,'token.json')},async()=>{shown();},async()=>Response.json({success:true,result:{qrcode:'qr'}}));
  try{const auth=api.authenticate();await ready;api.shutdown();await expect(auth).rejects.toThrow();await expect(api.authenticate()).rejects.toThrow('shut down');}finally{await rm(directory,{recursive:true,force:true});}
});
