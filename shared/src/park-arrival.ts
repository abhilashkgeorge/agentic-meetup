/**
 * Where people appear when they walk into Cubbon Park (the founder, 2026-10-03: "make sure
 * you have a room where people appear and they are not stacked on top of each other ...
 * make sure he is not being spawned on the same location as someone else").
 *
 * WHAT WAS WRONG. Everybody arrived on one point -- the standing spot nearest the
 * bandstand (the app's cubbon.ts `home`) -- so two people walking in were drawn inside
 * one another, the bigger body hiding the smaller, until one of them moved.
 *
 * NOW: the arrival is a patch of lawn by the bandstand with ARRIVAL_SLOTS on it, each a
 * clear place to stand -- no trunk, bench or water within reach -- and at least 3.4 m
 * (0.42 units) from the next. The server, which alone knows where everybody stands, gives
 * each newcomer the first slot nobody is standing near (server park/room.ts).
 *
 * The slots were worked out from the park's own layout (the app's garden, its sim's
 * `standable`) and are checked against it by the app's tests/park-arrival.test.ts: change
 * the park and that test says whether these still hold.
 */

/** Where the park's arrival is centred: the bandstand's lawn, in park units. */
export const ARRIVAL_HOME: readonly [number, number] = [9.573, -31.423];

/** Free places to arrive, nearest the middle first. */
export const ARRIVAL_SLOTS: readonly (readonly [number, number])[] = [
  [9.78, -31.42], [9.3, -31.17], [9.61, -31.9], [9.91, -30.98], [8.95, -31.53], [10.17, -31.8],
  [9.37, -30.68], [9.19, -32.15], [10.39, -31.12], [8.72, -31.07], [9.98, -32.3], [9.88, -30.45],
  [8.65, -31.95], [10.65, -31.66], [8.92, -30.49], [9.42, -32.59], [10.5, -30.64], [8.32, -31.37],
  [10.49, -32.33], [9.51, -30.1], [8.7, -32.47], [10.95, -31.24], [8.4, -30.61], [9.89, -32.84],
];

/** How close somebody may stand to a slot for it still to count as free. */
export const ARRIVAL_GAP = 0.4;

/**
 * The slot for somebody walking in, given where everybody already here stands: the first
 * with nobody within ARRIVAL_GAP; with every one of them taken, the one whose nearest
 * person is furthest away. Never on top of anybody while there is any room at all.
 */
export function arrivalSlot(here: readonly { x: number; z: number }[]): [number, number] {
  let best: readonly [number, number] = ARRIVAL_SLOTS[0]!;
  let bestRoom = -1;
  for (const s of ARRIVAL_SLOTS) {
    let room = Infinity;
    for (const p of here) room = Math.min(room, Math.hypot(p.x - s[0], p.z - s[1]));
    if (room >= ARRIVAL_GAP) return [s[0], s[1]];
    if (room > bestRoom) { bestRoom = room; best = s; }
  }
  return [best[0], best[1]];
}
