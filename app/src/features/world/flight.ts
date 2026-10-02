/**
 * THE EMERGENCY PICKUP: how you get to somebody who said yes to talking with you -- and
 * how anybody comes and goes in the park.
 *
 * WHAT THE FOUNDER ASKED (2026-10-03, after the first version): "what you have built
 * doesn't look good. What I was thinking of is like the emergency pickup feature in PUBG
 * ... understand how it is done in PUBG and use the same here". There a Fulton balloon
 * pops out of a bag and rises on its line, a plane snags the line and carries whoever
 * hangs on it, and each lets go and comes down by parachute. The first version here was
 * a beam of light and a puff of white smoke; this is the PUBG one, quickened to about
 * three seconds:
 *
 *   inflate  the balloon rises out of your back on its rope; you are still standing;
 *   yank     the rope goes taut and you are pulled up off the ground, over the trees;
 *   carry    you hang under the balloon as it crosses the park, trailing a little;
 *   chute    you let go, the parachute opens, and you come down beside them;
 *   settle   down, the parachute folds away.
 *
 * And the same parts for coming and going: somebody who walks into the park comes down
 * by parachute (`drop`), somebody who leaves it is taken up by a balloon (`away`).
 *
 * Over the trees, not through the park: nothing is in the way up there, so nobody is
 * walked into and nothing has to be steered round. What flies between phones is a few
 * numbers (ParkFly in shared/events.ts) that every phone plays the same way.
 *
 * PURE: numbers in, numbers out (tests/park-sky-drop.test.ts). The sim moves whoever is
 * flying (sim.ts), the crowd lifts them off the ground (crowd-gpu.ts), and rig-mesh.ts
 * draws the balloon, its rope and the parachute where `flightAt` says.
 */

export type FlightKind = 'pickup' | 'drop' | 'away';

export interface Flight {
  /** From where they stood... */
  fx: number; fz: number;
  /** ...to where they land. For a `drop`, the same point; for an `away`, unused. */
  tx: number; tz: number;
  /** A pickup unless said otherwise: the only kind that goes between phones. */
  kind?: FlightKind;
}

/** The balloon rising on its rope, before you leave the ground. */
export const INFLATE_MS = 550;
/** Pulled up off the ground. */
export const YANK_MS = 450;
/** Across, however far: never slower than this, never quicker. */
export const CARRY_MIN_MS = 500;
export const CARRY_MAX_MS = 1100;
/** Units a second under the balloon, until the carry would take longer than CARRY_MAX_MS. */
export const CARRY_SPEED = 30;
/** Coming down by parachute. */
export const CHUTE_MS = 950;
/** Down, the parachute folding away. */
export const SETTLE_MS = 250;
/** A drop into the park: the whole descent, from DROP_Y. */
export const DROP_MS = 1300;
/** Taken away: up on the balloon and out of sight. */
export const AWAY_MS = 1500;

/**
 * How high you hang while carried: over the tallest tree. A trunk is up to 2.4 units with
 * its crown on top (garden.ts: 2.4 x scale for the trunk's solid, scale up to 1.6) --
 * about four units in all -- so the carry clears every one of them.
 */
export const SKY = 4.6;
/** Where somebody walking into the park opens their parachute. */
export const DROP_Y = 3.2;
/** The rope, from your shoulders to the bottom of the balloon, fully paid out. */
export const ROPE = 1.6;
/** The balloon's size, in units: about a metre and a half across. */
export const BALLOON_R = 0.17;
/** Where the rope ties on: about shoulder height on a person 0.22 units tall. */
export const HARNESS_Y = 0.19;
/** How far the hanging body trails behind the balloon, at full speed. */
const TRAIL = 0.35;

export type FlightPhase = 'inflate' | 'yank' | 'carry' | 'chute' | 'settle' | 'landed';

export interface FlightPose {
  x: number;
  z: number;
  /** Height of their feet above the ground. */
  y: number;
  /** Which way they face: along the way (the sim's convention, atan2(dx, dz)). */
  heading: number;
  phase: FlightPhase;
  /** The balloon, while there is one: its middle, its size 0-1, how solid 0-1. */
  balloon: { x: number; y: number; z: number; size: number; alpha: number } | null;
  /** Whether the rope runs from their harness to the balloon. */
  roped: boolean;
  /** The parachute: 0 shut (or none), 1 fully open. */
  chute: number;
}

export function carryMs(f: Flight): number {
  const d = Math.hypot(f.tx - f.fx, f.tz - f.fz);
  return Math.min(CARRY_MAX_MS, Math.max(CARRY_MIN_MS, (d / CARRY_SPEED) * 1000));
}

