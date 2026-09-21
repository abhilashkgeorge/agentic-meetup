/**
 * Flat geometry for a miniature city.
 *
 * Pure functions shared by the build script (server/scripts/build-map.ts), the app's
 * sim and camera, and both test suites. Coordinates are scene units on a flat plane:
 * `x` east, `z` south (three's ground plane, +z toward the camera), projected from
 * lat/lon around one origin with one scale. Nothing here knows about three.js.
 */

export type Pt = readonly [number, number];
export type Ring = readonly Pt[];

export interface Projection {
  /** [lat, lon] of the scene's origin. */
  origin: readonly [number, number];
  /** Scene units per degree of latitude. */
  k: number;
  /** cos(origin latitude): degrees of longitude are this much shorter. */
  cosLat: number;
}

export function projection(lat0: number, lon0: number, k: number): Projection {
  return { origin: [lat0, lon0], k, cosLat: Math.cos((lat0 * Math.PI) / 180) };
}

/** Equirectangular: good to well under 1 % across one city. */
export function project(lat: number, lon: number, p: Projection): [number, number] {
  return [(lon - p.origin[1]) * p.cosLat * p.k, -(lat - p.origin[0]) * p.k];
}

export function unproject(x: number, z: number, p: Projection): [number, number] {
  return [p.origin[0] - z / p.k, p.origin[1] + x / (p.cosLat * p.k)];
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2
    + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Signed area (shoelace); positive when the ring winds counter-clockwise in x/z. */
export function signedArea(ring: Ring): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i]!; const b = ring[(i + 1) % n]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
export const polygonArea = (ring: Ring): number => Math.abs(signedArea(ring));

export function centroid(ring: Ring): [number, number] {
  const a = signedArea(ring);
  if (Math.abs(a) < 1e-9) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0; let cz = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i]!; const q = ring[(i + 1) % n]!;
    const w = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * w; cz += (p[1] + q[1]) * w;
  }
  return [cx / (6 * a), cz / (6 * a)];
}

export function bbox(ring: Ring): { minX: number; minZ: number; maxX: number; maxZ: number } {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

/** Even-odd ray cast. Works for concave rings; a point on an edge is "in". */
export function pointInPolygon(pt: Pt, ring: Ring): boolean {
  const [x, z] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!; const [xj, zj] = ring[j]!;
    if ((zi > z) !== (zj > z)) {
      const xAt = xj + ((z - zj) * (xi - xj)) / (zi - zj);
      if (x < xAt) inside = !inside;
      else if (Math.abs(x - xAt) < 1e-9) return true;
    }
  }
  return inside;
}

/** Distance from a point to a segment. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]; const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

/** Distance from a point to the nearest edge of a ring. */
export function distToRing(p: Pt, ring: Ring): number {
  let d = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) d = Math.min(d, distToSegment(p, ring[i]!, ring[(i + 1) % n]!));
  return d;
}

/** Ramer–Douglas–Peucker. Keeps the endpoints; never adds a point; eps 0 is identity. */
export function rdp(points: Ring, eps: number): Pt[] {
  if (points.length < 3 || eps <= 0) return [...points];
  const first = points[0]!; const last = points[points.length - 1]!;
  let maxD = -1; let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distToSegment(points[i]!, first, last);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const left = rdp(points.slice(0, idx + 1), eps);
    const right = rdp(points.slice(idx), eps);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/** A closed ring simplified: the seam is kept so the shape stays closed. */
export function rdpRing(ring: Ring, eps: number): Pt[] {
  if (ring.length < 4 || eps <= 0) return [...ring];
  const closed = [...ring, ring[0]!];
  const out = rdp(closed, eps);
  out.pop();
  return out.length >= 3 ? out : [...ring];
}

/**
 * Sutherland–Hodgman against the half-plane of points nearer `a` than `b`
 * (the perpendicular bisector). Convex clipper, any subject: a concave subject may
 * come back with zero-width bridges, which `pieces()` splits.
 */
export function clipHalfPlane(poly: Ring, a: Pt, b: Pt): Pt[] {
  const mx = (a[0] + b[0]) / 2; const mz = (a[1] + b[1]) / 2;
  const nx = b[0] - a[0]; const nz = b[1] - a[1];
  const side = (p: Pt) => (p[0] - mx) * nx + (p[1] - mz) * nz;     // <= 0 keeps
  const out: Pt[] = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const cur = poly[i]!; const prev = poly[(i + n - 1) % n]!;
    const sc = side(cur); const sp = side(prev);
    const inC = sc <= 0; const inP = sp <= 0;
    if (inC) {
      if (!inP) out.push(intersect(prev, cur, sp, sc));
      out.push(cur);
    } else if (inP) {
      out.push(intersect(prev, cur, sp, sc));
    }
  }
  return out;
}

function intersect(p: Pt, q: Pt, sp: number, sq: number): Pt {
  const t = sp / (sp - sq);
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
}

