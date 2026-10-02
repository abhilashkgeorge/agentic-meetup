/**
 * The town, without a renderer.
 *
 * Every agent's position, heading and state lives here in plain numbers, and the only
 * thing a renderer does is read them once a frame and draw. That split is deliberate:
 * if the 3D path fails on a phone (see features/dev/gl-bench.tsx), a 2D renderer over
 * this same file is two days, not a rewrite -- and the choreography (walk over, meet,
 * part, walk away, walk off the edge) is testable with no GL in the room.
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
import { lookFor, pointInPolygon, type Look, type ParkFly } from '@clone/shared';
import { flightAt, flightMs, type Flight } from './flight';
import { puff } from './park-effects';

/**
 * `live` is a real person walking in the park right now (park-live.ts): the server
 * says where they are and the sim only glides them there -- no wandering, no visits,
 * and a roster refresh leaves them alone.
 */
export type AgentKind = 'you' | 'stranger' | 'practice' | 'met' | 'live';
export type AgentState =
  | 'idle' | 'walking' | 'approaching' | 'talking' | 'parting' | 'leaving' | 'introduced' | 'gone'
  /** On a bench in the park, with somebody (park-hud.tsx): until they get up. */
  | 'sitting';
/**
 * What floats over a head. `dots` while two agents are together; `met` for a moment
 * after, the same mark for every pair. There is no verdict to draw: the tick, the
 * cross and the two coloured dots it replaced were a judgement of a person, shown in
 * the square before either human had looked.
 */
export type Bubble = 'dots' | 'met' | null;

export type Pt = readonly [number, number];
/**
 * One neighbourhood, as the sim needs it: where to stand, and how far "gone" is.
 * The outline is here so a crowded tile can spread people without pushing anybody
 * over the edge into the next neighbourhood.
 */
export interface MapArea { home: Pt; centre: Pt; radius: number; spots: readonly Pt[]; polygon: readonly Pt[] }
/**
 * Something you cannot walk through: a building, a tree or a landmark, as a circle
 * with a height. The height is what lets the camera tell a bungalow from a tower --
 * a lens riding above the roofs is not blocked by them, and a camera that pulls in
 * for every low building in a city of them is a camera that never stops lurching.
 */
export interface Solid {
  x: number; z: number; r: number; h: number;
  /**
   * True when this thing hides what is behind it, so the shoulder camera has to pull
   * in past it. A wall does. A TREE TRUNK DOES NOT, and that distinction is the whole
   * reason this field exists: the trunk collider is half a metre across, and while
   * nobody could get within six metres of a tree nobody ever found out what the camera
   * did about one. Once you could walk up and touch the bark, standing against a trunk
   * pulled the lens all the way in and swung it overhead, so the view of the park
   * became a view of the top of your own head (on the phone, 2026-09-23).
   *
   * Undefined means opaque, because everything that was here before this field was.
   */
  seeThrough?: boolean;
  /** What it is, where anybody asks: the park's tests keep some kinds off the paths. */
  kind?: 'tree' | 'prop' | 'bench' | 'bush' | 'wall' | 'fountain';
}

export interface MapSpots {
  central: string;
  areas: Readonly<Record<string, MapArea>>;
  /** Buildings and trees. Walked around, never through. */
  solids?: readonly Solid[];
  /** Lakes and rivers. Walked around, never across -- except on a bridge. */
  lakes?: readonly (readonly Pt[])[];
  /**
   * The places water does not stop you: a bridge deck, a line of stepping stones.
   * Checked before the water is, so a river can run right through a path.
   */
  bridges?: readonly Solid[];
  /**
   * The ring nobody walks out of: a park's fence. Whoever is inside stays inside, and
   * stops BOUND_INSET short of the line itself. Feet only: a camera looks over a fence.
   *
   * WHY NOT SOLIDS, which is what the edge was: a ring of circles 1.1 units wide just
   * outside the outline. Circles along a line leave a scalloped edge -- you stopped a
   * metre and a half inside it at one step and could walk a metre past it at the next
   * -- and wherever the boundary turned in on itself they reached a metre into the
   * park, across the paths running along it (tests/park-roads.test.ts, 2026-09-29). A
   * fence drawn on the line has to stop you at the line.
   */
  bounds?: readonly Pt[];
}

/**
 * Where the solid things are, in a grid, so a walking agent asks about four of them
 * rather than five hundred.
 *
 * Cells are two units across and everything is filed into every cell its own box
 * touches, so a lookup is the one cell under the foot. Without this the collision
 * test is 444 buildings plus 213 trees plus 54 lakes for every agent for every
 * candidate heading for every frame, which is the whole frame budget.
 */
const CELL = 2;
const cellKey = (x: number, z: number): number =>
  (Math.floor(x / CELL) + 512) * 1024 + (Math.floor(z / CELL) + 512);

interface Lake { ring: readonly Pt[]; minX: number; maxX: number; minZ: number; maxZ: number }

/** How far short of a fence (MapSpots.bounds) somebody stops, beyond their own width. */
export const BOUND_INSET = 0.015;
/** A fence-grid cell: wholly outside, wholly inside, or one the fence passes near. */
const OUT = 0, IN = 1, EDGE = 2;
/** The widest `pad` the bound's cells are filed for: a person's FOOT, and room to spare. */
const BOUND_PAD = 0.25;

/** Whether the segment (x0, z0)-(x1, z1) crosses the segment a-b. */
function crosses(x0: number, z0: number, x1: number, z1: number, a: Pt, b: Pt): boolean {
  const d1 = (b[0] - a[0]) * (z0 - a[1]) - (b[1] - a[1]) * (x0 - a[0]);
  const d2 = (b[0] - a[0]) * (z1 - a[1]) - (b[1] - a[1]) * (x1 - a[0]);
  const d3 = (x1 - x0) * (a[1] - z0) - (z1 - z0) * (a[0] - x0);
  const d4 = (x1 - x0) * (b[1] - z0) - (z1 - z0) * (b[0] - x0);
  return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
}

/** How far (x, z) is from the segment a-b, and the nearest point on it. */
function toSegment(x: number, z: number, a: Pt, b: Pt): { d: number; qx: number; qz: number } {
  const ex = b[0] - a[0], ez = b[1] - a[1];
  const l2 = ex * ex + ez * ez;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / l2));
  const qx = a[0] + ex * t, qz = a[1] + ez * t;
  return { d: Math.hypot(x - qx, z - qz), qx, qz };
}

