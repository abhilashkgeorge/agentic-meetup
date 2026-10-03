/**
 * The town keeps its map: small controls on the edges, the rest by the button (hud.tsx
 * TownBar; the founder, 2026-09-30: "fix any UI/UX issues like the one that we found on
 * the main homepage with a lot of tabs blocking most of the screens").
 *
 * WHAT WAS WRONG: the Home wore a card of up to eleven chips over the top half of the map
 * -- places, counts, a camera switch and links, all one shape, some of them not buttons at
 * all ("40 people nearby" and "5 visits left today" were greyed chips that did nothing) --
 * and a debug build put "Open debugger to view warnings" over the button on every start,
 * for two warnings three.js prints about itself.
 *
 * WHAT IS PINNED:
 *   - the town draws the TownBar, which holds no card and no chip;
 *   - your part of town with how many are there, opening who they are; one camera switch;
 *     the park and how you appear as places to go;
 *   - one nudge at a time, the most useful first; the line about your agent and the
 *     counts sit by the button, as words, not chips;
 *   - the two three.js warnings no longer raise the debug toast.
 *
 * WHY THE SOURCE, NOT THE SCREEN: no React Native renderer under vitest; checked on the
 * Pixel, in the commit.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - the town drawing the old card again        -> "holds no card" fails;
 *   - nudges in the wrong order                  -> "most useful first" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nudgeFor, townCounts } from '../src/features/world/town-bar';

const code = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const hud = code('features/world/hud.tsx');
const townBar = hud.slice(hud.indexOf('function TownBar('));

describe('the town\'s edges', () => {
  it('draws the TownBar, which holds no card and no chip', () => {
    // Once the square is here: before it, nothing (an orb says it is on its way, below).
    expect(hud).toMatch(/\) : !world \? null : \(\s*<TownBar /);
    expect(townBar.length).toBeGreaterThan(100);
    expect(townBar, 'the town wears a card again').not.toMatch(/<Card\b|<ChipGroup\b|<Chip\b/);
    expect(hud, 'a chip is back on the Home').not.toMatch(/<Chip\b|<ChipGroup\b|<Card\b/);
  });

  it('shows your part of town, one camera switch, and the places to go', () => {
    expect(townBar).toMatch(/<EdgePill glyph="📍" label=\{area\} detail=\{`· \$\{here\} here`\} onPress=\{onPeople\}/);
    expect(townBar).toMatch(/<EdgePill label=\{wide \? `Back to \$\{area\}` : 'Whole city'\} onPress=\{wide \? onHome : onCity\} \/>/);
    expect(townBar).toMatch(/<EdgePill glyph="🌳" label="Cubbon Park" onPress=\{onEnterVenue\} \/>/);
    expect(townBar).toMatch(/<EdgePill label="How you appear" onPress=\{onAppearance\} \/>/);
  });

  it('nudges one thing at a time, the most useful first', () => {
    const go = { question: () => {}, name: () => {}, area: () => {} };
    expect(nudgeFor({ question: true, askName: true, askArea: true }, go)?.label).toBe('A question for you');
    expect(nudgeFor({ question: false, askName: true, askArea: true }, go)?.label).toBe('Add your first name');
    expect(nudgeFor({ question: false, askName: false, askArea: true }, go)?.label).toBe('Which part of town?');
    expect(nudgeFor({ question: false, askName: false, askArea: false }, go)).toBeNull();
  });

  it('says the counts by the button, as words: the people, and whether it can go out again today', () => {
    // Not the visits to one person: a budget of their own, said in the agent's sheet. It
    // read "5 visits left today" under a button allowed once a day (2026-10-02). Negative
    // control, run by hand: the hud back on world.targetsLeftToday -> this fails.
    expect(townCounts('40', 1)).toBe('40 people nearby · can go out today');
    expect(townCounts('Under 20', 0)).toBe('Under 20 people nearby · out again tomorrow');
    expect(townCounts('40', 3)).toBe('40 people nearby · can go out 3 more times today');
    expect(townCounts('40', undefined)).toBe('40 people nearby');
    expect(hud).toMatch(/\{townCounts\(countLabel\(world\.pool\.total\), world\.roundsLeftToday\)\}/);
  });

  it('keeps three.js\'s own two warnings off a debug build\'s screen', async () => {
    const canvas = code('features/world/canvas.tsx');
    expect(canvas).toMatch(/LogBox\.ignoreLogs\(THREE_NOISE\);/);
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'canvas.tsx'), 'utf8');
    const list = src.match(/export const THREE_NOISE = \[(.*)\];/)![1]!;
    const patterns = [...list.matchAll(/\/((?:\\\/|[^/])+)\//g)].map((m) => new RegExp(m[1]!));
    for (const line of ['THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.',
                        'THREE.WebGLRenderer: WEBGL_lose_context extension not supported.']) {
      expect(patterns.some((re) => re.test(line)), line).toBe(true);
    }
  });
});