/** Clip a subject ring by every edge of a convex ring (Sutherland–Hodgman). */
export function clipByConvex(subject: Ring, convex: Ring): Pt[] {
  let out: Pt[] = [...subject];
  const ccw = signedArea(convex) > 0;
  for (let i = 0, n = convex.length; i < n && out.length; i++) {
    const a = convex[i]!; const b = convex[(i + 1) % n]!;
    // Inside is to the left of a->b for a CCW ring, to the right otherwise.
    const ex = b[0] - a[0]; const ez = b[1] - a[1];
    const side = (p: Pt) => (ex * (p[1] - a[1]) - ez * (p[0] - a[0])) * (ccw ? 1 : -1);   // >= 0 keeps
    const next: Pt[] = [];
    for (let j = 0, m = out.length; j < m; j++) {
      const cur = out[j]!; const prev = out[(j + m - 1) % m]!;
      const sc = side(cur); const sp = side(prev);
      const inC = sc >= 0; const inP = sp >= 0;
      if (inC) {
        if (!inP) next.push(intersect(prev, cur, sp, sc));
        next.push(cur);
      } else if (inP) {
        next.push(intersect(prev, cur, sp, sc));
      }
    }
    out = next;
  }
  return out;
}

/** Drop consecutive duplicates and near-zero-length steps. */
export function dedupeRing(ring: Ring, eps = 1e-6): Pt[] {
  const out: Pt[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > eps) out.push(p);
  }
  const first = out[0]; const last = out[out.length - 1];
  if (out.length > 1 && first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) <= eps) out.pop();
  return out;
}

/**
 * Split a ring at repeated vertices (the zero-width bridges Sutherland–Hodgman leaves
 * when it cuts a concave shape in two) and return the pieces, largest first.
 */
export function pieces(ring: Ring): Pt[][] {
  const r = dedupeRing(ring);
  const key = (p: Pt) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const seen = new Map<string, number>();
  const stack: Pt[] = [];
  const out: Pt[][] = [];
  for (const p of r) {
    const k = key(p);
    const at = seen.get(k);
    if (at !== undefined) {
      const piece = stack.splice(at);
      for (const q of piece) seen.delete(key(q));
      if (piece.length >= 3) out.push(piece);
    }
    seen.set(k, stack.length);
    stack.push(p);
  }
  if (stack.length >= 3) out.push(stack);
  return out.sort((a, b) => polygonArea(b) - polygonArea(a));
}

/**
 * Voronoi tiles of `centres`, each clipped to `outline`. Every cell is the bbox
 * square cut by the bisector of every other centre (convex, exact), then the outline
 * cut by that cell's edges. When the outline is concave the cut may come out in
 * pieces; the largest is the tile.
 */
export function voronoiCells(centres: readonly Pt[], outline: Ring): Pt[][] {
  const bb = bbox(outline);
  const pad = 10;
  const square: Pt[] = [
    [bb.minX - pad, bb.minZ - pad], [bb.maxX + pad, bb.minZ - pad],
    [bb.maxX + pad, bb.maxZ + pad], [bb.minX - pad, bb.maxZ + pad],
  ];
  return centres.map((c, i) => {
    let cell: Pt[] = square;
    for (let j = 0; j < centres.length; j++) {
      if (j === i) continue;
      cell = clipHalfPlane(cell, c, centres[j]!);
      if (cell.length < 3) return [];
    }
    const clipped = clipByConvex(outline, cell);
    const best = pieces(clipped)[0];
    return best ?? [];
  });
}

/** Shrink a ring toward its centroid by a fixed distance, for a gap between tiles. */
export function insetTowardCentroid(ring: Ring, gap: number): Pt[] {
  const [cx, cz] = centroid(ring);
  return ring.map(([x, z]) => {
    const d = Math.hypot(x - cx, z - cz);
    if (d <= gap) return [cx, cz] as Pt;
    const f = 1 - gap / d;
    return [cx + (x - cx) * f, cz + (z - cz) * f] as Pt;
  });
}

/**
 * Shrink a ring by a fixed gap along each vertex's mitre (the bisector of the two
 * inward edge normals), so concave corners move inward too -- insetTowardCentroid
 * pushes a concave vertex OUT when the centroid is on the wrong side of it. A mitre
 * that lands outside the ring (a sliver) falls back to the centroid direction, then
 * to the vertex itself.
 */
export function insetRing(ring: Ring, gap: number): Pt[] {
  const n = ring.length;
  if (n < 3 || gap <= 0) return [...ring];
  const s = signedArea(ring) > 0 ? 1 : -1;
  const [cx, cz] = centroid(ring);
  const inward = (a: Pt, b: Pt): Pt => {
    const dx = b[0] - a[0]; const dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1;
    return [(-dz / l) * s, (dx / l) * s];
  };
  return ring.map((v, i) => {
    const n1 = inward(ring[(i + n - 1) % n]!, v); const n2 = inward(v, ring[(i + 1) % n]!);
    let bx = n1[0] + n2[0]; let bz = n1[1] + n2[1];
    const bl = Math.hypot(bx, bz);
    let cand: Pt;
    if (bl < 1e-9) {
      cand = [v[0] + n1[0] * gap, v[1] + n1[1] * gap];
    } else {
      bx /= bl; bz /= bl;
      const cosHalf = bx * n1[0] + bz * n1[1];
      const len = Math.min(gap / Math.max(cosHalf, 1e-6), gap * 3);
      cand = [v[0] + bx * len, v[1] + bz * len];
    }
    if (pointInPolygon(cand, ring)) return cand;
    const d = Math.hypot(v[0] - cx, v[1] - cz);
    const f = d <= gap ? 0 : 1 - gap / d;
    const alt: Pt = [cx + (v[0] - cx) * f, cz + (v[1] - cz) * f];
    return pointInPolygon(alt, ring) ? alt : v;
  });
}

/** The same LCG the town's sim uses: one seed, one sequence, everywhere. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
