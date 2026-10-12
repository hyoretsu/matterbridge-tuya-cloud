import { expect, test } from 'bun:test';
import { Session } from './session.js';

test('session validates expiry and selects regional hosts', () => {
  expect(Session.isValidSessionData({ access_token: 'EU-token', refresh_token: 'r', expires_in: 0 })).toBe(false);
  expect(Session.isValidSessionData({ access_token: 'EU-token', refresh_token: 'r', expires_in: Infinity })).toBe(false);
  const session = new Session('EU-token', 'r', 100, 'EU');
  expect(session.areaBaseUrl).toBe('https://px1.tuyaeu.com');
  expect(session.hasValidToken()).toBe(true);
  session.resetToken('EU-token', 'r', 0);
  expect(session.hasValidToken()).toBe(false);
});
