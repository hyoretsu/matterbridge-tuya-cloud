import { describe, expect, test } from 'bun:test';
import axios, { type AxiosRequestConfig } from 'axios';
import { TuyaWebApi } from './service.js';
import { RateLimitError } from '../errors/RateLimitError.js';

const token = { access_token: 'EU-access', refresh_token: 'refresh', expires_in: 7200 };
function setup(responses: unknown[]) {
  const calls: AxiosRequestConfig[] = [];
  const transport = (async (config: AxiosRequestConfig) => {
    calls.push(config);
    const data = responses.shift();
    if (data instanceof Error) throw data;
    return { data };
  }) as typeof axios;
  return { api: new TuyaWebApi('user', 'password', '55', 'smart_life', undefined, transport), calls };
}

describe('TuyaWebApi', () => {
  test('authenticates, refreshes using regional host, preserves zero commands and shuts down', async () => {
    const { api, calls } = setup([token, token, { header: { code: 'SUCCESS' } }]);
    try {
      await api.getOrRefreshToken();
      await api.getOrRefreshToken();
      await api.setDeviceState('id', 'brightnessSet', { value: 0 });
      expect(calls[0].data).toContain('bizType=smart_life');
      expect(calls[0].timeout).toBe(15000);
      expect(calls[1].baseURL).toBe('https://px1.tuyaeu.com');
      expect(calls[2].data.payload.value).toBe(0);
      api.shutdown();
      await expect(api.getOrRefreshToken()).rejects.toThrow('shut down');
    } finally { api.shutdown(); }
  });
  test('rejects malformed successful discovery and query responses', async () => {
    const { api } = setup([token, { header: { code: 'SUCCESS' }, payload: {} }, { header: { code: 'SUCCESS' }, payload: { data: [] } }]);
    try {
      await api.getOrRefreshToken();
      await expect(api.discoverDevices()).rejects.toThrow('Malformed discovery');
      await expect(api.getDeviceState('id')).rejects.toThrow('Malformed query');
    } finally { api.shutdown(); }
  });
  test('rate limits and unsupported operations propagate', async () => {
    const { api } = setup([token, { header: { code: 'FrequentlyInvoke' } }, { header: { code: 'UnsupportedOperation' } }]);
    try {
      await api.getOrRefreshToken();
      await expect(api.discoverDevices()).rejects.toBeInstanceOf(RateLimitError);
      await expect(api.setDeviceState('id', 'turnOnOff', { value: 1 })).rejects.toThrow('Unsupported Operation');
    } finally { api.shutdown(); }
  });
  test('shutdown aborts outstanding requests', async () => {
    let signal: AbortSignal | undefined;
    const transport = ((config: AxiosRequestConfig) => new Promise((_resolve, reject) => {
      signal = config.signal as AbortSignal;
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) as typeof axios;
    const api = new TuyaWebApi('u', 'p', '55', 'tuya', undefined, transport);
    const request = api.getOrRefreshToken();
    api.shutdown();
    expect(signal?.aborted).toBe(true);
    await expect(request).rejects.toThrow('aborted');
  });
});

test('refresh failures schedule bounded retries without unhandled rejection; shutdown cancels timer', async () => {
  const { spyOn } = await import('bun:test');
  const scheduled: { callback: () => void; delay: number; handle: ReturnType<typeof setTimeout> }[] = [];
  const cancelled: unknown[] = [];
  const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, delay: number) => {
    const handle = { unref() {} } as ReturnType<typeof setTimeout>;
    scheduled.push({ callback, delay, handle });
    return handle;
  }) as typeof setTimeout);
  const clear = spyOn(globalThis, 'clearTimeout').mockImplementation((handle) => { cancelled.push(handle); });
  const { api } = setup([token, new Error('transient'), token]);
  try {
    await api.getOrRefreshToken();
    expect(scheduled[0].delay).toBe(3600000);
    scheduled[0].callback();
    // Drain async request, refresh catch, and scheduled callback catch.
    for (let index = 0; index < 10; index++) await Promise.resolve();
    expect(scheduled[1].delay).toBe(10000);
    scheduled[1].callback();
    for (let index = 0; index < 10; index++) await Promise.resolve();
    expect(scheduled[2].delay).toBe(3600000);
    api.shutdown();
    expect(cancelled).toContain(scheduled[2].handle);
  } finally { api.shutdown(); timer.mockRestore(); clear.mockRestore(); }
});

test('authentication throttle waits cancel during shutdown', async () => {
  const { api } = setup([{ responseStatus: 'error', errorMsg: 'you cannot auth exceed once in 180 seconds' }]);
  const request = api.getOrRefreshToken();
  for (let index = 0; index < 10; index++) await Promise.resolve();
  api.shutdown();
  await expect(request).rejects.toThrow('shut down');
});

test('malformed authentication and HTTP 429 fail explicitly', async () => {
  const { api } = setup([null]);
  await expect(api.getOrRefreshToken()).rejects.toThrow('Malformed authentication');
  api.shutdown();
  const limited = new axios.AxiosError('rate', 'ERR_BAD_REQUEST', undefined, undefined, { status: 429 } as never);
  const other = setup([limited]).api;
  await expect(other.getOrRefreshToken()).rejects.toBeInstanceOf(RateLimitError);
  other.shutdown();
});
