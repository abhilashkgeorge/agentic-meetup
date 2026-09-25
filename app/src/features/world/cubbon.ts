/**
 * Cubbon Park, at the size it actually is.
 *
 * THE GARDEN WAS NEVER A PLACE. `garden.ts` grows one from a seed: a path wandering
 * through some trees, a pond off to one side, twenty-six units across. It is a good
 * park and it is nobody's park -- the same shape for every neighbourhood, and the
 * founder put it beside a map of the real one and said so (2026-09-23).
 *
 * So this one is surveyed rather than invented. `scripts/build-cubbon.mjs` pulls the
 * boundary, all 185 footpaths, the water, the buildings and the statues out of
 * OpenStreetMap and commits them in metres; this file turns that into the same
 * `Garden` the renderer and the simulation already understand, so collision, people
 * placement and the camera come free.
 *
 * WHAT IS REAL AND WHAT IS NOT. Real: the outline, every path, the ponds, the
 * buildings that carry a name, the statues, and 42 individually surveyed trees.
 * Invented: the other seven hundred trees, the grass, the benches and the lamps --
 * OSM does not record a park's planting, and a park with 42 trees in it is a car park.
 * They are placed from a fixed seed against the real geometry, so they never land in a
 * pond or on a path and they never move between visits.
 *
 * THE SCALE, AND WHY THIS NUMBER. A person in this world is about 0.21 units tall
 * (PERSON 0.16 x the model's own 0.72, on a 1.85-unit model), so one unit is about
 * eight metres of the real place at the size people are drawn. That makes the park
 * 147 by 171 units -- roughly nine times the area of the garden it replaces, which is
 * what "let the size match the real park" costs. Full size was the founder's call,
 * with the walk across it measured and stated rather than discovered later.
 *
 * PURE. No three, no react-native, no asset loader beyond the JSON. The mesh that
 * draws this is garden-mesh.ts.
 */
import park from '../../../assets/venues/cubbon-park/park.json';
import {
  PATH_WIDTH, type Bench, type Building, type Bush, type Flower, type Garden,
  type Landmark, type Prop, type Reed, type Tree, type Tuft,
} from './garden';
import type { Pt } from './sim';

/**
 * Metres to world units.
 *
 * Derived from the people rather than chosen: a drawn person is ~0.21 units and a real
 * one is ~1.7 m. Everything else in the park follows from it, including the fact that
 * a real three-metre footpath comes out at 0.37 units -- narrower than the seeded
 * garden's 0.95, and correct, because that path was a road.
 */
export const METRES_PER_UNIT = 8.1;
const U = 1 / METRES_PER_UNIT;

/** Real footpaths are two people wide, not four. */
export const CUBBON_PATH_W = 0.42;
/** A service road through the park. Wider, and the only thing a vehicle could use. */
export const CUBBON_ROAD_W = 0.75;

const TREE_R = 0.55;
/** People stand anywhere within this of the bandstand, and thin out beyond it. */
const CROWD_CORE = 34;

interface RawPath { kind: string; name: string; line: [number, number][] }
interface RawRing { name: string; kind?: string; ring: [number, number][] }
interface RawFeature { name: string; kind: string; at: [number, number] }

interface Park {
  meta: { hectares: number; spanM: [number, number]; source: string };
  outline: [number, number][];
  paths: RawPath[];
  water: RawRing[];
  buildings: RawRing[];
  grounds: RawRing[];
  features: RawFeature[];
  trees: [number, number][];
}

const asset = park as unknown as Park;

const lcg = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

const scale = (p: readonly [number, number]): Pt => [p[0] * U, p[1] * U];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function inRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < xj + ((p[1] - zj) * (xi - xj)) / (zi - zj)) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a polyline. */
function toLine(p: Pt, line: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz)));
  }
  return best;
}

/**
 * How far to the nearest path, over ALL of them.
 *
 * Called for every candidate tree, bush, lamp and blade of grass against 185 polylines,
 * which is the one place in here that could be slow enough to notice. So the paths are
 * bucketed into a coarse grid first and only the ones in nearby cells are measured --
 * the whole park generates in a few milliseconds instead of a few seconds, and the
 * answer is identical because a path in a cell four cells away cannot be the nearest.
 */
