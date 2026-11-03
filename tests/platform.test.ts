import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { setupTest, resetTest } from 'matterbridge/test-utils/buntest/setup';
import { addMatterbridge, createTestEnvironment, createServerNode, destroyTestEnvironment, getMatterbridge, server, aggregator } from 'matterbridge/test-utils/buntest/matter';
import { AnsiLogger } from 'matterbridge/logger';
import { OnOff, ElectricalPowerMeasurement, ElectricalEnergyMeasurement, BridgedDeviceBasicInformation, LevelControl, TemperatureMeasurement, ColorControl, FanControl, Thermostat, WindowCovering } from 'matterbridge/matter/clusters';
import { OnOffServer, WindowCoveringServer, FanControlServer, ThermostatServer } from 'matterbridge/matter/behaviors';
import { Network, NetworkSimulator } from "matterbridge/matter";
import { TuyaPlatform, type CloudClient } from '../src/platform.js';
import { buildDevice } from '../src/devices/index.js';
import { DeviceController } from '../src/controller.js';
import { CoverState, type TuyaDevice } from '../src/api/response.js';
import { RateLimitError } from '../src/errors/index.js';
import type { PlatformConfig } from 'matterbridge';

const fixture = (type: TuyaDevice['dev_type'], data: TuyaDevice['data'], suffix = ''): TuyaDevice => ({id: `${type}${suffix}`, name: `${type}${suffix}`, dev_type: type, ha_type: 'switch', data: { online: true, ...data }});
const fixtures = [fixture('switch', {state: false}), fixture('outlet', {state:false,currentMa:788,voltageMv:210000,powerMw:113000,energyMwh:60000}), fixture('dimmer', {state: true, brightness: 10}), fixture('light', {state: true, brightness: 100, color_mode: 'colour', color_temp: 4000, color: {hue: '0', saturation: '0', brightness: '255'}}), fixture('temperature_sensor', {temperature: 0}), fixture('fan', {state: true, speed: 1, speed_level: 3}), fixture('climate', {state: true, current_temperature: 0, temperature: 20, mode: 'hot', min_temper: 0, max_temper: 40}), fixture('cover', {state: CoverState.Stopped, support_stop: true}), fixture('window', {state: CoverState.Opening, support_stop: false}), fixture('scene', {state: false}), fixture('garage', {state: CoverState.Stopped})];
const config: PlatformConfig = {name: 'matterbridge-tuya-cloud', type: 'DynamicPlatform', version: '0.1.0', debug: false, unregisterOnShutdown: true, scenes: true, options: {userCode:'fixture',statePollingInterval: 0}};
let platform: TuyaPlatform;
let currentDevices = fixtures;
let discoveryFailure: Error | undefined;
let queryFailure: Error | undefined;
let commandFailure: Error | undefined;
let calls: {id: string; method: string; payload: unknown}[] = [];
let queryGate: Promise<void> | undefined;
let activeQueries = 0;
let maxQueries = 0;
let discoveryCalls = 0;
const shutdown = mock(() => {});
const client: CloudClient = {
  getOrRefreshToken: mock(async () => undefined as never),
  discoverDevices: async () => { discoveryCalls++; if (discoveryFailure) throw discoveryFailure; return structuredClone(currentDevices); },
  getDeviceState: async id => {
    activeQueries++; maxQueries = Math.max(maxQueries, activeQueries);
    try { await queryGate; if (queryFailure) throw queryFailure; return {state: true, online: true, temperature: id === 'temperature_sensor' ? -10 : 20}; }
    finally { activeQueries--; }
  },
  setDeviceState: async (id, method, payload) => { calls.push({id, method, payload}); if(commandFailure) throw commandFailure; },
  shutdown,
};
const attributes = (id: string, cluster: { id: number }) => platform.devices.get(id)!.binding.endpoint.state[cluster.id === OnOff.id ? "onOff" : cluster.id === BridgedDeviceBasicInformation.id ? "bridgedDeviceBasicInformation" : cluster.id === LevelControl.id ? "levelControl" : cluster.id === TemperatureMeasurement.id ? "temperatureMeasurement" : cluster.id === ColorControl.id ? "colorControl" : cluster.id === FanControl.id ? "fanControl" : cluster.id === Thermostat.id ? "thermostat" : "windowCovering"];

beforeAll(async () => {
  await setupTest('TuyaPort');
  const environment = await createTestEnvironment();
  environment.set(Network, new NetworkSimulator().addHost(1));
  await createServerNode(0);
  platform = new TuyaPlatform(getMatterbridge(), new AnsiLogger({logName: 'TuyaPort'}), config, () => client);
  addMatterbridge(platform);
  await platform.onStart();
  await platform.onConfigure();
}, 60000);
afterAll(async () => {
  await platform?.onShutdown();
  await server?.close();
  await destroyTestEnvironment();
  resetTest();
});