class Ground {
  private readonly solids = new Map<number, Solid[]>();
  private readonly lakes = new Map<number, Lake[]>();
  private readonly bridges = new Map<number, Solid[]>();
  /**
   * The fence (MapSpots.bounds), as a dense grid of cells over its box: OUT, IN (wholly
   * inside, nothing to check) or EDGE (the fence passes near: check its segments, which
   * `boundEdges` lists by cell). A typed array and integer arithmetic, NOT a map: this
   * is asked by every walker for every heading it tries, every frame, and two map
   * lookups a time doubled the park's step with the thousand-person test crowd --
   * 0.16 to 0.34 ms in node, 11 ms of a 22 ms frame on the Seeker (2026-09-29).
   */
  private readonly bound: readonly Pt[] | null;
  private readonly boundCells: Uint8Array = new Uint8Array(0);
  private readonly boundEdges: (number[] | undefined)[] = [];
  /** For an EDGE cell, whether its middle is inside: the start of a local parity test. */
  private readonly boundMiddleIn: Uint8Array = new Uint8Array(0);
  private readonly boundX0: number = 0;
  private readonly boundZ0: number = 0;
  private readonly boundNX: number = 0;
  private readonly boundNZ: number = 0;
  readonly empty: boolean;

  constructor(map: MapSpots | null) {
    this.empty = !map || (!map.solids?.length && !map.lakes?.length && !map.bridges?.length && !map.bounds?.length);
    this.bound = map?.bounds && map.bounds.length > 2 ? map.bounds : null;
    if (!map) return;
    if (this.bound) {
      const ring = this.bound;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      // A cell of margin all round, so every cell the fence comes near is on the grid.
      this.boundX0 = Math.floor(minX / CELL) - 1;
      this.boundZ0 = Math.floor(minZ / CELL) - 1;
      this.boundNX = Math.floor(maxX / CELL) + 2 - this.boundX0;
      this.boundNZ = Math.floor(maxZ / CELL) + 2 - this.boundZ0;
      this.boundCells = new Uint8Array(this.boundNX * this.boundNZ);
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
        const x0 = Math.floor((Math.min(a[0], b[0]) - BOUND_PAD) / CELL), x1 = Math.floor((Math.max(a[0], b[0]) + BOUND_PAD) / CELL);
        const z0 = Math.floor((Math.min(a[1], b[1]) - BOUND_PAD) / CELL), z1 = Math.floor((Math.max(a[1], b[1]) + BOUND_PAD) / CELL);
        for (let cx = x0; cx <= x1; cx++) {
          for (let cz = z0; cz <= z1; cz++) {
            // Only the cells this edge actually comes near, not its whole box.
            const mid = toSegment((cx + 0.5) * CELL, (cz + 0.5) * CELL, a, b).d;
            if (mid > CELL * 0.71 + BOUND_PAD) continue;
            const k = this.boundCell(cx * CELL + CELL / 2, cz * CELL + CELL / 2);
            if (k < 0) continue;
            this.boundCells[k] = EDGE;
            const at = this.boundEdges[k];
            if (at) at.push(i); else this.boundEdges[k] = [i];
          }
        }
      }
      this.boundMiddleIn = new Uint8Array(this.boundCells.length);
      for (let k = 0; k < this.boundCells.length; k++) {
        const cx = this.boundX0 + Math.floor(k / this.boundNZ), cz = this.boundZ0 + (k % this.boundNZ);
        const inside = pointInPolygon([(cx + 0.5) * CELL, (cz + 0.5) * CELL], ring);
        this.boundMiddleIn[k] = inside ? 1 : 0;
        if (this.boundCells[k] !== EDGE) this.boundCells[k] = inside ? IN : OUT;
      }
    }
    const file = <T>(into: Map<number, T[]>, item: T, minX: number, maxX: number, minZ: number, maxZ: number) => {
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
        for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
          const k = (cx + 512) * 1024 + (cz + 512);
          const at = into.get(k);
          if (at) at.push(item); else into.set(k, [item]);
        }
      }
    };
    for (const s of map.solids ?? []) file(this.solids, s, s.x - s.r, s.x + s.r, s.z - s.r, s.z + s.r);
    for (const b of map.bridges ?? []) file(this.bridges, b, b.x - b.r, b.x + b.r, b.z - b.r, b.z + b.r);
    for (const ring of map.lakes ?? []) {
      if (ring.length < 3) continue;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of ring) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      file(this.lakes, { ring, minX, maxX, minZ, maxZ }, minX, maxX, minZ, maxZ);
    }
  }

  /**
   * A unit vector out of whatever this point is inside, or null when it is clear.
   * Straight away from the nearest solid; for a lake, away from its middle, which is
   * crude and is only ever used to walk somebody off water they should not be on.
   */
  escape(x: number, z: number, pad: number): [number, number] | null {
    if (this.empty) return null;
    const k = cellKey(x, z);
    // Out past the fence, or pressed into it: back in, straight at the nearest bit of it.
    if (this.bound && this.outOfBounds(x, z, pad)) {
      const ring = this.bound;
      const edges = this.boundEdges[this.boundCell(x, z)] ?? ring.map((_, i) => i);
      let best = { d: Infinity, qx: x, qz: z };
      for (const i of edges) {
        const s = toSegment(x, z, ring[i]!, ring[(i + 1) % ring.length]!);
        if (s.d < best.d) best = s;
      }
      const inside = pointInPolygon([x, z], ring);
      const dx = (best.qx - x) * (inside ? -1 : 1), dz = (best.qz - z) * (inside ? -1 : 1);
      const len = Math.hypot(dx, dz);
      return len < 1e-9 ? null : [dx / len, dz / len];
    }
    for (const s of this.solids.get(k) ?? []) {
      const d = s.r + pad;
      const dx = x - s.x; const dz = z - s.z;
      const len = Math.hypot(dx, dz);
      if (len < d) return len < 1e-6 ? [1, 0] : [dx / len, dz / len];
    }
    for (const l of this.lakes.get(k) ?? []) {
      if (x < l.minX || x > l.maxX || z < l.minZ || z > l.maxZ) continue;
      if (!pointInPolygon([x, z], l.ring)) continue;
      const dx = x - (l.minX + l.maxX) / 2; const dz = z - (l.minZ + l.maxZ) / 2;
      const len = Math.hypot(dx, dz);
      return len < 1e-6 ? [1, 0] : [dx / len, dz / len];
    }
    return null;
  }

  /**
   * Outside the fence, or closer to it than `pad` and BOUND_INSET: one lookup away
   * from the fence, a few segments beside it.
   */
  private outOfBounds(x: number, z: number, pad: number): boolean {
    const k = this.boundCell(x, z);
    if (k < 0) return true;
    const state = this.boundCells[k];
    if (state !== EDGE) return state === OUT;
    const ring = this.bound!;
    // In or out, locally: from the cell's middle, whose side is known, to here, the
    // fence is crossed only by the edges filed in this cell -- an odd number of
    // crossings is the other side. The whole ring (69 corners in Cubbon Park), asked
    // afresh for every heading of every walker near the fence, was most of the park's
    // step with the test crowd.
    const mx = (Math.floor(x / CELL) + 0.5) * CELL, mz = (Math.floor(z / CELL) + 0.5) * CELL;
    let inside = this.boundMiddleIn[k] === 1;
    for (const i of this.boundEdges[k]!) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      if (toSegment(x, z, a, b).d < pad + BOUND_INSET) return true;
      if (crosses(mx, mz, x, z, a, b)) inside = !inside;
    }
    return !inside;
  }

  /** The fence grid's cell under (x, z), or -1 off the grid (which is outside). */
  private boundCell(x: number, z: number): number {
    const cx = Math.floor(x / CELL) - this.boundX0, cz = Math.floor(z / CELL) - this.boundZ0;
    if (cx < 0 || cz < 0 || cx >= this.boundNX || cz >= this.boundNZ) return -1;
    return cx * this.boundNZ + cz;
  }

  /**
   * Is this a place a person cannot stand? `pad` is how wide they are.
   *
   * `above` is how high off the ground the question is being asked: a person asks at
   * 0 and everything counts, a camera asks at its own height and anything shorter
   * than that is simply below it. `wet` is false for a camera -- you cannot walk on
   * a lake but you can certainly look across one.
   */
  blocked(x: number, z: number, pad: number, above = 0, wet = true): boolean {
    if (this.empty) return false;
    // A fence stops feet, never a lens (`wet` is false for the camera).
    if (wet && this.bound && this.outOfBounds(x, z, pad)) return true;
    const k = cellKey(x, z);
    for (const s of this.solids.get(k) ?? []) {
      if (s.h <= above) continue;
      // `wet` is false only when the question is about the LENS rather than the feet,
      // and a lens can see past the things a body cannot walk through.
      if (!wet && s.seeThrough) continue;
      const d = s.r + pad;
      if ((x - s.x) ** 2 + (z - s.z) ** 2 < d * d) return true;
    }
    if (!wet) return false;
    // A bridge is the water's exception, so it is asked first: without it a river
    // across a path is a wall, and the path stops being a path.
    for (const b of this.bridges.get(k) ?? []) {
      if ((x - b.x) ** 2 + (z - b.z) ** 2 < b.r * b.r) return false;
    }
    for (const l of this.lakes.get(k) ?? []) {
      if (x < l.minX || x > l.maxX || z < l.minZ || z > l.maxZ) continue;
      if (pointInPolygon([x, z], l.ring)) return true;
    }
    return false;
  }
}

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
  /** Seconds spent with every way forward blocked. Past a second, they go elsewhere. */
  stuck: number;
  /** Which way round the thing in front: +1 or -1, and how long that choice holds. */
  dodge: 1 | -1;
  dodgeFor: number;
  /** Units a second, set by the person holding the stick. Zero means nobody is. */
  driveX: number;
  driveZ: number;
  partner: string | null;
  bubble: Bubble;
  ring: boolean;
  /** A live person's facing, walking and sitting, as the server last said (`live`). */
  liveFacing?: number;
  liveMoving?: boolean;
  liveSitting?: boolean;
  /** Not drawn. */
  hidden?: boolean;
  /** The bench seat they are walking to, or sitting on (`sitOn`). */
  seat?: { x: number; z: number; facing: number };
  /** Seconds left to reach that seat on foot before they are put on it (BENCH_SECS). */
  seatWait?: number;
  /**
   * Mid sky drop (flight.ts): the flight and how far into it, in ms. Your own from
   * `flyTo`; somebody else's as their phone sends it (`live`). Nothing else moves them
   * until they land.
   */
  fly?: { f: Flight; ms: number; done?: (() => void) | undefined };
  /** How far off the ground: up in the sky drop, 0 (or unset) otherwise. */
  lift?: number;
  /** On a bicycle (bike.ts): drawn on one, pedalling as they go, and wider to steer. */
  riding?: boolean;
}

