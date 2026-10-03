/**
 * Matches reads the cards again when the socket says they changed.
 *
 * WHAT WAS WRONG (the two-phone test, 2026-10-02): somebody else's round met this person
 * and wrote a card, and Matches -- open on the phone -- did not show it until the person
 * left the tab and came back. It read the cards on a visit, and while the person's own
 * round was out; the town heard the event and Matches did not.
 *
 * WHAT IS GUARDED: the events that mean a card was written or changed (cardsChange) bump
 * the store's `cards`, the rest do not; and Matches reads the cards again when it moves
 * (SOURCE SHAPE: the screen is React Native).
 *
 * Negative controls, run by hand and recorded in the commit: store.ts not bumping `cards`
 * -> "bumps the counter" fails; Matches without the effect -> "Matches reads again" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { cardsChange, type TownEvent } from '../src/features/world/bridge';

// The store reads the roster through lib/api, which needs React Native; nothing here fetches.
vi.mock('../src/lib/api', () => ({ getWorld: async () => null }));
const { useWorld } = await import('../src/features/world/store');

const R = '00000000-0000-4000-8000-000000000001';
const changes: TownEvent[] = [
  { type: 'round.decided', roundId: null, rendezvousId: R, agent: 'a' },
  { type: 'round.done', roundId: R, met: 1, skipped: null, error: null },
  { type: 'match.turn', rendezvousId: R, agent: 'a' },
  { type: 'match.introduced', rendezvousId: R, agent: 'a' },
];
const cues: TownEvent[] = [
  { type: 'round.queued', roundId: R },
  { type: 'round.met', roundId: null, rendezvousId: R, agent: 'a', practice: false },
  { type: 'round.talking', roundId: null, rendezvousId: R, agent: 'a' },
];

describe('the cards, live', () => {
  it('a card written -- whoever\'s round it was -- a turn, a yes, a round done: the cards changed', () => {
    for (const ev of changes) expect(cardsChange(ev), ev.type).toBe(true);
    for (const ev of cues) expect(cardsChange(ev), ev.type).toBe(false);
  });

  it('bumps the counter Matches watches, for those and only those', () => {
    const before = useWorld.getState().cards;
    for (const ev of cues) useWorld.getState().apply(ev);
    expect(useWorld.getState().cards).toBe(before);
    for (const ev of changes) useWorld.getState().apply(ev);
    expect(useWorld.getState().cards).toBe(before + changes.length);
    useWorld.getState().drained();
  });

  it('Matches reads again when the counter moves', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'matches', 'matches-screen.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(src).toContain('const cards = useWorld((s) => s.cards);');
    expect(src).toMatch(/useEffect\(\(\) => \{\s*if \(!cards\) return;\s*const t = setTimeout\(\(\) => void load\(\), 600\);\s*return \(\) => clearTimeout\(t\);\s*\}, \[cards, load\]\);/);
  });
});
