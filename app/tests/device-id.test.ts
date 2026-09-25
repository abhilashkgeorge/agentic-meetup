/**
 * The doors say which phone this is, and an app built before they could still starts.
 *
 * WHY (build list item 4): a ban holds against the handset as well as the number, so a
 * new SIM in the same phone is turned away (server tests/bans-stick.test.ts). The
 * server can only hold against what the app sends: X-Device-Id, at the four doors --
 * phone verify, invite redeem, device signup, token upgrade.
 *
 * HOW. The real api module with fetch stubbed; react-native and expo-application are
 * replaced, because neither loads under node. The second half loads the module again
 * with expo-application MISSING, which is what a build from before the rebuild is:
 * the request must still go, just without the header.
 *
 * Negative controls, run 2026-09-25:
 *   - verifyPhone without ...deviceHeader()             -> "every door" fails
 *   - device.ts importing expo-application at the top   -> native-imports fails
 *   - deviceId() letting the missing module throw       -> "an old build" fails
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/env', () => ({ getApiBase: () => 'http://api.test' }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

type Call = { url: string; headers: Record<string, string> };
const calls: Call[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    return { ok: true, json: async () => ({ status: 'needs_invite', ticket: 't', token: 'x.y', note: '' }) };
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.doUnmock('expo-application'); });

const doors = async () => {
  const api = await import('../src/lib/api');
  await api.verifyPhone('00000000-0000-0000-0000-000000000000', '123456', 'phone');
  await api.redeemInvite('ABCD-EFGH', 'phone', '00000000-0000-0000-0000-000000000000');
  await api.provisionDevice('phone');
  await api.upgradeToken('00000000-0000-0000-0000-000000000000');
  return calls.map((c) => [c.url.replace('http://api.test', ''), c.headers['X-Device-Id'] ?? null]);
};

describe('the doors', () => {
  it('every door says which phone this is', async () => {
    vi.doMock('expo-application', () => ({ getAndroidId: () => 'a1b2c3d4e5f60718' }));
    expect(await doors()).toEqual([
      ['/v1/auth/phone/verify', 'a1b2c3d4e5f60718'],
      ['/v1/auth/redeem', 'a1b2c3d4e5f60718'],
      ['/v1/auth/device', 'a1b2c3d4e5f60718'],
      ['/v1/auth/upgrade', 'a1b2c3d4e5f60718'],
    ]);
  });

  it('an old build, without the native module, still knocks -- just without the id', async () => {
    vi.doMock('expo-application', () => { throw new Error("Cannot find native module 'ExpoApplication'"); });
    expect(await doors()).toEqual([
      ['/v1/auth/phone/verify', null],
      ['/v1/auth/redeem', null],
      ['/v1/auth/device', null],
      ['/v1/auth/upgrade', null],
    ]);
  });
});
