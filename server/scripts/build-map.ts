/**
 * Build the miniature Bengaluru the town is drawn on.
 *
 *   npx tsx scripts/build-map.ts [--offline] [--secondary] [--density] [--svg out.svg]
 *
 * Pulls the city outline, the main roads, the named lakes and the big parks from
 * OpenStreetMap (Overpass; four mirrors, retries, and every raw answer cached under
 * scripts/map-cache/ and committed, so --offline rebuilds with no network), cuts the
 * outline into the thirty areas of shared/areas.ts (Voronoi of their centres), seeds
 * standing spots and building blocks per area, and writes ONE asset the app bundles:
 * app/assets/map/bangalore.json (~100 KB). Nothing is fetched at run time.
 *
 * Data: © OpenStreetMap contributors, ODbL. See app/assets/map/ATTRIBUTION.md.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AREAS, CENTRAL_AREA, nearestArea,
  bbox, centroid, dedupeRing, distToRing, distToSegment, insetRing, lcg, pointInPolygon,
  polygonArea, project, projection, rdp, rdpRing, unproject, voronoiCells, type Pt,
} from '@clone/shared';

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(here, 'map-cache');
const OUT = join(here, '..', '..', 'app', 'assets', 'map');
const args = new Set(process.argv.slice(2));
const flag = (f: string) => args.has(f);
const svgOut = process.argv.includes('--svg') ? process.argv[process.argv.indexOf('--svg') + 1] : null;

const MIRRORS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// The scene: 1 unit ≈ 0.55 km; the city (~0.32° across) spans ~64 units.
const P = projection(12.9716, 77.5946, 200);
const KM_PER_UNIT = 111.32 / P.k;
const KM2_PER_UNIT2 = KM_PER_UNIT * KM_PER_UNIT;

interface OsmEl { type: string; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[] }

// ── Overpass, cached ─────────────────────────────────────────────────────────

async function overpass(key: string, ql: string): Promise<{ elements: OsmEl[] }> {
  await mkdir(CACHE, { recursive: true });
  const file = join(CACHE, `${key}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  if (flag('--offline')) throw new Error(`offline and no cache for ${key}`);
  let lastErr: unknown = null;
  for (const mirror of MIRRORS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 200_000);
      try {
        process.stdout.write(`  ${key}: ${new URL(mirror).host} try ${attempt + 1}… `);
        const res = await fetch(mirror, {
          method: 'POST', signal: ctl.signal,
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'clone-map-build/1 (dating-agent)' },
          body: `data=${encodeURIComponent(ql)}`,
        });
        const text = await res.text();
        if (!res.ok || text.includes('runtime error') || !text.trimStart().startsWith('{')) {
          throw new Error(`${res.status}: ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
        }
        const json = JSON.parse(text) as { elements: OsmEl[] };
        await writeFile(file, JSON.stringify(json));
        console.log(`ok (${json.elements.length} elements)`);
        return json;
      } catch (err) {
        lastErr = err;
        console.log(`failed: ${(err as Error).message.slice(0, 100)}`);
        await new Promise((r) => setTimeout(r, [5_000, 15_000, 45_000][attempt]));
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw new Error(`overpass failed for ${key}: ${(lastErr as Error)?.message}`);
}

const ringOf = (g: { lat: number; lon: number }[]): Pt[] => g.map((p) => project(p.lat, p.lon, P));

/** Chain a relation's outer ways into closed rings by matching endpoints. */
function assembleOuter(members: NonNullable<OsmEl['members']>): Pt[][] {
  const ways = members.filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry?.length).map((m) => ringOf(m.geometry!));
  const rings: Pt[][] = [];
  const key = (p: Pt) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const pool = [...ways];
  while (pool.length) {
    let ring = pool.shift()!;
    let grew = true;
    while (grew && key(ring[0]!) !== key(ring[ring.length - 1]!)) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i]!;
        const end = key(ring[ring.length - 1]!);
        if (key(w[0]!) === end) { ring = [...ring, ...w.slice(1)]; pool.splice(i, 1); grew = true; break; }
        if (key(w[w.length - 1]!) === end) { ring = [...ring, ...[...w].reverse().slice(1)]; pool.splice(i, 1); grew = true; break; }
      }
    }
    rings.push(dedupeRing(ring));
  }
  return rings.sort((a, b) => polygonArea(b) - polygonArea(a));
}

/** Overpass' poly filter wants "lat lon lat lon …" of a coarse outline. */
function polyFilter(ring: Pt[]): string {
  return rdpRing(ring, 0.3).map(([x, z]) => unproject(x, z, P)).map(([lat, lon]) => `${lat.toFixed(4)} ${lon.toFixed(4)}`).join(' ');
}

