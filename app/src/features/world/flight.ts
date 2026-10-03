/**
 * THE EMERGENCY PICKUP: how you get to somebody who said yes to talking with you -- and
 * how anybody comes and goes in the park.
 *
 * WHAT THE FOUNDER ASKED (2026-10-03). "Like the emergency pickup feature in PUBG": a
 * balloon rises on its line, a plane snags it and carries whoever hangs on it, and they
 * let go and come down by parachute. Then, of the first version: "the rope should be
 * hooked to a person's back ... animate [the hands and legs] like he is being pulled and
 * dropped"; and of the second: "the animation still looks bad. please research how to
 * implement it right".
 *
 * HOW IT IS DONE NOW, from how games do it:
 *   - THE BODY IS A PENDULUM hung from its anchor -- the hook between the shoulder blades
 *     while carried, the hands on the risers under the parachute -- swung by what the
 *     anchor does: the balloon speeding up leaves the body trailing, slowing down swings
 *     it ahead; the canopy's opening throws the feet forward; each swing dies away
 *     (a damped harmonic oscillator, as procedural climbing and rope swings are done).
 *   - THE LIMBS LAG THE BODY (secondary motion): the legs hang nearer the vertical than
 *     the leaning body, the head stays up.
 *   - EACH POSE BLENDS INTO THE NEXT: standing, the jolt of being yanked up, hanging,
 *     the parachute, the flare -- never a cut (GPU crowds blend two baked frames).
 *   - THE PARACHUTE as a jumper flies one: hands up on the toggles, feet and knees
 *     together; a flare before touchdown -- toggles pulled down to the chest, knees
 *     bent -- and the canopy collapsing as they land.
 *
 *   inflate  the balloon rises out of the pack on your back; you stand;
 *   yank     the line goes taut: you are jerked up off the ground, arms flung up;
 *   carry    you hang from the hook under the balloon, arms out, over the trees;
 *   chute    you let go: the canopy opens with a swing, you come down beside them,
 *            flaring at the end;
 *   settle   down on your feet, the canopy gone.
 *
 * And the same parts for coming and going: walking into the park is a parachute down
 * onto your spot (`drop`), leaving is a balloon taking you up and away (`away`).
 *
 * PURE: numbers in, numbers out (tests/park-sky-drop.test.ts, tests/pickup-poses.test.ts).
 * The sim moves whoever is flying (sim.ts), the crowd poses them (crowd-gpu.ts rigRows,
 * from `act` and `lean`), and rig-mesh.ts draws the balloon, its rope and the parachute.
 */

export type FlightKind = 'pickup' | 'drop' | 'away';

export interface Flight {
  /** From where they stood... */
  fx: number; fz: number;
  /** ...to where they land. For a `drop`, the same point; for an `away`, unused. */
  tx: number; tz: number;
  /** A pickup unless said otherwise: the only kind that goes between phones. */
  kind?: FlightKind;
  /**
   * Which way a drop or an away faces, as the sim has them (a pickup faces along its
   * way): the hook and the hands are behind and in front of the body, so they turn with it.
   */
  facing?: number;
}

/** The balloon rising on its rope, before you leave the ground. */
export const INFLATE_MS = 500;
/** Jerked up off the ground. */
export const YANK_MS = 450;
/** Across, however far: never slower than this, never quicker. */
export const CARRY_MIN_MS = 600;
export const CARRY_MAX_MS = 1100;
/** Units a second under the balloon, until the carry would take longer than CARRY_MAX_MS. */
export const CARRY_SPEED = 30;
/**
 * Coming down under the parachute. With the rest, a pickup takes three and a half seconds
 * at most: a far bench is reached by pickup, and the founder wants a bench in about three
 * (tests/park-bench-time.test.ts).
 */
export const CHUTE_MS = 1150;
/** Down, the parachute folding away and the body standing up out of the flare. */
export const SETTLE_MS = 250;
/** A drop into the park: the whole descent, from DROP_Y. */
export const DROP_MS = 1500;
/** Taken away: up on the balloon and out of sight. */
export const AWAY_MS = 1600;

/**
 * How high you hang while carried: over the tallest tree. A trunk is up to 2.4 units with
 * its crown on top (garden.ts: 2.4 x scale for the trunk's solid, scale up to 1.6) --
 * about four units in all -- so the carry clears every one of them.
 */
