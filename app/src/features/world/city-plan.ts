/**
 * The city round Cubbon Park: the road outside its fence, the pavements, the buildings
 * across the road, and the lanes the traffic drives in.
 *
 * WHAT THE FOUNDER ASKED (2026-09-29): "make sure the park has a see through barricade
 * around the park so that users can know what the end of the park is in all directions.
 * You can add just buildings and traffic like bangalore after the barricade where no
 * user can go to." Until this the park's edge was a green plain that ran into the mist:
 * nothing said where the park stopped, and an invisible wall did.
 *
 * HOW. Everything follows the park's own outline, however it turns, by DISTANCE FROM
 * THE FENCE: a grid of how far each point outside the park is from it, and every edge
 * is a line of equal distance on that grid (marching squares). So the road is the band
 * 0.35 to 2.25 units out (15 m of carriageway), with a pavement either side; where the
 * park turns in on itself the road fills the notch, as the roads through Cubbon do; and
 * the buildings stand behind the far pavement, facing the road. The traffic drives the
 * lines 0.85 and 1.75 out, one each way, keeping LEFT: in the lane beside the park, the
 * park is on your left.
 *
 * PURE and SEEDED: the same plan every time. `scripts/build-city.mts` writes it to
 * assets/venues/cubbon-park/city.json, which is what the app reads, so the phone does
 * none of this; tests/city-plan.test.ts holds the file to a fresh plan and the plan to
 * its rules. No three here; city-mesh.ts draws it.
 */
import type { Pt } from './sim';

/** Distances out from the fence, in units (8.1 m). */
export const CITY = {
  /** The pavement between the fence and the road. */
  roadFrom: 0.35,
  /** The far kerb. */
  roadTo: 2.25,
  /** The far pavement's outer edge: buildings start beyond it. */
  pavementTo: 2.6,
  /** The lanes' middle lines: beside the park, and the far side. */
  laneIn: 0.85,
  laneOut: 1.75,
  /** The dashed line down the middle. */
  centre: 1.3,
  /** How deep the buildings go. The park's mist hides anything much further. */
  buildTo: 15,
} as const;

export interface CityBuilding {
  /** Its middle. */
  c: Pt;
  /** Its facing, as the sim's: its front, toward the road, is (sin a, cos a). */
  a: number;
  /** Along the road, back from it, and up. */
  w: number;
  d: number;
  h: number;
  /** Index into FACADES. */
  col: number;
  /** A shop sign over the ground floor, by index into SIGNS; -1 for none. */
  sign: number;
}

export interface CityPlan {
  /** The carriageway: each outer ring with the rings cut out of it. */
  road: { outer: Pt[]; holes: Pt[][] }[];
  /** The pavements, the same way: the one by the fence, and the far one. */
  pavement: { outer: Pt[]; holes: Pt[][] }[];
  /** The dashed middle line, as lines to dash. */
  centre: Pt[][];
  /** The traffic's two loops, each already turned the way it drives. */
  lanes: { loop: Pt[]; side: 'park' | 'far' }[];
  buildings: CityBuilding[];
}

/** Bengaluru walls: cream, sand, peach, terracotta, white, pale blue, sage, mustard, rose, concrete, glass. */
export const FACADES = [
  '#F2E6C9', '#E3CFA2', '#F2C4A0', '#CF8A6E', '#ECECEA', '#C6D4DE', '#B7C4A6', '#E9C766', '#E6B5AE', '#A7ADA9', '#7F98AA',
] as const;
/** Shop boards: the colours a street of them is. */
export const SIGNS = ['#D7263D', '#1B4F9C', '#F4B41A', '#1E8E3E', '#F26A1B', '#6B2FA3', '#FFFFFF'] as const;

// ── the field ────────────────────────────────────────────────────────────────

export interface Field {
  /** Signed distance from the fence: negative inside the park. Clamped to +-reach. */
  d: Float32Array;
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  h: number;
}

function toSegment(px: number, pz: number, a: Pt, b: Pt): number {
  const ex = b[0] - a[0], ez = b[1] - a[1];
  const l2 = ex * ex + ez * ez;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * ex + (pz - a[1]) * ez) / l2));
  return Math.hypot(px - a[0] - ex * t, pz - a[1] - ez * t);
}

/**
 * How far every grid point is from the ring, out to `reach`, negative inside it. Each
 * edge writes only the points within `reach` of it; inside and outside by scanline.
 */
