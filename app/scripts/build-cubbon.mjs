/**
 * The real Cubbon Park, pulled from OpenStreetMap once and committed.
 *
 *   node scripts/build-cubbon.mjs            # fetch, then build
 *   node scripts/build-cubbon.mjs --offline  # build from the committed cache
 *
 * WHY NOT KEEP INVENTING ONE. The walkable park has been a seeded garden: a path
 * wandering through some trees, the same shape for every neighbourhood, about 300
 * metres across. It reads as A park and never as THIS one, and the founder put the
 * two side by side and said so (2026-09-23) -- Cubbon Park is 1.2 km by 1.4 km with a
 * high court in the corner, a library in the middle and a bandstand, and none of that
 * can be reached by tuning a random seed.
 *
 * So the shape comes from the map. Everything here is real: the boundary as surveyed,
 * every footpath inside it, the water, the buildings that carry a name. What the
 * renderer does with it is still a stylised interpretation -- this is not a claim to
 * reproduce a place, it is a claim to get its SHAPE right, which is the part a person
 * walking through it can actually recognise.
 *
 * SAME OVERPASS DISCIPLINE AS THE CITY (server/scripts/build-map.ts): four mirrors,
 * three attempts each, and the raw answers committed under `.cubbon-cache/` so the
 * asset rebuilds without the network. The public servers time out often enough that
 * a build depending on them is a build that fails on the day it matters.
 *
 * LICENCE. OpenStreetMap data is ODbL: attribution is required and is already in
 * `assets/map/ATTRIBUTION.md`, which this park is covered by and adds itself to.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const CACHE = join(APP, '.cubbon-cache');
const OUT = join(APP, 'assets', 'venues', 'cubbon-park');
const OFFLINE = process.argv.includes('--offline');

/**
 * The park's own OSM way. Pinned by id rather than searched by name: there are several
 * things in Bengaluru called some version of "Cubbon Park" -- a metro station, a
 * police station, a bus stop -- and a name search on a rebuild is how the walkable
 * world silently becomes the shape of a car park.
 *
 * way/22895320 = Cubbon Park, leisure=park. A closed WAY, not a relation: the first
 * attempt here guessed a relation id, got a 2.3-hectare courtyard somewhere else
 * entirely, and reported it without complaint. The area check below is what would have
 * caught that, so it is not optional.
 */
const PARK_WAY = 22895320;

/** A generous box round the park, in degrees. Everything is clipped to the ring later. */
const BOX = { s: 12.966, w: 77.583, n: 12.985, e: 77.603 };

const MIRRORS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(key, ql) {
  const file = join(CACHE, `${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  if (OFFLINE) throw new Error(`--offline but ${key} is not cached`);

  let lastErr;
  for (const mirror of MIRRORS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(mirror, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(ql)}`,
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const text = await res.text();
        if (text.includes('runtime error')) throw new Error('overpass runtime error');
        const json = JSON.parse(text);
        mkdirSync(CACHE, { recursive: true });
        writeFileSync(file, JSON.stringify(json));
        console.log(`   ${key}: ${json.elements?.length ?? 0} elements from ${new URL(mirror).host}`);
        return json;
      } catch (err) {
        lastErr = err;
        await sleep([5_000, 15_000, 45_000][attempt]);
      }
    }
  }
  throw new Error(`overpass failed for ${key}: ${lastErr?.message}`);
}

// ── geometry ────────────────────────────────────────────────────────────────

/**
 * Metres, locally flat. The park is a kilometre across, so a plate carrée about its
 * own centre is accurate to centimetres -- there is no projection question here, only
 * the temptation to import one.
 */
const R = 6_371_000;
const toXZ = (lat, lon, origin) => [
  ((lon - origin.lon) * Math.PI / 180) * R * Math.cos(origin.lat * Math.PI / 180),
  // Z grows SOUTH, because the renderer's camera looks down -z and north should be up.
  -((lat - origin.lat) * Math.PI / 180) * R,
];

const ringOf = (el, nodes) =>
  (el.nodes ?? []).map((id) => nodes.get(id)).filter(Boolean).map((n) => [n.lat, n.lon]);

/** Douglas-Peucker, so a 900-point survey ring becomes something a phone can draw. */
function simplify(points, eps) {
  if (points.length < 3) return points;
  let worst = 0;
  let at = 0;
  const [ax, az] = points[0];
  const [bx, bz] = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const [px, pz] = points[i];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const d = Math.abs((px - ax) * dz - (pz - az) * dx) / len;
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= eps) return [points[0], points[points.length - 1]];
  return [
    ...simplify(points.slice(0, at + 1), eps).slice(0, -1),
    ...simplify(points.slice(at), eps),
  ];
}

