/**
 * The app never prints a pool count except through countLabel.
 *
 * Why: the server now sends every pool count rounded to ten, and null for "under 20"
 * (server/src/matching/candidates.ts shownCount) -- an exact small count, before and
 * after flipping one rule, is one person's private answer. A screen that printed the
 * field raw would show "null", or a stale 0 meaning "nobody" when the truth is "under
 * 20". Rendering is not observable here, so this reads the source of every screen that
 * shows a count, comments stripped.
 *
 * Negative control, run by hand: `{pool.total}` put back in chat-screen.tsx -> the
 * source test fails naming it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { costLabel, countLabel, isUnder20, FEW_ON_THE_APP, fewOnTheApp } from '../src/lib/counts';

const SRC = join(import.meta.dirname, '..', 'src');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('countLabel', () => {
  it('says "Under 20" for the server\'s null, and the number otherwise', () => {
    expect(countLabel(null)).toBe('Under 20');
    expect(countLabel(undefined)).toBe('Under 20');
    expect(countLabel(4820)).toBe((4820).toLocaleString());
    expect(isUnder20(null)).toBe(true);
    expect(isUnder20(20)).toBe(false);
  });
});

describe('the screens that show a pool count', () => {
  const screens = [
    'features/preferences/preferences-screen.tsx',
    'features/matches/matches-screen.tsx',
    'features/chat/chat-screen.tsx',
    'features/profile/profile-screen.tsx',
    'features/world/hud.tsx',
  ];
  it('print it only through countLabel', () => {
    for (const f of screens) {
      const src = strip(readFileSync(join(SRC, f), 'utf8'));
      // A raw total in JSX, stringified, or formatted by hand.
      expect(src, `${f} prints a raw pool count`).not.toMatch(/\{pool\??\.total\}/);
      expect(src, `${f} stringifies a raw pool count`).not.toMatch(/String\(pool\??\.total/);
      expect(src, `${f} formats a raw pool count`).not.toMatch(/pool\.total\.toLocaleString/);
      expect(src, `${f} reads "nobody" off a count that means "under 20"`).not.toMatch(/total\s*===\s*0/);
    }
  });
});

// The funnel read "5,010" and then "\u22122600" (Matches and Looking for, on the Pixel,
// 2026-09-30). Negative control, run by hand: the screens back on the bare number -> the
// second assertion fails.
describe('what a rule costs', () => {
  it('is set like the counts around it, and both funnels use it', async () => {
    expect(costLabel(2600)).toBe(`\u2212${(2600).toLocaleString()}`);
    expect(costLabel(80)).toBe('\u221280');
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const f of [['matches', 'matches-screen.tsx'], ['preferences', 'preferences-screen.tsx']]) {
      const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', ...f), 'utf8');
      expect(src, f[1]).toContain('value={costLabel(s.cost ?? 0)}');
    }
  });
});

// Testing a new account on the release app (2026-09-30), one of two people on the app: both
// Matches and Looking for said, in orange, to loosen her rules -- which were not why. When
// fewer than twenty people exist before any rule applies, the words say so. Negative
// control, run by hand: Matches back on the old sentence alone -> the second test fails.
describe('a small pool, when the app itself is small', () => {
  it('is known from the funnel\'s first step, not from the total', () => {
    expect(fewOnTheApp([{ step: 'everyone', remaining: null }, { step: 'the ages you want', remaining: null }])).toBe(true);
    expect(fewOnTheApp([{ step: 'everyone', remaining: 340 }, { step: 'your dealbreakers', remaining: null }])).toBe(false);
    expect(fewOnTheApp([])).toBe(false);
    expect(fewOnTheApp(undefined)).toBe(false);
  });

  it('is said on both screens instead of "loosen something"', () => {
    for (const f of [['matches', 'matches-screen.tsx'], ['preferences', 'preferences-screen.tsx']]) {
      const src = readFileSync(join(SRC, 'features', ...f), 'utf8');
      expect(src, f[1]).toMatch(/fewOnTheApp\(pool\.steps\) \? FEW_ON_THE_APP/);
    }
    expect(FEW_ON_THE_APP).toContain('Very few people are on the app yet');
    // It makes no claim about what was asked: on a near-empty app the asks may well be
    // why nobody is left, and it sat under "Nobody fits what you asked for" (2026-10-02).
    expect(FEW_ON_THE_APP).not.toMatch(/asked/i);
  });
});
