/**
 * THE EMERGENCY PICKUP: how you get to somebody who said yes to talking with you -- and
 * how anybody comes and goes in the park.
 *
 * WHAT THE FOUNDER ASKED (2026-10-03). "Like the emergency pickup feature in PUBG": a
 * balloon rises on its line, a plane snags it and carries whoever hangs on it, and they
 * let go and come down by parachute. Then, of the first version: "the rope should be
 * hooked to a person's back ... animate [the hands and legs] like he is being pulled and
 * dropped"; of the second: "the animation still looks bad. please research how to
 * implement it right"; and of the third (2026-10-04): "Use a fine rope, not the thick
 * one ... before the rope gets attached show a good aeroplane on the sky dropping the
 * cable then attaching to the user and dropping it to the partner's location. Only drop
 * to the partner if the partner is far away ... or else the user can walk".
 *
 * HOW IT IS DONE NOW, from how games do it:
 *   - THE BODY IS A PENDULUM hung from its anchor -- the hook between the shoulder blades
 *     while carried, the hands on the risers under the parachute -- swung by what the
 *     anchor does: the plane speeding up leaves the body trailing, slowing down swings
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
 *   approach a cargo plane swoops in low from behind you, slowing; you stand;
 *   cable    a fine cable drops from the back of its belly and catches the hook on your back;
 *   yank     the cable reels in: you are snatched off the ground, arms flung up, and
 *            hauled up under the plane;
 *   carry    you hang under it on the cable, arms out, over the trees, towards them;
 *   chute    you let go over them: the canopy opens with a swing and you drift down
 *            beside them, flaring at the end; the plane climbs away;
 *   settle   down on your feet, the canopy gone.
 *
 * And the same parts for coming and going: walking into the park is a parachute down
 * onto your spot (`drop`), leaving is the plane taking you up and away (`away`). Nearer
 * than FLY_MIN you jog over instead.
 *
 * PURE: numbers in, numbers out (tests/park-sky-drop.test.ts, tests/pickup-poses.test.ts).
 * The sim moves whoever is flying (sim.ts), the crowd poses them (crowd-gpu.ts rigRows,
 * from `act` and `lean`), and rig-mesh.ts draws the plane, its cable and the parachute.
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

/** The plane flying in, before its cable drops. */
export const APPROACH_MS = 900;
/** Its cable falling to the hook on your back. */
export const CABLE_MS = 500;
/** Reeled up off the ground to hang under the plane. */
export const YANK_MS = 550;
/** Across, however far: never slower than this, never quicker (a short hop is quicker still: see carryMs). */
export const CARRY_MIN_MS = 600;
export const CARRY_MAX_MS = 1100;
/** Units a second under the plane, until the carry would take longer than CARRY_MAX_MS. */
export const CARRY_SPEED = 30;
/**
 * Coming down under the parachute. With the rest, a pickup takes four and a half seconds
 * at most: three and a half until the plane and its cable came in (2026-10-04), the
 * founder having asked to see them; a far bench is reached this way
 * (tests/park-bench-time.test.ts).
 */
export const CHUTE_MS = 1150;
/** Down, the parachute folding away and the body standing up out of the flare. */
export const SETTLE_MS = 250;
/** A drop into the park: the whole descent, from DROP_Y. */
export const DROP_MS = 1500;
/** Taken away: after the plane has you, how long it is still in sight, speeding off and climbing. */
export const AWAY_CARRY_MS = 1400;
export const AWAY_MS = APPROACH_MS + CABLE_MS + YANK_MS + AWAY_CARRY_MS;

/**
 * How high you hang while carried: over the tallest tree. A trunk is up to 2.4 units with
 * its crown on top (garden.ts: 2.4 x scale for the trunk's solid, scale up to 1.6) --
 * about four units in all -- so the carry clears every one of them.
 */
export const SKY = 4.6;
/** Where somebody walking into the park opens their parachute. */
export const DROP_Y = 3.2;

