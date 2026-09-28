/**
 * The real place behind the walkable world.
 *
 * The city map and a venue do not share coordinates. Bengaluru uses the small
 * OSM-derived coordinates in map.ts; a venue has its own origin, measured only
 * against the people and props inside it. `Venue` is the portal between them:
 * `mapAt` is where the marker lives in the city and the garden returned by
 * `venueGarden()` is the local world entered from it.
 *
 * V1 deliberately ships one place. More venues add rows here and their own art;
 * none of that changes the realm or roster contracts below.
 */
import { CENTRAL_AREA } from '@clone/shared';
import type { AgentSpec } from './bridge';
import { makeCubbon } from './cubbon';
import { makeGarden, type Garden } from './garden';
import type { Pt } from './sim';

export interface Venue {
  id: string;
  name: string;
  areaId: string;
  kind: 'park' | 'cafe' | 'lakeside' | 'rooftop';
  /** City-map coordinates. Never pass these to the venue simulation. */
  mapAt: Pt;
  /** A real-world search, used by the directions link without a paid places API. */
  mapQuery: string;
  description: string;
}

/**
 * The marker is inside the OSM Cubbon Park polygon bundled in bangalore.json.
 * The venue itself is a curated interpretation, not a claim to reproduce every path.
 */
export const CUBBON_PARK: Venue = {
  id: 'cubbon-park',
  name: 'Cubbon Park',
  areaId: 'mg-road',
  kind: 'park',
  mapAt: [-0.54, -0.64],
  mapQuery: 'Cubbon Park Bengaluru',
  description: 'A green walk in the middle of Bengaluru.',
};

export const VENUES = [CUBBON_PARK] as const;
/**
 * How many people are in the park at once.
 *
 * TWELVE WAS RIGHT FOR A GARDEN 26 UNITS ACROSS and is wrong for Cubbon Park. The
 * surveyed park is 147 by 171 units, nine times the area, and twelve people spread
 * over it is one person every two thousand square units -- so walking it, you meet
 * nobody, which is the one thing the park exists for (the founder's own reason for
 * building it: somewhere to meet real people rather than agents).
 *
 * Thirty-two is still sparse by any real measure -- Cubbon Park has thousands in it on
 * a Sunday. It was what the frame budget allowed while only twelve of them could have
 * a rigged body; since every body is drawn by the graphics chip (crowd-gpu.ts) the
 * test crowd of a thousand is the measure of what the park can hold, and this number
 * is the founder's to raise.
 */
export const MAX_VENUE_AGENTS = 32;

export type RealmPhase = 'city' | 'entering' | 'venue' | 'leaving';
export interface RealmState {
  phase: RealmPhase;
  venue: Venue | null;
}

export type RealmEvent =
  | { type: 'enter'; venue: Venue }
  | { type: 'entered' }
  | { type: 'leave' }
  | { type: 'left' };

export const CITY_REALM: RealmState = { phase: 'city', venue: null };

/**
 * Pure transition table so a delayed fade cannot strand the UI between worlds.
 * Invalid/repeated events are no-ops.
 */
export function transitionRealm(state: RealmState, event: RealmEvent): RealmState {
  switch (event.type) {
    case 'enter':
      return state.phase === 'city' ? { phase: 'entering', venue: event.venue } : state;
    case 'entered':
      return state.phase === 'entering' && state.venue ? { ...state, phase: 'venue' } : state;
    case 'leave':
      return state.phase === 'venue' && state.venue ? { ...state, phase: 'leaving' } : state;
    case 'left':
      return state.phase === 'leaving' ? CITY_REALM : state;
  }
}

/**
 * The local, deterministic ground used by the venue simulation and renderer.
 *
 * Cubbon Park is SURVEYED, not grown: its outline, paths, water, buildings and
 * statues come out of OpenStreetMap at the size the place actually is (see
 * `cubbon.ts`). Any other venue still gets a seeded garden, which is what a venue we
 * have not mapped deserves -- a plausible park rather than a wrong one.
 */
export function venueGarden(venue: Venue): Garden {
  return venue.id === CUBBON_PARK.id ? makeCubbon() : makeGarden(venue.id);
}

const kindOrder: Record<AgentSpec['kind'], number> = {
  you: 0,
  met: 1,
  stranger: 2,
  practice: 3,
};

/**
 * Who appears after entering a venue.
 *
 * The user always enters. Everyone else must actually be in the venue's
 * neighbourhood; null means the central MG Road area, as it does everywhere else.
 * A hard limit keeps rigged bodies and draw calls bounded. Sorting is stable from
 * roster data, so refreshes do not reshuffle the room.
 */
export function agentsForVenue(
  agents: readonly AgentSpec[],
  venue: Venue,
  limit = MAX_VENUE_AGENTS,
): AgentSpec[] {
  const eligible = agents.filter((a) =>
    a.kind === 'you' || (a.area ?? CENTRAL_AREA) === venue.areaId);
  eligible.sort((a, b) =>
    kindOrder[a.kind] - kindOrder[b.kind]
    || a.seed - b.seed
    || a.ref.localeCompare(b.ref));
  return eligible.slice(0, Math.max(1, limit)).map((a) => ({
    ...a,
    // A venue sim has one local area. Keeping the city area here would send the
    // person through that sim's missing-area fallback and hide the coordinate bug.
    area: venue.id,
  }));
}

export const directionsUrl = (venue: Venue): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.mapQuery)}`;