/** The whole flight, start to the parachute folded, in ms. */
export function flightMs(f: Flight): number {
  if (f.kind === 'drop') return DROP_MS + SETTLE_MS;
  if (f.kind === 'away') return AWAY_MS;
  return INFLATE_MS + YANK_MS + carryMs(f) + CHUTE_MS + SETTLE_MS;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t * t * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Where they are `ms` into the flight, and the balloon, rope and parachute with them. */
export function flightAt(f: Flight, ms: number): FlightPose {
  const t = Math.max(0, ms);
  if (f.kind === 'drop') return dropAt(f, t);
  if (f.kind === 'away') return awayAt(f, t);
  const dx = f.tx - f.fx, dz = f.tz - f.fz;
  const d = Math.hypot(dx, dz);
  const heading = d > 1e-6 ? Math.atan2(dx, dz) : 0;
  const ux = d > 1e-6 ? dx / d : 0, uz = d > 1e-6 ? dz / d : 0;
  const carry = carryMs(f);
  const pose = (x: number, z: number, y: number, phase: FlightPhase,
    balloon: FlightPose['balloon'], roped: boolean, chute: number): FlightPose =>
    ({ x, z, y, heading, phase, balloon, roped, chute });

  // The balloon comes out of the bag on your back and rises to the end of its rope.
  if (t < INFLATE_MS) {
    const k = easeOut(t / INFLATE_MS);
    return pose(f.fx, f.fz, 0, 'inflate',
      { x: f.fx, y: HARNESS_Y + (ROPE + BALLOON_R) * k, z: f.fz, size: 0.25 + 0.75 * k, alpha: 1 }, true, 0);
  }
  // The rope goes taut: up you go, quicker and quicker, the balloon a rope's length above.
  if (t < INFLATE_MS + YANK_MS) {
    const k = (t - INFLATE_MS) / YANK_MS;
    const y = SKY * (0.7 * easeIn(k) + 0.3 * k);
    return pose(f.fx, f.fz, y, 'yank', { x: f.fx, y: y + HARNESS_Y + ROPE + BALLOON_R, z: f.fz, size: 1, alpha: 1 }, true, 0);
  }
  // Across under the balloon; you trail a little behind it while it is quickest.
  const c = t - INFLATE_MS - YANK_MS;
  if (c < carry) {
    const k = c / carry;
    const e = easeInOut(k);
    const swing = Math.sin(Math.PI * k);
    const bx = f.fx + dx * e, bz = f.fz + dz * e;
    const y = SKY + 0.4 * swing;
    return pose(bx - ux * TRAIL * swing, bz - uz * TRAIL * swing, y, 'carry',
      { x: bx, y: y + HARNESS_Y + ROPE + BALLOON_R, z: bz, size: 1, alpha: 1 }, true, 0);
  }
  // Let go over them: the parachute opens and you come down; the balloon sails on, up and away.
  const down = c - carry;
  if (down < CHUTE_MS) {
    const k = down / CHUTE_MS;
    const fall = 1 - (1 - k) * (1 - k);
    const gone = clamp01(k * 1.4);
    return pose(f.tx, f.tz, SKY * (1 - fall), 'chute',
      { x: f.tx + ux * gone * 2.5, y: SKY + HARNESS_Y + ROPE + BALLOON_R + gone * 3, z: f.tz + uz * gone * 2.5, size: 1, alpha: 1 - gone },
      false, easeOut(clamp01(k / 0.25)));
  }
  const s = down - CHUTE_MS;
  if (s < SETTLE_MS) return pose(f.tx, f.tz, 0, 'settle', null, false, 1 - s / SETTLE_MS);
  return pose(f.tx, f.tz, 0, 'landed', null, false, 0);
}

/** Walking into the park: down from DROP_Y on an open parachute, onto your spot. */
function dropAt(f: Flight, t: number): FlightPose {
  const base = { x: f.tx, z: f.tz, heading: 0, balloon: null, roped: false };
  if (t < DROP_MS) return { ...base, y: DROP_Y * (1 - easeOut(t / DROP_MS)), phase: 'chute', chute: 1 };
  const s = t - DROP_MS;
  if (s < SETTLE_MS) return { ...base, y: 0, phase: 'settle', chute: 1 - s / SETTLE_MS };
  return { ...base, y: 0, phase: 'landed', chute: 0 };
}

/** Leaving the park: the balloon up out of your back, and you up after it, out of sight. */
function awayAt(f: Flight, t: number): FlightPose {
  const k = clamp01(t / AWAY_MS);
  const rise = easeOut(clamp01(k / 0.3));
  const y = SKY * 1.6 * easeIn(clamp01((k - 0.3) / 0.7));
  return {
    x: f.fx, z: f.fz, y, heading: 0, roped: true, chute: 0,
    phase: k < 0.3 ? 'inflate' : k < 1 ? 'yank' : 'landed',
    balloon: { x: f.fx, y: y + HARNESS_Y + (ROPE + BALLOON_R) * rise, z: f.fz, size: 0.25 + 0.75 * rise, alpha: 1 - clamp01((k - 0.8) / 0.2) },
  };
}

/**
 * NEAR ENOUGH TO WALK. Under this far (about eight metres) a pickup is a lift straight up
 * and down on the spot -- the park bot did one of four centimetres, standing next to the
 * person it asked (2026-10-03) -- so you walk over instead, at a brisk pace.
 */
export const FLY_MIN = 1;
/** Whether getting from `from` to `to` is a pickup, or a few steps. */
export function flies(from: readonly [number, number], to: readonly [number, number]): boolean {
  return Math.hypot(to[0] - from[0], to[1] - from[1]) >= FLY_MIN;
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