/**
 * THE PLANE, by where its cable comes out of it (the back of its belly): how high it
 * passes to drop the cable -- just over the trees -- and how high it carries you, a
 * cable's length over SKY; how fast it passes, about a slow plane's speed, so the cable
 * can be seen to drop; how far ahead of you it is when the cable reaches your back, so
 * the cable trails down at a slant behind it, as off a moving plane; and how much higher
 * than it passes it comes in, swooping down.
 *
 * A hop shorter than FULL_PASS gets a nearer, slower pass (passOf), so the plane never
 * has you past where you are going before it has you at all.
 */
export const PASS_Y = 4.9;
export const CARRY_Y = 5.9;
export const PASS_SPEED = 6;
export const LEAD = 5;
export const PLANE_SWOOP = 1.6;
export const FULL_PASS = 9.8;
/**
 * Hanging under the plane as the carry starts: the body still trailing a little behind
 * it -- less behind a slower pass (passOf), hardly at all behind a short hop's.
 */
const HANG_LEAN = 0.1;

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
/** The cable you hang on while carried: from the plane down to the hook on your back. */
export const CABLE = CARRY_Y - (SKY + HOOK.y);

/** What the body is doing. Each is a baked pose (crowd-gpu.ts); `hang` and `chute` swing. */
export type Act = 'stand' | 'jolt' | 'hang' | 'chute' | 'flare';

export type FlightPhase = 'approach' | 'cable' | 'yank' | 'carry' | 'chute' | 'settle' | 'landed';

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
  /**
   * The plane, while it is in the sky: where its cable comes out (the back of its belly),
   * which way it flies, how steeply it climbs (radians, nose up), its roll, and how solid 0-1.
   */
  plane: { x: number; y: number; z: number; heading: number; climb: number; roll: number; alpha: number } | null;
  /**
   * The cable's lower end while there is a cable -- your hook once it has you -- and how
   * slack it hangs, 0 taut to 1 falling free. Its upper end is the plane.
   */
  cable: { x: number; y: number; z: number; slack: number } | null;
  /** Whether the cable has you. */
  roped: boolean;
  /** The parachute: 0 shut (or none), 1 fully open. */
  chute: number;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** Smooth 0 to 1 over [a, b]. */
const smooth = (t: number, a: number, b: number) => { const k = clamp01((t - a) / (b - a)); return k * k * (3 - 2 * k); };

/** When its cable starts down, when the cable has you, and when you hang under the plane. */
export const T_CABLE = APPROACH_MS;
export const T_HOOK = APPROACH_MS + CABLE_MS;
export const T_CARRY = T_HOOK + YANK_MS;

const hopOf = (f: Flight) => Math.hypot(f.tx - f.fx, f.tz - f.fz);

/**
 * How the plane passes for this hop: how far ahead of you it is when its cable has you,
 * and how fast. A short hop brings it in nearer and slower, so it never has you past
 * where you are going before it has you at all.
 */
function passOf(f: Flight): { lead: number; speed: number } {
  if (f.kind === 'away') return { lead: LEAD, speed: PASS_SPEED };
  const k = Math.min(1, hopOf(f) / FULL_PASS);
  return { lead: LEAD * k, speed: PASS_SPEED * k };
}

/** Where along the way the plane is as the carry starts, and how much further to over where you land. */
function carryAlong(f: Flight): { start: number; left: number } {
  const { lead, speed } = passOf(f);
  const start = lead + speed * (YANK_MS / 1000);
  return { start, left: Math.max(0, hopOf(f) - start) };
}

export function carryMs(f: Flight): number {
  if (f.kind === 'away') return AWAY_CARRY_MS;
  if (f.kind === 'drop') return 0;
  const { speed } = passOf(f);
  const { left } = carryAlong(f);
  if (left <= 1e-6 || speed <= 1e-6) return 0;
  // Not far: straight on at the pass's own speed.
  if (left <= speed * (CARRY_MIN_MS / 1000)) return (left / speed) * 1000;
  return Math.min(CARRY_MAX_MS, Math.max(CARRY_MIN_MS, (left / CARRY_SPEED) * 1000));
}

