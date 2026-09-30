/**
 * The park keeps its screen: nothing over the middle, only small controls on the top
 * edges (hud.tsx ParkBar; the founder, 2026-09-29: "Half of the screen is covered by the
 * white box ... redesign it completely so that it doesn't cover any part of the screen").
 *
 * WHAT WAS WRONG: in the park the town's card stayed on -- a title, a line, and six chips
 * in a white box over the top half: "Back to Bengaluru", "Nobody else here now" (which did
 * nothing when tapped), "Things to do", "Directions", "6 agents in the park" and the test
 * crowd.
 *
 * WHAT IS PINNED:
 *   - in the park the HUD draws the ParkBar, and the ParkBar holds no card and no chips;
 *   - a back button that says where it goes; who is here in one line, which says what it
 *     means when tapped; "Things to do" with today's count; no Directions anywhere;
 *   - the FPS meter (development) moves off the corner that now says who is here.
 *
 * WHY THE SOURCE, NOT THE SCREEN: no React Native renderer under vitest (safety.test.ts);
 * how it looks was checked on the Pixel, in the commit.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - the park drawing the town's card again  -> "holds no card" fails;
 *   - the Directions chip back                -> "no Directions" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARK_WHO_MEANS, parkWho } from '../src/features/world/park-top';

const code = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const hud = code('features/world/hud.tsx');
const parkBar = hud.slice(hud.indexOf('function ParkBar('));

describe('the park\'s top edge', () => {
  it('draws the ParkBar in the park, and the ParkBar holds no card and no chips', () => {
    expect(hud).toMatch(/\{venue \? \(\s*<ParkBar /);
    expect(parkBar.length).toBeGreaterThan(100);
    expect(parkBar, 'the park wears a card again').not.toMatch(/<Card\b|<ChipGroup\b|<Chip\b/);
  });

  it('says who is here in one line, and what it means when tapped', () => {
    expect([parkWho(0, 6), parkWho(1, 6), parkWho(2, 1), parkWho(3, 6, 1000)])
      .toEqual(['6 agents', '1 person · 6 agents', '2 people · 1 agent', '1000 test people']);
    expect(PARK_WHO_MEANS).toBe("People are here right now, like you. Agents walk the park for people who aren't.");
    expect(parkBar).toMatch(/onPress=\{\(\) => setExplain\(\(e\) => !e\)\}/);
    expect(parkBar).toMatch(/\{PARK_WHO_MEANS\}/);
  });

  it('has a back button that says where it goes, and Things to do with today\'s count', () => {
    expect(parkBar).toMatch(/accessibilityLabel="Back to Bengaluru"/);
    expect(parkBar).toMatch(/>Bengaluru<\/Text>/);
    expect(parkBar).toMatch(/<Pressable onPress=\{onQuests\}/);
    expect(parkBar).toMatch(/>Things to do<\/Text>/);
  });

  it('has no Directions anywhere', () => {
    for (const f of ['features/world/hud.tsx', 'features/world/world-screen.tsx']) {
      expect(code(f), f).not.toMatch(/Directions|directionsUrl|onDirections/);
    }
  });

  it('moves the FPS meter off the corner that says who is here', () => {
    expect(code('features/world/world-screen.tsx'))
      .toMatch(/<FpsMeter capped=\{cap30\} at=\{\{ top: insets\.top \+ \(realm\.phase === 'venue' \? 56 : 92\), left: space\.screen \}\} \/>/);
  });
});
