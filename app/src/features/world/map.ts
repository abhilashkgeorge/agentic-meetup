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
import type { MapSpots, Pt } from './sim';

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

/** What the sim needs of the map: per area, where to stand. */
export function spotsFrom(map: MapAsset): MapSpots {
  const areas: Record<string, MapSpots['areas'][string]> = {};
  for (const a of map.areas) areas[a.id] = { home: a.home, centre: a.centre, radius: a.radius, spots: a.spots };
  return { central: CENTRAL_AREA, areas };
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