describe('real Matter endpoints', () => {
  test('all usable categories register; garage gets explicit unsupported-data diagnostic', () => {
    expect(platform.devices.size).toBe(10);
    expect(platform.devices.has('garage')).toBe(false);
    const garage = fixtures.at(-1)!;
    expect(() => buildDevice(new DeviceController(garage, client), garage)).toThrow('Closure Control');
    for (const [id, entry] of platform.devices) {
      expect(entry.binding.endpoint.lifecycle.isReady).toBe(true);
      expect(entry.binding.endpoint.hasClusterServer(BridgedDeviceBasicInformation.id)).toBe(true);
      expect(entry.binding.endpoint.originalId ?? id).toBe(id);
    }
    expect(attributes('temperature_sensor', TemperatureMeasurement)?.measuredValue).toBe(0);
    expect(attributes('climate', Thermostat)?.localTemperature).toBe(0);
    expect(attributes('dimmer', LevelControl)?.currentLevel).toBe(1);
    expect(attributes('light', ColorControl)?.currentHue).toBe(0);
    expect(attributes('fan', FanControl)?.percentCurrent).toBe(33);
    expect(attributes('cover', WindowCovering)?.currentPositionLiftPercent100ths ?? null).toBeNull();
  });
  test('plug metering registers standard clusters and updates zero values', async()=>{
    const binding=platform.devices.get('outlet')!.binding;
    const endpoint=binding.endpoint;
    expect(endpoint.state.electricalPowerMeasurement.activeCurrent).toBe(788);
    expect(endpoint.state.electricalPowerMeasurement.voltage).toBe(210000);
    expect(endpoint.state.electricalPowerMeasurement.activePower).toBe(113000);
    expect(endpoint.state.electricalEnergyMeasurement.cumulativeEnergyImported?.energy).toBe(60000);
    expect(endpoint.hasClusterServer(ElectricalPowerMeasurement.id)).toBe(true);
    expect(endpoint.hasClusterServer(ElectricalEnergyMeasurement.id)).toBe(true);
    await binding.update({currentMa:0,voltageMv:0,powerMw:0,energyMwh:0});
    expect(endpoint.state.electricalPowerMeasurement.activeCurrent).toBe(0);
    expect(endpoint.state.electricalPowerMeasurement.voltage).toBe(0);
    expect(endpoint.state.electricalPowerMeasurement.activePower).toBe(0);
    expect(endpoint.state.electricalEnergyMeasurement.cumulativeEnergyImported?.energy).toBe(0);
    expect(platform.devices.get('switch')!.binding.endpoint.hasClusterServer(ElectricalPowerMeasurement.id)).toBe(false);
  });
  test('real On/Off commands produce payloads; cloud failures preserve controller and Matter state', async () => {
    const entry = platform.devices.get('switch')!;
    await entry.binding.endpoint.act(async agent => { await agent.get(OnOffServer).on(); });
    expect(calls.at(-1)).toEqual({id: 'switch', method: 'turnOnOff', payload: {value: 1}});
    expect(entry.controller.state.state).toBe(true);
    expect(attributes('switch', OnOff)?.onOff).toBe(true);
    commandFailure = new Error('cloud failed');
    try { await expect(entry.binding.endpoint.act(async agent => { await agent.get(OnOffServer).off(); })).rejects.toThrow('cloud failed'); }
    finally { commandFailure = undefined; }
    expect(entry.controller.state.state).toBe(true);
    expect(attributes('switch', OnOff)?.onOff).toBe(true);
  });
  test('fan and thermostat attribute writes await cloud commit and roll back on failure', async () => {
    const fan = platform.devices.get('fan')!;
    const climate = platform.devices.get('climate')!;
    const remoteWrite = async (endpoint, behavior, attribute, value) => endpoint.act(async agent => {
      // Real behavior/transaction, remote-write branch; no live controller/network.
      const remote = endpoint.agentFor({ ...agent.context, fabric: {fabricIndex: 1} });
      const target = remote.get(behavior);
      await agent.context.transaction.begin();
      await agent.context.transaction.addResources(target);
      target.state[attribute] = value;
    });
    await remoteWrite(fan.binding.endpoint, FanControlServer, 'percentSetting', 100);
    expect(calls.at(-1)).toEqual({id: 'fan', method: 'windSpeedSet', payload: {value: 3}});
    await remoteWrite(climate.binding.endpoint, ThermostatServer, 'occupiedHeatingSetpoint', 2200);
    expect(calls.at(-1)).toEqual({id: 'climate', method: 'temperatureSet', payload: {value: 22}});
    await remoteWrite(climate.binding.endpoint, ThermostatServer, 'systemMode', Thermostat.SystemMode.Cool);
    expect(calls.at(-1)).toEqual({id: 'climate', method: 'modeSet', payload: {value: 'cold'}});
    const previous = attributes('fan', FanControl)?.percentSetting;
    commandFailure = new Error('fan denied');
    try { await expect(remoteWrite(fan.binding.endpoint, FanControlServer, 'percentSetting', 0)).rejects.toThrow(); }
    finally { commandFailure = undefined; }
    expect(attributes('fan', FanControl)?.percentSetting).toBe(previous);
    expect(fan.controller.state.state).toBe(true);
  });
  test('scene executes once then stays off; Off never invokes cloud', async () => {
    const entry = platform.devices.get('scene')!;
    const count = calls.length;
    await entry.binding.endpoint.act(async agent => { await agent.get(OnOffServer).on(); });
    expect(calls.length).toBe(count + 1);
    expect(attributes('scene', OnOff)?.onOff).toBe(false);
    await entry.binding.endpoint.act(async agent => { await agent.get(OnOffServer).off(); });
    expect(calls.length).toBe(count + 1);
  });
  test('cover movement and stop preserve unknown position; unsupported stop fails', async () => {
    const endpoint = platform.devices.get('cover')!.binding.endpoint;
    await endpoint.act(async agent => { await agent.get(WindowCoveringServer).upOrOpen(); });
    expect(calls.at(-1)?.payload).toEqual({value: 1});
    await endpoint.act(async agent => { await agent.get(WindowCoveringServer).stopMotion(); });
    expect(calls.at(-1)?.method).toBe('startStop');
    expect(attributes('cover', WindowCovering)?.currentPositionLiftPercent100ths ?? null).toBeNull();
    const window = platform.devices.get('window')!.binding.endpoint;
    await expect(window.act(async agent => { await agent.get(WindowCoveringServer).stopMotion(); })).rejects.toThrow('stop capability');
  });
  test('polling updates zero/negative temperatures and reachability; transient errors retain state', async () => {
    await platform.pollDeviceStates();
    expect(attributes('temperature_sensor', TemperatureMeasurement)?.measuredValue).toBe(-1000);
    const entry = platform.devices.get('switch')!;
    entry.controller.update({online: false});
    await entry.updates;
    expect(attributes('switch', BridgedDeviceBasicInformation)?.reachable).toBe(false);
    queryFailure = new Error('temporary');
    await platform.pollDeviceStates();
    expect(attributes('switch', BridgedDeviceBasicInformation)?.reachable).toBe(false);
    queryFailure = new RateLimitError('rate limited');
    try { await expect(platform.pollDeviceStates()).rejects.toThrow('rate limited'); }
    finally { queryFailure = undefined; }
  });
  test('queries are sequential; concurrent discovery/poll requests share existing cycle', async () => {
    let release!: () => void;
    queryGate = new Promise<void>(resolve => { release = resolve; });
    const before = discoveryCalls;
    const first = platform.pollDeviceStates();
    await Promise.resolve(); await Promise.resolve();
    const second = platform.pollDeviceStates();
    const discovery = platform.discoverDevices();
    expect(discoveryCalls).toBe(before);
    expect(activeQueries).toBe(1);
    release();
    await Promise.all([first, second, discovery]);
    queryGate = undefined;
    expect(maxQueries).toBe(1);
    expect(activeQueries).toBe(0);
  });
  test('discovery failures retain devices; successful discovery adds/removes; rename keeps identity', async () => {
    const identity = platform.devices.get('switch')!.binding.endpoint.uniqueId;
    discoveryFailure = new Error('authentication failed');
    await expect(platform.discoverDevices()).rejects.toThrow('authentication failed');
    expect(platform.devices.size).toBe(10);
    discoveryFailure = undefined;
    currentDevices = [ {...fixtures[0], name: 'Renamed'}, {...fixture('outlet', {state: false}, '-new'), name: 'switch'} ];
    await platform.discoverDevices();
    expect([...platform.devices.keys()]).toEqual(['switch','outlet-new']);
    expect(platform.devices.get('switch')!.binding.endpoint.uniqueId).toBe(identity);
    expect(aggregator.parts.size).toBe(2);
    expect(platform.devices.get('outlet-new')!.binding.endpoint.deviceName).toContain('(');
  });
  test('repeated start and shutdown leave no endpoints/controllers or client resources', async () => {
    await platform.onStart();
    expect(platform.devices.size).toBe(2);
    await platform.onShutdown();
    expect(shutdown).toHaveBeenCalled();
    expect(platform.devices.size).toBe(0);
    expect(aggregator.parts.size).toBe(0);
    platform = new TuyaPlatform(getMatterbridge(), new AnsiLogger({logName: 'TuyaPort'}), config, () => client);
    addMatterbridge(platform);
    await platform.onStart();
    await platform.onConfigure();
    expect(platform.devices.size).toBe(2);
  });
  test('default shutdown retains endpoints, disposes controllers, and is idempotent', async () => {
    await platform.onShutdown();
    platform = new TuyaPlatform(getMatterbridge(), new AnsiLogger({logName: 'TuyaPort'}), {...config, unregisterOnShutdown: false}, () => client);
    addMatterbridge(platform);
    await platform.onStart();
    await platform.onConfigure();
    const entry = platform.devices.get('switch')!;
    await Promise.all([platform.onShutdown(), platform.onShutdown()]);
    expect(aggregator.parts.size).toBe(2);
    expect(platform.devices.size).toBe(0);
    await expect(entry.controller.query()).rejects.toThrow('disposed');
  });
});
