/**
 * The garden: the place you walk in, as opposed to the city you look at.
 *
 * The map is Bengaluru drawn from OpenStreetMap -- thirty neighbourhoods, real roads,
 * real lakes -- and it answers "where is everyone". It is a map, and down at head
 * height a map looks like a map: grey blocks on grey ground with nothing alive in it.
 * The founder put the two side by side and asked for the other thing (2026-09-22): a
 * place, with a path and trees and water and a sky.
 *
 * So there are two worlds. The city is still the city. "Walk around" opens this
 * instead: a park laid out by hand -- well, by seed -- with a path wandering through
 * it, a pond, trees in clumps, stone lanterns along the way, and the people who are
 * near you standing in it. One garden per neighbourhood, seeded by its id, so
 * Koramangala's is not Whitefield's and neither changes between visits.
 *
 * Pure: no three, no react-native. The mesh that draws this is ./garden-mesh.ts and
 * the collision comes free, because the shape it hands the sim is the same MapSpots
 * the city uses.
 */
import type { MapSpots, Pt, Solid } from './sim';

export interface Tree { x: number; z: number; scale: number; lean: number; kind: number }
export interface Tuft { x: number; z: number; scale: number; rot: number }
export interface Prop { x: number; z: number; rot: number; kind: 'lantern' | 'rock' }
export interface Bench { x: number; z: number; rot: number }
export interface Bush { x: number; z: number; scale: number }
export interface Flower { x: number; z: number; scale: number; tint: number }
export interface Reed { x: number; z: number; scale: number; rot: number }
export interface Bridge { x: number; z: number; rot: number; span: number; width: number }
export interface Fountain { x: number; z: number; radius: number }
/** A roofed thing you walk around. Only a real place has any. */
export interface Building { ring: Pt[]; name: string; height: number }
/** A statue, a rock somebody put a plaque on. Real places have these too. */
export interface Landmark { x: number; z: number; kind: string; name: string }

export interface Garden {
  id: string;
  /** How far out you can walk before the fog takes over. */
  radius: number;
  /**
   * The edge of the world, as a ring.
   *
   * A CIRCLE FOR A SEEDED GARDEN AND A SURVEY FOR A REAL ONE, and the difference is
   * the whole reason this is a field rather than `radius` and some trigonometry: a
   * real park is not round, and walking into a wall where the map says there is still
   * park is the single most obvious way a place stops being a place.
   */
  outline: Pt[];
  /** The path, as a smooth polyline from one side to the other. */
  path: Pt[];
  /**
   * Every path, each with its own width.
   *
   * One entry for a seeded garden -- the same line as `path` -- and a hundred and
   * eighty-five for Cubbon Park, where a service road through the middle and a
   * two-person footpath are different things and drawing both at one width is how a
   * park turns into a car park.
   */
  paths: { line: Pt[]; width: number }[];
  pond: Pt[];
  /** Every body of water. `[pond]` for a seeded garden. */
  ponds: Pt[][];
  /** The river's banks as one ring, and the line down the middle of it. */
  river: Pt[];
  riverLine: Pt[];
  /** Where the path crosses the river. Null only if the two never meet. */
  bridge: Bridge | null;
  fountain: Fountain;
  trees: Tree[];
  tufts: Tuft[];
  props: Prop[];
  benches: Bench[];
  bushes: Bush[];
  flowers: Flower[];
  reeds: Reed[];
  /** Where people stand: along the path, off to the sides. */
  spots: Pt[];
  home: Pt;
  /** Empty for a seeded garden; a real place has buildings in it. */
  buildings: Building[];
  landmarks: Landmark[];
}

/** How far out the ground goes. Beyond the radius it rolls into hills and haze. */
export const GARDEN_RADIUS = 26;
/** Four people abreast, against a person about 0.24 tall. At 1.5 it was a road. */
export const PATH_WIDTH = 0.95;
/**
 * HOW BIG EACH THING IS TO WALK INTO, against a person about 0.21 units tall.
 *
 * These were eyeballed in a garden 26 units across that nobody ever walked up to
 * anything in, and at Cubbon Park's scale -- where one unit is about eight metres --
 * they were absurd. You stopped SIX AND A HALF METRES from a tree trunk, four times
 * your own height, and could not get near a bench or a lamp (the founder, on the
 * phone, 2026-09-23: "even though I am a few metres away from the objects, I am not
 * able to walk towards it").
 *
 * So each one is now the size of the thing it stands for, and the tree is the
 * important one: what stops you is the TRUNK. A canopy begins about ten metres up.
 * You walk under a tree.
 */