/** The whole flight, start to standing, in ms. */
export function flightMs(f: Flight): number {
  if (f.kind === 'drop') return DROP_MS + SETTLE_MS;
  if (f.kind === 'away') return AWAY_MS;
  return T_CARRY + carryMs(f) + CHUTE_MS + SETTLE_MS;
}

// ── the plane ────────────────────────────────────────────────────────────────

/**
 * THE PLANE'S RUN, along the way (s, from the hook on your back as you stood, + towards
 * where you are going) and up (y), and how fast each changes. In from behind and above,
 * slowing to the pass; level while its cable goes down; climbing to carry height as it
 * reels you in; over to where you land -- faster in the middle of a long hop -- and on
 * and up and away once you let go. Each stretch meets the next at the same place and
 * speed: the plane never jumps or jerks.
 */
export function planeRun(f: Flight, ms: number): { s: number; y: number; vs: number; vy: number } {
  const { lead, speed } = passOf(f);
  const sCable = lead - speed * (CABLE_MS / 1000);
  if (ms < T_CABLE) {
    // In from behind, slowing: from two and a half times the pass's speed (and a little).
    const T = APPROACH_MS / 1000, tau = (T_CABLE - ms) / 1000;
    const a = (1.5 * speed + 4.4 / T) / T;
    const k = tau / T;
    return { s: sCable - speed * tau - 0.5 * a * tau * tau, y: PASS_Y + PLANE_SWOOP * k * k, vs: speed + a * tau, vy: (-2 * PLANE_SWOOP * k) / T };
  }
  if (ms < T_HOOK) return { s: sCable + speed * ((ms - T_CABLE) / 1000), y: PASS_Y, vs: speed, vy: 0 };
  if (ms < T_CARRY) {
    const k = (ms - T_HOOK) / YANK_MS;
    const rise = CARRY_Y - PASS_Y;
    return { s: lead + speed * ((ms - T_HOOK) / 1000), y: PASS_Y + rise * k * k * (3 - 2 * k), vs: speed, vy: (rise * 6 * k * (1 - k)) / (YANK_MS / 1000) };
  }
  const { start, left } = carryAlong(f);
  const c = (ms - T_CARRY) / 1000;
  if (f.kind === 'away') {
    return { s: start + speed * c + 9 * c * c, y: CARRY_Y + 0.4 * c + 2.2 * c * c, vs: speed + 18 * c, vy: 0.4 + 4.4 * c };
  }
  const T = carryMs(f) / 1000;
  if (c < T) {
    const k = c / T;
    // On at the pass's speed, and the rest of the way as a smooth surge: no speed added
    // at either end, the most in the middle.
    const extra = left - speed * T;
    const w = Math.PI * 2;
    return {
      s: start + speed * c + extra * (k - Math.sin(w * k) / w),
      y: CARRY_Y + 0.25 * Math.sin(Math.PI * k),
      vs: speed + (extra / T) * (1 - Math.cos(w * k)),
      vy: ((0.25 * Math.PI) / T) * Math.cos(Math.PI * k),
    };
  }
  const a = c - T;
  return { s: start + left + speed * a + 8 * a * a, y: CARRY_Y + 0.5 * a + 2.5 * a * a, vs: speed + 16 * a, vy: 0.5 + 5 * a };
}

/** How hard the plane is speeding up along the way while it carries you, units/s/s. */
function carryPush(f: Flight, ms: number): number {
  if (f.kind === 'away') return 18;
  const T = carryMs(f) / 1000;
  if (T <= 0) return 0;
  const k = (ms - T_CARRY) / 1000 / T;
  if (k < 0 || k > 1) return 0;
  const { speed } = passOf(f);
  const extra = carryAlong(f).left - speed * T;
  return ((extra / (T * T)) * Math.PI * 2) * Math.sin(Math.PI * 2 * k);
}

