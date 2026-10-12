import { describe, expect, test } from 'bun:test';
import { DeviceController } from './controller.js';
import type { TuyaDevice } from './api/response.js';

const device: TuyaDevice = { id: 'stable', name: 'Switch', dev_type: 'switch', ha_type: 'switch', data: { state: false, brightness: 0 } };
describe('DeviceController', () => {
  test('failed writes retain state and subsequent writes still execute', async () => {
    let calls = 0;
    const controller = new DeviceController(device, { getDeviceState: async () => ({}), setDeviceState: async () => { if (++calls === 1) throw new Error('failed'); } });
    await expect(controller.command('turnOnOff', { value: 1 }, { state: true })).rejects.toThrow('failed');
    expect(controller.state.state).toBe(false);
    await controller.command('brightnessSet', { value: 0 }, { brightness: 0 });
    expect(calls).toBe(2);
    expect(controller.state.brightness).toBe(0);
  });
  test('serializes operations, notifies after success, and prevents mutation after disposal', async () => {
    const events: string[] = [];
    const controller = new DeviceController(device, { setDeviceState: async () => { events.push('write'); }, getDeviceState: async () => { events.push('query'); return { state: true }; } });
    controller.subscribe(() => events.push('notify'));
    await Promise.all([controller.command('turnOnOff', { value: 1 }, { state: true }), controller.query()]);
    expect(events).toEqual(['write', 'notify', 'query', 'notify']);
    const snapshot = controller.state; snapshot.state = false;
    expect(controller.state.state).toBe(true);
    controller.dispose();
    await expect(controller.query()).rejects.toThrow('disposed');
  });
});