export function signedField(ring: readonly Pt[], h: number, reach: number): Field {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const x0 = minX - reach - h * 2, z0 = minZ - reach - h * 2;
  const nx = Math.ceil((maxX + reach + h * 2 - x0) / h) + 1;
  const nz = Math.ceil((maxZ + reach + h * 2 - z0) / h) + 1;
  const d = new Float32Array(nx * nz).fill(reach);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach - x0) / h));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0]) + reach - x0) / h));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach - z0) / h));
    const j1 = Math.min(nz - 1, Math.ceil((Math.max(a[1], b[1]) + reach - z0) / h));
    for (let j = j0; j <= j1; j++) {
      for (let k = i0; k <= i1; k++) {
        const v = toSegment(x0 + k * h, z0 + j * h, a, b);
        if (v < d[j * nx + k]!) d[j * nx + k] = v;
      }
    }
  }
  // Inside: every crossing of the row with the ring, and in between, negative.
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * h;
    const xs: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + ((z - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let s = 0; s + 1 < xs.length; s += 2) {
      const k0 = Math.max(0, Math.ceil((xs[s]! - x0) / h)), k1 = Math.min(nx - 1, Math.floor((xs[s + 1]! - x0) / h));
      for (let k = k0; k <= k1; k++) d[j * nx + k] = -d[j * nx + k]!;
    }
  }
  return { d, nx, nz, x0, z0, h };
}

/** The field between grid points: bilinear. Outside the grid, far. */
export function fieldAt(f: Field, x: number, z: number): number {
  const u = (x - f.x0) / f.h, v = (z - f.z0) / f.h;
  const i = Math.floor(u), j = Math.floor(v);
  if (i < 0 || j < 0 || i >= f.nx - 1 || j >= f.nz - 1) return Infinity;
  const s = u - i, t = v - j;
  const at = (a: number, b: number) => f.d[(j + b) * f.nx + i + a]!;
  return (at(0, 0) * (1 - s) + at(1, 0) * s) * (1 - t) + (at(0, 1) * (1 - s) + at(1, 1) * s) * t;
}

/**
 * Every closed line where the field equals `level` (marching squares). Each runs with
 * the lower side -- the park's -- on the LEFT of anybody going along it, as the sim
 * reckons left (facing (sin a, cos a), left is (cos a, -sin a)): the case table below
 * keeps the higher side counterclockwise of each segment with z taken as up, which is
 * clockwise the way the sim's x and z lie.
 */
export function contours(f: Field, level: number): Pt[][] {
  const { d, nx, nz, x0, z0, h } = f;
  const val = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= nz ? Infinity : d[j * nx + i]!) - level;
  // Edge ids: horizontal (i,j)-(i+1,j) is 2*(j*nx+i); vertical (i,j)-(i,j+1) is +1.
  const point = (id: number): Pt => {
    const cell = id >> 1, i = cell % nx, j = Math.floor(cell / nx);
    const [i2, j2] = id & 1 ? [i, j + 1] : [i + 1, j];
    const a = val(i, j), b = val(i2, j2);
    const t = a === b ? 0.5 : a / (a - b);
    return [x0 + (i + (i2 - i) * t) * h, z0 + (j + (j2 - j) * t) * h];
  };
  const next = new Map<number, number>();
  for (let j = 0; j + 1 < nz; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const bl = val(i, j) > 0, br = val(i + 1, j) > 0, tr = val(i + 1, j + 1) > 0, tl = val(i, j + 1) > 0;
      const bottom = 2 * (j * nx + i), top = 2 * ((j + 1) * nx + i), left = 2 * (j * nx + i) + 1, right = 2 * (j * nx + i + 1) + 1;
      const add = (from: number, to: number) => next.set(from, to);
      // Going round each cell, the segment runs so that "above the level" is on its
      // left (x right, z down the grid): the orientation every contour inherits.
      const code = (bl ? 1 : 0) | (br ? 2 : 0) | (tr ? 4 : 0) | (tl ? 8 : 0);
      switch (code) {
        case 0: case 15: break;
        case 1: add(bottom, left); break;
        case 2: add(right, bottom); break;
        case 3: add(right, left); break;
        case 4: add(top, right); break;
        case 5: {
          const centre = (val(i, j) + val(i + 1, j) + val(i + 1, j + 1) + val(i, j + 1)) / 4 > 0;
          if (centre) { add(top, left); add(bottom, right); } else { add(bottom, left); add(top, right); }
          break;
        }
        case 6: add(top, bottom); break;
        case 7: add(top, left); break;
        case 8: add(left, top); break;
        case 9: add(bottom, top); break;
        case 10: {
          const centre = (val(i, j) + val(i + 1, j) + val(i + 1, j + 1) + val(i, j + 1)) / 4 > 0;
          if (centre) { add(left, bottom); add(right, top); } else { add(left, top); add(right, bottom); }
          break;
        }
        case 11: add(right, top); break;
        case 12: add(left, right); break;
        case 13: add(bottom, right); break;
        case 14: add(left, bottom); break;
      }
    }
  }
  const out: Pt[][] = [];
  const done = new Set<number>();
  for (const start of next.keys()) {
    if (done.has(start)) continue;
    const loop: Pt[] = [];
    let at: number | undefined = start;
    while (at !== undefined && !done.has(at)) {
      done.add(at);
      loop.push(point(at));
      at = next.get(at);
    }
    if (loop.length > 2) out.push(loop);
  }
  return out;
}