// ── the yank ─────────────────────────────────────────────────────────────────

/**
 * Being reeled in: where the hook on your back is, off the plane, `ms` into the flight.
 * From standing (the cable has just reached you) to hanging a cable's length under it,
 * trailing a little -- as an offset from the plane that closes fast, then slower: the
 * snatch. At the end you move with the plane, so the carry takes over without a jerk.
 */
function reeled(f: Flight, ms: number): { s: number; y: number } {
  const { lead } = passOf(f);
  const k = clamp01((ms - T_HOOK) / YANK_MS);
  const e = easeOut(k);
  const r0s = -lead, r0y = HOOK.y - PASS_Y;
  const trail = HANG_LEAN * (passOf(f).speed / PASS_SPEED) ** 2;
  const r1s = -CABLE * Math.sin(trail), r1y = -CABLE * Math.cos(trail);
  const p = planeRun(f, ms);
  return { s: p.s + r0s + (r1s - r0s) * e, y: p.y + r0y + (r1y - r0y) * e };
}

/** The cable's slant from the hook up to the plane, from the upright: + is the plane ahead. */
function cableLean(f: Flight, ms: number): number {
  const p = planeRun(f, ms);
  const h = reeled(f, ms);
  return Math.atan2(p.s - h.s, p.y - h.y);
}

// ── the swing ────────────────────────────────────────────────────────────────

/** How the swings ring: hanging from the hook, and under the canopy. Periods and damping. */
const HANG_PERIOD = 1.25, HANG_DAMP = 0.22;
const CHUTE_PERIOD = 1.5, CHUTE_DAMP = 0.3;
/** The lean a full push of the plane's acceleration holds the body at. */
const LEAN_PER_PUSH = 0.42;
/** The plane's speeding up that pushes that hard, units/s/s (an eighteen-unit hop's, about). */
const FULL_PUSH = 250;
/** Past this the poses are not baked: the swing is held inside it. */
export const LEAN_MAX = 0.7;
/** The canopy's opening throws the feet forward: the body's swing starts at this speed. */
const OPENING_KICK = -1.2;
const STEP = 1 / 240;
const SAMPLE_MS = 5;

/**
 * The body's lean from the carry on, sampled every SAMPLE_MS: a damped pendulum, pushed
 * while carried by the plane's acceleration along the way (speeding up leaves the body
 * trailing, slowing down swings it ahead) and kicked at the parachute's opening. Before
 * the carry the body leans with the cable (cableLean). Worked out once per flight (the
 * same every time and on every phone).
 */
const swings = new WeakMap<Flight, Float32Array>();
function swingOf(f: Flight): Float32Array {
  const have = swings.get(f);
  if (have) return have;
  const total = flightMs(f);
  const out = new Float32Array(Math.ceil(total / SAMPLE_MS) + 2);
  const drop = f.kind === 'drop';
  const from = drop ? 0 : T_CARRY / 1000;
  const chuteStart = (T_CARRY + carryMs(f)) / 1000;
  const end = (drop ? DROP_MS : f.kind === 'away' ? AWAY_MS : total - SETTLE_MS) / 1000;
  let lean = drop ? 0.22 : cableLean(f, T_CARRY);
  let speed = drop ? 0 : (cableLean(f, T_CARRY) - cableLean(f, T_CARRY - SAMPLE_MS)) / (SAMPLE_MS / 1000);
  let under: 'hook' | 'canopy' = drop ? 'canopy' : 'hook';
  let next = Math.ceil((from * 1000) / SAMPLE_MS - 1e-9);
  out.fill(lean, 0, next);
  for (let t = from; next < out.length; t += STEP) {
    while (next < out.length && next * SAMPLE_MS <= t * 1000 + 1e-6) {
      // The canopy flies them level to the ground at the end: the swing is let out
      // over the flare's last moments.
      const fade = under === 'canopy' ? 1 - smooth(t, end - 0.45, end) : 1;
      out[next++] = Math.max(-LEAN_MAX, Math.min(LEAN_MAX, lean * fade));
    }
    let force = 0;
    if (!drop && under === 'hook') force = Math.max(-1, Math.min(1, carryPush(f, t * 1000) / FULL_PUSH));
    if (f.kind === 'away' && t * 1000 >= T_CARRY) force = 0.6;
    if (!drop && f.kind !== 'away' && under === 'hook' && t >= chuteStart) {
      under = 'canopy';
      speed += OPENING_KICK;
    }
    const period = under === 'hook' ? HANG_PERIOD : CHUTE_PERIOD;
    const damp = under === 'hook' ? HANG_DAMP : CHUTE_DAMP;
    const w = (Math.PI * 2) / period;
    const acc = -w * w * Math.sin(lean) - 2 * damp * w * speed + w * w * LEAN_PER_PUSH * force;
    speed += acc * STEP;
    lean += speed * STEP;
  }
  swings.set(f, out);
  return out;
}