/** The canopy. Used for PLANTING -- do not put a bench inside a tree -- never to walk into. */
const TREE_R = 0.55;
/** The trunk: the only part of a tree that is in the way. ~0.5 m of bark. */
const TRUNK_R = 0.06;
/** How wide a trunk is drawn at the ground, times the tree's scale (garden-mesh.ts). */
export const TRUNK_BASE = 0.085;
/** A lamp post is a post. */
const PROP_R = 0.07;
/**
 * A bench is 1.55 m long and under half a metre deep (venue-mesh.ts SIZE), so it stops
 * you as a row of five small circles along its length rather than one wide one. The
 * one wide circle (0.11, 89 cm) was sized for the old, bigger bench, and round a long,
 * thin thing it left most of a metre of thin air in front of the seat
 * (tests/no-invisible-skirt.test.ts).
 */
const BENCH_R = 0.024;
/** Where along the bench each circle sits: each overlaps the next. */
const BENCH_ALONG = [-0.07, -0.035, 0, 0.035, 0.07] as const;
/** How far from a bench's middle it reaches, for anything placed near one. */
const BENCH_HALF = 0.07 + BENCH_R;
/**
 * A bush is drawn as a sphere of BUSH_SIZE x its scale (garden-mesh.ts), and this used
 * to be bigger than the leaves, so the bush ended half a metre before what stopped you.
 * Just inside the foliage instead: a hedge is a soft thing and brushing the outer
 * leaves is right. 0.8 of the drawn radius, as it was at the old size.
 */
const BUSH_R = 0.084;
/** Wide enough to read as water you would not step into, narrow enough to bridge. */
const RIVER_W = 2.1;

const lcg = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

/**
 * How far a point is from the nearest path's SURFACE -- its edge, not its middle line --
 * over every path, each at its own width. Negative on a path.
 *
 * For keeping solid things off the paths, so a bicycle can ride every one of them
 * (the founder, 2026-09-29: "the road to ride the bicycle should be fine"). Bucketed
 * by a grid like cubbon.ts's pathIndex, because the park has 185 paths and this is
 * asked about every bench, lamp and bin in it.
 */
export function pathSurface(paths: readonly { line: readonly Pt[]; width: number }[], cell = 4) {
  const grid = new Map<string, number[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  paths.forEach(({ line }, i) => {
    for (let k = 0; k + 1 < line.length; k++) {
      const a = line[k]!, b = line[k + 1]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / cell));
      for (let s = 0; s <= steps; s++) {
        const kk = key(a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps);
        const at = grid.get(kk);
        if (at) { if (!at.includes(i)) at.push(i); } else grid.set(kk, [i]);
      }
    }
  });
  /**
   * The distance to the nearest path surface within `reach` (Infinity past it), the
   * nearest point on that path's middle line, and the path's width.
   */
  return (p: Pt, reach = 2): { edge: number; at: Pt; width: number } => {
    const span = Math.ceil(reach / cell) + 1;
    const cx = Math.floor(p[0] / cell), cz = Math.floor(p[1] / cell);
    let best = { edge: Infinity, at: p, width: 0 };
    const seen = new Set<number>();
    for (let dx = -span; dx <= span; dx++) {
      for (let dz = -span; dz <= span; dz++) {
        for (const i of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const { line, width } = paths[i]!;
          for (let k = 0; k + 1 < line.length; k++) {
            const a = line[k]!, b = line[k + 1]!;
            const ex = b[0] - a[0], ez = b[1] - a[1];
            const len2 = ex * ex + ez * ez;
            const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / len2));
            const q: Pt = [a[0] + ex * t, a[1] + ez * t];
            const edge = Math.hypot(p[0] - q[0], p[1] - q[1]) - width / 2;
            if (edge < best.edge) best = { edge, at: q, width };
          }
        }
      }
    }
    return best;
  };
}

