/**
 * The invite screen has a way back, and a mistyped code says to try again (the founder,
 * 2026-09-29, docs 15.3 item 15).
 *
 * WHAT WAS WRONG: the invite screen had no back button, and a mistyped code burned the
 * verified number (server tests/phone-auth.test.ts pins that half).
 *
 * WHY THE SOURCE, NOT THE SCREEN: no React Native renderer under vitest (safety.test.ts).
 *
 * Negative control, run by hand and recorded in the commit: the Back button removed ->
 * "has a way back" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const code = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the invite screen', () => {
  it('has a way back to the phone screen', () => {
    expect(code('features/auth/invite-screen.tsx')).toMatch(
      /<Button label="Back" variant="ghost"\s+onPress=\{\(\) => \(router\.canGoBack\(\) \? router\.back\(\) : router\.replace\('\/phone'\)\)\} \/>/);
  });

  it('says to try again when a code does not work', () => {
    expect(code('lib/api.ts')).toMatch(/body\.message \?\? "That code didn't work, try again\."/);
  });
});