export interface AgentInput {
  ref: string; kind: AgentKind; seed: number; ghost?: boolean; look?: Look;
  /** Omitted: leave the area alone. null: the central tile. */
  area?: string | null;
}

/** The crowd test's refs (addCrowd). Never a roster ref, which is 32 hex characters. */
export const CROWD = 'crowd-';
/** How many walkers the crowd test adds, in the park or the city (development builds). */
export const CROWD_TEST = 1000;
export const isCrowd = (ref: string): boolean => ref.startsWith(CROWD);

/** Plaza radius in scene units, for the town with no map. */
export const PLAZA = 8;
/** The fountain's footprint. Nobody is placed inside it. */
const FOUNTAIN = 2.2;
/** Where YOUR agent stands with no map: front of the fountain, nearest the camera. */
export const HOME: readonly [number, number] = [0, PLAZA * 0.55];
/**
 * HOW FAST A PERSON GOES, in scene units a second, against an agent drawn about 0.24
 * units tall (PERSON in canvas.tsx). A real person is 1.7 m and walks 1.4 m/s, which
 * is 0.8 of their own height a second -- so a stroll here is 0.2, and everything else
 * is a multiple of that.
 *
 * All three were far too quick. A stroll ran at eleven kilometres an hour, and the
 * trip cap below turned a long wander into a hundred and sixty: "why are all the
 * agents speedrunning . they are walking at around 200kmph" (2026-09-22).
 */
const WALK = 0.2;
/** A live person reaches where the server put them in about this many seconds. */
export const LIVE_CATCH_UP = 0.25;
/**
 * HOW LONG GETTING TO A BENCH MAY TAKE (the founder, 2026-10-03: "make sure it doesn't
 * take them more than 3 secs to get to a bench"). Walked at whatever pace gets them
 * there in this -- brisk, up to a run -- and a bench further than a run in this time is
 * stepped to by magic, in a puff of smoke. Somebody slowed on the way (a hedge, a
 * crowd) is put on the seat when it is up, the same way.
 */
