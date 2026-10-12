import { describe, expect, test } from 'bun:test';
import { BridgedDeviceBasicInformation, ColorControl, FanControl, LevelControl, OnOff, TemperatureMeasurement, Thermostat, WindowCovering } from 'matterbridge/matter/clusters';
import { buildDevice, deviceIdentity, UnsupportedDeviceError } from '../src/devices/index.js';
import { DeviceController } from '../src/controller.js';
import type { TuyaDevice, TuyaDeviceType, DeviceState } from '../src/api/response.js';

function fixture(type: TuyaDeviceType, data: DeviceState = {}) {
  const calls: unknown[][] = [];
  const device: TuyaDevice = { id: `fixture-${type}`, name: type, dev_type: type, ha_type: 'switch', data: { online: true, state: false, ...data } };
  const controller = new DeviceController(device, { async getDeviceState() { return device.data; }, async setDeviceState(...args) { calls.push(args); } });
  return { device, controller, calls };
}

describe('real Matterbridge endpoint construction', () => {
  const categories: [TuyaDeviceType, DeviceState, number][] = [
    ['switch', {}, OnOff.id], ['outlet', {}, OnOff.id], ['scene', {}, OnOff.id],
    ['dimmer', { brightness: 0 }, LevelControl.id],
    ['light', { brightness: 50, color: { hue: '0', saturation: '0', brightness: '255' }, color_temp: 2000 }, ColorControl.id],
    ['fan', { speed: 0, speed_level: 3 }, FanControl.id],
    ['climate', { current_temperature: 0, temperature: 0, mode: 'cold' }, Thermostat.id],
    ['temperature_sensor', { temperature: 0 }, TemperatureMeasurement.id],
    ['cover', { state: 1, support_stop: true }, WindowCovering.id],
    ['window', { state: 2 }, WindowCovering.id],
  ];
  for (const [type, data, cluster] of categories) test(`${type} declares required device cluster`, async () => {
    const { controller, device } = fixture(type, data);
    const binding = buildDevice(controller, device);
    expect(binding.endpoint.getClusterServerOptions(cluster)).toBeDefined();
    for (const definition of binding.endpoint.deviceTypes.values()) {
      for (const required of definition.requiredServerClusters) {
        const declared = Object.values(binding.endpoint.behaviors.supported).some(behavior => 'cluster' in behavior && (behavior.cluster as { id: number }).id === required);
        expect(declared).toBe(true);
      }
    }
    expect(binding.endpoint.getClusterServerOptions(BridgedDeviceBasicInformation.id)?.uniqueId).toBe(deviceIdentity(device.id));
    binding.dispose(); controller.dispose(); 
  });
  test('renaming preserves endpoint id, serial and unique id', async () => {
    const { controller, device } = fixture('switch');
    const first = buildDevice(controller, device);
    const second = buildDevice(controller, { ...device, name: 'Renamed' });
    expect([first.endpoint.id, first.endpoint.serialNumber, first.endpoint.uniqueId]).toEqual([second.endpoint.id, second.endpoint.serialNumber, second.endpoint.uniqueId]);
    controller.dispose();
  });
  test('garage insufficient mandatory closure state produces explicit diagnostic', () => {
    const { controller, device } = fixture('garage', { state: 3 });
    expect(() => buildDevice(controller, device)).toThrow(UnsupportedDeviceError);
    expect(() => buildDevice(controller, device)).toThrow('native Closure Control');
    controller.dispose();
  });
  test('cover does not advertise unmeasured position', async () => {
    const { controller, device } = fixture('cover', { state: 3 });
    const binding = buildDevice(controller, device);
    const options = binding.endpoint.getClusterServerOptions(WindowCovering.id);
    expect(options?.currentPositionLiftPercent100ths).toBeUndefined();
    expect(options?.configStatus).toMatchObject({ liftPositionAware: false });
    controller.dispose();
  });
  test('commands await cloud response and preserve state on failure', async () => {
    const { controller, device, calls } = fixture('light', { brightness: 10 });
    const binding = buildDevice(controller, device);
    await binding.endpoint.commandHandler.executeHandler('LevelControl.moveToLevel', { request: { level: 254 }, attributes: {}, endpoint: binding.endpoint });
    expect(calls[0]).toEqual([device.id, 'brightnessSet', { value: 100 }]);
    expect(controller.state.brightness).toBe(100);
    controller.dispose();
    const failed = fixture('switch');
    const failingController = new DeviceController(failed.device, { async getDeviceState() { return {}; }, async setDeviceState() { throw new Error('denied'); } });
    const failing = buildDevice(failingController, failed.device);
    await expect(failing.endpoint.commandHandler.executeHandler('OnOff.on', {})).rejects.toThrow('denied');
    expect(failingController.state.state).toBe(false);
    failingController.dispose(); failed.controller.dispose();
  });
  test('color saturation normalized for cloud payload', async () => {
    const { controller, device, calls } = fixture('light', { brightness: 100, color: { hue: '0', saturation: '0', brightness: '255' } });
    const binding = buildDevice(controller, device);
    await binding.endpoint.commandHandler.executeHandler('ColorControl.moveToHueAndSaturation', { request: { hue: 254, saturation: 254 }, attributes: {}, endpoint: binding.endpoint });
    expect(calls[0]).toEqual([device.id, 'colorSet', { color: { hue: 360, saturation: 1, brightness: 255 } }]);
    controller.dispose();
  });
});

test('cover commands send movement and stop without inventing position', async () => {
  const { controller, device, calls } = fixture('cover', { state: 3, support_stop: true });
  const binding = buildDevice(controller, device);
  const behavior = binding.endpoint.behaviors.supported.windowCovering;
  await behavior.prototype.upOrOpen.call(undefined);
  await behavior.prototype.downOrClose.call(undefined);
  await behavior.prototype.stopMotion.call(undefined);
  expect(calls).toEqual([[device.id, 'turnOnOff', { value: 1 }], [device.id, 'turnOnOff', { value: 0 }], [device.id, 'startStop', { value: 0 }]]);
  expect(controller.state.state).toBe(3);
  controller.dispose(); binding.dispose();
});

test('scene on executes once and off makes no cloud call', async () => {
  const { controller, device, calls } = fixture('scene');
  const binding = buildDevice(controller, device);
  const behavior = binding.endpoint.behaviors.supported.onOff;
  const server = { state: { onOff: false } };
  await behavior.prototype.on.call(server);
  expect(server.state.onOff).toBe(false);
  await behavior.prototype.off.call(server);
  expect(calls).toEqual([[device.id, 'turnOnOff', { value: 1 }]]);
  binding.dispose(); controller.dispose();
});
