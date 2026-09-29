/**
 * The car ride to somebody who said yes: where the car is, and where you are, at each
 * moment of it.
 *
 * WHY A CAR (the founder, 2026-09-29: "transfers the user to that person's place --
 * make it look like a car is what took them to the location, just for aesthetics").
 * The park is a kilometre across; walking to somebody who said yes would take minutes,
 * and a jump cut reads as a glitch. So a small car pulls up beside you, you get in, it
 * drives to them, you get out beside them, and it drives away.
 *
 * PURE: numbers in, numbers out. The canvas draws the car where this says, and moves
 * your agent where this says (tests/ride.test.ts).
 */

export interface Ride {
  /** Where you were standing, and where you are being taken: beside them, facing them. */
  from: readonly [number, number];
  to: readonly [number, number];
  /** When it started, in seconds of the canvas's clock. */
  start: number;
}

/** Pulling up beside you, in seconds. */
export const ARRIVE = 1.1;
/** Getting in, and getting out. */
export const DOOR = 0.45;
/** Driving away at the end. */
export const DEPART = 1.2;
/** Units a second, flat out. The park's paths are 0.42 wide; this is town driving. */
export const SPEED = 3.2;
/** However far apart, the drive itself takes at least this long and at most this. */
export const MIN_DRIVE = 1.4;
export const MAX_DRIVE = 5;
/** How far from the road-side point the car starts and ends, pulling in and out. */
export const RUN_UP = 2.4;

export type Phase = 'arriving' | 'boarding' | 'driving' | 'alighting' | 'departing' | 'done';

export interface RideFrame {
  phase: Phase;
  /** The car, and which way it points (radians, the sim's convention: atan2(dx, dz)). */
  car: { x: number; z: number; heading: number; visible: boolean };
  /** You: where, and whether you are drawn (not while inside). */
  you: { x: number; z: number; visible: boolean };
  /** Where the camera should look from the ground: the car while it drives. */
  follow: readonly [number, number];
}

export function driveTime(r: Ride): number {
  const d = Math.hypot(r.to[0] - r.from[0], r.to[1] - r.from[1]);
  return Math.min(MAX_DRIVE, Math.max(MIN_DRIVE, d / SPEED));
}

export function rideLength(r: Ride): number {
  return ARRIVE + DOOR + driveTime(r) + DOOR + DEPART;
}

/** Smooth start and stop. */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function rideAt(r: Ride, now: number): RideFrame {
  const [fx, fz] = r.from;
  const [tx, tz] = r.to;
  const d = Math.hypot(tx - fx, tz - fz) || 1;
  // The line of the drive, and the side of it the car stops on (to your right).
  const ux = (tx - fx) / d, uz = (tz - fz) / d;
  const heading = Math.atan2(ux, uz);
  const side = 0.28;
  const sx = uz * side, sz = -ux * side;
  const stopA: [number, number] = [fx + sx, fz + sz];
  const stopB: [number, number] = [tx + sx, tz + sz];
  const drive = driveTime(r);
  let t = now - r.start;

  const frame = (phase: Phase, car: [number, number], visible: boolean, you: { x: number; z: number; visible: boolean }, follow: readonly [number, number]): RideFrame =>
    ({ phase, car: { x: car[0], z: car[1], heading, visible }, you, follow });

  if (t < 0) t = 0;
  if (t < ARRIVE) {
    // Pulling up from behind you, along the line of the drive.
    const k = ease(t / ARRIVE);
    const car: [number, number] = [lerp(stopA[0] - ux * RUN_UP, stopA[0], k), lerp(stopA[1] - uz * RUN_UP, stopA[1], k)];
    return frame('arriving', car, true, { x: fx, z: fz, visible: true }, [fx, fz]);
  }
  t -= ARRIVE;
  if (t < DOOR) return frame('boarding', stopA, true, { x: fx, z: fz, visible: t < DOOR / 2 }, [fx, fz]);
  t -= DOOR;
  if (t < drive) {
    const k = ease(t / drive);
    const car: [number, number] = [lerp(stopA[0], stopB[0], k), lerp(stopA[1], stopB[1], k)];
    return frame('driving', car, true, { x: car[0], z: car[1], visible: false }, car);
  }
  t -= drive;
  if (t < DOOR) return frame('alighting', stopB, true, { x: tx, z: tz, visible: t >= DOOR / 2 }, [tx, tz]);
  t -= DOOR;
  if (t < DEPART) {
    const k = ease(t / DEPART);
    const car: [number, number] = [lerp(stopB[0], stopB[0] + ux * RUN_UP * 1.5, k), lerp(stopB[1], stopB[1] + uz * RUN_UP * 1.5, k)];
    return frame('departing', car, true, { x: tx, z: tz, visible: true }, [tx, tz]);
  }
  return frame('done', stopB, false, { x: tx, z: tz, visible: true }, [tx, tz]);
}

/**
 * Where to be dropped: beside the person, a step short of them on the line from where
 * you were, so you arrive facing them.
 */
export function besideThem(you: readonly [number, number], them: readonly [number, number], gap = 0.5): [number, number] {
  const dx = them[0] - you[0], dz = them[1] - you[1];
  const d = Math.hypot(dx, dz);
  if (d <= gap) return [you[0], you[1]];
  return [them[0] - (dx / d) * gap, them[1] - (dz / d) * gap];
}

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

/** How far each of the two sits from the middle of a bench, along it. */
export const SEAT = 0.068;

/**
 * Where to sit on a bench, and which way to face: the left seat for the one who asked,
 * the right for the one who said yes, so the two phones agree without saying so.
 * A bench's front is its `rot` (the sim's facing), its length along its own x.
 */
export function seatOn(bench: { x: number; z: number; rot: number }, left: boolean): { x: number; z: number; facing: number } {
  const l = left ? -SEAT : SEAT;
  const c = Math.cos(bench.rot), s = Math.sin(bench.rot);
  // The bench's own x is (cos, -sin) in the world, and its front (sin, cos).
  return { x: bench.x + l * c + 0.012 * s, z: bench.z - l * s + 0.012 * c, facing: bench.rot };
}
