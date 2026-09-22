/**
 * The miniature Bengaluru, as data.
 *
 * One JSON file, built once from OpenStreetMap by server/scripts/build-map.ts and
 * committed (app/assets/map/ATTRIBUTION.md says where it came from). Nothing is
 * fetched at run time. This file is pure -- no three, no react-native -- so the sim
 * and the tests can read the map without a renderer; ./map-mesh.ts is what draws it.
 */
import { AREAS, CENTRAL_AREA } from '@clone/shared';
import asset from '../../../assets/map/bangalore.json';
import type { MapSpots, Pt, Solid } from './sim';

export interface MapAreaAsset {
  id: string;
  name: string;
  centre: Pt;
  /** The standing spot nearest the centroid: where your agent lives. */
  home: Pt;
  /** Farthest vertex from the centre, for "gone" and for the camera's near band. */
  radius: number;
  /** 0..1 building density, from the curated weight (or OSM counts when --density ran). */
  density: number;
  polygon: Pt[];
  spots: Pt[];
  /** [x, z, width, depth, height, rotation] per block. Never a real footprint. */
  blocks: number[][];
}

export interface MapAsset {
  meta: { origin: [number, number]; k: number; cosLat: number; built: string; osm: string };
  outline: Pt[];
  areas: MapAreaAsset[];
  roads: Record<string, Pt[][]>;
  water: { name: string; polygon: Pt[] }[];
  parks: { name: string; polygon: Pt[]; trees: number[][] }[];
  landmarks: { id: string; name: string; area: string; at: Pt; kind: string; rot: number }[];
  lamps: Pt[];
}

export const MAP = asset as unknown as MapAsset;

/**
 * A tree's canopy radius, before its own scale. It lives here rather than beside the
 * mesh that draws it because this file is the pure one: the sim walks people around
 * exactly the circle map-mesh.ts draws, and tests/native-imports.test.ts will not let
 * a file the app imports at startup reach into the one that imports three.
 */
export const TREE = 0.15;

/**
 * How much room each landmark takes on the ground, after the three-quarter scale the
 * mesh is drawn at. They are not buildings and were not in the walking test, so the
 * first walk ended up standing in the middle of the cricket stadium with the camera
 * inside the bowl (on the phone, 2026-09-22). Roughly the footprint of the widest
 * part of each, which is all a person walking past needs to be kept out of.
 */
export const LANDMARK_RADIUS: Record<string, number> = {
  dome: 0.62, tower: 0.26, palace: 0.6, temple: 0.36,
  glasshouse: 0.42, stadium: 0.72, fort: 0.5, bull: 0.46,
};

/**
 * What the sim needs of the map: per area, where to stand -- and everywhere, what
 * cannot be walked through. A building becomes the circle that fits inside its
 * footprint, so somebody may cut a corner but never cross the middle of one; a tree
 * becomes its canopy; a lake stays the shape it is.
 */
export function spotsFrom(map: MapAsset): MapSpots {
  const areas: Record<string, MapSpots['areas'][string]> = {};
  for (const a of map.areas) areas[a.id] = { home: a.home, centre: a.centre, radius: a.radius, spots: a.spots, polygon: a.polygon };
  const solids: Solid[] = [];
  for (const a of map.areas) {
    for (const b of a.blocks) solids.push({ x: b[0]!, z: b[1]!, r: (b[2]! + b[3]!) / 4 });
  }
  for (const p of map.parks) {
    for (const t of p.trees) solids.push({ x: t[0]!, z: t[1]!, r: TREE * (t[2] ?? 1) });
  }
  for (const l of map.landmarks) solids.push({ x: l.at[0], z: l.at[1], r: LANDMARK_RADIUS[l.kind] ?? 0.45 });
  return { central: CENTRAL_AREA, areas, solids, lakes: map.water.map((w) => w.polygon) };
}

/** The neighbourhood's name for an id; null (no answer) is the central tile. */
export function areaName(id: string | null | undefined): string {
  const key = id ?? CENTRAL_AREA;
  return AREAS.find((a) => a.id === key)?.name ?? MAP.areas.find((a) => a.id === key)?.name ?? key;
}

/** How the HUD frames the city: the band the map is centred in when zoomed out. */
export interface Frame { top: number; bottom: number; side: number }

/** Bengaluru is drawn as itself; any other city is still "the square". */
export const cityTitle = (city: string | null | undefined): string =>
  !city ? 'The square' : /bangalore|bengaluru/i.test(city) ? 'Bengaluru' : `${city} square`;