function leanAt(f: Flight, ms: number): number {
  if (f.kind !== 'drop' && ms < T_CARRY) {
    // Upright until the cable has you; then the cable's slant, taken over quickly -- as far
    // as the baked frames go (a long cable from a plane well ahead slants further).
    return ms < T_HOOK ? 0 : Math.min(LEAN_MAX, cableLean(f, ms)) * smooth(ms, T_HOOK, T_HOOK + 250);
  }
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

/** Which way a flight goes: a pickup along its way, a drop or an away the way they face. */
function headingOf(f: Flight): number {
  if (f.kind === 'drop' || f.kind === 'away') return f.facing ?? 0;
  const dx = f.tx - f.fx, dz = f.tz - f.fz;
  return Math.hypot(dx, dz) > 1e-6 ? Math.atan2(dx, dz) : (f.facing ?? 0);
}

/** Where the plane is `ms` into the flight, in the world, and how it flies. */
export function planeAt(f: Flight, ms: number): { x: number; y: number; z: number; heading: number; climb: number; roll: number } {
  const heading = headingOf(f);
  const hook = anchorOff(HOOK, heading);
  const r = planeRun(f, ms);
  const ux = Math.sin(heading), uz = Math.cos(heading);
  // A little roll as it comes in, settling level for the pass.
  const roll = ms < T_CABLE ? 0.16 * (1 - smooth(ms, 0, T_CABLE)) * Math.sin(ms / 140) : 0;
  return { x: f.fx + hook[0] + ux * r.s, y: r.y, z: f.fz + hook[2] + uz * r.s, heading, climb: Math.atan2(r.vy, r.vs), roll };
}

/** Where they are `ms` into the flight, how they hang, and the plane, its cable and the parachute. */
export function flightAt(f: Flight, ms: number): FlightPose {
  const t = Math.max(0, ms);
  if (f.kind === 'drop') return dropAt(f, t);
  const away = f.kind === 'away';
  const heading = headingOf(f);
  const ux = Math.sin(heading), uz = Math.cos(heading);
  const lean = leanAt(f, t);
  const hookOff = anchorOff(HOOK, heading);
  const riserOff = anchorOff(RISER, heading);
  const hx0 = f.fx + hookOff[0], hz0 = f.fz + hookOff[2];
  const carry = carryMs(f);
  const release = T_CARRY + carry;
  const p = planeAt(f, t);
  // In out of nothing; into the haze well after you let go (or, taking you away, as it goes).
  const alpha = smooth(t, 0, 150) * (away ? 1 - smooth(t, AWAY_MS - 350, AWAY_MS) : 1 - smooth(t, release + 800, release + CHUTE_MS + SETTLE_MS - 50));
  const plane = alpha > 0.002 ? { ...p, alpha } : null;
  const at = (s: number, y: number) => ({ x: hx0 + ux * s, y, z: hz0 + uz * s });

  const standing = { x: f.fx, z: f.fz, y: 0, heading, lean: 0, anchor: { x: hx0, y: HOOK.y, z: hz0 }, chute: 0, roped: false };
  if (t < T_CABLE) return { ...standing, phase: 'approach', act: { from: 'stand', to: 'stand', w: 0 }, plane, cable: null };
  // Its cable falls from the back of its belly to the hook on your back, quicker as it goes.
  if (t < T_HOOK) {
    const k = (t - T_CABLE) / CABLE_MS;
    const fall = k * k;
    const cable = { x: p.x + (hx0 - p.x) * fall, y: p.y + (HOOK.y - p.y) * fall, z: p.z + (hz0 - p.z) * fall, slack: 1 };
    return { ...standing, phase: 'cable', act: { from: 'stand', to: 'stand', w: 0 }, plane, cable };
  }
  /** A body on the cable, its hook at `h`. */
  const onCable = (h: { x: number; y: number; z: number }, phase: FlightPhase, act: FlightPose['act'], slack = 0): FlightPose => ({
    x: h.x - hookOff[0], z: h.z - hookOff[2], y: h.y - hookOff[1], heading, phase, lean, act,
    anchor: h, plane, cable: { ...h, slack }, roped: true, chute: 0,
  });
  // The cable has you: reeled in, off the ground and up under the plane. The jolt flings
  // the arms up, and they come down out to the sides as you hang.
  if (t < T_CARRY) {
    const s = t - T_HOOK;
    const r = reeled(f, t);
    const act = s < JOLT_MS ? { from: 'stand' as const, to: 'jolt' as const, w: easeOut(s / JOLT_MS) }
      : { from: 'jolt' as const, to: 'hang' as const, w: smooth(s, JOLT_MS, YANK_MS) };
    return onCable(at(r.s, r.y), 'yank', act, 1 - smooth(s, 0, 120));
  }
  /** A cable's length under the plane, along the swing. */
  const under = (q: { s: number; y: number }, l: number) => ({ s: q.s - Math.sin(l) * CABLE, y: q.y - Math.cos(l) * CABLE });
  if (away || t < release) {
    const h = under(planeRun(f, t), lean);
    return onCable(at(h.s, h.y), away && t >= AWAY_MS ? 'landed' : 'carry', { from: 'hang', to: 'hang', w: 1 });
  }
  // Let go over them: the canopy opens and swings them, and they drift down onto the
  // spot beside them, flaring at the end; the cable reels back up into the plane as it
  // climbs away.
  const down = t - release;
  const rel = under(planeRun(f, release), leanAt(f, release));
  const relAt = at(rel.s, rel.y);
  // Let go, the cable whips back up after the plane, slack -- off you at once.
  const reel = clamp01(down / 220);
  const cable = reel < 1
    ? { x: relAt.x + (p.x - relAt.x) * easeOut(reel), y: relAt.y + (p.y - relAt.y) * easeOut(reel), z: relAt.z + (p.z - relAt.z) * easeOut(reel), slack: 0.7 }
    : null;
  const rx = relAt.x - hookOff[0], rz = relAt.z - hookOff[2], ry = relAt.y - hookOff[1];
  if (down < CHUTE_MS) {
    const k = down / CHUTE_MS;
    // The fall slows as the canopy fills, then a steady descent, then the flare.
    const yFeet = ry * (1 - (0.55 * easeOut(clamp01(k / 0.35)) + 0.45 * smooth(k, 0.35, 1)));
    const drift = easeOut(clamp01(k / 0.8));
    const fx = rx + (f.tx - rx) * drift, fz = rz + (f.tz - rz) * drift;
    const act = down < OPEN_MS ? { from: 'hang' as const, to: 'chute' as const, w: smooth(down, 0, OPEN_MS) }
      : down > CHUTE_MS - FLARE_MS ? { from: 'chute' as const, to: 'flare' as const, w: smooth(down, CHUTE_MS - FLARE_MS, CHUTE_MS) }
        : { from: 'chute' as const, to: 'chute' as const, w: 1 };
    return {
      x: fx, z: fz, y: yFeet, heading, phase: 'chute', lean, act,
      anchor: { x: fx + riserOff[0], y: yFeet + riserOff[1], z: fz + riserOff[2] }, plane, cable, roped: false,
      chute: easeOut(clamp01(down / OPEN_MS)),
    };
  }
  const s = down - CHUTE_MS;
  const settle = { x: f.tx, z: f.tz, y: 0, heading, lean: 0, anchor: { x: f.tx + riserOff[0], y: riserOff[1], z: f.tz + riserOff[2] }, plane, cable: null, roped: false };
  if (s < SETTLE_MS) return { ...settle, phase: 'settle', act: { from: 'flare', to: 'stand', w: smooth(s, 0, SETTLE_MS) }, chute: 1 - s / SETTLE_MS };
  return { ...settle, phase: 'landed', act: { from: 'stand', to: 'stand', w: 0 }, chute: 0 };
}

/**
 * The cable, as `n` + 1 points from the plane down to its end: straight when taut; when
 * slack -- falling, or reeling back up -- bellied down and back, trailing the plane.
 */
export function cableCurve(
  top: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number; slack: number },
  heading: number,
  n = 12,
): [number, number, number][] {
  const len = Math.hypot(end.x - top.x, end.y - top.y, end.z - top.z);
  const back = 0.16 * len * end.slack, sag = 0.07 * len * end.slack;
  const cx = (top.x + end.x) / 2 - Math.sin(heading) * back, cy = (top.y + end.y) / 2 - sag, cz = (top.z + end.z) / 2 - Math.cos(heading) * back;
  return Array.from({ length: n + 1 }, (_, i) => {
    const k = i / n, a = (1 - k) * (1 - k), b = 2 * k * (1 - k), c = k * k;
    return [a * top.x + b * cx + c * end.x, a * top.y + b * cy + c * end.y, a * top.z + b * cz + c * end.z];
  });
}

