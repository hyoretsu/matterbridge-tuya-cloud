import { expect, test } from 'bun:test';
import { boolean, numeric, scale } from './conversions.js';
test('zero values and finite numeric parsing', () => {
  expect(numeric(0)).toBe(0); expect(numeric('0')).toBe(0);
  for (const value of [undefined, null, '', NaN, Infinity, false]) expect(numeric(value)).toBeUndefined();
  expect(boolean('False')).toBe(false); expect(boolean(1)).toBeUndefined();
});
test('range mapping preserves zero and clamps boundary values', () => {
  expect(scale(0, 0, 100, 0, 254)).toBe(0); expect(scale(100, 0, 100, 0, 254)).toBe(254);
  expect(scale(-10, 0, 100, 0, 254)).toBe(0); expect(scale(200, 0, 100, 0, 254)).toBe(254);
  expect(() => scale(1, 5, 5, 0, 100)).toThrow('Invalid conversion range');
});