/** A stable number for a neighbourhood id, so one place always grows one garden. */
export function seedOfId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Distance from a point to a polyline, for keeping things off the path. */
function toPath(p: Pt, path: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!; const b = path[i + 1]!;
    const dx = b[0] - a[0]; const dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz)));
  }
  return best;
}

/** Even-odd ray cast, the same rule the rest of the world uses. */
function inRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!; const [xj, zj] = ring[j]!;
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < xj + ((p[1] - zj) * (xi - xj)) / (zi - zj)) inside = !inside;
  }
  return inside;
}

/** Where two segments cross, or null. Used to find the ford the bridge goes over. */
function meet(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const rx = b[0] - a[0]; const rz = b[1] - a[1];
  const sx = d[0] - c[0]; const sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + rx * t, a[1] + rz * t];
}

/** Both banks of a line as one ring: down one side and back up the other. */
function banks(line: readonly Pt[], width: number): Pt[] {
  const half = width / 2;
  const left: Pt[] = []; const right: Pt[] = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)]!; const b = line[Math.min(line.length - 1, i + 1)]!;
    let dx = b[0] - a[0]; let dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const p = line[i]!;
    left.push([p[0] - dz * half, p[1] + dx * half]);
    right.push([p[0] + dz * half, p[1] - dx * half]);
  }
  return [...left, ...right.reverse()];
}

