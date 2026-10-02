/**
 * THE SKY DROP: how you get to somebody who said yes to talking with you.
 *
 * WHY NOT THE CAR (the founder, 2026-10-03). The car that drove you over was drawn on
 * your phone and nobody else's: "in the partner's phone I look like I am sitting in an
 * invisible car". It also drove straight through people, and a long drive took seven
 * seconds. He chose this instead: you rise on a beam of light, glide over the trees,
 * and drop down beside them in a puff of smoke -- about two seconds, and everybody who
 * can see you sees it, because what flies is a few numbers (ParkFly in shared/events.ts)
 * that every phone plays the same way.
 *
 * Over the trees, not through the park: nothing is in the way up there, so nobody is
 * driven into and nothing has to be steered round.
 *
 * PURE: numbers in, numbers out (tests/flight.test.ts). The sim moves whoever is flying
 * (sim.ts `flyTo`, and `live` for somebody else's), the crowd lifts them off the ground
 * (crowd-gpu.ts), and park-effects.ts draws the beams and the smoke.
 */

export interface Flight {
  /** From where they stood... */
  fx: number; fz: number;
  /** ...to where they land. */
  tx: number; tz: number;
}

/** Rising on the beam. */
export const LIFT_MS = 550;
/** Coming down beside them. */
export const DROP_MS = 550;
/** Across, however far: never slower than this, never quicker. */
export const GLIDE_MIN_MS = 600;
export const GLIDE_MAX_MS = 1400;
/** Units a second over the trees, until the glide would take longer than GLIDE_MAX_MS. */
export const GLIDE_SPEED = 25;
/**
 * How high: over the tallest tree. A trunk is up to 2.4 units with its crown on top
 * (garden.ts: 2.4 x scale for the trunk's solid, scale up to 1.6) -- about four units
 * in all -- so the glide clears every one of them.
 */
export const SKY = 4.6;
/** A little extra height mid-glide, so it reads as a hop over the park rather than a lift. */
const ARC = 0.6;

export type FlightPhase = 'lift' | 'glide' | 'drop' | 'landed';

export interface FlightPose {
  x: number;
  z: number;
  /** Height above the ground. */
  y: number;
  /** Which way they face: along the glide (the sim's convention, atan2(dx, dz)). */
  heading: number;
  phase: FlightPhase;
}

export function glideMs(f: Flight): number {
  const d = Math.hypot(f.tx - f.fx, f.tz - f.fz);
  return Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, (d / GLIDE_SPEED) * 1000));
}

/** The whole flight, take-off to touch-down, in ms. */
export function flightMs(f: Flight): number {
  return LIFT_MS + glideMs(f) + DROP_MS;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Where they are `ms` into the flight. Before it, where they stood; after it, landed. */
export function flightAt(f: Flight, ms: number): FlightPose {
  const dx = f.tx - f.fx, dz = f.tz - f.fz;
  const heading = Math.hypot(dx, dz) > 1e-6 ? Math.atan2(dx, dz) : 0;
  const glide = glideMs(f);
  const t = Math.max(0, ms);
  if (t < LIFT_MS) return { x: f.fx, z: f.fz, y: SKY * easeOut(t / LIFT_MS), heading, phase: 'lift' };
  if (t < LIFT_MS + glide) {
    const k = (t - LIFT_MS) / glide;
    const e = easeInOut(k);
    return { x: f.fx + dx * e, z: f.fz + dz * e, y: SKY + ARC * Math.sin(Math.PI * k), heading, phase: 'glide' };
  }
  const down = t - LIFT_MS - glide;
  if (down < DROP_MS) return { x: f.tx, z: f.tz, y: SKY * (1 - easeInOut(down / DROP_MS)), heading, phase: 'drop' };
  return { x: f.tx, z: f.tz, y: 0, heading, phase: 'landed' };
}

/**
 * Where to land: beside them, a step short on the line from where you were so you land
 * facing them -- or, if a trunk, a bench or somebody already stands there, the nearest
 * clear spot on a ring round them. `clear` says whether a spot is free to stand on.
 */
export function landingBeside(
  you: readonly [number, number],
  them: readonly [number, number],
  clear: (x: number, z: number) => boolean,
  gap = 0.5,
): [number, number] {
  const dx = you[0] - them[0], dz = you[1] - them[1];
  const d = Math.hypot(dx, dz);
  const toward = d > 1e-6 ? Math.atan2(dx, dz) : 0;
  // Straight in first, then either side of it, further round each time.
  for (const r of [gap, gap * 1.5, gap * 2]) {
    for (let k = 0; k <= 6; k++) {
      for (const side of k === 0 ? [0] : [1, -1]) {
        const a = toward + side * k * (Math.PI / 6);
        const x = them[0] + Math.sin(a) * r, z = them[1] + Math.cos(a) * r;
        if (clear(x, z)) return [x, z];
      }
    }
  }
  return [them[0] + Math.sin(toward) * gap, them[1] + Math.cos(toward) * gap];
}
