/**
 * Walking into the park, stepping away from it, and flying across it (the founder,
 * 2026-10-03).
 *
 * WHAT WAS WRONG:
 *   - everybody arrived on one point, so two people walking in were drawn inside each
 *     other ("make sure he is not being spawned on the same location as someone else");
 *   - opening another screen took you out of the park at once, and back you popped in
 *     where you had been ("add a 10 sec delay when i leave for another screen");
 *   - the ride to a partner was drawn on the rider's phone only: everybody else saw them
 *     slide across the grass ("in the partner's phone I look like I am sitting in an
 *     invisible car").
 *
 * WHAT IS GUARDED, on the room itself with a clock of its own:
 *   - each newcomer gets a free arrival slot (shared/park-arrival.ts), nobody within
 *     ARRIVAL_GAP; with every slot taken, the roomiest; a phone that says where it already
 *     stands (back after a drop) is believed;
 *   - away, you are still seen, standing, for AWAY_MS; back (enter or move) before then
 *     and nothing changed; past it, you are gone, as a leave;
 *   - a flight is sent to everybody who can see the flier, timed by the server's clock
 *     from when it started, and goes when they land.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - enter without arrivalSlot (everybody at the home) -> "a free slot each" fails;
 *   - expireAway removing nobody -> "gone after the grace" fails;
 *   - the snapshot without `fly` -> "seen flying" fails.
 */
import { describe, expect, it } from 'vitest';
import { ARRIVAL_GAP, ARRIVAL_SLOTS, STARTER, arrivalSlot } from '@clone/shared';
import { AWAY_MS, ParkRoom } from '../src/park/room.js';

const ref = (viewer: string, other: string) => `${viewer}>${other}`.padEnd(32, '0').slice(0, 32);
function room() {
  let t = 1_000_000;
  const r = new ParkRoom(ref, () => t);
  return { r, later: (ms: number) => { t += ms; } };
}
const look = STARTER;

describe('walking into the park', () => {
  it('puts each newcomer on a free arrival slot, never on top of anybody', () => {
    const { r } = room();
    const spots = Array.from({ length: 10 }, (_, i) => r.enter(`p${i}`, look, []));
    for (const [i, s] of spots.entries()) {
      expect(ARRIVAL_SLOTS.some(([x, z]) => x === s.x && z === s.z), `p${i} is not on a slot`).toBe(true);
      for (const [j, o] of spots.entries()) {
        if (i !== j) expect(Math.hypot(s.x - o.x, s.z - o.z), `p${i} on p${j}`).toBeGreaterThanOrEqual(ARRIVAL_GAP);
      }
    }
    // The room has them where it said.
    expect(r.members.get('p3')).toMatchObject(spots[3]!);
  });

  it('with every slot taken, picks the one with the most room', () => {
    const here = ARRIVAL_SLOTS.map(([x, z]) => ({ x, z }));
    const roomiest = arrivalSlot(here.slice(1));
    expect(roomiest).toEqual([ARRIVAL_SLOTS[0]![0], ARRIVAL_SLOTS[0]![1]]);
    const full = arrivalSlot(here);
    expect(ARRIVAL_SLOTS.some(([x, z]) => x === full[0] && z === full[1])).toBe(true);
  });

  it('believes a phone that already stands somewhere, and leaves a returning member where they are', () => {
    const { r } = room();
    expect(r.enter('a', look, [], { x: 40, z: 12 })).toEqual({ x: 40, z: 12 });
    r.move('a', 41, 12, 0, false);
    expect(r.enter('a', look, [])).toEqual({ x: 41, z: 12 });
  });
});

describe('stepping away from the park', () => {
  it('is still seen, standing, for the grace -- and back before it ends, nothing changed', () => {
    const { r, later } = room();
    r.enter('a', look, [], { x: 0, z: 0 });
    r.enter('b', look, [], { x: 1, z: 0 });
    r.move('b', 1, 0, 0, true);
    expect(r.away('b')).toBe(true);
    later(AWAY_MS - 1);
    expect(r.expireAway()).toEqual([]);
    expect(r.snapshot('a')).toEqual([expect.objectContaining({ x: 1, z: 0, moving: false })]);
    // Back: a move (or an enter) clears the clock.
    r.move('b', 1, 0, 0, false);
    later(AWAY_MS * 3);
    expect(r.expireAway()).toEqual([]);
    expect(r.members.has('b')).toBe(true);
  });

  it('is gone after the grace, as a leave', () => {
    const { r, later } = room();
    r.enter('a', look, [], { x: 0, z: 0 });
    r.enter('b', look, [], { x: 1, z: 0 });
    r.away('b');
    later(AWAY_MS);
    expect(r.expireAway()).toEqual(['b']);
    expect(r.members.has('b')).toBe(false);
    expect(r.snapshot('a')).toEqual([]);
    expect(r.away('nobody')).toBe(false);
  });
});

describe('the sky drop, seen by everybody', () => {
  it('sends the flight timed from its start by the server, and drops it on landing', () => {
    const { r, later } = room();
    r.enter('a', look, [], { x: 0, z: 0 });
    r.enter('b', look, [], { x: 2, z: 0 });
    const fly = { fx: 2, fz: 0, tx: 10, tz: 5, t: 150 };
    r.move('b', 2, 0, 0, true, false, fly);
    expect(r.snapshot('a')[0]?.fly).toEqual({ fx: 2, fz: 0, tx: 10, tz: 5, t: 150 });
    later(500);
    // The same flight again from the phone: its start stays, so t is the server's own.
    r.move('b', 6, 2, 0, true, false, { ...fly, t: 640 });
    expect(r.snapshot('a')[0]?.fly?.t).toBe(650);
    // Landed: no flight.
    r.move('b', 10, 5, 0, false);
    expect(r.snapshot('a')[0]?.fly).toBeUndefined();
  });
});
