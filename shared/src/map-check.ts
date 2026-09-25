/**
 * Is this city map fit to send to a phone?
 *
 * WHY THIS EXISTS. One map, built by hand with somebody watching, broke three times:
 * Overpass timed out twice on build day; the wrong OSM relation id produced a
 * 2.3-hectare courtyard where a 61-hectare park should have been, and it LOOKED fine;
 * and Douglas-Peucker flattened a closed ring to two points, because a ring whose
 * first point is its last has a zero-length chord and the algorithm has nothing to
 * measure from. Building a map per city, unattended, for every place a user turns up
 * in, there is no version of this that does not fail sometimes.
 *
 * So the promise is not "the build works". The promise is **a broken map never reaches
 * a phone**: every asset is checked here before it is served, and an asset with any
 * fault is not served at all -- the phone gets the generated town instead, which is
 * always available and never wrong, only generic.
 *
 * Every check below is a thing that has actually gone wrong, or the same shape of
 * thing. None of them is a style opinion; a fault means the map is WRONG, not ugly.
 *
 * Pure, and shared: the build script runs it before writing, the server runs it before
 * serving, and the tests run it on fixtures of the three real failures.
 */
import { polygonArea } from './geo.js';

export interface MapFault {
  /** Stable, greppable, safe to put in a log or a metric. */
  code: string;
  detail: string;
}

/** What a city asset has to look like. Deliberately loose: this is a gate, not a parser. */
export interface CityAsset {
  meta?: { origin?: [number, number]; k?: number; built?: string; osm?: string };
  outline?: [number, number][];
  areas?: { id?: string; centre?: [number, number]; polygon?: [number, number][] }[];
  roads?: Record<string, [number, number][][]>;
  water?: unknown[];
  parks?: unknown[];
}

/**
 * A city is bigger than a park and smaller than a province.
 *
 * The courtyard was 0.02 km2 and Bengaluru is 1,190. Greater London is about 1,600 and
 * Tokyo's 23 wards about 630, so the ceiling has to be generous; what it is really
 * catching is the two orders of magnitude between a city and a building.
 */
const MIN_KM2 = 5;
const MAX_KM2 = 8000;

/**
 * An outline this coarse is a simplifier that ate the shape.
 *
 * The ring that came back from the Douglas-Peucker bug had two points. A real city
 * boundary simplified for drawing still has dozens; Bengaluru's has 380.
 */
const MIN_OUTLINE_POINTS = 12;

/** Over this and the download stops being free on a phone. */
const MAX_BYTES = 400_000;

const finitePt = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/**
 * Every fault in this asset, empty when it is fit to serve.
 *
 * `bytes` is the serialised size when the caller knows it; the size check is skipped
 * rather than guessed when it does not.
 */
export function checkMap(asset: CityAsset | null | undefined, bytes?: number): MapFault[] {
  const faults: MapFault[] = [];
  const fault = (code: string, detail: string) => faults.push({ code, detail });

  if (!asset || typeof asset !== 'object') {
    return [{ code: 'not-an-object', detail: 'the asset is missing or is not an object' }];
  }

  // --- the origin, because everything else is measured from it -------------------
  const origin = asset.meta?.origin;
  if (!finitePt(origin)) fault('no-origin', 'meta.origin is missing or not two finite numbers');
  else {
    const [lat, lon] = origin;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) fault('origin-off-earth', `meta.origin is ${lat}, ${lon}`);
    // 0,0 is in the Atlantic and is what an unset variable looks like.
    if (lat === 0 && lon === 0) fault('origin-null-island', 'meta.origin is 0, 0');
  }
  const k = asset.meta?.k;
  if (typeof k !== 'number' || !Number.isFinite(k) || k <= 0) {
    fault('no-scale', `meta.k is ${String(k)}; nothing can be measured without it`);
  }

  // --- the outline ---------------------------------------------------------------
  const outline = asset.outline;
  if (!Array.isArray(outline)) {
    fault('no-outline', 'outline is missing');
  } else {
    const bad = outline.findIndex((p) => !finitePt(p));
    if (bad >= 0) fault('outline-not-finite', `outline[${bad}] is not two finite numbers`);
    else if (outline.length < MIN_OUTLINE_POINTS) {
      // THE DOUGLAS-PEUCKER BUG. Two points is a line, not a city.
      fault('outline-too-coarse', `the outline has ${outline.length} points; a city keeps at least ${MIN_OUTLINE_POINTS}`);
    } else if (typeof k === 'number' && k > 0) {
      // THE WRONG-ID BUG. Right shape, right file, wrong place -- only the size says so.
      const kmPerUnit = 111 / k;
      const km2 = polygonArea(outline) * kmPerUnit * kmPerUnit;
      if (km2 < MIN_KM2) fault('outline-too-small', `the outline is ${km2.toFixed(2)} km2; a city is at least ${MIN_KM2}`);
      if (km2 > MAX_KM2) fault('outline-too-big', `the outline is ${km2.toFixed(0)} km2; over ${MAX_KM2} is a region, not a city`);
    }
  }

  // --- the streets ---------------------------------------------------------------
  // A city with no roads is a build that half-failed: the outline query answered and
  // the roads query did not. It renders as a blank plate and looks deliberate.
  const roads = asset.roads;
  const lines = roads && typeof roads === 'object'
    ? Object.values(roads).flatMap((v) => (Array.isArray(v) ? v : []))
    : [];
  if (!lines.length) fault('no-roads', 'not one road came back; the streets query probably failed on its own');
  else {
    const stray = lines.findIndex((l) => !Array.isArray(l) || l.length < 2 || !l.every(finitePt));
    if (stray >= 0) fault('road-not-a-line', `roads line ${stray} is not two or more finite points`);
  }

  // --- the neighbourhoods, when there are any ------------------------------------
  // Optional by design: most cities will ship without them, and that is a map with
  // less detail rather than a broken one. If they ARE here they have to be inside.
  if (Array.isArray(asset.areas) && Array.isArray(outline) && outline.every(finitePt) && outline.length >= 3) {
    for (const a of asset.areas) {
      if (!finitePt(a?.centre)) { fault('area-no-centre', `area ${a?.id ?? '?'} has no centre`); continue; }
      if (!inRing(a.centre, outline)) fault('area-outside', `area ${a.id ?? '?'} sits outside the city outline`);
    }
  }

  if (typeof bytes === 'number' && bytes > MAX_BYTES) {
    fault('too-big', `${(bytes / 1024).toFixed(0)} KB; the budget is ${MAX_BYTES / 1024} KB`);
  }

  return faults;
}

/** Fit to send to a phone. */
export const mapIsServable = (asset: CityAsset | null | undefined, bytes?: number): boolean =>
  checkMap(asset, bytes).length === 0;

function inRing(pt: [number, number], ring: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!; const [xj, zj] = ring[j]!;
    if ((zi > pt[1]) !== (zj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}