// ── the build ────────────────────────────────────────────────────────────────

async function main() {
  console.log('outline');
  const rel = await overpass('outline', `[out:json][timeout:180];
    rel["boundary"="administrative"]["admin_level"~"^(6|7|8)$"]["name"~"^(Bengaluru|Bangalore|Bruhat Bengaluru)",i];
    out geom;`);
  const candidates = rel.elements.filter((e) => e.type === 'relation' && e.members)
    .map((e) => ({ id: e.id, name: e.tags?.name ?? '?', level: e.tags?.admin_level, rings: assembleOuter(e.members!) }))
    .map((c) => ({ ...c, km2: (c.rings[0] ? polygonArea(c.rings[0]) : 0) * KM2_PER_UNIT2 }));
  for (const c of candidates) console.log(`  relation ${c.id} "${c.name}" level ${c.level}: ${c.km2.toFixed(0)} km²`);
  const city = candidates.find((c) => c.km2 >= 600 && c.km2 <= 900) ?? candidates.sort((a, b) => Math.abs(a.km2 - 709) - Math.abs(b.km2 - 709))[0];
  if (!city || !city.rings[0]) throw new Error('no city outline found');
  const outline = rdpRing(city.rings[0], 0.08);
  const ob = bbox(outline);
  console.log(`  using relation ${city.id} "${city.name}" ${city.km2.toFixed(0)} km², ${outline.length} points, span ${(ob.maxX - ob.minX).toFixed(1)} × ${(ob.maxZ - ob.minZ).toFixed(1)} units`);
  const poly = polyFilter(city.rings[0]);

  console.log('roads');
  const roadClasses = flag('--secondary') ? 'trunk|primary|secondary' : 'trunk|primary';
  const roadsRaw = await overpass(flag('--secondary') ? 'roads-secondary' : 'roads', `[out:json][timeout:180];
    way["highway"~"^(${roadClasses})$"](poly:"${poly}"); out geom;`);
  const roads: Record<string, Pt[][]> = { trunk: [], primary: [], secondary: [] };
  for (const w of roadsRaw.elements) {
    if (!w.geometry || !w.tags?.highway) continue;
    const cls = w.tags.highway;
    if (!(cls in roads)) continue;
    const line = rdp(ringOf(w.geometry), 0.12);
    if (line.length >= 2) roads[cls]!.push(line);
  }
  if (!flag('--secondary')) delete roads.secondary;
  console.log(`  trunk ${roads.trunk!.length}, primary ${roads.primary!.length}${roads.secondary ? `, secondary ${roads.secondary.length}` : ''}`);

  console.log('water');
  const waterRaw = await overpass('water', `[out:json][timeout:180];
    (way["natural"="water"]["name"](poly:"${poly}"); rel["natural"="water"]["name"](poly:"${poly}");); out geom;`);
  const water = areasFrom(waterRaw.elements, 0.08);
  console.log(`  ${water.length} lakes ≥ 0.08 km²: ${water.slice(0, 8).map((w) => w.name).join(', ')}…`);

  console.log('parks');
  const parksRaw = await overpass('parks', `[out:json][timeout:180];
    (way["leisure"="park"]["name"](poly:"${poly}"); rel["leisure"="park"]["name"](poly:"${poly}");); out geom;`);
  const parks = areasFrom(parksRaw.elements, 0.15);
  console.log(`  ${parks.length} parks ≥ 0.15 km²: ${parks.slice(0, 8).map((w) => w.name).join(', ')}…`);

  // Tiles: Voronoi of the thirty centres, clipped to the outline, a gap between them.
  console.log('tiles');
  const centres = AREAS.map((a) => project(a.lat, a.lon, P));
  AREAS.forEach((a, i) => { if (!pointInPolygon(centres[i]!, outline)) throw new Error(`${a.id} is outside the outline; nudge its centre`); });
  for (let i = 0; i < AREAS.length; i++) for (let j = i + 1; j < AREAS.length; j++) {
    const km = Math.hypot(centres[i]![0] - centres[j]![0], centres[i]![1] - centres[j]![1]) * KM_PER_UNIT;
    if (km < 2) console.log(`  warn: ${AREAS[i]!.id} and ${AREAS[j]!.id} are ${km.toFixed(1)} km apart`);
  }
  const rawTiles = voronoiCells(centres, outline);
  const tiles = rawTiles.map((t) => rdpRing(insetRing(t, 0.3), 0.06));
  const tileArea = rawTiles.reduce((s, t) => s + polygonArea(t), 0);
  console.log(`  Σ tile area ${tileArea.toFixed(1)} vs outline ${polygonArea(outline).toFixed(1)} units²`);
  let within10 = 0, within25 = 0, pairs = 0;
  for (let i = 0; i < AREAS.length; i++) for (let j = i + 1; j < AREAS.length; j++) {
    const km = Math.hypot(centres[i]![0] - centres[j]![0], centres[i]![1] - centres[j]![1]) * KM_PER_UNIT;
    pairs++; if (km <= 10) within10++; if (km <= 25) within25++;
  }
  console.log(`  centre pairs within 10 km: ${(100 * within10 / pairs).toFixed(0)} %, within 25 km: ${(100 * within25 / pairs).toFixed(0)} %`);

  // Density: OpenStreetMap building counts per tile, or the curated weight.
  const density: number[] = [];
  if (flag('--density')) {
    console.log('density');
    const counts: number[] = [];
    for (let i = 0; i < AREAS.length; i++) {
      const tilePoly = rawTiles[i]!.map(([x, z]) => unproject(x, z, P)).map(([lat, lon]) => `${lat.toFixed(4)} ${lon.toFixed(4)}`).join(' ');
      try {
        const r = await overpass(`density-${AREAS[i]!.id}`, `[out:json][timeout:180]; way["building"](poly:"${tilePoly}"); out count;`);
        counts.push(Number(r.elements[0]?.tags?.total ?? 0) / polygonArea(rawTiles[i]!));
      } catch { counts.push(-1); }
    }
    const max = Math.max(...counts.filter((c) => c >= 0), 1);
    const maxW = Math.max(...AREAS.map((a) => a.weight));
    for (let i = 0; i < AREAS.length; i++) density.push(counts[i]! >= 0 ? counts[i]! / max : AREAS[i]!.weight / maxW);
  } else {
    const maxW = Math.max(...AREAS.map((a) => a.weight));
    for (const a of AREAS) density.push(a.weight / maxW);
  }

  // Per area: spots, home, radius, blocks.
  const roadSegs: [Pt, Pt][] = [];
  for (const cls of Object.keys(roads)) for (const line of roads[cls]!) for (let i = 1; i < line.length; i++) roadSegs.push([line[i - 1]!, line[i]!]);
  const nearRoad = (p: Pt, d: number) => roadSegs.some(([a, b]) => distToSegment(p, a, b) < d);
  const inAny = (p: Pt, rings: { polygon: Pt[] }[]) => rings.some((r) => pointInPolygon(p, r.polygon));
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const r2 = (p: Pt): Pt => [round2(p[0]), round2(p[1])];

  const totalBlocksWanted = AREAS.reduce((s, _a, i) => s + Math.round(6 + 34 * density[i]!), 0);
  const blockScale = Math.min(1, 450 / totalBlocksWanted);
  const areasOut = AREAS.map((a, i) => {
    const tile = tiles[i]!;
    const rnd = lcg(0x5eed + i);
    const tb = bbox(tile);
    const sample = (margin: number, tries = 4000, extra?: (p: Pt) => boolean): Pt | null => {
      for (let t = 0; t < tries; t++) {
        const p: Pt = [tb.minX + rnd() * (tb.maxX - tb.minX), tb.minZ + rnd() * (tb.maxZ - tb.minZ)];
        if (!pointInPolygon(p, tile) || distToRing(p, tile) < margin) continue;
        if (extra && !extra(p)) continue;
        return p;
      }
      return null;
    };
    const spots: Pt[] = [];
    for (let k = 0; k < 24; k++) {
      const p = sample(0.5, 4000, (q) => !inAny(q, water) && !inAny(q, parks)) ?? sample(0.2) ?? centroid(tile);
      spots.push(p);
    }
    const c = centroid(tile);
    const home = spots.reduce((best, p) => (Math.hypot(p[0] - c[0], p[1] - c[1]) < Math.hypot(best[0] - c[0], best[1] - c[1]) ? p : best), spots[0]!);
    const radius = Math.max(...tile.map((v) => Math.hypot(v[0] - c[0], v[1] - c[1])));
    const blocks: number[][] = [];
    const want = Math.round(Math.round(6 + 34 * density[i]!) * blockScale);
    for (let k = 0; k < want; k++) {
      const p = sample(0.45, 3000, (q) => !nearRoad(q, 0.3) && !inAny(q, water) && !inAny(q, parks)
        && blocks.every((b) => Math.hypot(b[0]! - q[0], b[1]! - q[1]) > 0.45));
      if (!p) break;
      const w = 0.35 + rnd() * 0.55; const d = 0.35 + rnd() * 0.55;
      const h = 0.15 + density[i]! * 0.45 * (0.6 + rnd() * 0.8);
      blocks.push([round2(p[0]), round2(p[1]), round2(w), round2(d), round2(h), round2(rnd() * Math.PI)]);
    }
    return {
      id: a.id, name: a.name, centre: r2(c), home: r2(home), radius: round2(radius), density: round2(density[i]!),
      polygon: tile.map(r2), spots: spots.map(r2), blocks,
    };
  });

  // Trees in parks, lamps along primary roads.
  const parksOut = parks.map((pk, i) => {
    const rnd = lcg(0x7ee + i);
    const pb = bbox(pk.polygon);
    const trees: number[][] = [];
    const n = Math.min(12, Math.max(3, Math.round(polygonArea(pk.polygon) * 4)));
    for (let t = 0; t < 400 && trees.length < n; t++) {
      const p: Pt = [pb.minX + rnd() * (pb.maxX - pb.minX), pb.minZ + rnd() * (pb.maxZ - pb.minZ)];
      if (pointInPolygon(p, pk.polygon) && distToRing(p, pk.polygon) > 0.2) trees.push([round2(p[0]), round2(p[1]), round2(0.7 + rnd() * 0.6)]);
    }
    return { name: pk.name, polygon: pk.polygon.map(r2), trees };
  });
  const lamps: Pt[] = [];
  for (const line of roads.primary ?? []) {
    let carry = 0;
    for (let i = 1; i < line.length && lamps.length < 400; i++) {
      const a = line[i - 1]!; const b = line[i]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = carry; s < len; s += 3) lamps.push(r2([a[0] + ((b[0] - a[0]) * s) / len, a[1] + ((b[1] - a[1]) * s) / len]));
      carry = (carry + Math.ceil((len - carry) / 3) * 3) - len;
    }
  }
  const lampStep = Math.max(1, Math.ceil(lamps.length / 120));
  const lampsOut = lamps.filter((_, i) => i % lampStep === 0);

  const LANDMARKS: { id: string; name: string; lat: number; lon: number; kind: string; rot: number }[] = [
    { id: 'vidhana-soudha', name: 'Vidhana Soudha', lat: 12.9797, lon: 77.5912, kind: 'dome', rot: 0 },
    { id: 'ub-city', name: 'UB City', lat: 12.9718, lon: 77.5960, kind: 'tower', rot: 0.3 },
    { id: 'palace', name: 'Bangalore Palace', lat: 12.9988, lon: 77.5921, kind: 'palace', rot: 0 },
    { id: 'iskcon', name: 'ISKCON', lat: 13.0098, lon: 77.5510, kind: 'temple', rot: 0 },
    { id: 'lalbagh', name: 'Lalbagh Glass House', lat: 12.9507, lon: 77.5848, kind: 'glasshouse', rot: 0.2 },
    { id: 'chinnaswamy', name: 'Chinnaswamy Stadium', lat: 12.9788, lon: 77.5996, kind: 'stadium', rot: 0 },
    { id: 'fort', name: 'Bangalore Fort', lat: 12.9627, lon: 77.5757, kind: 'fort', rot: 0 },
    { id: 'bull-temple', name: 'Bull Temple', lat: 12.9426, lon: 77.5680, kind: 'bull', rot: 0 },
  ];
  const landmarks = LANDMARKS.map((l) => ({
    id: l.id, name: l.name, area: nearestArea(l.lat, l.lon)?.id ?? CENTRAL_AREA, at: r2(project(l.lat, l.lon, P)), kind: l.kind, rot: l.rot,
  }));

  const asset = {
    meta: { origin: P.origin, k: P.k, cosLat: round2(P.cosLat * 10000) / 10000, built: new Date().toISOString().slice(0, 10), osm: `relation/${city.id}` },
    outline: outline.map(r2),
    areas: areasOut,
    roads: Object.fromEntries(Object.entries(roads).map(([k, lines]) => [k, lines.map((l) => l.map(r2))])),
    water: water.map((w) => ({ name: w.name, polygon: w.polygon.map(r2) })),
    parks: parksOut,
    landmarks,
    lamps: lampsOut,
  };

  const json = JSON.stringify(asset);
  const bytes = (v: unknown) => JSON.stringify(v).length;
  console.log('sizes', {
    outline: bytes(asset.outline), areas: bytes(asset.areas), roads: bytes(asset.roads), water: bytes(asset.water),
    parks: bytes(asset.parks), landmarks: bytes(asset.landmarks), lamps: bytes(asset.lamps), total: json.length,
  });
  if (json.length > 300_000) throw new Error(`asset is ${json.length} bytes; the budget is 300 KB (try without --secondary)`);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'bangalore.json'), json);
  await writeFile(join(OUT, 'ATTRIBUTION.md'), `# Map data

The miniature Bengaluru drawn on the Home screen is built from OpenStreetMap data:
the city outline (OSM ${asset.meta.osm}), the main roads, the named lakes and the larger
parks, pulled on ${asset.meta.built} by \`server/scripts/build-map.ts\` and simplified into
\`bangalore.json\`. Neighbourhood tiles are the Voronoi cells of the thirty centres in
\`shared/src/areas.ts\`; buildings are not real footprints, only a density.

© OpenStreetMap contributors, Open Database License (ODbL) 1.0 — https://www.openstreetmap.org/copyright

The app shows "Map data © OpenStreetMap contributors" in Settings, as the licence asks.
During the build the BBMP ward boundaries published by DataMeet (CC BY-SA 2.5 IN) are
used only as a sanity check on the outline's extent; nothing from them is shipped.
`);
  console.log(`wrote ${join(OUT, 'bangalore.json')} (${(json.length / 1024).toFixed(0)} KB)`);

  if (svgOut) {
    const w = ob.maxX - ob.minX + 4; const h = ob.maxZ - ob.minZ + 4;
    const tx = (p: Pt) => `${(p[0] - ob.minX + 2).toFixed(2)},${(p[1] - ob.minZ + 2).toFixed(2)}`;
    const path = (ring: readonly Pt[]) => `M${ring.map(tx).join('L')}Z`;
    const line = (l: readonly Pt[]) => `M${l.map(tx).join('L')}`;
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" width="1200" style="background:#E2E5EB">`,
      `<path d="${path(asset.outline)}" fill="#dfe2e8" stroke="none"/>`,
      ...asset.areas.map((a) => `<path d="${path(a.polygon)}" fill="#EBEDF2" stroke="#C3CBD9" stroke-width="0.08"/>`),
      ...asset.parks.map((p) => `<path d="${path(p.polygon)}" fill="#cfe7d6"/>`),
      ...asset.water.map((wt) => `<path d="${path(wt.polygon)}" fill="#d9d4f5"/>`),
      ...Object.values(asset.roads).flatMap((ls) => ls.map((l) => `<path d="${line(l)}" fill="none" stroke="#ffffff" stroke-width="0.18"/>`)),
      ...asset.areas.flatMap((a) => a.blocks.map((b) => `<rect x="${(b[0]! - ob.minX + 2 - b[2]! / 2).toFixed(2)}" y="${(b[1]! - ob.minZ + 2 - b[3]! / 2).toFixed(2)}" width="${b[2]}" height="${b[3]}" fill="#f7f8fb"/>`)),
      ...asset.landmarks.map((l) => `<circle cx="${(l.at[0] - ob.minX + 2).toFixed(2)}" cy="${(l.at[1] - ob.minZ + 2).toFixed(2)}" r="0.35" fill="#6D5DFC"/>`),
      ...asset.areas.map((a) => `<text x="${(a.centre[0] - ob.minX + 2).toFixed(2)}" y="${(a.centre[1] - ob.minZ + 2).toFixed(2)}" font-size="0.9" text-anchor="middle" fill="#5B6470" font-family="sans-serif">${a.name}</text>`),
      '</svg>',
    ].join('\n');
    await writeFile(svgOut, svg);
    console.log(`wrote ${svgOut}`);
  }
}

/** Named polygons from ways and multipolygon relations, kept above a size in km². */
function areasFrom(elements: OsmEl[], minKm2: number): { name: string; polygon: Pt[] }[] {
  const out: { name: string; polygon: Pt[] }[] = [];
  for (const e of elements) {
    const name = e.tags?.name;
    if (!name) continue;
    let ring: Pt[] | null = null;
    if (e.type === 'way' && e.geometry) ring = dedupeRing(ringOf(e.geometry));
    else if (e.type === 'relation' && e.members) ring = assembleOuter(e.members)[0] ?? null;
    if (!ring || ring.length < 4) continue;
    if (polygonArea(ring) * KM2_PER_UNIT2 < minKm2) continue;
    const simple = rdpRing(ring, 0.06);
    if (simple.length >= 3) out.push({ name, polygon: simple });
  }
  // Largest first, and one polygon per name.
  const seen = new Set<string>();
  return out.sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon)).filter((w) => (seen.has(w.name) ? false : (seen.add(w.name), true)));
}

main().catch((err) => { console.error(err); process.exit(1); });
