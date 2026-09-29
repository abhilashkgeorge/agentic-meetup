/**
 * The park's right-hand column never covers you (park-live.ts dockWidth).
 *
 * WHAT WAS WRONG (the Seeker, 2026-09-29): the column -- what was just said, the card of
 * what you are doing with somebody, the voice line -- was a fixed 228 dp wide. The Seeker
 * is 470 dp wide and the walking camera keeps you in the middle of it, so the card sat
 * over your own character: over your head as you walked, over you on the bike. The mic
 * buttons, taller than the old "Say something", had lifted the card to head height.
 *
 * WHAT IS PINNED: on any phone from 320 to 520 dp wide, the column ends to the right of
 * the middle by at least half a person (PLAYER_CLEAR), and is never wider than before;
 * and every part of the column takes its width from dockWidth, none from a number.
 *
 * Negative control, run by hand and recorded in the commit: dockWidth returning the old
 * 228 -> "never reaches the middle" fails, at the Seeker's width among others.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAYER_CLEAR, dockWidth } from '../src/features/world/park-live';

const EDGE = 20;
const code = (file: string) => readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the park\'s right-hand column', () => {
  it('never reaches the middle of the screen, where the walking camera keeps you', () => {
    for (let w = 320; w <= 520; w += 10) {
      const left = w - EDGE - dockWidth(w);
      expect(left, `at ${w} dp it covers the middle`).toBeGreaterThanOrEqual(w / 2 + PLAYER_CLEAR);
      expect(dockWidth(w)).toBeLessThanOrEqual(228);
    }
    // Still room for the card on the phone it was found on.
    expect(dockWidth(470)).toBeGreaterThanOrEqual(190);
  });

  it('is where every part of the column takes its width from', () => {
    for (const file of ['park-hud.tsx', 'park-voice-hud.tsx']) {
      const src = code(file);
      expect(src, `${file} keeps a fixed width`).not.toMatch(/DOCK_W|maxWidth:\s*228/);
      expect(src).toContain('dockWidth(useWindowDimensions().width)');
    }
  });
});
