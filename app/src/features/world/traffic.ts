/**
 * Bengaluru traffic on the road round Cubbon Park: two-wheelers, autos, cars and
 * buses, one lane each way, keeping left (city-plan.ts has the lanes).
 *
 * WHAT THE FOUNDER ASKED (2026-09-29): "buildings and traffic like bangalore after the
 * barricade where no user can go to". So it is a picture, not a game: nobody drives
 * these and nothing hits them; they only have to move the way traffic moves. Each
 * vehicle keeps to its lane at its own pace and slows for the one in front
 * (the intelligent driver model, cut down: a free road accelerates you to your pace,
 * the car ahead brakes you to keep your distance) -- which is enough for bunching,
 * gaps and the odd crawl, and is what a street looks like from the pavement.
 *
 * The mix is Bengaluru's: most of what moves is two-wheelers and autos.
 *
 * PURE: no three, no clock of its own. The canvas steps it with the frame's dt and
 * city-mesh.ts draws whatever is near the camera. tests/traffic.test.ts drives it.
 */
import type { Pt } from './sim';

/** Metres to units, as everywhere in the park (cubbon.ts METRES_PER_UNIT). */
const M = 1 / 8.1;

export type VehicleKind = 'bike' | 'auto' | 'car' | 'bus';

/** How long each is, how fast each likes to go, and how often you see one. */
export const VEHICLES: Record<VehicleKind, { length: number; pace: [number, number]; share: number }> = {
  bike: { length: 1.9 * M, pace: [8 * M, 13 * M], share: 0.4 },
  auto: { length: 2.7 * M, pace: [7 * M, 10 * M], share: 0.25 },
  car: { length: 4.2 * M, pace: [8 * M, 12 * M], share: 0.28 },
  bus: { length: 11 * M, pace: [6 * M, 8.5 * M], share: 0.07 },
};

/** Bumper to bumper, standing still, and the time gap kept at speed. */
const STANDSTILL = 1.6 * M;
const HEADWAY = 1.2;
/** Pull away and brake, units a second squared. */
const ACCEL = 1.4 * M;
const BRAKE = 3 * M;

export interface Vehicle {
  kind: VehicleKind;
  /** Which lane, and how far along it (units, from its first point). */
  lane: number;
  s: number;
  /** Units a second, now and as its driver likes. */
  v: number;
  pace: number;
  /** A number of its own: its colour, its rider's helmet. */
  seed: number;
  /** Where it is and which way it faces, after the last step (the sim's facing). */
  x: number;
  z: number;
  facing: number;
  /** Its place in its lane's order, front to back as the lane runs. */
  slot: number;
}

interface Lane { loop: readonly Pt[]; cum: number[]; length: number }