/**
 * The same thing for a ring, which is NOT the same thing.
 *
 * Douglas-Peucker measures every point against the line from the first to the last.
 * On a closed ring those are the same point, the line has zero length, every distance
 * is measured against a dot, and the whole park simplifies to two points. It did: a
 * 72-point boundary came back as a straight line and the script printed it as a
 * success.
 *
 * So the ring is cut at its two most distant points and each arc is simplified as an
 * open line, which is what a ring actually is twice over.
 */
function simplifyRing(ring, eps) {
  const closed = ring.length > 2
    && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  if (pts.length < 8) return ring;

  let best = 0;
  let far = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) { best = d; far = i; }
  }
  const a = simplify(pts.slice(0, far + 1), eps);
  const b = simplify([...pts.slice(far), pts[0]], eps);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return closed ? [...out, out[0]] : out;
}

const pointIn = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

const areaOf = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a / 2);
};

// ── fetch ───────────────────────────────────────────────────────────────────

console.log('Cubbon Park, from OpenStreetMap');

const bbox = `${BOX.s},${BOX.w},${BOX.n},${BOX.e}`;

const outlineRaw = await overpass('outline', `[out:json][timeout:180];
way(${PARK_WAY});
(._;>;);
out body;`);

const pathsRaw = await overpass('paths', `[out:json][timeout:180];
way["highway"~"^(footway|path|pedestrian|steps|track|service|living_street)$"](${bbox});
(._;>;);
out body;`);

const waterRaw = await overpass('water', `[out:json][timeout:180];
(
  way["natural"="water"](${bbox});
  way["water"](${bbox});
);
(._;>;);
out body;`);

const featuresRaw = await overpass('features', `[out:json][timeout:180];
(
  way["building"](${bbox});
  way["leisure"~"^(playground|pitch|garden|bandstand)$"](${bbox});
  node["tourism"~"^(artwork|museum|aquarium|attraction)$"](${bbox});
  node["historic"](${bbox});
  node["amenity"~"^(library|fountain|toilets|cafe|drinking_water)$"](${bbox});
  way["amenity"~"^(library|fountain)$"](${bbox});
);
(._;>;);
out body;`);

const treesRaw = await overpass('trees', `[out:json][timeout:180];
node["natural"="tree"](${bbox});
out body;`);

// ── the boundary ────────────────────────────────────────────────────────────

const nodesOf = (raw) => new Map(raw.elements.filter((e) => e.type === 'node').map((e) => [e.id, e]));

const outNodes = nodesOf(outlineRaw);
const parkWay = outlineRaw.elements.find((e) => e.type === 'way' && e.id === PARK_WAY);
if (!parkWay) throw new Error(`way ${PARK_WAY} is not in the answer`);

const ringLL = parkWay.nodes.map((id) => outNodes.get(id)).filter(Boolean);
if (ringLL.length < 8) throw new Error(`the boundary came back as ${ringLL.length} points`);

// The park's own centre is the origin, so the venue's coordinates mean something on
// their own and do not drift when the city's origin moves.
const origin = {
  lat: ringLL.reduce((a, n) => a + n.lat, 0) / ringLL.length,
  lon: ringLL.reduce((a, n) => a + n.lon, 0) / ringLL.length,
};

const ringM = ringLL.map((n) => toXZ(n.lat, n.lon, origin));
const outline = simplifyRing(ringM, 4);
const hectares = areaOf(ringM) / 10_000;

const span = {
  x: Math.max(...ringM.map((p) => p[0])) - Math.min(...ringM.map((p) => p[0])),
  z: Math.max(...ringM.map((p) => p[1])) - Math.min(...ringM.map((p) => p[1])),
};
console.log(`   boundary ${ringM.length} points -> ${outline.length} after simplify`);
console.log(`   ${hectares.toFixed(1)} ha, ${Math.round(span.x)} m by ${Math.round(span.z)} m`);

// THE CHECK THAT WOULD HAVE CAUGHT THE WRONG ID. Cubbon Park is about 120 hectares
// (300 acres; Wikipedia and the horticulture department disagree between 197 and 300
// depending on what is counted, so the window is wide). A boundary outside it is
// somebody else's park and must not be shipped as this one.
if (hectares < 40 || hectares > 200) {
  throw new Error(`${hectares.toFixed(1)} ha is not Cubbon Park. Check PARK_WAY.`);
}
if (outline.length < 12) throw new Error(`the ring simplified to ${outline.length} points`);