export const BENCH_SECS = 2.6;
/** The longest time a walk to a bench is allowed before the magic takes over. */
export const BENCH_MAX_SECS = 3;
/** Further than this and they are put there: a gap that size is a lost connection, not a walk. */
export const LIVE_JUMP = 3;
/** The spot in front of a bench seat, where somebody stands to sit down or on getting up. */
const frontOf = (seat: { x: number; z: number; facing: number }): [number, number] =>
  [seat.x + Math.sin(seat.facing) * 0.13, seat.z + Math.cos(seat.facing) * 0.13];
/** A seed from a ref, so the same person walks in the same step on every phone. */
const seedOf = (ref: string): number => (parseInt(ref.slice(0, 8), 16) >>> 0) || 1;
const HURRY = 0.38;
/** The fastest anybody moves: a run, not a car. */
const RUN_MAX = 0.84;
/**
 * A VISIT has a deadline and a wander does not.
 *
 * When a round sends your agent to meet somebody the picture has to keep up with the
 * conversation, so a long approach is hurried -- but only up to a run. Wandering is
 * just wandering: it takes as long as it takes, and capping it by distance is what
 * had everybody sprinting between the far corners of a park.
 */
const TRIP_SECS = 10;
const ARRIVE = 0.08;
/** How far apart two agents stand to talk: close enough to be talking. */
const TOGETHER = 0.3;
/** As far as anybody wanders in one go before standing about again. */
const STROLL = 7;
/**
 * How wide a person is on the ground, for walking around things.
 *
 * A PERSON, NOT A CAR. This was 0.09 when a unit was a couple of metres and it was
 * never looked at again; in Cubbon Park a unit is 8.1 m, so it quietly meant a radius
 * of 73 cm -- a person a metre and a half across, barging round the park inside an
 * invisible barrel. Stacked on a bush's own oversized collider it closed gaps you
 * could plainly see through: the founder stood between a tree and a bush, with a
 * metre of daylight on the screen, and could not walk between them (2026-09-23).
 *
 * The agents are 1.70 m tall here and about 50 cm across the shoulders, so the radius
 * is 25 cm; this is 28, which leaves a couple of centimetres so nobody's elbow enters
 * a wall. Exported because the guards measure against it, and a constant the tests
 * copy by hand is a constant that drifts.
 */
export const FOOT = 0.035;
/**
 * How wide somebody on a bicycle is on the ground: a bike is 1.6 m long, so its wheels
 * reach most of a metre from the rider's middle. A little under that, as with FOOT, so
 * a gap the bike plainly fits through is not refused.
 */
export const RIDE_FOOT = 0.06;
/** How far off the straight line an agent will look for a way past, in radians. */
const DETOURS = [0.4, 0.85, 1.35, 1.9, 2.4] as const;
/** How long an agent keeps going round a building the same way once it has committed. */
const DODGE_SECS = 1.6;
const PARTING_SECS = 3;
/**
 * How long two agents stand together, dots over their heads, before they part.
 *
 * It used to be however long the conversation took on the server -- minutes -- and
 * the sim simply waited for the verdict. A round holds no conversation now and its
 * cues arrive within a second, often before your agent has reached the first person,
 * so the square keeps its own clock for the moment itself.
 */
const TOGETHER_SECS = 2;
/**
 * Out of sight, a walker takes one step in this many frames (WorldSim.step, which
 * counts frames round 12: keep this a number that divides it).
 */
export const FAR_EVERY = 4;
/**
 * How far behind the camera somebody still counts as in sight: a little, so the
 * people at your own shoulder -- the camera sits behind you -- and anyone a small turn
 * would show are stepped every frame.
 */
export const BEHIND = 2;
/** The two agents of a meeting, in either order. */
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
/**
 * A spot is a place, not a pixel: two people sent to the same one do not overlap.
 *
 * Scaled to the neighbourhood, because a tile has twenty-four spots and can hold far
 * more than twenty-four people -- fifty-one of them stood in one heap in MG Road on
 * the phone (2026-09-22). Spreading them over the tile they are actually in is honest
 * and is the difference between a crowd crush and a neighbourhood.
 */
