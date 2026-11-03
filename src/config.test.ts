import { describe, expect, test } from "bun:test";
import { applyDeviceConfiguration, validateConfig, type TuyaWebConfig } from "./config.js";
import type { TuyaDevice } from "./api/response.js";
import schema from "../matterbridge-tuya-cloud.schema.json";
import defaults from "../matterbridge-tuya-cloud.config.json";
const config: TuyaWebConfig = { name: "matterbridge-tuya-cloud", options: { userCode: "fixture" } };
const devices: TuyaDevice[] = [
  { id: "a", name: "Lamp", dev_type: "light", ha_type: "light", data: { brightness: 0 } },
  { id: "b", name: "Evening", dev_type: "scene", ha_type: "scene", data: {} },
];
describe("configuration", () => {
  test("schema and config defaults agree with runtime defaults", () => {
    const validated = validateConfig(config);
    for (const key of ["authMode", "pollingInterval", "statePollingInterval"] as const) {
      expect(validated.options[key]).toBe(defaults.options[key]);
      expect(schema.properties.options.properties[key].default).toBe(defaults.options[key]);
    }
    expect(validated.scenes).toBe(defaults.scenes);
  });
  test("requires credentials and rejects unsafe polling", () => {
    expect(() => validateConfig(defaults)).toThrow("userCode");
    for (const pollingInterval of [0, 600, NaN, Infinity]) expect(() => validateConfig({ ...config, options: { ...config.options, pollingInterval } })).toThrow("615");
    expect(() => validateConfig({ ...config, options: { ...config.options, statePollingInterval: 64 } })).toThrow("65");
    expect(validateConfig({ ...config, options: { ...config.options, statePollingInterval: 0 } }).options.statePollingInterval).toBe(0);
  });
  test("overrides preserve zero and leave inputs untouched across retries", () => {
    const settings: TuyaWebConfig = { ...config, defaults: [{ id: "Lamp", device_type: "dimmer", min_brightness: 0, max_brightness: 1000 }] };
    const before = structuredClone({ devices, settings });
    const result = applyDeviceConfiguration(devices, settings);
    expect(result[0]?.dev_type).toBe("dimmer");
    expect(result[0]?.config?.min_brightness).toBe(0);
    expect(applyDeviceConfiguration(devices, settings)).toEqual(result);
    expect({ devices, settings }).toEqual(before);
  });
  test("scenes disabled by default, whitelist and hidden IDs or names honored", () => {
    expect(applyDeviceConfiguration(devices, config).map(d => d.id)).toEqual(["a"]);
    expect(applyDeviceConfiguration(devices, { ...config, scenes: true }).length).toBe(2);
    expect(applyDeviceConfiguration(devices, { ...config, scenes: ["Evening"], hiddenAccessories: ["Lamp"] }).map(d => d.id)).toEqual(["b"]);
    expect(applyDeviceConfiguration(devices, { ...config, scenes: true, scenesWhitelist: ["missing"] }).length).toBe(1);
  });
  test("invalid overrides rejected before discovery", () => {
    expect(() => validateConfig({ ...config, defaults: [{ id: "a", current_temperature_factor: 0 }] })).toThrow("positive");
    expect(() => validateConfig({ ...config, defaults: [{ id: "a", min_brightness: 100, max_brightness: 0 }] })).toThrow("less than");
  });
});

test('modern auth defaults to User Code and validates developer fields independently',()=>{
  expect(validateConfig(config).options.authMode).toBe('userCode');
  expect(()=>validateConfig({name:'matterbridge-tuya-cloud',options:{authMode:'developer',accessId:'id'}})).toThrow('accessSecret');
  expect(validateConfig({name:'matterbridge-tuya-cloud',options:{authMode:'developer',accessId:'id',accessSecret:'secret',region:'eu'}}).options.region).toBe('eu');
  expect(()=>validateConfig({name:'matterbridge-tuya-cloud',options:{userCode:'code',region:'invalid' as never}})).toThrow('region');
});

test('light Kelvin bounds require finite increasing manufacturer ranges',()=>{
  expect(validateConfig({...config,lightTemperatureRanges:[{id:'light',minKelvin:2700,maxKelvin:6500}]}).lightTemperatureRanges?.[0]?.minKelvin).toBe(2700);
  for(const range of [{id:'light',minKelvin:0,maxKelvin:6500},{id:'light',minKelvin:6500,maxKelvin:2700},{id:'light',minKelvin:2700,maxKelvin:Infinity}])expect(()=>validateConfig({...config,lightTemperatureRanges:[range]})).toThrow('Kelvin');
});
