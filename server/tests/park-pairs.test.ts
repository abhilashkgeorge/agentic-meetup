/**
 * Two people in the park agreeing to talk, on their own: nobody asked while busy, an
 * answer both ways, a no remembered, invitations that lapse, and a bench that is the
 * pair's alone -- private both ways.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - let `mayAsk` ignore busy -> "never asks somebody busy" fails;
 *   - forget the no in `answer` -> "does not ask again soon after a no" fails;
 *   - let anybody take a bench in `sit` -> "a bench is the pair's alone" fails;
 *   - let a bench-sitter hear the park in `say` -> "private both ways" fails.
 */
import { describe, expect, it } from 'vitest';
import { STARTER } from '@clone/shared';
import { ASK_MS, DECLINED_MS, ParkPairs } from '../src/park/pairs.js';
import { ParkRoom } from '../src/park/room.js';

function clock() {
  let t = 5_000_000;
  return { now: () => t, later: (ms: number) => { t += ms; } };
}

describe('asking somebody to talk', () => {
  it('never asks somebody busy: talking, asking, or being asked', () => {
    const c = clock();
    const p = new ParkPairs(c.now);
    expect(p.ask('a', 'b')).toBe(true);
    expect(p.busy('a') && p.busy('b')).toBe(true);
    expect(p.ask('c', 'b'), 'b is being asked').toBe(false);
    expect(p.ask('c', 'a'), 'a is asking').toBe(false);
    expect(p.ask('a', 'c'), 'one invitation at a time').toBe(false);
    expect(p.answer('b', true)).toBe('a');
    expect(p.partnerOf('a')).toBe('b');
    expect(p.ask('c', 'a'), 'a is talking').toBe(false);
    expect(p.ask('c', 'c'), 'nobody asks themselves').toBe(false);
  });

  it('does not ask again soon after a no, and may later', () => {
    const c = clock();
    const p = new ParkPairs(c.now);
    p.ask('a', 'b');
    expect(p.answer('b', false)).toBe('a');
    expect(p.busy('a') || p.busy('b')).toBe(false);
    expect(p.mayAsk('a', 'b')).toBe(false);
    expect(p.mayAsk('c', 'b'), 'a no to one person is not a no to everybody').toBe(true);
    c.later(DECLINED_MS + 1);
    p.expire();
    expect(p.mayAsk('a', 'b')).toBe(true);
  });

  it('lets an unanswered invitation lapse, for both', () => {
    const c = clock();
    const p = new ParkPairs(c.now);
    p.ask('a', 'b');
    c.later(ASK_MS - 1);
    expect(p.expire()).toEqual([]);
    c.later(2);
    expect(p.expire()).toEqual([{ from: 'a', to: 'b' }]);
    expect(p.busy('a') || p.busy('b')).toBe(false);
    expect(p.answer('b', true), 'a lapsed invitation cannot be accepted').toBeNull();
  });

  it('ends everything of somebody who leaves, and says who to tell', () => {
    const p = new ParkPairs(clock().now);
    p.ask('a', 'b'); p.answer('b', true);
    p.ask('c', 'd');
    p.ask('e', 'f');
    expect(p.leave('a')).toEqual({ partner: 'b', wasAsking: null, wasAskedBy: null });
    expect(p.leave('c')).toEqual({ partner: null, wasAsking: 'd', wasAskedBy: null });
    expect(p.leave('f')).toEqual({ partner: null, wasAsking: null, wasAskedBy: 'e' });
    for (const u of ['a', 'b', 'c', 'd', 'e', 'f']) expect(p.busy(u), u).toBe(false);
  });
});

describe('a bench', () => {
  it('is the pair\'s alone, and theirs to leave', () => {
    const p = new ParkPairs(clock().now);
    expect(p.sit('a', 3), 'nobody sits alone').toBeNull();
    p.ask('a', 'b'); p.answer('b', true);
    p.ask('c', 'd'); p.answer('d', true);
    expect(p.sit('a', 3)).toBe('b');
    expect(p.benchOf('b')).toBe(3);
    expect(p.sit('c', 3), 'somebody else\'s bench').toBeNull();
    expect(p.sit('c', 4)).toBe('d');
    // Moving to another bench frees the first.
    expect(p.sit('b', 5)).toBe('a');
    expect(p.isBenchTaken(3)).toBe(false);
    expect(p.stand('a')).toBe('b');
    expect(p.benchOf('b')).toBeNull();
    // Parting stands them up.
    p.sit('a', 6);
    p.part('b');
    expect(p.benchOf('a')).toBeNull();
    expect(p.isBenchTaken(6)).toBe(false);
  });

  it('is private both ways: nobody near hears them, and they hear nobody', () => {
    const p = new ParkPairs(clock().now);
    const ref = (v: string, o: string) => `${v}>${o}`.padEnd(32, '0').slice(0, 32);
    const r = new ParkRoom(ref, Date.now, p);
    for (const u of ['a', 'b', 'c']) { r.enter(u, STARTER, []); r.move(u, 0, 0, 0, false); }
    p.ask('a', 'b'); p.answer('b', true);
    // Paired but standing: still a public conversation.
    let said = r.say('a', 'shall we sit?');
    expect(said.ok && said.to.map((t) => t.userId).sort()).toEqual(['a', 'b', 'c']);
    p.sit('a', 1);
    said = r.say('a', 'this is nice');
    expect(said.ok && said.private).toBe(true);
    expect(said.ok && said.to.map((t) => t.userId).sort()).toEqual(['a', 'b']);
    said = r.say('c', 'anybody here?');
    expect(said.ok && said.to.map((t) => t.userId)).toEqual(['c']);
    // Seen sitting there -- that they sit is not a secret, what they say is -- and not
    // while still walking to it.
    expect(r.snapshot('c').map((x) => x.sitting)).toEqual([true, true]);
    r.move('a', 0.1, 0, 0, true);
    expect(r.snapshot('c').filter((x) => x.sitting)).toHaveLength(1);
  });
});