const JITTER_MIN = 0.35;
const JITTER_MAX = 1.5;
const jitterFor = (radius: number) => Math.min(JITTER_MAX, Math.max(JITTER_MIN, radius * 0.24));
/** 137.5°, the angle a sunflower uses. Consecutive placements never line up. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

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
  /**
   * Everybody, in that order, as one array reused until somebody arrives or leaves.
   * Building it fresh on every call was a thousand-element array twice a frame with
   * the park's test crowd, for the collector to clear up.
   */
  private list: SimAgent[] | null = null;
  /** Frames counted round, to say whose turn it is to step (see step). */
  private tick = 0;
  /** Visits a visitor has been asked to make while already on one, in order. */
  private readonly visits = new Map<string, string[]>();
  /**
   * Meetings the server has finished (the card is written) that the square has not
   * played out yet. A pair in here parts as soon as it has stood together for
   * TOGETHER_SECS -- however far along the walk it was when the cue arrived.
   */
  private readonly metPairs = new Set<string>();
  /** How many people have been placed in each tile, so the next one goes somewhere new. */
  private readonly placed = new Map<string, number>();
  private map: MapSpots | null = null;
  private ground = new Ground(null);
  /** Bench only: agents start and finish conversations on their own. */
  private autoplay = false;
  private autoClock = 0;

  constructor(seed = 1) {
    this.rnd = lcg(seed);
  }

  /** The city to stand in. Set once, before anybody is added; null is the plaza. */
  setMap(map: MapSpots | null): void {
    this.map = map;
    this.ground = new Ground(map);
  }

  /** For tests and the bench: is this a place somebody could stand? */
  standable(x: number, z: number): boolean {
    return !this.ground.blocked(x, z, FOOT);
  }

  /**
   * Is the view clear at this point, for a lens `above` the ground and `pad` wide?
   * Roofs below it do not count and water never does.
   */
  seeThrough(x: number, z: number, above: number, pad: number): boolean {
    return !this.ground.blocked(x, z, pad, above, false);
  }

  /**
   * Take the wheel. `vx`/`vz` are world units a second, straight from the stick;
   * (0, 0) lets go and leaves them standing where they are.
   *
   * A driven agent is not steered by anything else -- no wandering, no walking home
   * on the next roster -- but it still cannot walk through a wall, and it still gets
   * called on when a round sends somebody over.
   */
  drive(ref: string, vx: number, vz: number): void {
    const a = this.byRef.get(ref);
    if (!a) return;
    a.driveX = vx; a.driveZ = vz;
  }

  /** Is somebody holding the stick for this agent? */
  driven(ref: string): boolean {
    const a = this.byRef.get(ref);
    return !!a && (a.driveX !== 0 || a.driveZ !== 0);
  }

  agents(): readonly SimAgent[] {
    if (!this.list) {
      const out: SimAgent[] = [];
      for (const ref of this.order) {
        const a = this.byRef.get(ref);
        if (a) out.push(a);
      }
      this.list = out;
    }
    return this.list;
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
      // Here in person: the server moves them, not the roster.
      if (have?.kind === 'live') continue;
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
          // Not while somebody is walking them by hand: a poll must not yank the
          // agent out from under a thumb.
          if (have.driveX === 0 && have.driveZ === 0 && (have.state === 'idle' || have.state === 'walking')) {
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
        state: 'idle', wait: 1 + this.rnd() * 4, stuck: 0, dodge: 1, dodgeFor: 0,
        driveX: 0, driveZ: 0, partner: null, bubble: null, ring: false,
      });
      this.order.push(ref);
      this.list = null;
    }
  }

  /**
   * A real person in the park, where the server last said they were. The first time,
   * they appear there; after that they glide to it (LIVE_CATCH_UP) -- the server says
   * a few times a second, and a jump each time would look like a stutter. Somebody the
   * square was drawing as an agent becomes the person: one body each, never two.
   */
  live(
    ref: string, look: Look, x: number, z: number, facing: number, moving: boolean, sitting = false, riding = false,
    fly?: ParkFly,
  ): void {
    const have = this.byRef.get(ref);
    if (have) {
      if (have.kind !== 'live') {
        have.kind = 'live'; have.ghost = false; have.partner = null; have.bubble = null; have.ring = false;
        this.visits.delete(ref);
      }
      have.look = look; have.liveFacing = facing; have.liveMoving = moving; have.liveSitting = sitting;
      have.riding = riding;
      if (fly) this.flying(have, fly);
      // Mid-air here, landed on their own phone: this one lands too, in its own time
      // (a drop is half a second), where they did.
      if (have.fly) { have.tx = have.fly.f.tx; have.tz = have.fly.f.tz; return; }
      have.tx = x; have.tz = z;
      // One steady pace per word from the server, set to arrive as the next one does:
      // closing a share of the gap each frame instead eased in, and was always late.
      have.speed = Math.max(WALK, Math.hypot(x - have.x, z - have.z) / LIVE_CATCH_UP);
      return;
    }
    const a: SimAgent = {
      ref, kind: 'live', seed: seedOf(ref), ghost: false, look, area: null, x, z, tx: x, tz: z, speed: WALK,
      facing, state: moving ? 'walking' : 'idle', wait: 0, stuck: 0, dodge: 1, dodgeFor: 0,
      driveX: 0, driveZ: 0, partner: null, bubble: null, ring: false, liveFacing: facing, liveMoving: moving,
      liveSitting: sitting, riding,
    };
    if (fly) this.flying(a, fly);
    this.byRef.set(ref, a);
    this.order.push(ref);
    this.list = null;
  }

  /**
   * Somebody else's flight, as their phone says it is going: a new one starts where it
   * is; the same one carries on in this phone's own time, pulled back into step only
   * when the two drift apart by more than a few frames.
   */
  private flying(a: SimAgent, fly: ParkFly): void {
    const f = a.fly?.f;
    if (f && f.fx === fly.fx && f.fz === fly.fz && f.tx === fly.tx && f.tz === fly.tz) {
      if (Math.abs(a.fly!.ms - fly.t) > 300) a.fly!.ms = fly.t;
      return;
    }
    a.fly = { f: { fx: fly.fx, fz: fly.fz, tx: fly.tx, tz: fly.tz }, ms: fly.t };
    a.seat = undefined;
    this.flyStep(a, 0);
  }

  /**
   * THE SKY DROP (flight.ts): up on a beam, over the trees, down beside (tx, tz). Off a
   * bench and off a bicycle first; the stick does nothing until you land, and `done` is
   * called then. A second flight while one is under way is ignored. False if not here.
   */
  flyTo(ref: string, tx: number, tz: number, done?: () => void): boolean {
    const a = this.byRef.get(ref);
    if (!a || a.fly) return false;
    if (a.seat) this.standUp(ref);
    a.seat = undefined;
    a.riding = false;
    a.driveX = 0; a.driveZ = 0;
    a.fly = { f: { fx: a.x, fz: a.z, tx, tz }, ms: 0, done };
    return true;
  }

  /**
   * A few brisk steps to (tx, tz): somebody who said yes standing near enough to walk to
   * (flight.ts FLY_MIN). The stick takes over if a thumb goes on it. False if not here.
   */
  walkTo(ref: string, tx: number, tz: number): boolean {
    const a = this.byRef.get(ref);
    if (!a || a.fly) return false;
    if (a.seat) this.standUp(ref);
    a.driveX = 0; a.driveZ = 0;
    this.setTarget(a, tx, tz, WALK * 1.8);
    a.state = 'walking';
    return true;
  }

  /** Whether somebody is up in a sky drop right now. */
  inFlight(ref: string): boolean {
    return !!this.byRef.get(ref)?.fly;
  }

  /** A flight's frame: where it says, facing along it; landed, back on the ground. */
  private flyStep(a: SimAgent, dt: number): void {
    const fl = a.fly!;
    fl.ms += dt * 1000;
    const pose = flightAt(fl.f, fl.ms);
    a.x = pose.x; a.z = pose.z; a.tx = pose.x; a.tz = pose.z;
    a.lift = pose.y;
    a.facing = pose.heading;
    a.state = 'idle'; a.stuck = 0;
    if (fl.ms < flightMs(fl.f)) return;
    a.fly = undefined;
    a.lift = 0;
    a.wait = 2;
    fl.done?.();
  }

  /**
   * Put somebody down here, now, standing: where the park says you arrive (park.arrived).
   */
  place(ref: string, x: number, z: number, facing?: number): void {
    const a = this.byRef.get(ref);
    if (!a) return;
    a.x = x; a.z = z; a.tx = x; a.tz = z; a.driveX = 0; a.driveZ = 0; a.stuck = 0;
    if (facing !== undefined) a.facing = facing;
    if (a.state === 'walking') a.state = 'idle';
  }

  /**
   * On a bicycle or off it. Getting on stands you up off a bench first; nothing else
   * changes -- you are where you were, facing where you faced.
   */
  setRiding(ref: string, on: boolean): void {
    const a = this.byRef.get(ref);
    if (!a || !!a.riding === on) return;
    if (on && a.seat) this.standUp(ref);
    a.riding = on;
  }

  /**
   * Walk to a bench and sit on it: to the spot in front of the seat at a walk -- the
   * bench itself is solid, nobody walks into it -- then onto the seat, facing out.
   * Off the bicycle first: nobody sits on a bench astride one.
   */
  sitOn(ref: string, seat: { x: number; z: number; facing: number }): void {
    const a = this.byRef.get(ref);
    if (!a) return;
    a.riding = false;
    const [fx, fz] = frontOf(seat);
    a.driveX = 0; a.driveZ = 0;
    a.seat = seat;
    // Briskly, at the least: somebody is waiting to talk (at a stroll, a bench forty
    // metres off took half a minute on the phone). Faster the further, up to a run --
    // and further than a run gets there in BENCH_SECS, by magic.
    const d = Math.hypot(fx - a.x, fz - a.z);
    if (d > RUN_MAX * BENCH_SECS) { this.magicSeat(a); return; }
    this.setTarget(a, fx, fz, Math.min(RUN_MAX, Math.max(WALK * 1.8, d / BENCH_SECS)));
    a.state = 'walking';
    a.seatWait = BENCH_MAX_SECS;
  }

  /** Onto their seat at once: a puff where they stood, and one on the bench. */
  private magicSeat(a: SimAgent): void {
    const seat = a.seat;
    if (!seat) return;
    puff(a.x, a.z);
    a.x = seat.x; a.z = seat.z; a.tx = seat.x; a.tz = seat.z; a.facing = seat.facing;
    a.state = 'sitting'; a.seatWait = undefined; a.stuck = 0;
    puff(seat.x, seat.z);
  }

  /** Up off the bench, and a step forward off it, standing. */
  standUp(ref: string): void {
    const a = this.byRef.get(ref);
    if (!a?.seat) return;
    const seat = a.seat;
    a.seat = undefined;
    a.seatWait = undefined;
    if (a.state === 'sitting') {
      const [fx, fz] = frontOf(seat);
      a.x = fx; a.z = fz; a.tx = fx; a.tz = fz;
      a.state = 'idle'; a.wait = 2;
    }
  }

  /** Gone from the park: the person goes (the roster may bring their agent back). */
  unlive(ref: string): void {
    if (this.byRef.get(ref)?.kind === 'live') this.remove(ref);
  }

  remove(ref: string): void {
    if (!this.byRef.delete(ref)) return;
    this.visits.delete(ref);
    for (const k of [...this.metPairs]) if (k.split('|').includes(ref)) this.metPairs.delete(k);
    const i = this.order.indexOf(ref);
    if (i >= 0) this.order.splice(i, 1);
    this.list = null;
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
   * calls on them in order, each after parting from the one before.
   */
  meet(a: string, b: string): void {
    const A = this.byRef.get(a);
    const B = this.byRef.get(b);
    if (!A || !B) return;
    if (A.partner === b) return;
    if (A.state === 'approaching' || A.state === 'talking' || A.state === 'parting') {
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
    this.setTarget(A, B.x + (dx / len) * TOGETHER, B.z + (dz / len) * TOGETHER, HURRY, true);
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

  /**
   * `a` and `b` have met: their card is written. Recorded, not acted on at once --
   * the pair parts once it has actually stood together (see `talking` in stepOne),
   * and then both show the same small mark for a few seconds. The same for every
   * pair: there is nothing about how it went to show.
   */
  parted(a: string, b: string): void {
    if (!this.byRef.has(a) || !this.byRef.has(b)) return;
    this.metPairs.add(pairKey(a, b));
  }

  /** Both humans said yes: a ring at both their feet, and they stay together a while. */
  introduced(a: string, b: string): void {
    for (const ref of [a, b]) {
      const p = this.byRef.get(ref);
      if (!p) continue;
      p.state = 'introduced'; p.ring = true; p.bubble = null; p.wait = 8;
    }
  }

  /** The roster stopped saying they were talking, with no cue: just stand down. */
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
   * The round is over, however it ended: nobody else is to be visited. Whoever `ref`
   * was with is left to wander. A round that failed used to leave your agent standing
   * in a conversation for ever, dots and all.
   *
   * EXCEPT MEETINGS THAT HAPPENED. A round finishes in about a second now, so its
   * `done` arrives while your agent is still walking to the first of the people it
   * met. Those meetings are real -- their cards exist -- so the visits to them are
   * kept and played out; only visits nobody finished are dropped.
   */
  recall(ref: string): void {
    const kept = (this.visits.get(ref) ?? []).filter((b) => this.metPairs.has(pairKey(ref, b)));
    if (kept.length) this.visits.set(ref, kept); else this.visits.delete(ref);
    const a = this.byRef.get(ref);
    if (a?.state === 'parting') return;
    if (a?.partner && this.metPairs.has(pairKey(ref, a.partner))) return;
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

  /**
   * Move everybody on by `dt` seconds.
   *
   * `near` is the camera: where it stands, how far it can see, and which way it looks
   * along the ground (fx, fz, a unit vector; both 0 for "every way"). Somebody it
   * cannot see -- behind the park's mist, or more than BEHIND units behind the camera
   * -- takes one step in FAR_EVERY frames, a step FAR_EVERY frames long: the same walk,
   * a quarter of the work. With the park's thousand-person test crowd the sim was 7.5
   * ms of a 35 ms frame on the Seeker (debug build, 2026-09-28), nearly all of it
   * people nobody could see; with the mist alone it was still 4 ms (2026-09-29),
   * because half the people inside it are behind you. Anyone being driven by a thumb
   * is always stepped every frame.
   *
   * `every` is how often the people IN sight are stepped: 1, every frame, unless the
   * camera is so far out that a step would move them less than a pixel -- the whole
   * city on the map, where 1,000 walkers were 18 ms of a 35 ms frame and each of them
   * two pixels tall (the Seeker, 2026-09-29). Never less often than FAR_EVERY.
   */
  step(dt: number, near?: { x: number; z: number; r: number; fx?: number; fz?: number; every?: number }): void {
    const all = this.agents();
    // Round 12, which 1, 2, 3 and 4 all divide, so every rate comes round evenly.
    this.tick = (this.tick + 1) % 12;
    const beat = this.tick % FAR_EVERY;
    const r2 = near ? near.r * near.r : Infinity;
    const fx = near?.fx ?? 0;
    const fz = near?.fz ?? 0;
    const every = Math.max(1, Math.min(FAR_EVERY, Math.floor(near?.every ?? 1)));
    const seen = this.tick % every;
    for (let i = 0; i < all.length; i++) {
      const a = all[i]!;
      if (near && a.driveX === 0 && a.driveZ === 0) {
        const dx = a.x - near.x;
        const dz = a.z - near.z;
        if (dx * dx + dz * dz > r2 || dx * fx + dz * fz < -BEHIND) {
          if (i % FAR_EVERY === beat) this.stepOne(a, dt * FAR_EVERY);
          continue;
        }
        if (every > 1) {
          if (i % every === seen) this.stepOne(a, dt * every);
          continue;
        }
      }
      this.stepOne(a, dt);
    }
    if (this.autoplay) this.stepAutoplay(dt);
  }

  private stepOne(a: SimAgent, dt: number): void {
    if (a.fly) { this.flyStep(a, dt); return; }
    if (a.kind === 'live') { this.glide(a, dt); return; }
    // Somebody is driving: their hand beats the state machine. They still face where
    // they push even when a wall stops them, which is what tells you it is a wall.
    if (a.driveX !== 0 || a.driveZ !== 0) {
      // The stick on a bench: up first, then walk.
      if (a.seat) this.standUp(a.ref);
      a.facing = Math.atan2(a.driveX, a.driveZ);
      this.push(a, a.driveX * dt, a.driveZ * dt);
      a.state = 'walking'; a.tx = a.x; a.tz = a.z; a.stuck = 0;
      return;
    }
    switch (a.state) {
      case 'idle':
        // Your own agent stays put between outings, so it is always where you left it
        // and always the same one to tap. Everybody else drifts about.
        if (a.kind === 'you') break;
        a.wait -= dt;
        if (a.wait <= 0) { this.wander(a); a.state = 'walking'; }
        break;
      case 'walking':
        if (this.moveToward(a, dt)) {
          // In front of their bench: onto the seat, facing out from it.
          if (a.seat) { a.x = a.seat.x; a.z = a.seat.z; a.tx = a.x; a.tz = a.z; a.facing = a.seat.facing; a.state = 'sitting'; a.seatWait = undefined; }
          else { a.state = 'idle'; a.wait = 4 + this.rnd() * 5; }
        } else if (a.seat && a.seatWait !== undefined) {
          // Held up on the way: past BENCH_MAX_SECS, onto the seat by magic.
          a.seatWait -= dt;
          if (a.seatWait <= 0) this.magicSeat(a);
        }
        break;
      case 'sitting':
        break;
      case 'approaching': {
        const p = a.partner ? this.byRef.get(a.partner) : undefined;
        if (!p) { this.lost(a); break; }
        const arrived = this.moveToward(a, dt);
        if (arrived && Math.hypot(p.x - a.x, p.z - a.z) <= TOGETHER + ARRIVE) {
          a.state = 'talking'; a.bubble = 'dots'; a.wait = TOGETHER_SECS;
          a.facing = Math.atan2(p.x - a.x, p.z - a.z);
        }
        break;
      }
      case 'talking': {
        // Held until the pair's meeting is over on the server (parted()) AND they have
        // stood together a moment; the bench's autoplay calls parted() itself.
        const p = a.partner ? this.byRef.get(a.partner) : undefined;
        if (a.partner && !p) { this.lost(a); break; }
        a.wait -= dt;
        if (p && a.wait <= 0 && this.metPairs.delete(pairKey(a.ref, p.ref))) {
          for (const x of [a, p]) { x.state = 'parting'; x.bubble = 'met'; x.wait = PARTING_SECS; }
        }
        break;
      }
      case 'parting':
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
   * A live person closes on where the server last put them, at the pace `live` set --
   * arriving as the next word does (a quarter of a second), never slower than a walk --
   * and straight: their own phone already kept them out of the walls.
   */
  private glide(a: SimAgent, dt: number): void {
    const dx = a.tx - a.x, dz = a.tz - a.z;
    const d = Math.hypot(dx, dz);
    if (d > LIVE_JUMP) { a.x = a.tx; a.z = a.tz; }
    else if (d > 1e-4) {
      const step = Math.min(d, a.speed * dt);
      a.x += (dx / d) * step; a.z += (dz / d) * step;
    }
    const moving = a.liveMoving === true || d > 0.01;
    // Sat down once they are there: on a bench beside somebody.
    a.state = a.liveSitting && d <= 0.01 ? 'sitting' : moving ? 'walking' : 'idle';
    // Facing where they are going while they go; where their own phone says, stood still.
    a.facing = moving && d > 0.01 ? Math.atan2(dx, dz) : a.liveFacing ?? a.facing;
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

  /**
   * A step taken by hand, sliding along whatever it runs into: the full move first,
   * then each axis alone. Sliding is what a wall should feel like under a thumb --
   * stopping dead reads as the controls having broken.
   */
  private push(a: SimAgent, dx: number, dz: number): void {
    const pad = a.riding ? RIDE_FOOT : FOOT;
    const free = (x: number, z: number) => !this.ground.blocked(x, z, pad);
    if (free(a.x + dx, a.z + dz)) { a.x += dx; a.z += dz; return; }
    if (dx !== 0 && free(a.x + dx, a.z)) { a.x += dx; return; }
    if (dz !== 0 && free(a.x, a.z + dz)) { a.z += dz; return; }
    // Wedged: let them out the way they came in rather than trap them.
    const out = this.ground.escape(a.x, a.z, pad);
    if (out) { a.x += out[0] * Math.hypot(dx, dz); a.z += out[1] * Math.hypot(dx, dz); }
  }

  /**
   * Somewhere in their own neighbourhood: you go home, everybody else to a spot --
   * and by preference a spot within strolling distance, because a park is somewhere
   * you drift about in rather than march from one end of to the other.
   */
  private wander(a: SimAgent): void {
    if (a.kind === 'you') { const [hx, hz] = this.home(a.area); this.setTarget(a, hx, hz, WALK); return; }
    let pick = this.spot(a.area);
    for (let i = 0; i < 3 && Math.hypot(pick[0] - a.x, pick[1] - a.z) > STROLL; i++) pick = this.spot(a.area);
    this.setTarget(a, pick[0], pick[1], WALK);
  }

  /**
   * Aim at a point. `hurried` is for a visit, which has somewhere to be: the further
   * it is the quicker they go, up to a run. Everything else keeps its own pace.
   */
  private setTarget(a: SimAgent, tx: number, tz: number, base: number, hurried = false): void {
    a.tx = tx; a.tz = tz;
    a.speed = hurried
      ? Math.min(RUN_MAX, Math.max(base, Math.hypot(tx - a.x, tz - a.z) / TRIP_SECS))
      : base;
  }

  /**
   * A step toward the target, around whatever is in the way. Returns true on arrival.
   *
   * People used to walk through buildings, trees and lakes, because nothing in the
   * sim knew they were there ("add physics please", 2026-09-22). They now try straight
   * ahead, then further and further off it, and take the first heading that is clear.
   *
   * THE SIDE IS STICKY, and that is the whole trick. Trying left and right alternately
   * looks reasonable and does not work: pressed against a wall, an agent finds a gap
   * to its left, steps into it, and from there the first clear heading is back to the
   * right -- so it shuffles on the spot for ever, which is exactly what the test
   * caught. Committing to one way round for a second and a half turns that shuffle
   * into somebody walking round a building.
   *
   * Two escapes matter: somebody standing inside something walks straight out of it
   * (a roster may place anyone anywhere), and somebody genuinely boxed in gives up on
   * this target and wants to be somewhere else rather than standing still for ever.
   */
  private moveToward(a: SimAgent, dt: number): boolean {
    const dx = a.tx - a.x;
    const dz = a.tz - a.z;
    const d = Math.hypot(dx, dz);
    if (d <= ARRIVE) return true;
    const stepLen = Math.min(d, a.speed * dt);
    const base = Math.atan2(dx, dz);
    const go = (ang: number): boolean => {
      const nx = a.x + Math.sin(ang) * stepLen;
      const nz = a.z + Math.cos(ang) * stepLen;
      if (this.ground.blocked(nx, nz, FOOT)) return false;
      a.x = nx; a.z = nz; a.facing = ang; a.stuck = 0;
      return true;
    };
    a.dodgeFor = Math.max(0, a.dodgeFor - dt);

    // Standing in something: out, the shortest way, whatever the target says.
    const out = this.ground.escape(a.x, a.z, FOOT);
    if (out) {
      a.x += out[0] * stepLen; a.z += out[1] * stepLen;
      a.facing = Math.atan2(out[0], out[1]);
      return false;
    }
    if (go(base)) { a.dodgeFor = 0; return false; }
    const sides: readonly (1 | -1)[] = a.dodgeFor > 0 ? [a.dodge, (-a.dodge) as 1 | -1] : [1, -1];
    for (const side of sides) {
      for (const off of DETOURS) {
        if (!go(base + off * side)) continue;
        a.dodge = side; a.dodgeFor = DODGE_SECS;
        return false;
      }
    }
    // Every way is blocked: wait a moment, then want to be somewhere else.
    a.stuck += dt;
    if (a.stuck > 1.2) {
      a.stuck = 0; a.dodgeFor = 0;
      // Boxed in on the way to a bench: onto it by magic, not off somewhere else -- the
      // seat would have snapped them back onto it from wherever they ended up.
      if (a.seat) { this.magicSeat(a); return false; }
      this.wander(a);
    }
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
      // EVENLY, NOT AT RANDOM. Picking one of twenty-four spots at random for each of
      // fifty-one people leaves half the tile empty and puts four people on one
      // corner -- the birthday problem, and on the phone it read as a crowd crush
      // (2026-09-22). Counting instead means every spot is used before any is used
      // twice, and the second and third person at a spot stand off it at the golden
      // angle, so a full tile is a scatter rather than a heap.
      const key = area ?? this.map?.central ?? '';
      const n = this.placed.get(key) ?? 0;
      this.placed.set(key, n + 1);
      const s = tile.spots[n % tile.spots.length]!;
      const ring = Math.floor(n / tile.spots.length);
      const j = jitterFor(tile.radius);
      const ang = n * GOLDEN;
      let r = ring === 0 ? j * 0.3 * this.rnd() : j * (0.45 + 0.4 * Math.min(ring, 3));
      // Never over the edge and never inside a building: a ring wide enough to spread a
      // full tile is wide enough to put somebody in the neighbourhood next door or on
      // a roof. Halve it until it lands, then give up and use the spot, which the
      // build script already put on a street.
      for (let t = 0; t < 5; t++) {
        const p: Pt = [s[0] + Math.cos(ang) * r, s[1] + Math.sin(ang) * r];
        const inside = !tile.polygon.length || pointInPolygon(p, tile.polygon);
        if (inside && !this.ground.blocked(p[0], p[1], FOOT)) return [p[0], p[1]];
        r /= 2;
      }
      return [s[0], s[1]];
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

  // ── The park's crowd test ────────────────────────────────────────────────

  /**
   * `n` walkers for the park's frame-rate test (the founder, 2026-09-28: "put 1000
   * people in the park, I want to see how well it renders"). Development builds
   * only, from a chip in the park (hud.tsx). Every fourth is a practice ghost, as in
   * the bench, because see-through bodies cost more to draw and the pool is full of
   * them. They wander the park's spots like anybody else; refs start CROWD, so the
   * roster never mistakes them for people and never removes them.
   */
  addCrowd(n: number, area: string | null | readonly (string | null)[]): void {
    const list: AgentInput[] = [];
    for (let i = 0; i < n; i++) {
      const seed = Math.floor(this.rnd() * 1e9);
      // A list of areas is taken in turn: the city's test spreads over all thirty.
      const where = typeof area === 'string' || area === null ? area : area[i % area.length] ?? null;
      list.push({ ref: `${CROWD}${i}`, kind: i % 4 === 0 ? 'practice' : 'stranger', seed, look: lookFor(seed), area: where });
    }
    this.upsert(list);
  }

  /** Everybody `addCrowd` put here, gone at once. Nobody else is touched. */
  removeCrowd(): void {
    const keep = this.order.filter((ref) => !isCrowd(ref));
    for (const ref of this.order) if (isCrowd(ref)) { this.byRef.delete(ref); this.visits.delete(ref); }
    this.order.length = 0;
    this.order.push(...keep);
    this.list = null;
  }

  // ── Bench ────────────────────────────────────────────────────────────────

  /**
   * A town of `n` for the frame-rate bench: you, strangers, every fourth one a practice
   * ghost, and meetings starting and ending by themselves so the bubbles are on
   * screen at a realistic rate. On a map the town is spread over the
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
      // About one in thirteen ends in the ring, as it did when a quarter "got on" and
      // three in ten of those were introduced -- so the bench keeps drawing rings.
      if (a.partner && this.rnd() < 0.075) this.introduced(a.ref, a.partner);
      else if (a.partner) this.parted(a.ref, a.partner);
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