/** Douglas-Peucker on a closed loop: corners kept, straight runs thinned. */
export function simplify(loop: readonly Pt[], tol: number): Pt[] {
  if (loop.length < 4) return [...loop];
  const keep = new Uint8Array(loop.length);
  const rec = (a: number, b: number) => {
    let far = -1, fd = tol;
    for (let k = a + 1; k < b; k++) {
      const dd = toSegment(loop[k]![0], loop[k]![1], loop[a]!, loop[b]!);
      if (dd > fd) { fd = dd; far = k; }
    }
    if (far < 0) return;
    keep[far] = 1;
    rec(a, far); rec(far, b);
  };
  const mid = Math.floor(loop.length / 2);
  keep[0] = 1; keep[mid] = 1;
  rec(0, mid); rec(mid, loop.length - 1);
  keep[loop.length - 1] = 1;
  return loop.filter((_, k) => keep[k]);
}

/** Twice the signed area: positive for a loop going anticlockwise with x right, z up. */
export function signedArea(loop: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!, b = loop[(i + 1) % loop.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

function inRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!, [xj, zj] = ring[j]!;
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < xj + ((p[1] - zj) * (xi - xj)) / (zi - zj)) inside = !inside;
  }
  return inside;
}

/**
 * The band between two levels as rings with holes: each ring at the outer level with
 * every ring at the inner level that lies inside it.
 */
function band(f: Field, inner: number, outer: number, tol: number): { outer: Pt[]; holes: Pt[][] }[] {
  const outs = contours(f, outer).map((l) => simplify(l, tol)).filter((l) => l.length > 2);
  const ins = contours(f, inner).map((l) => simplify(l, tol)).filter((l) => l.length > 2);
  // A ring at the outer level with the park on its inside is a boundary; one with the
  // park outside it (a courtyard of city ringed by park) is a hole of its own.
  return outs.map((o) => ({ outer: o, holes: ins.filter((h) => inRing(h[0]!, o)) }));
}

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Do two buildings overlap, footprint to footprint (separating axes), with `gap` between. */
function overlaps(p: CityBuilding, q: CityBuilding, gap: number): boolean {
  const axes = [p.a, p.a + Math.PI / 2, q.a, q.a + Math.PI / 2].map((t) => [Math.sin(t), Math.cos(t)] as const);
  const corners = (b: CityBuilding): Pt[] => {
    const f = [Math.sin(b.a), Math.cos(b.a)], s = [Math.cos(b.a), -Math.sin(b.a)];
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [
      b.c[0] + s[0]! * (b.w / 2) * u! + f[0]! * (b.d / 2) * v!, b.c[1] + s[1]! * (b.w / 2) * u! + f[1]! * (b.d / 2) * v!,
    ]);
  };
  const cp = corners(p), cq = corners(q);
  for (const [ax, az] of axes) {
    const proj = (cs: Pt[]) => cs.map(([x, z]) => x * ax + z * az);
    const a = proj(cp), b = proj(cq);
    if (Math.max(...a) + gap < Math.min(...b) || Math.max(...b) + gap < Math.min(...a)) return false;
  }
  return true;
}

/** A building's four corners. */
export function cornersOf(b: CityBuilding): Pt[] {
  const f = [Math.sin(b.a), Math.cos(b.a)], s = [Math.cos(b.a), -Math.sin(b.a)];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [
    b.c[0] + s[0]! * (b.w / 2) * u! + f[0]! * (b.d / 2) * v!, b.c[1] + s[1]! * (b.w / 2) * u! + f[1]! * (b.d / 2) * v!,
  ]);
}

