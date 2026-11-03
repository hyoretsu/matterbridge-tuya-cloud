import { REGIONS } from "./cloud/OpenApi.js";
import { TuyaDeviceTypes, type TuyaDevice, type TuyaDeviceType } from "./api/response.js";

export interface TuyaDeviceDefaults {
  id: string;
  device_type: TuyaDeviceType;
  min_temper: string | number;
  max_temper: string | number;
  current_temperature_factor: string | number;
  target_temperature_factor: string | number;
  dimmer_characteristics: "Brightness"[];
  fan_characteristics: "Speed"[];
  light_characteristics: ("Brightness" | "Color" | "Color Temperature")[];
  cover_characteristics: "Stop"[];
  min_brightness: string | number;
  max_brightness: string | number;
  min_kelvin: string | number;
  max_kelvin: string | number;
}
export interface TuyaWebConfig {
  [key: string]: unknown;
  name: string;
  type?: string;
  version?: string;
  debug?: boolean;
  unregisterOnShutdown?: boolean;
  options?: {
    authMode?: 'userCode' | 'developer';
    userCode?: string;
    sharingClientId?: string;
    sharingSchema?: string;
    accessId?: string;
    accessSecret?: string;
    userId?: string;
    region?: keyof typeof REGIONS;
    pollingInterval?: number;
    statePollingInterval?: number;
  };
  defaults?: Partial<TuyaDeviceDefaults>[];
  hiddenAccessories?: string[];
  energyCounters?: {id: string; code: string}[];
  scenes?: boolean | string[];
  scenesWhitelist?: string[];
}
export type TuyaConfig = TuyaWebConfig;
export interface ValidatedConfig extends TuyaWebConfig {
  options: {
    sharingClientId?: string;
    sharingSchema?: string;
    authMode: 'userCode' | 'developer';
    userCode: string;
    accessId: string;
    accessSecret: string;
    userId: string;
    region: keyof typeof REGIONS;
    pollingInterval: number;
    statePollingInterval: number;
  };
}

export function validateConfig(config: TuyaWebConfig): ValidatedConfig {
  const options = config.options ?? {};
  const authMode = options.authMode ?? 'userCode';
  if (authMode !== 'userCode' && authMode !== 'developer') throw new Error('Invalid options.authMode');
  for (const key of authMode === 'userCode' ? ['userCode'] as const : ['accessId','accessSecret'] as const) {
    if (typeof options[key] !== 'string' || !options[key]!.trim()) throw new Error('Missing Tuya options.' + key);
  }
  const region = options.region ?? 'us';
  if (!(region in REGIONS)) throw new Error('Invalid options.region');
  for (const key of ['sharingClientId','sharingSchema'] as const) if (options[key] !== undefined && (typeof options[key] !== 'string' || !options[key]!.trim())) throw new Error('Invalid options.' + key);
  const pollingInterval = options.pollingInterval ?? 615;
  const statePollingInterval = options.statePollingInterval ?? 65;
  if (!Number.isFinite(pollingInterval) || pollingInterval < 615) {
    throw new Error("options.pollingInterval must be at least 615 seconds");
  }
  if (!Number.isFinite(statePollingInterval) || (statePollingInterval !== 0 && statePollingInterval < 65)) {
    throw new Error("options.statePollingInterval must be zero or at least 65 seconds");
  }
  for (const key of ["hiddenAccessories", "scenesWhitelist"] as const) {
    if (config[key] !== undefined && (!Array.isArray(config[key]) || config[key]!.some(value => typeof value !== "string"))) {
      throw new Error(`${key} must be an array of names or IDs`);
    }
  }
  if (config.scenes !== undefined && typeof config.scenes !== "boolean" && (!Array.isArray(config.scenes) || config.scenes.some(value => typeof value !== "string"))) {
    throw new Error("scenes must be a boolean or an array of names or IDs");
  }
  if (config.defaults !== undefined && !Array.isArray(config.defaults)) throw new Error("defaults must be an array");
  for (const override of config.defaults ?? []) {
    if (!override || typeof override.id !== "string" || !override.id.trim()) throw new Error("Device defaults require an id");
    if (override.device_type !== undefined && !TuyaDeviceTypes.includes(override.device_type)) throw new Error(`Invalid device_type for ${override.id}`);
    for (const key of ["min_temper", "max_temper", "current_temperature_factor", "target_temperature_factor", "min_brightness", "max_brightness", "min_kelvin", "max_kelvin"] as const) {
      const value = override[key];
      if (value !== undefined && (String(value).trim() === "" || !Number.isFinite(Number(value)))) throw new Error(`Invalid ${key} for ${override.id}`);
      if (value !== undefined && (key.includes("factor") || key.includes("kelvin")) && Number(value) <= 0) throw new Error(`${key} must be positive for ${override.id}`);
    }
    for (const [min, max] of [["min_temper", "max_temper"], ["min_brightness", "max_brightness"], ["min_kelvin", "max_kelvin"]] as const) {
      if (override[min] !== undefined && override[max] !== undefined && Number(override[min]) >= Number(override[max])) throw new Error(`${min} must be less than ${max} for ${override.id}`);
    }
    for (const [key, allowed] of [["cover_characteristics", ["Stop"]], ["dimmer_characteristics", ["Brightness"]], ["fan_characteristics", ["Speed"]], ["light_characteristics", ["Brightness", "Color", "Color Temperature"]]] as const) {
      const values = override[key];
      if (values !== undefined && (!Array.isArray(values) || values.some(value => !(allowed as readonly string[]).includes(value)))) throw new Error(`Invalid ${key} for ${override.id}`);
    }
  }
  if (config.energyCounters !== undefined && (!Array.isArray(config.energyCounters) || config.energyCounters.some(item => !item || typeof item.id !== 'string' || !item.id.trim() || typeof item.code !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(item.code)))) throw new Error('energyCounters requires device id and verified cumulative datapoint code');
  if (config.unregisterOnShutdown !== undefined && typeof config.unregisterOnShutdown !== "boolean") throw new Error("unregisterOnShutdown must be boolean");
  return { ...structuredClone(config), scenes: config.scenes ?? false, options: { ...options, authMode, userCode: options.userCode ?? "", accessId: options.accessId ?? "", accessSecret: options.accessSecret ?? "", userId: options.userId ?? "", region, pollingInterval, statePollingInterval } };
}

/** Clone cloud data before applying settings, so retries never mutate discovery or configuration. */
export function applyDeviceConfiguration(devices: readonly TuyaDevice[], config: TuyaWebConfig): TuyaDevice[] {
  return devices.map(device => {
    const result = structuredClone(device);
    for (const override of config.defaults ?? []) {
      if (override.id !== device.id && override.id !== device.name) continue;
      const { id: _id, device_type, ...settings } = structuredClone(override);
      result.config = { ...result.config, ...settings, old_dev_type: device.dev_type };
      if (device_type) result.dev_type = device_type;
    }
    return result;
  }).filter(device => {
    if (config.hiddenAccessories?.some(id => id === device.id || id === device.name)) return false;
    if (device.dev_type !== "scene") return true;
    if (!config.scenes) return false;
    const whitelist = Array.isArray(config.scenes) ? config.scenes : config.scenesWhitelist;
    return !whitelist?.length || whitelist.some(id => id === device.id || id === device.name);
  });
}
