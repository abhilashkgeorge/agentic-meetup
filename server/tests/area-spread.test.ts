/**
 * The synthetic crowd stands all over Bengaluru, not on one square of it.
 *
 * THE BUG THIS EXISTS FOR. Every synthetic Bangalore profile was seeded before areas
 * existed, so all of them carry the city-centre point. `api/world.ts` derives the tile
 * an agent stands in from that point, and `nearestArea(12.9716, 77.5946)` is MG Road
 * for every single one of them -- so the whole city stood in one neighbourhood.
 * Measured on the live database, 2026-09-23: 5,008 synthetics, 2,349 on that one
 * point, and two rows in the entire table with a `traits.area` at all. The founder saw
 * it on the phone: "why are all the agents in MG Road".
 *
 * This tests the choice, not the UPDATE. The UPDATE is four lines of SQL; the part
 * that can be quietly wrong is where people land, and above all whether re-running the
 * backfill moves anybody -- a shuffle on every run would make the city unstable and
 * indistinguishable from a bug.
 *
 * No database and no model: `areaForUser` is a pure function of the id.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - `return CENTRAL_AREA` from areaForUser -> the spread and the hole tests fail.
 *   - draw from `Math.random()` instead of the id -> the idempotence test fails.
 *   - drop the `:area` salt so both draws share a hash -> "no longer parks everybody on
 *     MG Road" fails: the silent eight per cent are then exactly the people the
 *     distribution would have put in its first bucket, and that bucket is MG Road.
 */
import { describe, expect, it } from 'vitest';
import { AREAS, CENTRAL_AREA } from '@clone/shared';
import { areaForUser } from '../src/matching/area-spread.js';

/** Ids shaped like the real ones: the backfill hashes uuids, so the test does too. */
const ids = Array.from({ length: 4000 }, (_, i) =>
  `0000${i.toString(16).padStart(4, '0')}-0000-4000-8000-${i.toString(16).padStart(12, '0')}`);

const spread = () => {
  const n = new Map<string, number>();
  for (const id of ids) {
    const a = areaForUser(id);
    n.set(a ?? '(none)', (n.get(a ?? '(none)') ?? 0) + 1);
  }
  return n;
};

describe('spreading the crowd', () => {
  it('puts the same person in the same place every time', () => {
    // The whole reason the choice comes from the id. Re-running must be a no-op.
    for (const id of ids.slice(0, 200)) expect(areaForUser(id)).toBe(areaForUser(id));
  });

  it('uses the whole city, not one square of it', () => {
    const n = spread();
    const named = [...n].filter(([a]) => a !== '(none)');
    expect(named.length, 'the crowd stands in too few neighbourhoods').toBeGreaterThanOrEqual(25);
    for (const [a, c] of named) {
      expect(c / ids.length, `${a} holds ${(c / ids.length * 100).toFixed(1)}% of the city`)
        .toBeLessThan(0.15);
    }
  });

  it('no longer parks everybody on MG Road', () => {
    const n = spread();
    const there = n.get(CENTRAL_AREA) ?? 0;
    expect(there / ids.length, 'MG Road is still holding the city').toBeLessThan(0.1);
    expect(there, 'MG Road emptied out entirely, which is also wrong').toBeGreaterThan(0);
  });

  it('leaves about one in twelve without an answer', () => {
    // Rule 3's hole, and the same one the generator leaves, so a backfilled crowd and
    // a freshly seeded one look alike.
    const silent = (spread().get('(none)') ?? 0) / ids.length;
    expect(silent).toBeGreaterThan(0.05);
    expect(silent).toBeLessThan(0.12);
  });

  it('only ever names a real neighbourhood', () => {
    const known = new Set(AREAS.map((a) => a.id));
    for (const id of ids.slice(0, 500)) {
      const a = areaForUser(id);
      if (a !== null) expect(known.has(a), `${a} is not a neighbourhood`).toBe(true);
    }
  });

  it('follows the weights: the big neighbourhoods are the big ones', () => {
    // Koramangala carries more weight than Sadashivanagar, and should hold more people.
    const n = spread();
    const w = new Map(AREAS.map((a) => [a.id, a.weight]));
    const heaviest = [...w].sort((a, b) => b[1] - a[1])[0]![0];
    const lightest = [...w].sort((a, b) => a[1] - b[1])[0]![0];
    expect(n.get(heaviest) ?? 0).toBeGreaterThan(n.get(lightest) ?? 0);
  });
});
