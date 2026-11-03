export interface CloudPoint { code: string; value: unknown; }
export interface CloudRange { code: string; type: string; values: string | Record<string, unknown>; }
export interface CloudDevice { id: string; name: string; category: string; online: boolean; status: CloudPoint[]; }
export interface CloudSpecification { functions: CloudRange[]; status: CloudRange[]; }
export interface CloudBackend {
  authenticate(): Promise<void>;
  devices(): Promise<CloudDevice[]>;
  device(id: string): Promise<CloudDevice>;
  specification(id: string): Promise<CloudSpecification>;
  commands(id: string, commands: CloudPoint[]): Promise<void>;
  shutdown(): void;
}
export type CloudTransport = (url: string, init: RequestInit) => Promise<Response>;
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed Tuya response');
  return value as Record<string, unknown>;
}
export function list(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error('Malformed Tuya list'); return value; }
export function cloudDevice(value: unknown): CloudDevice {
  const data = object(value);
  if (typeof data.id !== 'string' || !data.id || typeof data.name !== 'string' || typeof data.category !== 'string' || typeof data.online !== 'boolean') throw new Error('Malformed Tuya device');
  const status = (data.status === undefined || data.status === null ? [] : list(data.status)).map(value => { const point = object(value); if (typeof point.code !== 'string' || !('value' in point)) throw new Error('Malformed Tuya status'); return {code: point.code, value: point.value}; });
  return { id: data.id, name: data.name, category: data.category, online: data.online, status };
}
export function cloudSpecification(value: unknown): CloudSpecification {
  const data = object(value);
  const ranges = (value: unknown) => list(value).map(value => { const range = object(value); if (typeof range.code !== 'string' || typeof range.type !== 'string' || !(typeof range.values === 'string' || (range.values && typeof range.values === 'object'))) throw new Error('Malformed Tuya specification'); return range as unknown as CloudRange; });
  return {functions: ranges(data.functions), status: ranges(data.status)};
}
