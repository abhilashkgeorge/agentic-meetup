/**
 * No waiting card runs out unseen (the founder, 2026-09-29: "Show every waiting card, or at
 * least '2 more waiting', so none expire unseen"; docs 15.3 item 19).
 *
 * WHAT WAS WRONG: Matches shows one waiting card at a time -- on purpose, a list of people
 * reads as a menu -- and it was simply the first of the list, newest round first. Every
 * other waiting card sat unseen until its three days ran out, with nothing to say it was
 * there.
 *
 * WHAT IS PINNED: the card in front is the one that fades soonest, so a card can only run
 * out while it is the one on screen; under "WAITING ON YOU" it says how many more wait.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - the screen back to the plain first card        -> "the one that fades soonest" fails;
 *   - the "more waiting" line not rendered            -> "says how many more" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { moreWaiting, soonestFirst } from '../src/features/matches/waiting';

const day = (n: number) => new Date(Date.UTC(2026, 9, 1) + n * 86_400_000).toISOString();
const screen = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'matches', 'matches-screen.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the waiting cards', () => {
  it('put the one that fades soonest in front; one with no end date last; ties keep their order', () => {
    const cards = [
      { id: 'newest', waitingOnYou: true, fadesAt: day(3) },
      { id: 'oldest', waitingOnYou: true, fadesAt: day(1) },
      { id: 'no-end', waitingOnYou: true, fadesAt: null },
      { id: 'also-old', waitingOnYou: true, fadesAt: day(1) },
    ];
    expect(soonestFirst(cards).map((c) => c.id)).toEqual(['oldest', 'also-old', 'newest', 'no-end']);
    expect(screen, 'the card in front is not the one that fades soonest')
      .toMatch(/\.\.\.soonestFirst\(matches\.filter\(\(m\) => m\.waitingOnYou\)\)\.slice\(0, 1\)/);
  });

  it('says how many more wait behind it', () => {
    expect([0, 1, 2].map(moreWaiting)).toEqual([null, '1 more waiting', '2 more waiting']);
    expect(screen).toMatch(/const moreLine = moreWaiting\(matches\.filter\(\(m\) => m\.waitingOnYou\)\.length - 1\);/);
    expect(screen, 'the count of the others is never shown').toMatch(/\{i === 0 && m\.waitingOnYou && moreLine && \(/);
  });
});
