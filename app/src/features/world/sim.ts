/**
 * The town, without a renderer.
 *
 * Every agent's position, heading and state lives here in plain numbers, and the only
 * thing a renderer does is read them once a frame and draw. That split is deliberate:
 * if the 3D path fails on a phone (see features/dev/gl-bench.tsx), a 2D renderer over
 * this same file is two days, not a rewrite -- and the choreography (walk over, talk,
 * verdict, walk away, walk off the edge) is testable with no GL in the room.
 *
 * Seeded, like AliveRig in features/avatar/animation.ts: a run is reproducible, so a
 * test can assert where somebody ends up. Nothing here imports three.
 *
 * THE MAP. With no map set this is the old square: a plaza of radius PLAZA around a
 * fountain, everybody placed at random in it. With `setMap()` (world-screen.tsx calls
 * it once with the miniature Bengaluru from ./map.ts) every agent has an `area`, a
 * neighbourhood, and stands on one of that tile's seeded spots; you stand at your
 * tile's home. Somebody with no area stands in the central tile. `spot()` and
 * `home()` are the only two places a position is chosen, so the map is one branch
 * in each and nothing else knows.
 */
import { lookFor, type Look } from '@clone/shared';

export type AgentKind = 'you' | 'stranger' | 'practice' | 'met';
export type AgentState =
  | 'idle' | 'walking' | 'approaching' | 'talking' | 'verdict' | 'leaving' | 'introduced' | 'gone';
export type Verdict = 'got_on' | 'unsure' | 'did_not_click' | 'could_not_tell';
export type Bubble = 'dots' | Verdict | null;

export type Pt = readonly [number, number];
/** One neighbourhood, as the sim needs it: where to stand, and how far "gone" is. */
export interface MapArea { home: Pt; centre: Pt; radius: number; spots: readonly Pt[] }
export interface MapSpots { central: string; areas: Readonly<Record<string, MapArea>> }

export interface SimAgent {
  ref: string;
  kind: AgentKind;
  /** Drives colour variation and the bob phase, so no two walk in step. */
  seed: number;
  /** Drawn see-through: a practice profile, whatever else it is. */
  ghost: boolean;
  /** How they are drawn: the character they built, or a seeded one. */
  look: Look;
  /** The neighbourhood they stand in; null is the central tile (or the plaza). */
  area: string | null;
  x: number;
  z: number;
  tx: number;
  tz: number;
  /** Units per second toward the target: the walk or the hurry, or more for a long trip. */
  speed: number;
  /** Radians, y-axis. The way they are looking. */
  facing: number;
  state: AgentState;
  /** Seconds left in the current state, where the state is timed. */
  wait: number;
  partner: string | null;
  bubble: Bubble;
  ring: boolean;
}

export interface AgentInput {
  ref: string; kind: AgentKind; seed: number; ghost?: boolean; look?: Look;
  /** Omitted: leave the area alone. null: the central tile. */
  area?: string | null;
}

/** Plaza radius in scene units, for the town with no map. */
export const PLAZA = 8;
/** The fountain's footprint. Nobody is placed inside it. */
const FOUNTAIN = 2.2;
/** Where YOUR agent stands with no map: front of the fountain, nearest the camera. */
export const HOME: readonly [number, number] = [0, PLAZA * 0.55];
const WALK = 1.6;
const HURRY = 2.2;
/** No trip takes longer than this, however far: Koramangala to Whitefield is ~25 units. */
const TRIP_SECS = 4;
const ARRIVE = 0.15;
const TOGETHER = 0.9;
const VERDICT_SECS = 3;
/** A spot is a place, not a pixel: two people sent to the same one do not overlap. */
const JITTER = 0.35;