/** Catmull-Rom through the control points, so the path bends rather than dog-legs. */
function smooth(points: readonly Pt[], per = 8): Pt[] {
  if (points.length < 2) return [...points];
  const out: Pt[] = [];
  const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))]!;
  for (let i = 0; i + 1 < points.length; i++) {
    const p0 = at(i - 1); const p1 = at(i); const p2 = at(i + 1); const p3 = at(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per; const t2 = t * t; const t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

/**
 * Grow one garden. Everything is drawn from a single seeded sequence, so the same
 * neighbourhood is the same garden every time it is opened, on every phone.
 */
export function makeGarden(id: string): Garden {
  const rnd = lcg(seedOfId(id));
  const R = GARDEN_RADIUS;

  // The path crosses the whole garden, entering and leaving at opposite-ish edges and
  // wandering on the way. Five control points is enough to feel hand-drawn.
  const enter = rnd() * Math.PI * 2;
  const leave = enter + Math.PI + (rnd() - 0.5) * 1.1;
  const control: Pt[] = [
    [Math.cos(enter) * R * 1.05, Math.sin(enter) * R * 1.05],
    [Math.cos(enter) * R * 0.5 + (rnd() - 0.5) * 8, Math.sin(enter) * R * 0.5 + (rnd() - 0.5) * 8],
    [(rnd() - 0.5) * 7, (rnd() - 0.5) * 7],
    [Math.cos(leave) * R * 0.5 + (rnd() - 0.5) * 8, Math.sin(leave) * R * 0.5 + (rnd() - 0.5) * 8],
    [Math.cos(leave) * R * 1.05, Math.sin(leave) * R * 1.05],
  ];
  const path = smooth(control, 10);

  // A pond, off to one side, out of the path's way.
  const pondAt = enter + Math.PI / 2 + (rnd() - 0.5) * 1.2;
  const pondR = 4 + rnd() * 3;
  const pondC: Pt = [Math.cos(pondAt) * (R * 0.45), Math.sin(pondAt) * (R * 0.45)];
  // Nudged clear of the path before the outline is drawn, so the ring is built once
  // and never edited: Pt is readonly and a pond you can walk across is worse anyway.
  const pondPush = Math.max(0, (PATH_WIDTH * 0.5 + 1.2 + pondR * 0.8) - toPath(pondC, path));
  const cx0 = pondC[0] + Math.cos(pondAt) * pondPush;
  const cz0 = pondC[1] + Math.sin(pondAt) * pondPush;
  const pond: Pt[] = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = pondR * (0.75 + rnd() * 0.45);
    pond.push([cx0 + Math.cos(a) * r, cz0 + Math.sin(a) * r * 0.75]);
  }
  const pondMid: Pt = [cx0, cz0];

  // A river, crossing the way the path does not, so the two meet once and the meeting
  // is worth a bridge. It runs past the pond, which reads as the pond feeding it.
  const across = enter + Math.PI / 2;
  const riverControl: Pt[] = [
    [Math.cos(across) * R * 1.15, Math.sin(across) * R * 1.15],
    [Math.cos(across) * R * 0.55 + (rnd() - 0.5) * 7, Math.sin(across) * R * 0.55 + (rnd() - 0.5) * 7],
    [(rnd() - 0.5) * 6, (rnd() - 0.5) * 6],
    [-Math.cos(across) * R * 0.55 + (rnd() - 0.5) * 7, -Math.sin(across) * R * 0.55 + (rnd() - 0.5) * 7],
    [-Math.cos(across) * R * 1.15, -Math.sin(across) * R * 1.15],
  ];
  const riverLine = smooth(riverControl, 9);
  const river = banks(riverLine, RIVER_W);

  // The ford: the first place the path and the river actually cross. A bridge goes
  // there, and the sim is told the water does not stop you on it.
  let bridge: Bridge | null = null;
  outer: for (let i = 0; i + 1 < path.length; i++) {
    for (let j = 0; j + 1 < riverLine.length; j++) {
      const hit = meet(path[i]!, path[i + 1]!, riverLine[j]!, riverLine[j + 1]!);
      if (!hit) continue;
      const dx = path[i + 1]![0] - path[i]![0]; const dz = path[i + 1]![1] - path[i]![1];
      bridge = { x: hit[0], z: hit[1], rot: Math.atan2(dx, dz), span: RIVER_W + 1.3, width: PATH_WIDTH + 0.22 };
      break outer;
    }
  }

  const inRiver = (p: Pt) => inRing(p, river);
  const onBridge = (p: Pt) => !!bridge && dist(p, [bridge.x, bridge.z]) < bridge.span * 0.6;

  // A clearing with a fountain in it, off the path but beside it, so it is somewhere
  // you arrive at rather than somewhere you pass.
  let fountain: Fountain = { x: 0, z: 0, radius: 1.5 };
  for (let i = 0; i < 300; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 5 + rnd() * (R * 0.55);
    const c: Pt = [Math.cos(a) * r, Math.sin(a) * r];
    const near = toPath(c, path);
    if (near < PATH_WIDTH * 0.5 + 2 || near > 6) continue;
    if (inRiver(c) || inRing(c, pond)) continue;
    fountain = { x: c[0], z: c[1], radius: 1.5 };
    break;
  }

  const clearOfPath = (p: Pt, by: number) => toPath(p, path) > PATH_WIDTH * 0.5 + by;
  const clearOfPond = (p: Pt, by: number) => !inRing(p, pond) && dist(p, pondMid) > pondR * 0.6 + by;
  const clearOfWater = (p: Pt, by: number) => !inRiver(p) && !inRing(p, pond)
    && dist(p, [fountain.x, fountain.z]) > fountain.radius + by;

  // Trees in clumps, because scattered trees read as a plantation.
  const trees: Tree[] = [];
  for (let c = 0; c < 14 && trees.length < 70; c++) {
    const ca = rnd() * Math.PI * 2;
    const cr = 5 + rnd() * (R - 6);
    const cx = Math.cos(ca) * cr; const cz = Math.sin(ca) * cr;
    const n = 2 + Math.floor(rnd() * 5);
    for (let k = 0; k < n && trees.length < 70; k++) {
      const p: Pt = [cx + (rnd() - 0.5) * 6, cz + (rnd() - 0.5) * 6];
      if (Math.hypot(p[0], p[1]) > R) continue;
      if (!clearOfPath(p, 0.9) || !clearOfPond(p, 0.6) || !clearOfWater(p, 0.8)) continue;
      if (trees.some((t) => dist([t.x, t.z], p) < 1.3)) continue;
      trees.push({ x: p[0], z: p[1], scale: 0.75 + rnd() * 0.7, lean: (rnd() - 0.5) * 0.12, kind: Math.floor(rnd() * 3) });
    }
  }

  // Stone lanterns in pairs along the path, and rocks near the water.
  const props: Prop[] = [];
  for (let i = 1; i < 5; i++) {
    const at = path[Math.floor((i / 5) * path.length)]!;
    const nxt = path[Math.min(path.length - 1, Math.floor((i / 5) * path.length) + 1)]!;
    const dx = nxt[0] - at[0]; const dz = nxt[1] - at[1];
    const len = Math.hypot(dx, dz) || 1;
    const off = PATH_WIDTH * 0.5 + 0.55;
    const side = rnd() < 0.5 ? 1 : -1;
    props.push({ x: at[0] - (dz / len) * off * side, z: at[1] + (dx / len) * off * side, rot: Math.atan2(dx, dz), kind: 'lantern' });
  }
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2;
    const p: Pt = [pondMid[0] + Math.cos(a) * (pondR + 0.7), pondMid[1] + Math.sin(a) * (pondR * 0.75 + 0.7)];
    if (!clearOfPath(p, 0.4) || inRiver(p)) continue;
    props.push({ x: p[0], z: p[1], rot: rnd() * Math.PI, kind: 'rock' });
  }

  // Benches, facing the path they sit beside, and a couple looking at the water.
  const benches: Bench[] = [];
  const bench = (p: Pt, facing: number) => {
    if (!clearOfWater(p, 0.5) || Math.hypot(p[0], p[1]) > R - 1) return;
    if (trees.some((t) => dist([t.x, t.z], p) < TREE_R * t.scale + 0.5)) return;
    if (benches.some((b) => dist([b.x, b.z], p) < 2.2)) return;
    benches.push({ x: p[0], z: p[1], rot: facing });
  };
  for (let i = 1; i < 9; i++) {
    const at = Math.floor((i / 9) * (path.length - 1));
    const a = path[at]!; const b = path[Math.min(path.length - 1, at + 1)]!;
    const dx = b[0] - a[0]; const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    const side = i % 2 === 0 ? 1 : -1;
    const off = PATH_WIDTH * 0.5 + 0.62;
    // Facing the path, which means facing back across the offset.
    bench([a[0] - (dz / len) * off * side, a[1] + (dx / len) * off * side], Math.atan2((dz / len) * side, -(dx / len) * side));
  }
  for (let i = 0; i < 5; i++) {
    const a = rnd() * Math.PI * 2;
    const p: Pt = [pondMid[0] + Math.cos(a) * (pondR + 1.35), pondMid[1] + Math.sin(a) * (pondR * 0.75 + 1.35)];
    bench(p, Math.atan2(pondMid[0] - p[0], pondMid[1] - p[1]));
  }

  // Hedges: low and rounded, gathered at the feet of the trees and along the path.
  const bushes: Bush[] = [];
  for (let i = 0; i < 600 && bushes.length < 60; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 3 + Math.sqrt(rnd()) * (R - 3);
    const p: Pt = [Math.cos(a) * r, Math.sin(a) * r];
    if (!clearOfPath(p, 0.55) || !clearOfWater(p, 0.5)) continue;
    if (benches.some((b) => dist([b.x, b.z], p) < 1.2)) continue;
    if (bushes.some((b) => dist([b.x, b.z], p) < 0.9)) continue;
    const byTree = trees.some((t) => dist([t.x, t.z], p) < 2.4);
    if (!byTree && toPath(p, path) > 4 && rnd() < 0.7) continue;
    bushes.push({ x: p[0], z: p[1], scale: 0.7 + rnd() * 0.7 });
  }

  // Flower beds: a few patches rather than confetti, so they read as planted.
  const flowers: Flower[] = [];
  for (let bed = 0; bed < 7; bed++) {
    let c: Pt = [0, 0];
    let ok = false;
    for (let k = 0; k < 120 && !ok; k++) {
      const a = rnd() * Math.PI * 2;
      const r = 4 + rnd() * (R - 5);
      c = [Math.cos(a) * r, Math.sin(a) * r];
      ok = clearOfPath(c, 0.9) && clearOfWater(c, 0.9) && toPath(c, path) < 7;
    }
    if (!ok) continue;
    const tint = rnd();
    const spread = 0.9 + rnd() * 1.1;
    for (let i = 0; i < 90; i++) {
      const p: Pt = [c[0] + (rnd() - 0.5) * spread * 2, c[1] + (rnd() - 0.5) * spread * 2];
      if (!clearOfPath(p, 0.25) || !clearOfWater(p, 0.3)) continue;
      flowers.push({ x: p[0], z: p[1], scale: 0.7 + rnd() * 0.6, tint });
    }
  }

  // Reeds at the water's edge: the thing that stops a pond looking like spilled paint.
  const reeds: Reed[] = [];
  for (let i = 0; i < 1400 && reeds.length < 420; i++) {
    const onPond = rnd() < 0.45;
    let p: Pt;
    if (onPond) {
      const a = rnd() * Math.PI * 2;
      const r = pondR * (0.92 + rnd() * 0.22);
      p = [pondMid[0] + Math.cos(a) * r, pondMid[1] + Math.sin(a) * r * 0.75];
    } else {
      const at = riverLine[Math.floor(rnd() * riverLine.length)]!;
      const a = rnd() * Math.PI * 2;
      p = [at[0] + Math.cos(a) * (RIVER_W * 0.5 + rnd() * 0.5), at[1] + Math.sin(a) * (RIVER_W * 0.5 + rnd() * 0.5)];
    }
    if (Math.hypot(p[0], p[1]) > R) continue;
    if (onBridge(p) || !clearOfPath(p, 0.2)) continue;
    reeds.push({ x: p[0], z: p[1], scale: 0.8 + rnd() * 0.9, rot: rnd() * Math.PI });
  }

  // Grass, thickest beside the path where you actually see it.
  const tufts: Tuft[] = [];
  for (let i = 0; i < 22000 && tufts.length < 7000; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * R;
    const p: Pt = [Math.cos(a) * r, Math.sin(a) * r];
    if (!clearOfPath(p, 0.1) || !clearOfPond(p, 0.2) || !clearOfWater(p, 0.15)) continue;
    if (trees.some((t) => dist([t.x, t.z], p) < 0.5 * t.scale)) continue;
    // Thickest where you walk, thinning out toward the trees.
    const near = toPath(p, path);
    if (near > 7 && rnd() < 0.45) continue;
    tufts.push({ x: p[0], z: p[1], scale: 0.75 + rnd() * 0.9, rot: rnd() * Math.PI });
  }

  // Standing room: beside the path, spread along it, never on it.
  const spots: Pt[] = [];
  for (let i = 0; i < 26; i++) {
    const t = 0.1 + (i / 26) * 0.8;
    const at = path[Math.floor(t * (path.length - 1))]!;
    const nxt = path[Math.min(path.length - 1, Math.floor(t * (path.length - 1)) + 1)]!;
    const dx = nxt[0] - at[0]; const dz = nxt[1] - at[1];
    const len = Math.hypot(dx, dz) || 1;
    const side = i % 2 === 0 ? 1 : -1;
    const off = PATH_WIDTH * 0.5 + 0.5 + rnd() * 1.6;
    const p: Pt = [at[0] - (dz / len) * off * side, at[1] + (dx / len) * off * side];
    const blocked = trees.some((t2) => dist([t2.x, t2.z], p) < TREE_R * t2.scale + 0.2)
      || props.some((pr) => dist([pr.x, pr.z], p) < PROP_R + 0.2)
      || benches.some((b) => dist([b.x, b.z], p) < BENCH_HALF + 0.2)
      || bushes.some((b) => dist([b.x, b.z], p) < BUSH_R * b.scale + 0.2)
      || dist(p, [fountain.x, fountain.z]) < fountain.radius + 0.2
      || (inRiver(p) && !onBridge(p))
      || inRing(p, pond);
    spots.push(blocked ? [at[0], at[1]] : p);
  }

  const mid = path[Math.floor(path.length / 2)]!;
  // The round edge of a grown garden, written down rather than implied, so everything
  // downstream reads one field whether the place was invented or surveyed.
  const outline: Pt[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    outline.push([Math.cos(a) * R, Math.sin(a) * R]);
  }
  return {
    id, radius: R, outline, path, paths: [{ line: path, width: PATH_WIDTH }], pond, ponds: [pond],
    river, riverLine, bridge, fountain,
    trees, tufts, props, benches, bushes, flowers, reeds, spots,
    home: [mid[0], mid[1]],
    buildings: [], landmarks: [],
  };
}