// ── everything inside it ────────────────────────────────────────────────────

const inPark = (p) => pointIn(p, ringM);

function waysOf(raw, keep) {
  const nodes = nodesOf(raw);
  const out = [];
  for (const el of raw.elements) {
    if (el.type !== 'way') continue;
    if (!keep(el.tags ?? {})) continue;
    const pts = ringOf(el, nodes).map(([lat, lon]) => toXZ(lat, lon, origin));
    if (pts.length < 2) continue;
    // Anything with at least one end in the park. A path that leaves is clipped by
    // the renderer against the ring rather than dropped: a path to the gate is a real
    // path, and dropping it leaves the gate unreachable.
    if (!pts.some(inPark)) continue;
    out.push({ tags: el.tags ?? {}, pts });
  }
  return out;
}

const paths = waysOf(pathsRaw, () => true).map((w) => ({
  kind: w.tags.highway === 'service' || w.tags.highway === 'living_street' ? 'road' : 'path',
  name: w.tags.name ?? '',
  line: simplify(w.pts, 2.5),
}));

const water = waysOf(waterRaw, () => true).map((w) => ({
  name: w.tags.name ?? '',
  ring: simplifyRing(w.pts, 3),
}));

const buildings = waysOf(featuresRaw, (t) => Boolean(t.building)).map((w) => ({
  name: w.tags.name ?? '',
  kind: w.tags.building,
  ring: simplifyRing(w.pts, 3),
}));

const grounds = waysOf(featuresRaw, (t) => Boolean(t.leisure)).map((w) => ({
  name: w.tags.name ?? '',
  kind: w.tags.leisure,
  ring: simplifyRing(w.pts, 3),
}));

const featureNodes = featuresRaw.elements
  .filter((e) => e.type === 'node' && e.tags)
  .map((e) => ({ tags: e.tags, at: toXZ(e.lat, e.lon, origin) }))
  .filter((e) => inPark(e.at))
  .map((e) => ({
    name: e.tags.name ?? '',
    kind: e.tags.historic ?? e.tags.tourism ?? e.tags.amenity ?? 'marker',
    at: e.at.map((n) => Math.round(n * 10) / 10),
  }));

const trees = treesRaw.elements
  .filter((e) => e.type === 'node')
  .map((e) => toXZ(e.lat, e.lon, origin))
  .filter(inPark)
  .map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);

const round = (line) => line.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);

const asset = {
  meta: {
    source: 'OpenStreetMap, ODbL. way/' + PARK_WAY,
    built: new Date().toISOString().slice(0, 10),
    origin: [origin.lat, origin.lon],
    /** Metres. The renderer scales; the asset never pretends to be in world units. */
    units: 'metres',
    hectares: Math.round(hectares * 10) / 10,
    spanM: [Math.round(span.x), Math.round(span.z)],
  },
  outline: round(outline),
  paths: paths.map((p) => ({ ...p, line: round(p.line) })),
  water: water.map((w) => ({ ...w, ring: round(w.ring) })),
  buildings: buildings.map((b) => ({ ...b, ring: round(b.ring) })),
  grounds: grounds.map((g) => ({ ...g, ring: round(g.ring) })),
  features: featureNodes,
  trees,
};

mkdirSync(OUT, { recursive: true });
const file = join(OUT, 'park.json');
writeFileSync(file, JSON.stringify(asset) + '\n');
const kb = (readFileSync(file).length / 1024).toFixed(0);

console.log(`\n   paths      ${asset.paths.length}`);
console.log(`   water      ${asset.water.length}`);
console.log(`   buildings  ${asset.buildings.length}`);
console.log(`   grounds    ${asset.grounds.length}`);
console.log(`   features   ${asset.features.length}`);
console.log(`   trees      ${asset.trees.length}`);
console.log(`\npark.json  ${kb} KB`);
const named = asset.features.filter((f) => f.name).map((f) => `${f.name} (${f.kind})`);
const namedBuildings = asset.buildings.filter((b) => b.name).map((b) => b.name);
if (named.length) console.log(`\nnamed features: ${named.join(', ')}`);
if (namedBuildings.length) console.log(`named buildings: ${namedBuildings.join(', ')}`);