/** The whole plan, from the park's outline. Seeded: the same outline, the same city. */
export function planCity(outline: readonly Pt[], seed = 0xb10c): CityPlan {
  const f = signedField(outline, 0.2, CITY.buildTo + 2);
  const TOL = 0.04;
  const road = band(f, CITY.roadFrom, CITY.roadTo, TOL);
  const pavement = [...band(f, 0, CITY.roadFrom, TOL), ...band(f, CITY.roadTo, CITY.pavementTo, TOL)];
  const centre = contours(f, CITY.centre).map((l) => simplify(l, TOL));

  // THE LANES. The longest line at each distance is the road round the whole park;
  // the short ones are islands. Every line comes with the park on its left, so the lane
  // by the park already goes the way India drives -- keeping left, the park's kerb on
  // your left -- and the far lane is turned round, its own kerb on its left.
  const longest = (ls: Pt[][]) => ls.reduce((a, b) => (b.length > a.length ? b : a), [] as Pt[]);
  const laneIn = simplify(longest(contours(f, CITY.laneIn)), TOL);
  const laneOut = simplify(longest(contours(f, CITY.laneOut)), TOL).reverse();
  const lanes = [{ loop: laneIn, side: 'park' as const }, { loop: laneOut, side: 'far' as const }];

  // THE BUILDINGS: tried at random points of the city beyond the far pavement, each
  // facing down the field towards the road, and kept if all four corners are off the
  // pavement and it overlaps nobody. Nearer the road they are shops and flats, further
  // back taller: Bengaluru round Cubbon Park is three to six storeys with the odd tower.
  const rnd = lcg(seed);
  const buildings: CityBuilding[] = [];
  const grid = new Map<string, CityBuilding[]>();
  const key = (x: number, z: number) => `${Math.floor(x / 6)},${Math.floor(z / 6)}`;
  const nearby = (c: Pt) => {
    const out: CityBuilding[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      out.push(...(grid.get(`${Math.floor(c[0] / 6) + dx},${Math.floor(c[1] / 6) + dz}`) ?? []));
    }
    return out;
  };
  for (let tries = 0; tries < 60_000 && buildings.length < 1400; tries++) {
    const c: Pt = [f.x0 + rnd() * (f.nx - 1) * f.h, f.z0 + rnd() * (f.nz - 1) * f.h];
    const dc = fieldAt(f, c[0], c[1]);
    if (!(dc > CITY.pavementTo + 0.6 && dc < CITY.buildTo)) continue;
    // Down the field: the way back to the road.
    const e = 0.2;
    const gx = fieldAt(f, c[0] + e, c[1]) - fieldAt(f, c[0] - e, c[1]);
    const gz = fieldAt(f, c[0], c[1] + e) - fieldAt(f, c[0], c[1] - e);
    if (!Number.isFinite(gx) || !Number.isFinite(gz) || Math.hypot(gx, gz) < 1e-6) continue;
    const front = dc < 6;
    const b: CityBuilding = {
      c,
      a: Math.atan2(-gx, -gz),
      w: 1.3 + rnd() * 1.9,
      d: 1.3 + rnd() * 1.7,
      h: front ? 0.9 + rnd() * rnd() * 2.6 : 1.5 + rnd() * rnd() * 4.6,
      col: Math.floor(rnd() * (FACADES.length - 1)),
      sign: front && rnd() < 0.7 ? Math.floor(rnd() * SIGNS.length) : -1,
    };
    // The tall ones are glass.
    if (b.h > 4) b.col = FACADES.length - 1;
    if (cornersOf(b).some(([x, z]) => !(fieldAt(f, x, z) > CITY.pavementTo + 0.05))) continue;
    if (nearby(c).some((o) => overlaps(b, o, 0.12))) continue;
    buildings.push(b);
    const k = key(c[0], c[1]);
    const at = grid.get(k);
    if (at) at.push(b); else grid.set(k, [b]);
  }

  const round = (p: Pt): Pt => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    road: road.map((r) => ({ outer: r.outer.map(round), holes: r.holes.map((h) => h.map(round)) })),
    pavement: pavement.map((r) => ({ outer: r.outer.map(round), holes: r.holes.map((h) => h.map(round)) })),
    centre: centre.map((l) => l.map(round)),
    lanes: lanes.map((l) => ({ loop: l.loop.map(round), side: l.side })),
    buildings: buildings.map((b) => ({ ...b, c: round(b.c), a: r3(b.a), w: r3(b.w), d: r3(b.d), h: r3(b.h) })),
  };
}
