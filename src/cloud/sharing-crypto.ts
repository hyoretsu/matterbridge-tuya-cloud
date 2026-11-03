import {createHash, createHmac, createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';
// Tuya device-sharing wire protocol, interoperable with tuya-device-sharing-sdk (Apache-2.0).
export function sharingKeys(requestId: string, refreshToken: string) {
  const hash = createHash('md5').update(requestId + refreshToken).digest('hex');
  const secret = createHmac('sha256', requestId).update(hash).digest('hex').slice(0,16);
  return {hash, secret};
}
export function encryptSharing(value: unknown, secret: string, nonce = randomBytes(12)): string {
  const cipher = createCipheriv('aes-128-gcm', Buffer.from(secret), nonce);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([nonce, data]).toString('base64');
}
export function decryptSharing(value: string, secret: string): unknown {
  const buffer = Buffer.from(value, 'base64');
  if (buffer.length < 28) throw new Error('Malformed encrypted Tuya response');
  const cipher = createDecipheriv('aes-128-gcm', Buffer.from(secret), buffer.subarray(0,12));
  cipher.setAuthTag(buffer.subarray(-16));
  const text = Buffer.concat([cipher.update(buffer.subarray(12,-16)),cipher.final()]).toString('utf8');
  try { return JSON.parse(text); } catch { return text; }
}
export function sharingSignature(headers: Record<string,string>, hash: string, query = '', body = ''): string {
  const value = ['X-appKey','X-requestId','X-sid','X-time','X-token'].filter(key => headers[key]).map(key => key + '=' + headers[key]).join('||') + query + body;
  return createHmac('sha256',hash).update(value).digest('hex');
}