export const SKY = 4.6;
/** Where somebody walking into the park opens their parachute. */
export const DROP_Y = 3.2;
/** The rope, from the hook on your back to the bottom of the balloon, fully paid out. */
export const ROPE = 1.6;
/** The balloon's size, in units: about a metre and a half across. */
export const BALLOON_R = 0.17;

/**
 * THE BODY'S ANCHORS, in world units off the feet of somebody standing, facing +z: the
 * hook between the shoulder blades, and the hands up on the risers. Each is the pivot its
 * swing turns about, here and in the baked poses (crowd-gpu.ts, which works in the
 * model's own units: these divided by BODY_K). A person is 0.215 units tall.
 *
 * The risers are as high as the hands go, arms all but straight up (the shoulders are at
 * 1.4 of the model's units and an arm is 0.42 long): set higher, at 2.0, no hand reached
 * them, and the parachute's lines stopped short of the hands.
 */
export const BODY_K = 0.72 * 0.16; // character-mesh.ts MODEL_SCALE x camera.ts PERSON
export const HOOK = { y: 1.3 * BODY_K, z: -0.07 * BODY_K } as const;
export const RISER = { y: 1.8 * BODY_K, z: 0.1 * BODY_K } as const;
/** How far above the hands the canopy's middle rides. */
export const CANOPY_ABOVE = 0.26;

/** What the body is doing. Each is a baked pose (crowd-gpu.ts); `hang` and `chute` swing. */
export type Act = 'stand' | 'jolt' | 'hang' | 'chute' | 'flare';

export type FlightPhase = 'inflate' | 'yank' | 'carry' | 'chute' | 'settle' | 'landed';

export interface FlightPose {
  /** Where their feet would be standing upright -- the model's own origin -- and how high. */
  x: number;
  z: number;
  y: number;
  /** Which way they face (the sim's convention, atan2(dx, dz)). */
  heading: number;
  phase: FlightPhase;
  /** The body's swing about its anchor, radians: + is the top forward along `heading`. */
  lean: number;
  /** The pose: `from` blending into `to` by `w` (0 all `from`, 1 all `to`). */
  act: { from: Act; to: Act; w: number };
  /** The anchor in the world: the hook (hanging) or the hands on the risers (parachute). */
  anchor: { x: number; y: number; z: number };
  /** The balloon, while there is one: its middle, its size 0-1, how solid 0-1. */
  balloon: { x: number; y: number; z: number; size: number; alpha: number } | null;
  /** Whether the rope runs from the hook to the balloon. */
  roped: boolean;
  /** The parachute: 0 shut (or none), 1 fully open. */
  chute: number;
}

export function carryMs(f: Flight): number {
  const d = Math.hypot(f.tx - f.fx, f.tz - f.fz);
  return Math.min(CARRY_MAX_MS, Math.max(CARRY_MIN_MS, (d / CARRY_SPEED) * 1000));
}