// ── the camera ───────────────────────────────────────────────────────────────

/** Where a camera is and what it looks at. */
export interface Shot { eye: [number, number, number]; look: [number, number, number] }

/**
 * THE CAMERA ON YOUR OWN PICKUP, IN SHOTS, CUT -- NOT PANNED (the founder, 2026-10-04:
 * "you don't have to pan the camera from the user to the aeroplane. It will be better to
 * show the animation of the plane dropping the cable, then show it being attached to the
 * user and the user being dropped to the partner's location"). The first version tipped
 * the walking camera up after the plane and down again with its cable: one long pan.
 *
 *   1. THE PLANE DROPPING ITS CABLE. Cut, as the flight starts, to a camera low on the
 *      ground ahead of where the cable will drop, a little to the side, looking back up
 *      the plane's way: it comes in out of the distance towards you, growing, and its
 *      cable falls from its belly towards you, standing small at the bottom.
 *   2. THE CABLE ON YOU. Cut, just before the cable reaches you, to behind you: you about
 *      two thirds of the way down the picture, clear of the park's cards and buttons, the
 *      plane near the top, the cable between -- it hooks on your back and snatches you up,
 *      the camera rising with you, closing in as you are reeled up under the plane, just
 *      far enough back that the plane and you are SHOT_SPREAD degrees apart.
 *   3. DOWN BESIDE THEM. Once your canopy is open, back to the walking camera, following
 *      you down to where they are.
 *
 * `w` is how much of this shot to use over the walking camera: all of it from the first
 * frame -- a cut -- easing out to none as you come down.
 */
