/**
 * Things for two people to do together in Cubbon Park, and the points each is worth.
 *
 * WHAT THE FOUNDER ASKED (2026-09-29): "add more tasks couples can do in the park.
 * gameify it." So once two people are talking (the park's "Find someone"), there are
 * things to do together -- walk, ride, sit and talk, see the sights -- and each one done
 * pays both of them points, once a day each, which buy things for their character.
 *
 * THE SERVER DECIDES, from what it already knows: who is paired with whom (park/
 * pairs.ts), where each of them is and whether they are riding (park/room.ts), and how
 * many things each has said on a bench -- counted, never read. The phone only shows it.
 * Everything here is shared so the two say the same thing.
 *
 * Distances are park units, 8.1 m each (the app's cubbon.ts).
 */

export type ParkQuestId = 'hello' | 'walk' | 'ride' | 'talk' | 'sights';

export interface ParkQuest {
  id: ParkQuestId;
  /** What it is, and how to do it, in the words the phone shows. */
  title: string;
  how: string;
  /** How much of it makes it done: units walked or ridden, things said each, sights seen. */
  goal: number;
  points: number;
}

export const PARK_QUESTS: readonly ParkQuest[] = [
  { id: 'hello', title: 'Meet someone here', how: 'Find someone to talk to, and they say yes.', goal: 1, points: 10 },
  { id: 'walk', title: 'Walk together', how: 'Walk side by side for 250 m.', goal: 31, points: 15 },
  { id: 'ride', title: 'Ride together', how: 'Ride bikes side by side for 500 m.', goal: 62, points: 25 },
  { id: 'talk', title: 'Sit and talk', how: 'Sit on a bench and each say three things.', goal: 3, points: 20 },
  { id: 'sights', title: 'See the sights', how: 'Visit three of the park\'s sights together.', goal: 3, points: 30 },
];

/** How near two people must be to count as together: walking side by side, riding in step. */
export const TOGETHER_WALKING = 0.6;
export const TOGETHER_RIDING = 1.0;
/**
 * The fastest a pair's walk or ride counts at, units a second: anything quicker is not
 * a walk. A walk in the park is 0.57 units a second and a bicycle twice it.
 */
export const COUNTS_UP_TO = { walk: 0.8, ride: 1.6 } as const;

export interface ParkSight { id: string; name: string; x: number; z: number; r: number }

/**
 * The park's sights, where the app draws them (its survey, cubbon.ts): the statues,
 * the rock and the two buildings you would walk to. `r` is how near counts as there:
 * the buildings are big, a statue is not. tests (app park-quests) hold these to the park
 * the app draws, so the two cannot drift apart.
 */
export const PARK_SIGHTS: readonly ParkSight[] = [
  { id: 'lions', name: 'The Lions at the gate', x: 1.91, z: -29.93, r: 1.8 },
  { id: 'cubbon', name: 'Mark Cubbon Statue', x: 13.35, z: -18.23, r: 1.8 },
  { id: 'wodeyar', name: 'Chamarajendra Wodeyar Statue', x: -0.17, z: -3.7, r: 1.8 },
  { id: 'logo', name: 'The Bengaluru sign', x: -30.65, z: -20.79, r: 1.8 },
  { id: 'iyer', name: 'Seshadri Iyer Statue', x: -39.09, z: 20.1, r: 1.8 },
  { id: 'gneiss', name: 'The Peninsular Gneiss rock', x: 54.68, z: -36.6, r: 2.4 },
];

/** Today, in Bengaluru: what "once a day" counts in. */
export function parkDay(now: number): string {
  return new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10);
}