/** The whole flight, start to standing, in ms. */
export function flightMs(f: Flight): number {
  if (f.kind === 'drop') return DROP_MS + SETTLE_MS;
  if (f.kind === 'away') return AWAY_MS;
  return INFLATE_MS + YANK_MS + carryMs(f) + CHUTE_MS + SETTLE_MS;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t * t * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Smooth 0 to 1 over [a, b]. */
const smooth = (t: number, a: number, b: number) => { const k = clamp01((t - a) / (b - a)); return k * k * (3 - 2 * k); };

// ── the swing ────────────────────────────────────────────────────────────────

/** How the swings ring: hanging from the hook, and under the canopy. Periods and damping. */
const HANG_PERIOD = 1.25, HANG_DAMP = 0.22;
const CHUTE_PERIOD = 1.5, CHUTE_DAMP = 0.3;
/** The lean a full push of the balloon's acceleration holds the body at, for a long hop. */
const LEAN_PER_PUSH = 0.42;
/** Past this the poses are not baked: the swing is held inside it. */
export const LEAN_MAX = 0.7;
/** The canopy's opening throws the feet forward: the body's swing starts at this speed. */
const OPENING_KICK = -1.2;
const STEP = 1 / 240;
const SAMPLE_MS = 5;

/**
 * The body's lean through the whole flight, sampled every SAMPLE_MS: a damped pendulum,
 * pushed while carried by the balloon's acceleration along the way (speeding up leaves
 * the body trailing, slowing down swings it ahead) and kicked at the parachute's opening.
 * Worked out once per flight (the same every time and on every phone).
 */
const swings = new WeakMap<Flight, Float32Array>();
function swingOf(f: Flight): Float32Array {
  const have = swings.get(f);
  if (have) return have;
  const total = flightMs(f);
  const out = new Float32Array(Math.ceil(total / SAMPLE_MS) + 2);
  const d = Math.hypot(f.tx - f.fx, f.tz - f.fz);
  const carry = carryMs(f) / 1000;
  const carryStart = (INFLATE_MS + YANK_MS) / 1000;
  const chuteStart = carryStart + carry;
  const end = (f.kind === 'drop' ? DROP_MS : f.kind === 'away' ? AWAY_MS : total - SETTLE_MS) / 1000;
  // How hard a hop this long pushes: a short one hardly swings at all.
  const push = LEAN_PER_PUSH * Math.min(1, d / 18);
  let lean = f.kind === 'drop' ? 0.22 : 0, speed = 0;
  let under: 'hook' | 'canopy' = f.kind === 'drop' ? 'canopy' : 'hook';
  let next = 0;
  for (let t = 0; next < out.length; t += STEP) {
    while (next < out.length && next * SAMPLE_MS <= t * 1000 + 1e-6) {
      // The canopy flies them level to the ground at the end: the swing is let out
      // over the flare's last moments.
      const fade = under === 'canopy' ? 1 - smooth(t, end - 0.45, end) : 1;
      out[next++] = Math.max(-LEAN_MAX, Math.min(LEAN_MAX, lean * fade));
    }
    let force = 0;
    if (f.kind !== 'drop' && f.kind !== 'away' && under === 'hook' && t >= carryStart && t < chuteStart) {
      // The balloon's acceleration along the way, as a share of its most (easeInOut's
      // second derivative, 24k up to the middle and -24(1-k) after, at most 12).
      const k = (t - carryStart) / carry;
      force = (k < 0.5 ? 24 * k : -24 * (1 - k)) / 12;
    }
    if (f.kind !== 'drop' && f.kind !== 'away' && under === 'hook' && t >= chuteStart) {
      under = 'canopy';
      speed += OPENING_KICK;
    }
    if (f.kind === 'away') force = 0.15 * Math.sin(t * 5);
    const period = under === 'hook' ? HANG_PERIOD : CHUTE_PERIOD;
    const damp = under === 'hook' ? HANG_DAMP : CHUTE_DAMP;
    const w = (Math.PI * 2) / period;
    const acc = -w * w * Math.sin(lean) - 2 * damp * w * speed + w * w * push * force;
    speed += acc * STEP;
    lean += speed * STEP;
  }
  swings.set(f, out);
  return out;
}

function leanAt(f: Flight, ms: number): number {
  const s = swingOf(f);
  const i = Math.max(0, ms) / SAMPLE_MS;
  const a = Math.min(s.length - 1, Math.floor(i));
  const b = Math.min(s.length - 1, a + 1);
  return s[a]! + (s[b]! - s[a]!) * (i - a);
}

// ── where everything is ──────────────────────────────────────────────────────

/** The body's anchor, turned to face `heading`: the offset from the feet, in the world. */
function anchorOff(a: { y: number; z: number }, heading: number): [number, number, number] {
  return [Math.sin(heading) * a.z, a.y, Math.cos(heading) * a.z];
}

/** Where they are `ms` into the flight, how they hang, and the balloon, rope and parachute. */
export function flightAt(f: Flight, ms: number): FlightPose {
  const t = Math.max(0, ms);
  if (f.kind === 'drop') return dropAt(f, t);
  if (f.kind === 'away') return awayAt(f, t);
  const dx = f.tx - f.fx, dz = f.tz - f.fz;
  const d = Math.hypot(dx, dz);
  const heading = d > 1e-6 ? Math.atan2(dx, dz) : 0;
  const ux = d > 1e-6 ? dx / d : 0, uz = d > 1e-6 ? dz / d : 0;
  const carry = carryMs(f);
  const lean = leanAt(f, t);
  const hookOff = anchorOff(HOOK, heading);
  const riserOff = anchorOff(RISER, heading);
  const ropeTop = ROPE + BALLOON_R;

  /** A body hanging from the hook at `hook`, the balloon on the rope above it at `lean`. */
  const hanging = (hx: number, hy: number, hz: number, phase: FlightPhase, act: FlightPose['act'], size = 1): FlightPose => ({
    x: hx - hookOff[0], z: hz - hookOff[2], y: hy - hookOff[1], heading, phase, lean, act,
    anchor: { x: hx, y: hy, z: hz },
    // The rope runs from the hook up along the swing to the balloon: trailing, the
    // balloon is ahead.
    balloon: { x: hx + ux * Math.sin(lean) * ropeTop, y: hy + Math.cos(lean) * ropeTop, z: hz + uz * Math.sin(lean) * ropeTop, size, alpha: 1 },
    roped: true, chute: 0,
  });

  // The balloon comes out of the pack on your back and rises to the end of its rope.
  if (t < INFLATE_MS) {
    const k = easeOut(t / INFLATE_MS);
    const hx = f.fx + hookOff[0], hy = hookOff[1], hz = f.fz + hookOff[2];
    return {
      x: f.fx, z: f.fz, y: 0, heading, phase: 'inflate', lean: 0, act: { from: 'stand', to: 'stand', w: 0 },
      anchor: { x: hx, y: hy, z: hz },
      balloon: { x: hx, y: hy + ropeTop * k, z: hz, size: 0.25 + 0.75 * k, alpha: 1 }, roped: true, chute: 0,
    };
  }
  // The rope goes taut: up you go, quicker and quicker -- the jolt flings the arms up,
  // and they come down out to the sides as you hang.
  if (t < INFLATE_MS + YANK_MS) {
    const s = t - INFLATE_MS;
    const k = s / YANK_MS;
    const y = SKY * (0.7 * easeIn(k) + 0.3 * k);
    const act = s < JOLT_MS ? { from: 'stand' as const, to: 'jolt' as const, w: easeOut(s / JOLT_MS) }
      : { from: 'jolt' as const, to: 'hang' as const, w: smooth(s, JOLT_MS, YANK_MS) };
    return hanging(f.fx + hookOff[0], y + hookOff[1], f.fz + hookOff[2], 'yank', act);
  }
  // Across under the balloon: the balloon on its path, the body swinging below it.
  const c = t - INFLATE_MS - YANK_MS;
  if (c < carry) {
    const k = c / carry;
    const e = easeInOut(k);
    const by = SKY + hookOff[1] + ropeTop + 0.4 * Math.sin(Math.PI * k);
    const bx = f.fx + hookOff[0] + dx * e, bz = f.fz + hookOff[2] + dz * e;
    // The hook hangs a rope's length below the balloon, along the swing.
    const hx = bx - ux * Math.sin(lean) * ropeTop, hz = bz - uz * Math.sin(lean) * ropeTop;
    const hy = by - Math.cos(lean) * ropeTop;
    return { ...hanging(hx, hy, hz, 'carry', { from: 'hang', to: 'hang', w: 1 }), balloon: { x: bx, y: by, z: bz, size: 1, alpha: 1 } };
  }
  // Let go over them: the canopy opens and swings them; down beside them, flaring at the
  // end, the balloon sailing on up and away.
  const down = c - carry;
  const gone = clamp01(down / CHUTE_MS * 1.4);
  const balloonAway = { x: f.tx + hookOff[0] + ux * gone * 2.5, y: SKY + hookOff[1] + ropeTop + gone * 3, z: f.tz + hookOff[2] + uz * gone * 2.5, size: 1, alpha: 1 - gone };
  if (down < CHUTE_MS) {
    const k = down / CHUTE_MS;
    // The fall slows as the canopy fills, then a steady descent, then the flare.
    const yFeet = SKY * (1 - (0.55 * easeOut(clamp01(k / 0.35)) + 0.45 * smooth(k, 0.35, 1)));
    const ax = f.tx + riserOff[0], az = f.tz + riserOff[2], ay = yFeet + riserOff[1];
    const act = down < OPEN_MS ? { from: 'hang' as const, to: 'chute' as const, w: smooth(down, 0, OPEN_MS) }
      : down > CHUTE_MS - FLARE_MS ? { from: 'chute' as const, to: 'flare' as const, w: smooth(down, CHUTE_MS - FLARE_MS, CHUTE_MS) }
        : { from: 'chute' as const, to: 'chute' as const, w: 1 };
    return {
      x: ax - riserOff[0], z: az - riserOff[2], y: ay - riserOff[1], heading, phase: 'chute', lean, act,
      anchor: { x: ax, y: ay, z: az }, balloon: balloonAway, roped: false,
      chute: easeOut(clamp01(down / OPEN_MS)),
    };
  }
  const s = down - CHUTE_MS;
  const settle = { x: f.tx, z: f.tz, y: 0, heading, lean: 0, anchor: { x: f.tx + riserOff[0], y: riserOff[1], z: f.tz + riserOff[2] }, balloon: null, roped: false };
  if (s < SETTLE_MS) return { ...settle, phase: 'settle', act: { from: 'flare', to: 'stand', w: smooth(s, 0, SETTLE_MS) }, chute: 1 - s / SETTLE_MS };
  return { ...settle, phase: 'landed', act: { from: 'stand', to: 'stand', w: 0 }, chute: 0 };
}

/** The jolt: how long the arms take to fling up as the rope snatches you off your feet. */
export const JOLT_MS = 140;
/** The canopy filling: hanging into the parachute pose. */
export const OPEN_MS = 300;
/** The flare before touchdown: toggles to the chest, knees bent. */
export const FLARE_MS = 380;

/** Walking into the park: down from DROP_Y under an open canopy, flaring onto your spot. */
function dropAt(f: Flight, t: number): FlightPose {
  const heading = f.facing ?? 0;
  const [ox, oy, oz] = anchorOff(RISER, heading);
  const lean = leanAt(f, t);
  const base = { x: f.tx, z: f.tz, heading, balloon: null, roped: false };
  if (t < DROP_MS) {
    const k = t / DROP_MS;
    const y = DROP_Y * (1 - easeOut(k));
    const act = t > DROP_MS - FLARE_MS ? { from: 'chute' as const, to: 'flare' as const, w: smooth(t, DROP_MS - FLARE_MS, DROP_MS) }
      : { from: 'chute' as const, to: 'chute' as const, w: 1 };
    return { ...base, y, phase: 'chute', lean, act, anchor: { x: f.tx + ox, y: y + oy, z: f.tz + oz }, chute: 1 };
  }
  const s = t - DROP_MS;
  const anchor = { x: f.tx + ox, y: oy, z: f.tz + oz };
  if (s < SETTLE_MS) return { ...base, y: 0, phase: 'settle', lean: 0, act: { from: 'flare', to: 'stand', w: smooth(s, 0, SETTLE_MS) }, anchor, chute: 1 - s / SETTLE_MS };
  return { ...base, y: 0, phase: 'landed', lean: 0, act: { from: 'stand', to: 'stand', w: 0 }, anchor, chute: 0 };
}

/** Leaving the park: the balloon up out of the pack, and you snatched up after it, out of sight. */
function awayAt(f: Flight, t: number): FlightPose {
  const k = clamp01(t / AWAY_MS);
  const rise = easeOut(clamp01(k / 0.3));
  const y = SKY * 1.6 * easeIn(clamp01((k - 0.3) / 0.7));
  const s = t - AWAY_MS * 0.3;
  const act = s < 0 ? { from: 'stand' as const, to: 'stand' as const, w: 0 }
    : s < JOLT_MS ? { from: 'stand' as const, to: 'jolt' as const, w: easeOut(s / JOLT_MS) }
      : { from: 'jolt' as const, to: 'hang' as const, w: smooth(s, JOLT_MS, JOLT_MS + 350) };
  const heading = f.facing ?? 0;
  const [ox, oy, oz] = anchorOff(HOOK, heading);
  const hx = f.fx + ox, hy = y + oy, hz = f.fz + oz;
  const lean = s < 0 ? 0 : leanAt(f, t);
  return {
    x: f.fx, z: f.fz, y, heading, phase: k < 0.3 ? 'inflate' : k < 1 ? 'yank' : 'landed', lean, act,
    anchor: { x: hx, y: hy, z: hz }, roped: true, chute: 0,
    balloon: { x: hx, y: hy + (ROPE + BALLOON_R) * rise, z: hz, size: 0.25 + 0.75 * rise, alpha: 1 - clamp01((k - 0.8) / 0.2) },
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
