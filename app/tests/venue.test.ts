/**
 * A venue is a portal between two coordinate spaces, not a renamed city tile.
 *
 * Negative controls:
 * - keep each agent's city `area` in agentsForVenue -> the local-area assertion fails;
 * - admit every city agent -> the Whitefield exclusion fails;
 * - skip the entering/leaving phases -> the transition assertions fail.
 */
import { describe, expect, it } from 'vitest';
import { lookFor } from '@clone/shared';
import type { AgentSpec } from '../src/features/world/bridge';
import {
  CITY_REALM, CUBBON_PARK, MAX_VENUE_AGENTS, agentsForVenue, directionsUrl,
  transitionRealm, venueGarden,
} from '../src/features/world/venue';

const agent = (ref: string, kind: AgentSpec['kind'], seed: number, area: string | null): AgentSpec => ({
  ref, kind, seed, area, ghost: kind === 'practice', look: lookFor(seed),
});

describe('a real date venue', () => {
  it('links a real city marker to a separate deterministic local world', () => {
    const a = venueGarden(CUBBON_PARK);
    const b = venueGarden(CUBBON_PARK);
    expect(a).toEqual(b);
    expect(a.id).toBe(CUBBON_PARK.id);
    expect(a.home).not.toEqual(CUBBON_PARK.mapAt);
    expect(Math.hypot(a.home[0], a.home[1])).toBeLessThan(a.radius);
    expect(CUBBON_PARK.areaId).toBe('mg-road');
  });

  it('takes only nearby agents, keeps the user, and writes venue-local area ids', () => {
    const roster = [
      agent('you', 'you', 7, 'whitefield'),
      agent('met-late', 'met', 9, 'mg-road'),
      agent('met-first', 'met', 2, null),
      agent('near', 'stranger', 4, 'mg-road'),
      agent('far', 'stranger', 1, 'whitefield'),
    ];
    const local = agentsForVenue(roster, CUBBON_PARK);
    expect(local.map((a) => a.ref)).toEqual(['you', 'met-first', 'met-late', 'near']);
    expect(local.some((a) => a.ref === 'far')).toBe(false);
    expect(local.every((a) => a.area === CUBBON_PARK.id)).toBe(true);
  });

  it('bounds a crowd without ever dropping the user', () => {
    // MORE THAN THE CAP, whatever the cap is. Written against a fixed thirty, this
    // stopped testing anything the day the park got big enough to want more people in
    // it: the roster was smaller than the limit and the limit was never reached.
    const roster = [
      ...Array.from({ length: MAX_VENUE_AGENTS + 20 }, (_, i) => agent(`p-${i}`, 'stranger', i, 'mg-road')),
      agent('you', 'you', 999, 'whitefield'),
    ];
    const local = agentsForVenue(roster, CUBBON_PARK);
    expect(local).toHaveLength(MAX_VENUE_AGENTS);
    expect(local[0]!.ref).toBe('you');
  });

  it('crosses explicit transition phases and ignores events in the wrong phase', () => {
    const entering = transitionRealm(CITY_REALM, { type: 'enter', venue: CUBBON_PARK });
    expect(entering).toEqual({ phase: 'entering', venue: CUBBON_PARK });
    expect(transitionRealm(entering, { type: 'leave' })).toBe(entering);
    const inside = transitionRealm(entering, { type: 'entered' });
    expect(inside.phase).toBe('venue');
    const leaving = transitionRealm(inside, { type: 'leave' });
    expect(leaving.phase).toBe('leaving');
    expect(transitionRealm(leaving, { type: 'left' })).toEqual(CITY_REALM);
  });

  it('opens directions without a paid places API', () => {
    expect(directionsUrl(CUBBON_PARK)).toContain('google.com/maps/search/');
    expect(directionsUrl(CUBBON_PARK)).toContain('Cubbon%20Park%20Bengaluru');
  });
});
