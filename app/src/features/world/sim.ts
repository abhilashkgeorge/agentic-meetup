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
 */
export type AgentKind = 'you' | 'stranger' | 'practice' | 'met';
export type AgentState =
  | 'idle' | 'walking' | 'approaching' | 'talking' | 'verdict' | 'leaving' | 'introduced' | 'gone';
export type Verdict = 'got_on' | 'unsure' | 'did_not_click' | 'could_not_tell';
export type Bubble = 'dots' | Verdict | null;

export interface SimAgent {
  ref: string;
  kind: AgentKind;
  /** Drives colour variation and the bob phase, so no two walk in step. */
  seed: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  /** Radians, y-axis. The way they are looking. */
  facing: number;
  state: AgentState;
  /** Seconds left in the current state, where the state is timed. */
  wait: number;
  partner: string | null;
  bubble: Bubble;
  ring: boolean;
}

/** Plaza radius in scene units. The renderer's ground is a little bigger. */
export const PLAZA = 8;
const WALK = 1.6;
const HURRY = 2.2;
const ARRIVE = 0.15;
const TOGETHER = 0.9;
const VERDICT_SECS = 3;

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
  /** Bench only: agents start and finish conversations on their own. */
  private autoplay = false;
  private autoClock = 0;

  constructor(seed = 1) {
    this.rnd = lcg(seed);
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
  upsert(list: ReadonlyArray<{ ref: string; kind: AgentKind; seed: number }>): void {
    for (const { ref, kind, seed } of list) {
      const have = this.byRef.get(ref);
      if (have) { have.kind = kind; continue; }
      const [x, z] = this.spot();
      this.byRef.set(ref, {
        ref, kind, seed, x, z, tx: x, tz: z,
        facing: this.rnd() * Math.PI * 2,
        state: 'idle', wait: 1 + this.rnd() * 4, partner: null, bubble: null, ring: false,
      });
      this.order.push(ref);
    }
  }

  remove(ref: string): void {
    if (!this.byRef.delete(ref)) return;
    const i = this.order.indexOf(ref);
    if (i >= 0) this.order.splice(i, 1);
  }

  /** Two agents walk to a spot between them and start talking (dots). */
  meet(a: string, b: string): void {
    const A = this.byRef.get(a);
    const B = this.byRef.get(b);
    if (!A || !B) return;
    const mx = (A.x + B.x) / 2;
    const mz = (A.z + B.z) / 2;
    const dx = B.x - A.x;
    const dz = B.z - A.z;
    const len = Math.hypot(dx, dz) || 1;
    // Stand a little apart, facing each other.
    A.tx = mx - (dx / len) * (TOGETHER / 2); A.tz = mz - (dz / len) * (TOGETHER / 2);
    B.tx = mx + (dx / len) * (TOGETHER / 2); B.tz = mz + (dz / len) * (TOGETHER / 2);
    for (const p of [A, B]) {
      p.state = 'approaching'; p.bubble = null; p.ring = false;
    }
    A.partner = b; B.partner = a;
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

  /** Not for me: they walk to the edge of the square and are gone. */
  pass(ref: string): void {
    const a = this.byRef.get(ref);
    if (!a) return;
    const ang = Math.atan2(a.z, a.x) || this.rnd() * Math.PI * 2;
    a.tx = Math.cos(ang) * (PLAZA + 4);
    a.tz = Math.sin(ang) * (PLAZA + 4);
    a.state = 'leaving'; a.bubble = null; a.ring = false; a.partner = null;
  }

  step(dt: number): void {
    for (const a of this.agents()) this.stepOne(a, dt);
    if (this.autoplay) this.stepAutoplay(dt);
  }

  private stepOne(a: SimAgent, dt: number): void {
    switch (a.state) {
      case 'idle':
        a.wait -= dt;
        if (a.wait <= 0) { [a.tx, a.tz] = this.spot(); a.state = 'walking'; }
        break;
      case 'walking':
        if (this.moveToward(a, WALK, dt)) { a.state = 'idle'; a.wait = 4 + this.rnd() * 5; }
        break;
      case 'approaching': {
        const arrived = this.moveToward(a, HURRY, dt);
        const p = a.partner ? this.byRef.get(a.partner) : undefined;
        if (arrived && p && Math.hypot(p.x - a.x, p.z - a.z) <= TOGETHER + ARRIVE) {
          a.state = 'talking'; a.bubble = 'dots';
          a.facing = Math.atan2(p.x - a.x, p.z - a.z);
        }
        break;
      }
      case 'talking':
        // Held until verdict() is called; the bench's autoplay does that itself.
        break;
      case 'verdict':
        a.wait -= dt;
        if (a.wait <= 0) {
          a.bubble = null; a.partner = null;
          [a.tx, a.tz] = this.spot(); a.state = 'leaving';
        }
        break;
      case 'leaving':
        if (this.moveToward(a, WALK, dt)) {
          if (Math.hypot(a.x, a.z) > PLAZA + 2) a.state = 'gone';
          else { a.state = 'idle'; a.wait = 3 + this.rnd() * 4; }
        }
        break;
      case 'introduced':
        a.wait -= dt;
        if (a.wait <= 0) { a.ring = false; a.state = 'idle'; a.wait = 2; }
        break;
      case 'gone':
        break;
    }
  }

  /** Returns true on arrival. */
  private moveToward(a: SimAgent, speed: number, dt: number): boolean {
    const dx = a.tx - a.x;
    const dz = a.tz - a.z;
    const d = Math.hypot(dx, dz);
    if (d <= ARRIVE) return true;
    const stepLen = Math.min(d, speed * dt);
    a.x += (dx / d) * stepLen;
    a.z += (dz / d) * stepLen;
    a.facing = Math.atan2(dx, dz);
    return false;
  }

  private spot(): [number, number] {
    const ang = this.rnd() * Math.PI * 2;
    const r = Math.sqrt(this.rnd()) * (PLAZA - 0.8);
    return [Math.cos(ang) * r, Math.sin(ang) * r];
  }

  // ── Bench ────────────────────────────────────────────────────────────────

  /**
   * A town of `n` for the frame-rate bench: you, strangers, every fourth one a practice
   * ghost, and conversations starting and ending by themselves so bubbles and verdict
   * glyphs are on screen at a realistic rate. Real rounds drive all of this from
   * events instead; nothing here is used outside the bench.
   */
  populateBench(n: number): void {
    for (const ref of [...this.order]) this.remove(ref);
    const list: { ref: string; kind: AgentKind; seed: number }[] = [
      { ref: 'you', kind: 'you', seed: 7 },
    ];
    for (let i = 1; i < n; i++) {
      list.push({
        ref: `b${i}`,
        kind: i % 4 === 0 ? 'practice' : i % 9 === 0 ? 'met' : 'stranger',
        seed: Math.floor(this.rnd() * 1e9),
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