/**
 * The garden as the sim already understands the world: one area, its standing spots,
 * and the things you cannot walk through. Nothing in sim.ts needs to know a garden
 * from a city.
 */
export function gardenSpots(g: Garden): MapSpots {
  const solids: Solid[] = [
    // ONE SOLID PER TREE, AND IT IS THE TRUNK.
    //
    // It was the canopy -- one wide, tall cylinder -- and that did two wrong things at
    // once. It stopped you six and a half metres short of the bark, in a park whose
    // whole point is the trees. And it read to the camera as a building, so `clearBack`
    // pulled the lens right in and `riseFor` swung it overhead: the view snapped to a
    // plan of your own head every time you brushed past one, in a park with 700 of
    // them (on the phone, 2026-09-23).
    //
    // A canopy begins about ten metres up and was never in anybody's way. The trunk
    // is, for your feet -- but not for your eyes, which is what `seeThrough` says.
    ...g.trees.map((t) => ({
      x: t.x, z: t.z, r: TRUNK_R * t.scale, h: 2.4 * t.scale, kind: 'tree' as const,
      // You can see past a tree. Without this the camera treats every trunk as a wall
      // and rears up over your head the moment you touch one -- which only became
      // reachable when the canopy stopped stopping you six metres out.
      seeThrough: true,
    })),
    ...g.props.map((p) => ({ x: p.x, z: p.z, r: PROP_R, h: p.kind === 'lantern' ? 0.35 : 0.15, kind: 'prop' as const })),
    // You walk round a bench, not through it, but the camera sees over both it and
    // the hedges -- which is what the height on each of these is for.
    ...g.benches.flatMap((b) => BENCH_ALONG.map((d) => ({
      // Along the bench's own length, which is its x: (cos rot, -sin rot) in the world.
      x: b.x + Math.cos(b.rot) * d, z: b.z - Math.sin(b.rot) * d, r: BENCH_R, h: 0.1, kind: 'bench' as const,
    }))),
    ...g.bushes.map((b) => ({ x: b.x, z: b.z, r: BUSH_R * b.scale, h: 0.14 * b.scale, kind: 'bush' as const })),
    { x: g.fountain.x, z: g.fountain.z, r: g.fountain.radius, h: 0.5, kind: 'fountain' },
  ];
  // A BUILDING IS A WALL, AND A WALL IS ITS EDGES, NOT ITS CORNERS.
  //
  // One solid per corner is what this was, and a surveyed footprint is a handful of
  // corners a long way apart: the State Central Library's longest edge is 3.4 units
  // between two solids that cover half a unit each. You could walk straight through
  // the wall and stand inside an extruded box. So the solids step along every edge,
  // close enough together that nothing fits between two of them.
  for (const b of g.buildings) {
    for (let i = 0; i < b.ring.length; i++) {
      const a = b.ring[i]!;
      const c = b.ring[(i + 1) % b.ring.length]!;
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      // A METRE OF WALL, not four. At r 0.4 the library stood a full four metres
      // further out than it looked, and the bandstand's collider was twice the size
      // of the bandstand. Thinner solids need closer spacing or you walk between two
      // of them, so the step falls with the radius.
      const n = Math.max(1, Math.round(len / 0.16));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        solids.push({
          x: a[0] + (c[0] - a[0]) * t,
          z: a[1] + (c[1] - a[1]) * t,
          r: 0.12, h: b.height, kind: 'wall',
        });
      }
    }
  }

  // THE EDGE OF THE WORLD IS THE OUTLINE, whatever shape it is: the park's fence
  // (MapSpots.bounds), which stops you at the line itself. It was a ring of wide
  // circles just outside it, and circles along a line are a scalloped wall: a metre
  // and a half short of the edge at one step, a metre past it at the next, and a metre
  // into the park wherever the boundary turned in -- across the paths that run along
  // it (tests/park-roads.test.ts, 2026-09-29).
  return {
    central: g.id,
    areas: {
      [g.id]: { home: g.home, centre: [0, 0], radius: g.radius, spots: g.spots, polygon: g.outline },
    },
    solids,
    lakes: [...g.ponds, g.river].filter((w) => w.length > 2),
    bridges: g.bridge ? [{ x: g.bridge.x, z: g.bridge.z, r: g.bridge.span * 0.6, h: 0 }] : [],
    bounds: g.outline,
  };
}