export const SHOT_SPREAD = 31;
export const SHOT_BELOW = 9;
const SHOT_SIDE = 0.2;
const SHOT_UP = 0.2;
const SHOT_NEAR = 3;
const SHOT_FAR = 9;
/** When the picture cuts from the plane to you: a little before its cable has you. */
export const SHOT_CUT_MS = T_HOOK - 150;
/** The first shot's camera: how far ahead of where the cable drops, how far to the side, how high, and what it looks at. */
const PLANE_SHOT = { ahead: 5, side: 1.6, up: 0.45, aimBack: 3, aimUp: 2.8 } as const;

export function flightShot(f: Flight, ms: number): (Shot & { w: number }) | null {
  if (f.kind === 'drop' || f.kind === 'away') return null;
  const release = T_CARRY + carryMs(f);
  const w = 1 - smooth(ms, release + 100, release + 900);
  const heading = headingOf(f);
  const ux = Math.sin(heading), uz = Math.cos(heading);
  // 1. The plane coming in, from a camera on the ground ahead of the drop, looking back.
  if (ms < SHOT_CUT_MS) {
    const { lead, speed } = passOf(f);
    const drop = lead - speed * (CABLE_MS / 1000);
    const hook = anchorOff(HOOK, heading);
    const sx = (s: number, side: number) => f.fx + hook[0] + ux * s + uz * side;
    const sz = (s: number, side: number) => f.fz + hook[2] + uz * s - ux * side;
    const at = drop + PLANE_SHOT.ahead;
    return {
      w,
      eye: [sx(at, PLANE_SHOT.side), PLANE_SHOT.up, sz(at, PLANE_SHOT.side)],
      look: [sx(drop - PLANE_SHOT.aimBack, 0), PLANE_SHOT.aimUp, sz(drop - PLANE_SHOT.aimBack, 0)],
    };
  }
  // 2. You and the plane, from behind you.
  const pose = flightAt(f, ms);
  const yaw = pose.heading + SHOT_SIDE;
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  // You: the middle of you, below the hook or the hands.
  const m = { x: pose.anchor.x, y: pose.anchor.y - (pose.phase === 'chute' || pose.phase === 'settle' ? 0.12 : 0.05), z: pose.anchor.z };
  const q = planeAt(f, ms);
  const eyeAt = (r: number) => ({ x: m.x - dx * r, y: Math.max(0.25, m.y + SHOT_UP), z: m.z - dz * r });
  const rise = (e: { x: number; y: number; z: number }, p: { x: number; y: number; z: number }) =>
    Math.atan2(p.y - e.y, (p.x - e.x) * dx + (p.z - e.z) * dz);
  const spread = (r: number) => { const e = eyeAt(r); return rise(e, q) - rise(e, m); };
  const want = (SHOT_SPREAD * Math.PI) / 180;
  let lo = SHOT_NEAR, hi = SHOT_FAR;
  if (spread(lo) > want) {
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (spread(mid) > want) lo = mid; else hi = mid; }
    lo = hi;
  }
  const e = eyeAt(lo);
  const pitch = rise(e, m) + (SHOT_BELOW * Math.PI) / 180;
  return {
    w,
    eye: [e.x, e.y, e.z],
    look: [e.x + dx * Math.cos(pitch) * lo, e.y + Math.sin(pitch) * lo, e.z + dz * Math.cos(pitch) * lo],
  };
}

/** The jolt: how long the arms take to fling up as the cable snatches you off your feet. */
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
  const base = { x: f.tx, z: f.tz, heading, plane: null, cable: null, roped: false };
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

/**
 * NEAR ENOUGH TO WALK. Under this far -- about twenty-five metres -- you go over on foot,
 * at a run if need be (sim.ts walkTo), instead of a plane coming for you (the founder,
 * 2026-10-04: "only drop to the partner if the partner is far away ... or else the user
 * can walk to the partner's location"). It was eight metres, set because a lift on the
 * spot looked absurd (the park bot did one of four centimetres, 2026-10-03); a plane
 * swooping in to move you a stone's throw is as absurd.
 */
export const FLY_MIN = 3;
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
