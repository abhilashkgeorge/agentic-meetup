/**
 * The phone's half of push notifications (the founder, 2026-09-28): where a tap opens,
 * when the question is asked, and that sign-out lets go.
 *
 * The server decides WHEN a phone is woken (server/tests/push.test.ts). This holds the
 * app to: a tap opens the screen the moment belongs to; the permission is asked when a
 * card is about to wait on the person, never at launch; sign-out drops the token so the
 * next person on this phone is not woken for somebody else's matches; the native module
 * is loaded at the call (tests/native-imports.test.ts covers the import rule itself).
 *
 * Negative controls, run 2026-09-28, each restored byte-identical:
 *   - routeForPush sending 'shared' to the Matches tab -> "a tap opens" fails
 *   - the launch registration asking (ask: true)       -> "asked when it means something" fails
 *   - sign-out without unregisterPush                  -> "sign-out lets go" fails
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { routeForPush } from '../src/features/push/route';

const APP = join(import.meta.dirname, '..');
const said = (rel: string) => readFileSync(join(APP, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const id = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('a tap opens', () => {
  it('the screen the moment belongs to', () => {
    expect(routeForPush({ kind: 'turn', rendezvousId: id })).toBe('/(tabs)/matches');
    expect(routeForPush({ kind: 'fades', rendezvousId: id })).toBe('/(tabs)/matches');
    expect(routeForPush({ kind: 'shared', rendezvousId: id }), 'their profile, just shared').toBe(`/match/${id}`);
    expect(routeForPush({ kind: 'introduced', rendezvousId: id })).toBe(`/dm/${id}`);
    expect(routeForPush({ kind: 'message', rendezvousId: id })).toBe(`/dm/${id}`);
  });

  it('nothing for what it does not know, and never a path built from a bad id', () => {
    expect(routeForPush({ kind: 'something-else', rendezvousId: id })).toBeNull();
    expect(routeForPush(undefined)).toBeNull();
    expect(routeForPush({ kind: 'message', rendezvousId: '../../settings' })).toBe('/(tabs)/chats');
    expect(routeForPush({ kind: 'shared', rendezvousId: 42 })).toBe('/(tabs)/matches');
  });
});

describe('when and how', () => {
  it('asked when it means something: at launch only if already allowed, at the first send-out otherwise', () => {
    expect(said('src/app/_layout.tsx')).toContain('void registerForPush(token, { ask: false });');
    expect(said('src/app/_layout.tsx')).toContain('listenForTaps(');
    expect(said('src/features/world/world-screen.tsx')).toContain('void registerForPush(token, { ask: true });');
    expect(said('src/features/matches/matches-screen.tsx')).toContain('void registerForPush(token, { ask: true });');
  });

  it('sign-out lets go of this phone', () => {
    const settings = said('src/features/settings/settings-screen.tsx');
    expect(settings).toContain('await unregisterPush(token);');
    expect(settings.indexOf('await unregisterPush(token);'), 'dropped after the session is gone: the request would 401')
      .toBeLessThan(settings.indexOf('await logout(token);'));
  });

  it('the build carries the notifications plugin', () => {
    const plugins = (JSON.parse(readFileSync(join(APP, 'app.json'), 'utf8')) as { expo: { plugins: unknown[] } }).expo.plugins;
    expect(plugins.some((p) => (Array.isArray(p) ? p[0] : p) === 'expo-notifications')).toBe(true);
  });
});
