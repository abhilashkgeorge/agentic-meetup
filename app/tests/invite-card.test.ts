/**
 * The invite card says three in all, and the reviewer's says no limit.
 *
 * WHAT WAS WRONG: it said "You can have a few out at a time" -- the old rule -- and
 * counted invites that had run out unused, which the server did not, so it could show
 * none left while the server would make one. The server now sends the count
 * (tests/invites.test.ts); this is the card's reading of it.
 *
 * Negative control, run 2026-09-25: canMake always true -> "none left" fails.
 */
import { describe, expect, it } from 'vitest';
import { inviteCard } from '../src/features/settings/invites';

describe('the invite card', () => {
  it('says how many are left of three in all', () => {
    expect(inviteCard(2, 3)).toEqual({
      label: 'Invites · 2 left',
      line: 'You can bring in 3 people. An invite that runs out unused comes back.',
      canMake: true,
    });
  });
  it('none left: the button is dead', () => {
    expect(inviteCard(0, 3).canMake).toBe(false);
  });
  it('the reviewer has no limit, and no count', () => {
    const card = inviteCard(null, 3);
    expect(card.label).toBe('Invites');
    expect(card.canMake).toBe(true);
    expect(card.line).not.toMatch(/\d/);
  });
});
