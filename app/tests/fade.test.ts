/**
 * A card fades toward the end of its three days, in words, never a countdown.
 *
 * WHY (build list item 9): "matches expire after 3 days with no answer; card fades".
 * The server expires the card and sends when it will (server tests/match-expiry.test.ts);
 * this pins how the phone shows it -- and that the matches screen uses it on the card.
 *
 * Negative controls, run 2026-09-25:
 *   - fade() ignoring fadesAt (always full)             -> "fades" fails
 *   - the matches card without fade(m.fadesAt)          -> "on the card" fails
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fade } from '../src/features/matches/fade';

const H = 60 * 60 * 1000;
const at = (hoursLeft: number) => new Date(1_800_000_000_000 + hoursLeft * H).toISOString();
const NOW = 1_800_000_000_000;

describe('the card fades', () => {
  it('full on the first day, then paler, with words and no numbers', () => {
    expect(fade(at(60), NOW)).toEqual({ opacity: 1, line: null });
    expect(fade(at(40), NOW)).toEqual({ opacity: 0.8, line: "Fades tomorrow if you don't answer." });
    expect(fade(at(5), NOW)).toEqual({ opacity: 0.55, line: "Fades today if you don't answer." });
    for (const h of [40, 5]) expect(fade(at(h), NOW).line).not.toMatch(/\d/);
  });

  it('not your turn, or no deadline: never faded', () => {
    expect(fade(null, NOW)).toEqual({ opacity: 1, line: null });
    expect(fade(undefined, NOW)).toEqual({ opacity: 1, line: null });
  });

  it('on the card: the matches screen fades each card by its own deadline', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'matches', 'matches-screen.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(src).toMatch(/opacity: fade\(m\.fadesAt\)\.opacity/);
    expect(src).toMatch(/fade\(m\.fadesAt\)\.line/);
  });
});