function pathIndex(paths: readonly Pt[][], cell: number) {
  const grid = new Map<string, number[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  paths.forEach((line, i) => {
    for (let k = 0; k + 1 < line.length; k++) {
      const a = line[k]!;
      const b = line[k + 1]!;
      const steps = Math.max(1, Math.ceil(dist(a, b) / cell));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const kk = key(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
        const at = grid.get(kk);
        if (at) { if (!at.includes(i)) at.push(i); } else grid.set(kk, [i]);
      }
    }
  });
  return (p: Pt, reach: number): number => {
    const span = Math.ceil(reach / cell);
    const cx = Math.floor(p[0] / cell);
    const cz = Math.floor(p[1] / cell);
    const seen = new Set<number>();
    let best = Infinity;
    for (let dx = -span; dx <= span; dx++) {
      for (let dz = -span; dz <= span; dz++) {
        for (const i of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          best = Math.min(best, toLine(p, paths[i]!));
        }
      }
    }
    return best;
  };
}

/**
 * The same trick for a cloud of points: nearest-neighbour by grid.
 *
 * Grass is generated by rejection sampling -- a quarter of a million candidates -- and
 * every one of them asked "is there a tree here?" against all seven hundred trees.
 * That is 182 million distance checks and it took 2.2 seconds, which is 2.2 seconds of
 * frozen phone the first time somebody walks into the park. Bucketed, it is a handful
 * of comparisons each and the answer is identical.
 */
function pointIndex(cell: number) {
  const grid = new Map<string, { x: number; z: number; r: number }[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  return {
    add(x: number, z: number, r: number) {
      const k = key(x, z);
      const at = grid.get(k);
      if (at) at.push({ x, z, r }); else grid.set(k, [{ x, z, r }]);
    },
    /** Is anything within its own radius of this point? */
    hits(p: Pt, pad: number): boolean {
      const span = Math.ceil((pad + cell) / cell);
      const cx = Math.floor(p[0] / cell);
      const cz = Math.floor(p[1] / cell);
      for (let dx = -span; dx <= span; dx++) {
        for (let dz = -span; dz <= span; dz++) {
          for (const q of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
            if (Math.hypot(q.x - p[0], q.z - p[1]) < q.r + pad) return true;
          }
        }
      }
      return false;
    },
  };
}

/** The park, once. Built lazily because it is a few milliseconds and not every screen wants it. */
let cached: Garden | null = null;

export function makeCubbon(): Garden {
  if (cached) return cached;
  const rnd = lcg(0x0cbb0);

  const outline = asset.outline.map(scale);
  const lines: Pt[][] = asset.paths.map((p) => p.line.map(scale));
  const roads = new Set(asset.paths.map((p, i) => (p.kind === 'road' ? i : -1)).filter((i) => i >= 0));
  const paths = lines.map((line, i) => ({ line, width: roads.has(i) ? CUBBON_ROAD_W : CUBBON_PATH_W }));
  const ponds: Pt[][] = asset.water.map((w) => w.ring.map(scale));

  const buildings: Building[] = asset.buildings.map((b) => ({
    name: b.name,
    ring: b.ring.map(scale),
    // Guessed, and only the named ones matter: the library is a tall Gothic hall, the
    // bandstand is a roof on poles, everything else is a shed. Nothing here claims to
    // be the real elevation -- OSM has no heights for these.
    height: b.name === 'State Central Library' ? 2.2 : b.name === 'Band Stand' ? 0.9 : 0.7,
  }));

  const landmarks: Landmark[] = asset.features
    .filter((f) => f.name && f.kind !== 'toilets' && f.kind !== 'drinking_water')
    .map((f) => {
      const at = scale(f.at);
      return {
        x: at[0], z: at[1], name: f.name,
        kind: f.kind === 'memorial' || f.kind === 'artwork' ? 'statue'
          : f.kind === 'attraction' ? 'rock' : 'marker',
      };
    });

  const near = pathIndex(lines, 4);
  const inPark = (p: Pt) => inRing(p, outline);
  const inWater = (p: Pt, pad = 0) => ponds.some((w) => inRing(p, w) || toLine(p, w) < pad);
  const inBuilding = (p: Pt, pad = 0) =>
    buildings.some((b) => inRing(p, b.ring) || toLine(p, b.ring) < pad);

  const bounds = outline.reduce(
    (a, [x, z]) => ({
      minX: Math.min(a.minX, x), maxX: Math.max(a.maxX, x),
      minZ: Math.min(a.minZ, z), maxZ: Math.max(a.maxZ, z),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  );
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  /** Half the long axis: what the fog and the camera are sized against. */
  const radius = Math.max(spanX, spanZ) / 2;

  /** A point somewhere in the park, on open ground. */
  const openGround = (pad: number, tries = 40): Pt | null => {
    for (let i = 0; i < tries; i++) {
      const p: Pt = [
        bounds.minX + rnd() * spanX,
        bounds.minZ + rnd() * spanZ,
      ];
      if (!inPark(p)) continue;
      if (inWater(p, pad) || inBuilding(p, pad)) continue;
      if (near(p, pad + CUBBON_ROAD_W) < CUBBON_ROAD_W * 0.5 + pad) continue;
      return p;
    }
    return null;
  };

  // ── trees ────────────────────────────────────────────────────────────────
  //
  // The 42 OSM records first, because those are where trees genuinely are, then
  // enough invented ones to read as a park. Cubbon has something like 6,800; this
  // draws 700, which at a phone's draw distance is the same picture.
  const treeGrid = pointIndex(2);
  const trees: Tree[] = asset.trees.map((t) => {
    const p = scale(t);
    treeGrid.add(p[0], p[1], 0.42);
    return { x: p[0], z: p[1], scale: 1.1 + rnd() * 0.5, lean: (rnd() - 0.5) * 0.12, kind: Math.floor(rnd() * 3) };
  });
  for (let i = 0; i < 9000 && trees.length < 700; i++) {
    const p = openGround(0.5, 1);
    if (!p) continue;
    if (treeGrid.hits(p, 0.43)) continue;
    // Thicker away from the paths, which is where a park's trees are: the middle of a
    // lawn is open and the edges are planted.
    const d = near(p, 6);
    if (d < 0.8 && rnd() < 0.6) continue;
    const t = { x: p[0], z: p[1], scale: 0.85 + rnd() * 0.75, lean: (rnd() - 0.5) * 0.14, kind: Math.floor(rnd() * 3) };
    treeGrid.add(t.x, t.z, 0.42 * t.scale);
    trees.push(t);
  }

  // ── benches and lamps, along the paths ───────────────────────────────────
  const benches: Bench[] = [];
  const props: Prop[] = [];
  for (const [i, line] of lines.entries()) {
    if (line.length < 2) continue;
    const step = roads.has(i) ? 9 : 5;
    let run = 0;
    for (let k = 0; k + 1 < line.length; k++) {
      const a = line[k]!;
      const b = line[k + 1]!;
      const len = dist(a, b);
      for (let t = 0; t < len; t += 0.4) {
        run += 0.4;
        if (run < step) continue;
        run = 0;
        const u = t / (len || 1);
        const at: Pt = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
        const dx = (b[0] - a[0]) / (len || 1);
        const dz = (b[1] - a[1]) / (len || 1);
        const side = rnd() < 0.5 ? 1 : -1;
        const off = (roads.has(i) ? CUBBON_ROAD_W : CUBBON_PATH_W) * 0.5 + 0.22;
        const p: Pt = [at[0] - dz * off * side, at[1] + dx * off * side];
        if (!inPark(p) || inWater(p, 0.2) || inBuilding(p, 0.2)) continue;
        if (rnd() < 0.45) {
          if (benches.some((x) => dist([x.x, x.z], p) < 1.2)) continue;
          benches.push({ x: p[0], z: p[1], rot: Math.atan2(dx, dz) + (side > 0 ? 0 : Math.PI) });
        } else {
          if (props.some((x) => dist([x.x, x.z], p) < 1.2)) continue;
          props.push({ x: p[0], z: p[1], rot: rnd() * Math.PI, kind: rnd() < 0.7 ? 'lantern' : 'rock' });
        }
      }
    }
  }

  // ── undergrowth ──────────────────────────────────────────────────────────
  const bushes: Bush[] = [];
  for (let i = 0; i < 6000 && bushes.length < 900; i++) {
    const p = openGround(0.25, 1);
    if (!p) continue;
    if (bushes.some((b) => dist([b.x, b.z], p) < 0.6)) continue;
    const byTree = treeGrid.hits(p, 1.2);
    if (!byTree && rnd() < 0.55) continue;
    bushes.push({ x: p[0], z: p[1], scale: 0.7 + rnd() * 0.8 });
  }

  const flowers: Flower[] = [];
  for (let bed = 0; bed < 26; bed++) {
    const c = openGround(1.0);
    if (!c) continue;
    const tint = rnd();
    const spread = 0.8 + rnd() * 1.4;
    for (let i = 0; i < 70; i++) {
      const p: Pt = [c[0] + (rnd() - 0.5) * spread * 2, c[1] + (rnd() - 0.5) * spread * 2];
      if (!inPark(p) || inWater(p, 0.25) || near(p, 1) < CUBBON_PATH_W * 0.5 + 0.1) continue;
      flowers.push({ x: p[0], z: p[1], scale: 0.6 + rnd() * 0.6, tint });
    }
  }

  const reeds: Reed[] = [];
  for (const w of ponds) {
    for (let i = 0; i < 900 && reeds.length < 1200; i++) {
      const k = Math.floor(rnd() * w.length);
      const a = w[k]!;
      const b = w[(k + 1) % w.length]!;
      const t = rnd();
      const p: Pt = [
        a[0] + (b[0] - a[0]) * t + (rnd() - 0.5) * 0.5,
        a[1] + (b[1] - a[1]) * t + (rnd() - 0.5) * 0.5,
      ];
      if (!inPark(p) || near(p, 0.6) < CUBBON_PATH_W * 0.5) continue;
      reeds.push({ x: p[0], z: p[1], scale: 0.7 + rnd() * 0.8, rot: rnd() * Math.PI });
    }
  }

  // ── grass ────────────────────────────────────────────────────────────────
  //
  // THE ONE NUMBER THAT DECIDES WHETHER THIS RUNS. The seeded garden puts 7,000 tufts
  // in a 26-unit circle; the same density here would be eighty thousand, and the park
  // already measured at 59.8 fps with grass as more than half of its triangles. So
  // these are generated for the WHOLE park and the mesh draws only the cells near the
  // camera (see garden-mesh.ts). Thickest beside a path, because that is where a
  // person walking actually looks.
  //
  // DENSITY IS THE WHOLE THING, and the first cut got it wrong by three and a half
  // times. The seeded garden puts 7,000 tufts in a 26-unit circle: 3.3 a square unit,
  // which is what makes a lawn read as grass rather than as paint. Spreading 24,000
  // over a park nine times the size is 0.9 a square unit, and on the phone the park
  // was a flat green field with nothing growing on it at all.
  //
  // So the density is matched instead of the count, and the cull is what pays for it:
  // only the cells within GRASS_SEE of the player are ever drawn, so the number that
  // reaches the graphics card is about what the small garden drew, and the rest sits
  // in memory costing nothing.
  const tufts: Tuft[] = [];
  for (let i = 0; i < 260_000 && tufts.length < 62_000; i++) {
    const p: Pt = [bounds.minX + rnd() * spanX, bounds.minZ + rnd() * spanZ];
    if (!inPark(p) || inWater(p, 0.1) || inBuilding(p, 0.1)) continue;
    const d = near(p, 4);
    if (d < CUBBON_PATH_W * 0.5) continue;
    // Thickest where you walk, thinning into the open middle of a lawn -- which is
    // also where the cull means nobody is standing to look at it.
    if (d > 3.5 && rnd() < 0.45) continue;
    if (treeGrid.hits(p, 0)) continue;
    tufts.push({ x: p[0], z: p[1], scale: 0.7 + rnd() * 0.9, rot: rnd() * Math.PI });
  }

  // ── where people stand ───────────────────────────────────────────────────
  //
  // YOU ARRIVE BESIDE THE BAND STAND, NOT INSIDE IT. It is the middle of the real
  // park and the right place to put somebody down -- and the first cut used its own
  // coordinates, which is the middle of its footprint. The building is extruded from
  // that footprint, so the park opened with the camera in a grey box (on the phone,
  // 2026-09-23).
  const bandAt: Pt = (() => {
    const mark = landmarks.find((l) => /band/i.test(l.name));
    if (mark) return [mark.x, mark.z];
    const built = buildings.find((b) => /band/i.test(b.name));
    if (built?.ring.length) {
      return [
        built.ring.reduce((a, p) => a + p[0], 0) / built.ring.length,
        built.ring.reduce((a, p) => a + p[1], 0) / built.ring.length,
      ];
    }
    return [0, 0];
  })();

  // Beside a path, and THICKEST AROUND THE BAND STAND, thinning with distance.
  //
  // Spread evenly over 147 by 171 units, thirty-two people are one person every two
  // thousand square units and the median standing spot is fifty-four units from where
  // you arrive -- so walking the park, you met nobody, which is the one thing it
  // exists for. Real crowds are not even either: Cubbon Park fills up around the
  // bandstand, the library lawn and the main avenue, and empties toward the edges.
  // So the far half of the park keeps its paths, its benches and its trees, and has
  // fewer people standing in it.
  //
  // Sampled from the longest paths first: a six-metre spur behind the toilets is a
  // path, and nobody stands on it.
  const byLength = lines
    .map((line, i) => ({ i, len: line.slice(1).reduce((a, p, k) => a + dist(p, line[k]!), 0) }))
    .sort((a, b) => b.len - a.len)
    .slice(0, 40);
  const spots: Pt[] = [];
  for (let n = 0; n < 900 && spots.length < 120; n++) {
    const pick = byLength[n % byLength.length]!;
    const line = lines[pick.i]!;
    const k = Math.floor(rnd() * Math.max(1, line.length - 1));
    const a = line[k]!;
    const b = line[Math.min(line.length - 1, k + 1)]!;
    const len = dist(a, b) || 1;
    const t = rnd();
    const at: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const dx = (b[0] - a[0]) / len;
    const dz = (b[1] - a[1]) / len;
    const side = rnd() < 0.5 ? 1 : -1;
    const off = CUBBON_PATH_W * 0.5 + 0.25 + rnd() * 0.5;
    const p: Pt = [at[0] - dz * off * side, at[1] + dx * off * side];
    if (!inPark(p) || inWater(p, 0.2) || inBuilding(p, 0.2)) continue;
    if (treeGrid.hits(p, 0.2)) continue;
    // The crowd gradient. Everything within CROWD_CORE, then thinning as 1/distance.
    const fromBand = dist(p, bandAt);
    if (fromBand > CROWD_CORE && rnd() > CROWD_CORE / fromBand) continue;
    if (benches.some((x) => dist([x.x, x.z], p) < 0.45)) continue;
    if (spots.some((s) => dist(s, p) < 1.5)) continue;
    spots.push(p);
  }

  const home: Pt = spots.length
    ? spots.reduce((best, p) => (dist(p, bandAt) < dist(best, bandAt) ? p : best), spots[0]!)
    : bandAt;

  // The spine: the longest single path, for anything that still wants one line through
  // the place -- the seeded garden's idea of a park, kept so nothing downstream breaks.
  const spine = lines[byLength[0]?.i ?? 0] ?? [[0, 0], [1, 0]];

  cached = {
    id: 'cubbon-park',
    radius,
    outline,
    path: spine,
    paths,
    pond: ponds[0] ?? [],
    ponds,
    river: [],
    riverLine: [],
    bridge: null,
    fountain: { x: home[0], z: home[1], radius: 0 },
    trees, tufts, props, benches, bushes, flowers, reeds, spots,
    home,
    buildings,
    landmarks,
  };
  return cached;
}

/** What the park is, in numbers, for a test and for the bench readout. */
export const cubbonFacts = () => ({
  hectares: asset.meta.hectares,
  spanM: asset.meta.spanM,
  spanUnits: [
    Math.round(asset.meta.spanM[0] * U * 10) / 10,
    Math.round(asset.meta.spanM[1] * U * 10) / 10,
  ] as [number, number],
  paths: asset.paths.length,
  source: asset.meta.source,
});
