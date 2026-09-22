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

export interface Garden {
  id: string;
  /** How far out you can walk before the fog takes over. */
  radius: number;
  /** The path, as a smooth polyline from one side to the other. */
  path: Pt[];
  pond: Pt[];
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
}

/** How far out the ground goes. Beyond the radius it rolls into hills and haze. */
export const GARDEN_RADIUS = 26;
/** Four people abreast, against a person about 0.24 tall. At 1.5 it was a road. */
export const PATH_WIDTH = 0.95;
const TREE_R = 0.55;
const PROP_R = 0.3;
const BENCH_R = 0.26;
const BUSH_R = 0.16;
/** Wide enough to read as water you would not step into, narrow enough to bridge. */
const RIVER_W = 2.1;

const lcg = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

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
      || benches.some((b) => dist([b.x, b.z], p) < BENCH_R + 0.2)
      || bushes.some((b) => dist([b.x, b.z], p) < BUSH_R * b.scale + 0.2)
      || dist(p, [fountain.x, fountain.z]) < fountain.radius + 0.2
      || (inRiver(p) && !onBridge(p))
      || inRing(p, pond);
    spots.push(blocked ? [at[0], at[1]] : p);
  }

  const mid = path[Math.floor(path.length / 2)]!;
  return {
    id, radius: R, path, pond, river, riverLine, bridge, fountain,
    trees, tufts, props, benches, bushes, flowers, reeds, spots,
    home: [mid[0], mid[1]],
  };
}

/**
 * The garden as the sim already understands the world: one area, its standing spots,
 * and the things you cannot walk through. Nothing in sim.ts needs to know a garden
 * from a city.
 */
export function gardenSpots(g: Garden): MapSpots {
  const solids: Solid[] = [
    ...g.trees.map((t) => ({ x: t.x, z: t.z, r: TREE_R * t.scale, h: 2.2 * t.scale })),
    ...g.props.map((p) => ({ x: p.x, z: p.z, r: PROP_R, h: p.kind === 'lantern' ? 0.35 : 0.15 })),
    // You walk round a bench, not through it, but the camera sees over both it and
    // the hedges -- which is what the height on each of these is for.
    ...g.benches.map((b) => ({ x: b.x, z: b.z, r: BENCH_R, h: 0.13 })),
    ...g.bushes.map((b) => ({ x: b.x, z: b.z, r: BUSH_R * b.scale, h: 0.16 * b.scale })),
    { x: g.fountain.x, z: g.fountain.z, r: g.fountain.radius, h: 0.5 },
  ];
  // The edge of the world, as a ring of solids you cannot push past.
  const edge = 44;
  for (let i = 0; i < edge; i++) {
    const a = (i / edge) * Math.PI * 2;
    solids.push({ x: Math.cos(a) * (g.radius + 1.6), z: Math.sin(a) * (g.radius + 1.6), r: 2.2, h: 4 });
  }
  const ring: Pt[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    ring.push([Math.cos(a) * g.radius, Math.sin(a) * g.radius]);
  }
  return {
    central: g.id,
    areas: { [g.id]: { home: g.home, centre: [0, 0], radius: g.radius, spots: g.spots, polygon: ring } },
    solids,
    lakes: [g.pond, g.river],
    bridges: g.bridge ? [{ x: g.bridge.x, z: g.bridge.z, r: g.bridge.span * 0.6, h: 0 }] : [],
  };
}