/** The same LCG as the avatar rig, so one seed means one town. */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class WorldSim {
  private readonly rnd: () => number;
  private readonly byRef = new Map<string, SimAgent>();
  /** Insertion order, kept stable so an instance slot means the same agent all frame. */
  private readonly order: string[] = [];
  /** Visits a visitor has been asked to make while already on one, in order. */
  private readonly visits = new Map<string, string[]>();
  private map: MapSpots | null = null;
  /** Bench only: agents start and finish conversations on their own. */
  private autoplay = false;
  private autoClock = 0;

  constructor(seed = 1) {
    this.rnd = lcg(seed);
  }

  /** The city to stand in. Set once, before anybody is added; null is the plaza. */
  setMap(map: MapSpots | null): void {
    this.map = map;
  }

  agents(): readonly SimAgent[] {
    const out: SimAgent[] = [];
    for (const ref of this.order) {
      const a = this.byRef.get(ref);
      if (a) out.push(a);
    }
    return out;
  }

  get(ref: string): SimAgent | undefined {
    return this.byRef.get(ref);
  }

  /**
   * Add agents that are new; leave the ones already here where they stand. A roster
   * refresh must not teleport the whole town.
   */
  upsert(list: ReadonlyArray<AgentInput>): void {
    for (const { ref, kind, seed, ghost, look, area } of list) {
      const have = this.byRef.get(ref);
      // A practice profile stays a ghost after it is met: "not a real person" is
      // about who they are, not about whether the agents have talked.
      const seeThrough = ghost ?? kind === 'practice';
      if (have) {
        // A refresh may bring a new character (they built one): swap it, do not move them.
        have.kind = kind; have.ghost = seeThrough; if (look) have.look = look;
        // A new neighbourhood (they answered the question): walk there -- unless they
        // are mid-visit, which is never interrupted for scenery.
        if (area !== undefined && area !== have.area) {
          have.area = area;
          if (have.state === 'idle' || have.state === 'walking') {
            const [tx, tz] = kind === 'you' ? this.home(area) : this.spot(area);
            this.setTarget(have, tx, tz, WALK); have.state = 'walking';
          }
        }
        continue;
      }
      const where = area ?? null;
      const [x, z] = kind === 'you' ? this.home(where) : this.spot(where);
      this.byRef.set(ref, {
        ref, kind, seed, ghost: seeThrough, look: look ?? lookFor(seed), area: where, x, z, tx: x, tz: z, speed: WALK,
        facing: this.rnd() * Math.PI * 2,
        state: 'idle', wait: 1 + this.rnd() * 4, partner: null, bubble: null, ring: false,
      });
      this.order.push(ref);
    }
  }

  remove(ref: string): void {
    if (!this.byRef.delete(ref)) return;
    this.visits.delete(ref);
    const i = this.order.indexOf(ref);
    if (i >= 0) this.order.splice(i, 1);
  }

  /**
   * `a` walks over to `b`, who stays where they are, and they talk (dots).
   *
   * The visitor moves and the visited stands still -- which is what the product says
   * happens ("your agent walks over"), and which also stops the whole square drifting
   * into the fountain: the first cut met at the midpoint of two random walkers, and
   * the midpoint of a square is its middle.
   *
   * ONE AT A TIME. A round tells the town about all three people the moment it has
   * chosen them, and then talks to them in turn; the first cut took all three cues
   * at once, so your agent set off for the last one named and the other two stood
   * about "approaching" nobody. A visitor already on a visit queues the rest and
   * calls on them in order, each after the verdict on the one before.
   */
  meet(a: string, b: string): void {
    const A = this.byRef.get(a);
    const B = this.byRef.get(b);
    if (!A || !B) return;
    if (A.partner === b) return;
    if (A.state === 'approaching' || A.state === 'talking' || A.state === 'verdict') {
      const q = this.visits.get(a) ?? [];
      if (!q.includes(b)) q.push(b);
      this.visits.set(a, q);
      return;
    }
    this.startVisit(A, B);
  }

  private startVisit(A: SimAgent, B: SimAgent): void {
    const dx = A.x - B.x;
    const dz = A.z - B.z;
    const len = Math.hypot(dx, dz) || 1;
    this.setTarget(A, B.x + (dx / len) * TOGETHER, B.z + (dz / len) * TOGETHER, HURRY);
    B.tx = B.x; B.tz = B.z;
    for (const p of [A, B]) {
      p.state = 'approaching'; p.bubble = null; p.ring = false;
    }
    A.partner = B.ref; B.partner = A.ref;
  }

  /** The next queued visit for `a`, started; false when there is nobody left to see. */
  private nextVisit(a: SimAgent): boolean {
    const q = this.visits.get(a.ref);
    while (q && q.length) {
      const B = this.byRef.get(q.shift()!);
      if (B) { this.startVisit(a, B); return true; }
    }
    return false;
  }

  /** How the conversation went, shown over this agent for a few seconds. */
  verdict(ref: string, words: Verdict): void {
    const a = this.byRef.get(ref);
    if (!a) return;
    a.state = 'verdict';
    a.bubble = words;
    a.wait = VERDICT_SECS;
  }

  /** Both humans said yes: a ring at both their feet, and they stay together a while. */
  introduced(a: string, b: string): void {
    for (const ref of [a, b]) {
      const p = this.byRef.get(ref);
      if (!p) continue;
      p.state = 'introduced'; p.ring = true; p.bubble = null; p.wait = 8;
    }
  }

  /** The roster stopped saying they were talking, with no verdict: just stand down. */
  settle(ref: string): void {
    const a = this.byRef.get(ref);
    if (!a) return;
    const partner = a.partner ? this.byRef.get(a.partner) : undefined;
    for (const p of [a, partner]) {
      if (!p) continue;
      p.partner = null; p.bubble = null;
      if (this.nextVisit(p)) continue;
      this.wander(p); p.state = 'walking';
    }
  }

  /**
   * The round is over, however it ended: nobody else is to be visited. The queue is
   * dropped and whoever `ref` was with is left to wander. A round that failed used
   * to leave your agent standing in a conversation for ever, dots and all.
   */
  recall(ref: string): void {
    this.visits.delete(ref);
    this.settle(ref);
  }

  /** Not for me: they walk out of their neighbourhood (or off the square) and are gone. */
  pass(ref: string): void {
    const a = this.byRef.get(ref);
    if (!a) return;
    const [cx, cz] = this.centreOf(a.area);
    const r = this.radiusOf(a.area);
    const ang = Math.atan2(a.z - cz, a.x - cx) || this.rnd() * Math.PI * 2;
    this.setTarget(a, cx + Math.cos(ang) * (r + 4), cz + Math.sin(ang) * (r + 4), WALK);
    a.state = 'leaving'; a.bubble = null; a.ring = false; a.partner = null;
  }

  step(dt: number): void {
    for (const a of this.agents()) this.stepOne(a, dt);
    if (this.autoplay) this.stepAutoplay(dt);
  }

  private stepOne(a: SimAgent, dt: number): void {
    switch (a.state) {
      case 'idle':
        // Your own agent stays put between outings, so it is always where you left it
        // and always the same one to tap. Everybody else drifts about.
        if (a.kind === 'you') break;
        a.wait -= dt;
        if (a.wait <= 0) { this.wander(a); a.state = 'walking'; }
        break;
      case 'walking':
        if (this.moveToward(a, dt)) { a.state = 'idle'; a.wait = 4 + this.rnd() * 5; }
        break;
      case 'approaching': {
        const p = a.partner ? this.byRef.get(a.partner) : undefined;
        if (!p) { this.lost(a); break; }
        const arrived = this.moveToward(a, dt);
        if (arrived && Math.hypot(p.x - a.x, p.z - a.z) <= TOGETHER + ARRIVE) {
          a.state = 'talking'; a.bubble = 'dots';
          a.facing = Math.atan2(p.x - a.x, p.z - a.z);
        }
        break;
      }
      case 'talking':
        // Held until verdict() is called; the bench's autoplay does that itself.
        if (a.partner && !this.byRef.get(a.partner)) this.lost(a);
        break;
      case 'verdict':
        a.wait -= dt;
        if (a.wait <= 0) {
          a.bubble = null; a.partner = null;
          if (this.nextVisit(a)) break;
          this.wander(a); a.state = 'leaving';
        }
        break;
      case 'leaving': {
        if (this.moveToward(a, dt)) {
          const [cx, cz] = this.centreOf(a.area);
          if (Math.hypot(a.x - cx, a.z - cz) > this.radiusOf(a.area) + 2) a.state = 'gone';
          else { a.state = 'idle'; a.wait = 3 + this.rnd() * 4; }
        }
        break;
      }
      case 'introduced':
        a.wait -= dt;
        if (a.wait <= 0) { a.ring = false; a.state = 'idle'; a.wait = 2; }
        break;
      case 'gone':
        break;
    }
  }

  /**
   * The person `a` was with has left the square (the roster stopped listing them).
   * Nobody is stranded walking towards, or talking to, an empty spot.
   */
  private lost(a: SimAgent): void {
    a.partner = null; a.bubble = null;
    if (this.nextVisit(a)) return;
    this.wander(a); a.state = 'walking';
  }

  /** Somewhere in their own neighbourhood: you go home, everybody else to a spot. */
  private wander(a: SimAgent): void {
    const [tx, tz] = a.kind === 'you' ? this.home(a.area) : this.spot(a.area);
    this.setTarget(a, tx, tz, WALK);
  }

  /** Aim at a point; a long trip is hurried so it still takes about TRIP_SECS. */
  private setTarget(a: SimAgent, tx: number, tz: number, base: number): void {
    a.tx = tx; a.tz = tz;
    a.speed = Math.max(base, Math.hypot(tx - a.x, tz - a.z) / TRIP_SECS);
  }

  /** Returns true on arrival. */
  private moveToward(a: SimAgent, dt: number): boolean {
    const dx = a.tx - a.x;
    const dz = a.tz - a.z;
    const d = Math.hypot(dx, dz);
    if (d <= ARRIVE) return true;
    const stepLen = Math.min(d, a.speed * dt);
    a.x += (dx / d) * stepLen;
    a.z += (dz / d) * stepLen;
    a.facing = Math.atan2(dx, dz);
    return false;
  }

  private areaOf(id: string | null): MapArea | null {
    if (!this.map) return null;
    return this.map.areas[id ?? this.map.central] ?? this.map.areas[this.map.central] ?? null;
  }

  /** A place to stand: one of the tile's spots, or inside the square and never in the fountain. */
  private spot(area: string | null): [number, number] {
    const tile = this.areaOf(area);
    if (tile && tile.spots.length) {
      const s = tile.spots[Math.floor(this.rnd() * tile.spots.length)]!;
      return [s[0] + (this.rnd() * 2 - 1) * JITTER, s[1] + (this.rnd() * 2 - 1) * JITTER];
    }
    const ang = this.rnd() * Math.PI * 2;
    const r = FOUNTAIN + Math.sqrt(this.rnd()) * (PLAZA - 0.8 - FOUNTAIN);
    return [Math.cos(ang) * r, Math.sin(ang) * r];
  }

  /** Where your agent stands between outings: the tile's home, or the plaza's. */
  home(area: string | null): [number, number] {
    const tile = this.areaOf(area);
    return tile ? [tile.home[0], tile.home[1]] : [HOME[0], HOME[1]];
  }

  /** The home of the tile `ref` belongs to; the central home for a ref not here. */
  homeOf(ref: string): [number, number] {
    return this.home(this.byRef.get(ref)?.area ?? null);
  }

  private centreOf(area: string | null): [number, number] {
    const tile = this.areaOf(area);
    return tile ? [tile.centre[0], tile.centre[1]] : [0, 0];
  }

  private radiusOf(area: string | null): number {
    return this.areaOf(area)?.radius ?? PLAZA;
  }

  // ── Bench ────────────────────────────────────────────────────────────────

  /**
   * A town of `n` for the frame-rate bench: you, strangers, every fourth one a practice
   * ghost, and conversations starting and ending by themselves so bubbles and verdict
   * glyphs are on screen at a realistic rate. On a map the town is spread over the
   * neighbourhoods in turn, you in the central one. Real rounds drive all of this
   * from events instead; nothing here is used outside the bench.
   */
  populateBench(n: number): void {
    for (const ref of [...this.order]) this.remove(ref);
    this.visits.clear();
    const ids = this.map ? Object.keys(this.map.areas) : [];
    const list: AgentInput[] = [
      { ref: 'you', kind: 'you', seed: 7, look: lookFor(7), area: null },
    ];
    for (let i = 1; i < n; i++) {
      const seed = Math.floor(this.rnd() * 1e9);
      list.push({
        ref: `b${i}`,
        kind: i % 4 === 0 ? 'practice' : i % 9 === 0 ? 'met' : 'stranger',
        seed,
        look: lookFor(seed),
        area: ids.length ? ids[i % ids.length]! : null,
      });
    }
    this.upsert(list);
    this.autoplay = true;
    this.autoClock = 0;
  }

  private stepAutoplay(dt: number): void {
    this.autoClock -= dt;
    if (this.autoClock > 0) return;
    this.autoClock = 1.2;
    const all = this.agents();
    // End a conversation that has run its course.
    const talking = all.filter((a) => a.state === 'talking');
    if (talking.length && this.rnd() < 0.5) {
      const a = talking[Math.floor(this.rnd() * talking.length)]!;
      const words: Verdict[] = ['got_on', 'unsure', 'did_not_click', 'could_not_tell'];
      const w = words[Math.floor(this.rnd() * words.length)]!;
      this.verdict(a.ref, w);
      if (a.partner) this.verdict(a.partner, w);
      if (w === 'got_on' && this.rnd() < 0.3 && a.partner) this.introduced(a.ref, a.partner);
      return;
    }
    // Start one, keeping roughly a fifth of the town in conversation.
    const idle = all.filter((a) => a.state === 'idle' || a.state === 'walking');
    if (idle.length >= 2 && talking.length * 5 < all.length) {
      const a = idle[Math.floor(this.rnd() * idle.length)]!;
      const b = idle[Math.floor(this.rnd() * idle.length)]!;
      if (a !== b) this.meet(a.ref, b.ref);
    }
  }
}
