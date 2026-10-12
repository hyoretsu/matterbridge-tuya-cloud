import type { MatterbridgeEndpoint } from 'matterbridge';
import { MatterbridgeColorControlServer } from 'matterbridge/behaviors';
import { ColorControl, LevelControl } from 'matterbridge/matter/clusters';
import type { DeviceController } from '../controller.js';
import type { DeviceState, TuyaDevice } from '../api/response.js';
import { UnsupportedDeviceError } from './types.js';
import { matterCommand, numeric, scale, unsupported } from './conversions.js';

export function lightCapabilities(device: TuyaDevice) {
  const configured = device.dev_type === 'dimmer' ? device.config?.dimmer_characteristics : device.config?.light_characteristics;
  return {
    brightness: configured ? configured.includes('Brightness') : numeric(device.data.brightness ?? device.data.color?.brightness) !== undefined,
    color: device.dev_type === 'light' && (configured ? (configured as readonly string[]).includes('Color') : device.data.color?.hue !== undefined && device.data.color?.saturation !== undefined),
    temperature: device.dev_type === 'light' && (configured ? (configured as readonly string[]).includes('Color Temperature') : numeric(device.data.color_temp) !== undefined),
  };
}
export function configureLight(endpoint: MatterbridgeEndpoint, controller: DeviceController, device: TuyaDevice): (state: DeviceState) => Promise<void> {
  const capabilities = lightCapabilities(device);
  if ((capabilities.color || capabilities.temperature || device.dev_type === 'dimmer') && !capabilities.brightness) throw new UnsupportedDeviceError(`Light ${device.id}: Matter light type requires brightness capability`);
  function brightnessRange(state: DeviceState) {
    const colorBrightness = state.color?.brightness !== undefined && (state.color_mode === 'color' || state.color_mode === 'colour');
    return { colorBrightness, min: numeric(device.config?.min_brightness) ?? (colorBrightness ? 1 : 10), max: numeric(device.config?.max_brightness) ?? (colorBrightness ? 255 : 100) };
  }
  const minKelvin = numeric(device.config?.min_kelvin) ?? 2000;
  const maxKelvin = numeric(device.config?.max_kelvin) ?? 7142;
  const minMired = Math.ceil(1000000 / maxKelvin);
  const maxMired = Math.floor(1000000 / minKelvin);
  if (capabilities.brightness) {
    endpoint.createDefaultLevelControlClusterServer(1, 1, 254);
    const setLevel = async (level: number, withOnOff: boolean) => matterCommand(async () => {
      const { min, max, colorBrightness } = brightnessRange(controller.state);
      const value = scale(level, 1, 254, min, max);
      await controller.command('brightnessSet', { value }, colorBrightness ? { color: { ...controller.state.color, brightness: String(value) } } : { brightness: value });
      if (withOnOff) await controller.command('turnOnOff', { value: level === 0 ? 0 : 1 }, { state: level !== 0 });
    });
    endpoint.addCommandHandler('LevelControl.moveToLevel', async ({ request }) => setLevel(request.level, false));
    endpoint.addCommandHandler('LevelControl.moveToLevelWithOnOff', async ({ request }) => setLevel(request.level, true));
    endpoint.addCommandHandler('LevelControl.step', async ({ request }) => {
      const { min, max, colorBrightness } = brightnessRange(controller.state);
      const current = numeric(colorBrightness ? controller.state.color?.brightness : controller.state.brightness);
      if (current === undefined) unsupported('Brightness unknown');
      await setLevel(Math.min(254, Math.max(0, scale(current, min, max, 1, 254) + (request.stepMode === LevelControl.StepMode.Up ? request.stepSize : -request.stepSize))), false);
    });
    for (const command of ['LevelControl.move', 'LevelControl.moveWithOnOff', 'LevelControl.stepWithOnOff'] as const) endpoint.addCommandHandler(command, async () => unsupported('Continuous brightness movement unavailable'));
    endpoint.addCommandHandler('LevelControl.stop', async () => unsupported('Brightness stop unavailable'));
    endpoint.addCommandHandler('LevelControl.stopWithOnOff', async () => unsupported('Brightness stop unavailable'));
  }
  if (capabilities.color || capabilities.temperature) {
    const features = [ ...(capabilities.color ? [ColorControl.Feature.HueSaturation] : []), ...(capabilities.temperature ? [ColorControl.Feature.ColorTemperature] : []) ];
    endpoint.behaviors.require(MatterbridgeColorControlServer.with(...features), {
      colorMode: capabilities.color ? ColorControl.ColorMode.CurrentHueAndCurrentSaturation : ColorControl.ColorMode.ColorTemperatureMireds,
      enhancedColorMode: capabilities.color ? ColorControl.EnhancedColorMode.CurrentHueAndCurrentSaturation : ColorControl.EnhancedColorMode.ColorTemperatureMireds,
      colorCapabilities: { hueSaturation: capabilities.color, colorTemperature: capabilities.temperature, xy: false, enhancedHue: false, colorLoop: false },
      currentHue: 0, currentSaturation: 0,
      ...(capabilities.temperature ? { colorTemperatureMireds: minMired, colorTempPhysicalMinMireds: minMired, colorTempPhysicalMaxMireds: maxMired, coupleColorTempToLevelMinMireds: minMired, startUpColorTemperatureMireds: null } : {}),
      options: { executeIfOff: false }, remainingTime: 0, numberOfPrimaries: null,
    });
    async function writeColor(hue?: number, saturation?: number) {
      const previous = controller.state.color ?? {};
      const color = { hue: hue === undefined ? numeric(previous.hue) ?? 0 : scale(hue, 0, 254, 0, 360), saturation: saturation === undefined ? numeric(previous.saturation) ?? 0 : scale(saturation, 0, 254, 0, 100), brightness: numeric(previous.brightness) ?? 255 };
      await matterCommand(() => controller.command('colorSet', { color: { ...color, saturation: color.saturation / 100 } }, { color: { hue: String(color.hue), saturation: String(color.saturation), brightness: String(color.brightness) }, color_mode: 'colour' }));
    }
    if (capabilities.color) {
      endpoint.addCommandHandler('ColorControl.moveToHue', async ({ request }) => writeColor(request.hue));
      endpoint.addCommandHandler('ColorControl.moveToSaturation', async ({ request }) => writeColor(undefined, request.saturation));
      endpoint.addCommandHandler('ColorControl.moveToHueAndSaturation', async ({ request }) => writeColor(request.hue, request.saturation));
      for (const command of ['ColorControl.moveHue', 'ColorControl.stepHue', 'ColorControl.moveSaturation', 'ColorControl.stepSaturation'] as const) endpoint.addCommandHandler(command, async () => unsupported('Continuous color movement unavailable'));
    }
    if (capabilities.temperature) {
      endpoint.addCommandHandler('ColorControl.moveToColorTemperature', async ({ request }) => {
        const value = Math.min(maxKelvin, Math.max(minKelvin, Math.round(1000000 / request.colorTemperatureMireds)));
        await matterCommand(() => controller.command('colorTemperatureSet', { value }, { color_temp: value, color_mode: 'white' }));
      });
      for (const command of ['ColorControl.moveColorTemperature', 'ColorControl.stepColorTemperature'] as const) endpoint.addCommandHandler(command, async () => unsupported('Continuous color temperature movement unavailable'));
    }
    endpoint.addCommandHandler('ColorControl.stopMoveStep', async () => unsupported('Color stop unavailable'));
  }
  return async state => {
    if (capabilities.brightness) {
      const { min, max, colorBrightness } = brightnessRange(state);
      const level = numeric(colorBrightness ? state.color?.brightness : state.brightness);
      if (level !== undefined) await endpoint.setAttribute(LevelControl.id, 'currentLevel', scale(level, min, max, 1, 254));
    }
    if (capabilities.color) {
      const hue = numeric(state.color?.hue), saturation = numeric(state.color?.saturation);
      if (hue !== undefined) await endpoint.setAttribute(ColorControl.id, 'currentHue', scale(hue, 0, 360, 0, 254));
      if (saturation !== undefined) await endpoint.setAttribute(ColorControl.id, 'currentSaturation', scale(saturation, 0, 100, 0, 254));
    }
    if (capabilities.temperature) {
      const kelvin = numeric(state.color_temp);
      if (kelvin !== undefined && kelvin > 0) await endpoint.setAttribute(ColorControl.id, 'colorTemperatureMireds', Math.max(minMired, Math.min(maxMired, Math.round(1000000 / kelvin))));
    }
    if ((capabilities.color || capabilities.temperature) && state.color_mode !== undefined) {
      const mode = state.color_mode === 'white' && capabilities.temperature ? ColorControl.ColorMode.ColorTemperatureMireds : ColorControl.ColorMode.CurrentHueAndCurrentSaturation;
      await endpoint.setAttribute(ColorControl.id, 'colorMode', mode);
      await endpoint.setAttribute(ColorControl.id, 'enhancedColorMode', mode);
    }
  };
}
