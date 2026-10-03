/**
 * The server screen says why it is open (settings/connect-words.ts, connect-screen.tsx).
 *
 * WHAT WAS WRONG (the Pixel, 2026-10-02 and 2026-10-03): opened from Settings with the
 * server answering, it said "Can't reach the server -- It tried this and nothing
 * answered", warned that a working localhost "means this phone, not your Mac", had no way
 * back but the phone's own Back, and after "Use the default again" stayed where it was
 * while Settings went on showing the old address.
 *
 * WHAT IS PINNED: from Settings it is "Server" with the address it talks to, no warning,
 * and a back button; at launch, after a failure, the old words stay; Settings opens it as
 * "from settings"; and "Use the default again" carries on like "Test and save" (SOURCE
 * SHAPE for the wiring: expo-router does not run here).
 *
 * Negative controls, run by hand and recorded in the commit: connectWords ignoring why ->
 * "from Settings" fails; Settings opening '/connect' bare -> "Settings says so" fails;
 * the reset without again() -> "carries on" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectWords } from '../src/features/settings/connect-words';

const src = (...p: string[]) => readFileSync(join(import.meta.dirname, '..', 'src', ...p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the server screen', () => {
  it('from Settings: "Server", the address it talks to, no warning', () => {
    expect(connectWords(true)).toEqual({ title: 'Server', lead: 'The app talks to this address:', warnLocalhost: false });
  });

  it('at launch, after nothing answered: the failure, and the localhost warning', () => {
    expect(connectWords(false)).toEqual({ title: "Can't reach the server", lead: 'It tried this and nothing answered:', warnLocalhost: true });
  });

  it('Settings says so, the screen listens, and has a way back', () => {
    expect(src('features', 'settings', 'settings-screen.tsx')).toContain("router.push({ pathname: '/connect', params: { from: 'settings' } })");
    const screen = src('features', 'settings', 'connect-screen.tsx');
    expect(screen).toContain("const chosen = useLocalSearchParams<{ from?: string }>().from === 'settings';");
    expect(screen).toContain('{chosen && <Header title="" onBack={() => router.back()} />}');
    expect(screen).toContain("{words.warnLocalhost && tried.includes('localhost') && (");
  });

  it('"Use the default again" carries on, as "Test and save" does', () => {
    const screen = src('features', 'settings', 'connect-screen.tsx');
    const reset = screen.slice(screen.indexOf('label="Use the default again"'));
    expect(reset.slice(0, reset.indexOf('})()} />'))).toMatch(/setNote\(`Back to \$\{d\}`\);\s*again\(\);/);
  });
});
