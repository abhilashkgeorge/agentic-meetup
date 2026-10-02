/**
 * The bench two people sit on: which one, and which seat each takes.
 *
 * This file was ride.ts, and also held the car that drove you to somebody who said yes.
 * The sky drop replaced the car (flight.ts, 2026-10-03); the benches stayed.
 *
 * PURE: numbers in, numbers out (tests/park-live.test.ts, tests/park-scale.test.ts).
 */

/**
 * The bench for two: the free one nearest the point halfway between them. `taken` are
 * the ones the server said were somebody else's.
 */
export function benchFor(
  benches: readonly { x: number; z: number; rot: number }[],
  a: readonly [number, number],
  b: readonly [number, number],
  taken: ReadonlySet<number> = new Set(),
): number | null {
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  let best = -1, bestD = Infinity;
  benches.forEach((bench, i) => {
    if (taken.has(i)) return;
    const d = (bench.x - mx) ** 2 + (bench.z - mz) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best < 0 ? null : best;
}

/**
 * How far each of the two sits from the middle of a bench, along it: a sitting person
 * is 0.64 m across at the elbows, the bench 1.55 m long (venue-mesh.ts SIZE), so they
 * sit 0.68 m apart -- side by side, a few centimetres between them, and neither off an
 * end (tests/park-scale.test.ts).
 */
export const SEAT = 0.042;

/**
 * Where to sit on a bench, and which way to face: the left seat for the one who asked,
 * the right for the one who said yes, so the two phones agree without saying so.
 * A bench's front is its `rot` (the sim's facing), its length along its own x.
 */
export function seatOn(bench: { x: number; z: number; rot: number }, left: boolean): { x: number; z: number; facing: number } {
  const l = left ? -SEAT : SEAT;
  const c = Math.cos(bench.rot), s = Math.sin(bench.rot);
  // The bench's own x is (cos, -sin) in the world. On its middle line, a sitting
  // person's back is a few centimetres in front of the backrest (the size test).
  return { x: bench.x + l * c, z: bench.z - l * s, facing: bench.rot };
}