function laneOf(loop: readonly Pt[]): Lane {
  const cum = [0];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!, b = loop[(i + 1) % loop.length]!;
    cum.push(cum[i]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return { loop, cum, length: cum[loop.length]! };
}

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Everybody's place is worked out this often in steps; in between, only those near. */
const PLACE_EVERY = 8;

export class Traffic {
  readonly vehicles: Vehicle[] = [];
  private readonly lanes: Lane[];
  /**
   * Per lane, its vehicles in order along it, for finding who is in front. The order
   * never changes -- nobody overtakes (the step stops each at the bumper ahead) and the
   * loop only wraps round -- so it is set once and never sorted again.
   */
  private readonly order: Vehicle[][];
  /** Each vehicle's gap to the one in front, and that one's speed, this step. */
  private gap = new Float64Array(0);
  private lead = new Float64Array(0);
  private steps = 0;

  /**
   * `every` is how far apart, on average, vehicles start: units of lane per vehicle.
   * At 3.5 (28 m) a lane holds one every few seconds of looking -- busy, not jammed.
   */
  constructor(loops: readonly (readonly Pt[])[], seed = 0x7a4f, every = 3.5) {
    const rnd = lcg(seed);
    this.lanes = loops.map(laneOf);
    this.order = this.lanes.map(() => []);
    const kinds = Object.keys(VEHICLES) as VehicleKind[];
    this.lanes.forEach((lane, li) => {
      const n = Math.max(1, Math.floor(lane.length / every));
      for (let k = 0; k < n; k++) {
        let r = rnd(), kind: VehicleKind = 'bike';
        for (const c of kinds) { if (r < VEHICLES[c].share) { kind = c; break; } r -= VEHICLES[c].share; }
        const [lo, hi] = VEHICLES[kind].pace;
        const pace = lo + rnd() * (hi - lo);
        const v: Vehicle = { kind, lane: li, s: (k / n) * lane.length, v: pace * 0.8, pace, seed: Math.floor(rnd() * 1e9), x: 0, z: 0, facing: 0, slot: k };
        this.vehicles.push(v);
        this.order[li]!.push(v);
      }
    });
    for (const list of this.order) list.forEach((v, k) => { v.slot = k; });
    this.gap = new Float64Array(this.vehicles.length);
    this.lead = new Float64Array(this.vehicles.length);
    for (const v of this.vehicles) this.place(v);
  }

  /** Lane lengths, for the tests. */
  laneLength(i: number): number { return this.lanes[i]!.length; }

  /**
   * Move everybody on by dt seconds. `near` is the camera on the ground: only vehicles
   * within `r` of it are placed every step, everybody else every PLACE_EVERY -- nobody
   * sees where they are, and working out a place is most of a step's cost.
   *
   * WRITTEN FOR THE PHONE'S JAVASCRIPT, which is many times slower than a computer's:
   * no sort (the order never changes), and nothing made fresh each step (every step
   * that allocated was garbage for the collector, sixty times a second).
   */
  step(dt: number, near?: { x: number; z: number; r: number }): void {
    const h = Math.min(dt, 0.1);
    const all = this.vehicles;
    // Everybody's gap first, from where everybody is, then everybody moves: nobody
    // reacts to a car that has already moved this step.
    for (let i = 0; i < all.length; i++) {
      const v = all[i]!;
      const list = this.order[v.lane]!;
      const f = list[(v.slot + 1) % list.length]!;
      if (f === v) { this.gap[i] = Infinity; this.lead[i] = v.v; continue; }
      let ds = f.s - v.s;
      if (ds <= 0) ds += this.lanes[v.lane]!.length;
      this.gap[i] = ds - (VEHICLES[f.kind].length + VEHICLES[v.kind].length) / 2;
      this.lead[i] = f.v;
    }
    const root = 2 * Math.sqrt(ACCEL * BRAKE);
    for (let i = 0; i < all.length; i++) {
      const v = all[i]!;
      const gap = this.gap[i]!, speed = this.lead[i]!;
      const want = STANDSTILL + Math.max(0, v.v * HEADWAY + (v.v * (v.v - speed)) / root);
      const r = v.v / v.pace;
      const a = ACCEL * (1 - r * r * r * r - (gap > 0 ? (want / gap) * (want / gap) : 100));
      v.v = Math.max(0, Math.min(v.pace * 1.1, v.v + a * h));
      // Never through the one in front, whatever the arithmetic says: it moves this
      // step too, so its old place is the most this one may reach.
      v.s = (v.s + Math.min(v.v * h, Math.max(0, gap - 0.02 * M))) % this.lanes[v.lane]!.length;
    }
    const everybody = !near || this.steps++ % PLACE_EVERY === 0;
    const r2 = near ? (near.r + 2) * (near.r + 2) : 0;
    for (let i = 0; i < all.length; i++) {
      const v = all[i]!;
      if (everybody || (v.x - near!.x) * (v.x - near!.x) + (v.z - near!.z) * (v.z - near!.z) < r2) this.place(v);
    }
  }

  /** Put a vehicle where its distance along its lane says, facing along it. */
  private place(v: Vehicle): void {
    const lane = this.lanes[v.lane]!;
    const { cum, loop } = lane;
    let lo = 0, hi = loop.length;
    while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (cum[mid]! <= v.s) lo = mid; else hi = mid; }
    const a = loop[lo]!, b = loop[(lo + 1) % loop.length]!;
    const seg = cum[lo + 1]! - cum[lo]!;
    const t = seg > 0 ? (v.s - cum[lo]!) / seg : 0;
    v.x = a[0] + (b[0] - a[0]) * t;
    v.z = a[1] + (b[1] - a[1]) * t;
    // Facing along the lane a little ahead, so a corner is turned, not snapped.
    let w = v.s + VEHICLES[v.kind].length * 0.6;
    if (w >= lane.length) w -= lane.length;
    let lo2 = 0, hi2 = loop.length;
    while (lo2 + 1 < hi2) { const mid = (lo2 + hi2) >> 1; if (cum[mid]! <= w) lo2 = mid; else hi2 = mid; }
    const c = loop[lo2]!, d = loop[(lo2 + 1) % loop.length]!;
    const seg2 = cum[lo2 + 1]! - cum[lo2]!;
    const t2 = seg2 > 0 ? (w - cum[lo2]!) / seg2 : 0;
    const dx = c[0] + (d[0] - c[0]) * t2 - v.x, dz = c[1] + (d[1] - c[1]) * t2 - v.z;
    if (dx * dx + dz * dz > 1e-12) v.facing = Math.atan2(dx, dz);
  }
}
