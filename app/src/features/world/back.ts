/**
 * What Android's Back does on the town screen: close what is open, topmost first, and in
 * Cubbon Park go back to the city -- only with nothing open does it leave the app.
 *
 * Nothing on this screen listened for Back, so with a sheet open -- talking to your agent,
 * the people list, a stranger's card, the park's "Things to do" -- it closed the whole app,
 * and from inside the park it did the same instead of walking you back to Bengaluru (on the
 * Pixel 6a, 2026-09-30). The pure half, so the order is tested without a phone.
 */
export interface BackState {
  /** Talking to your own agent. */
  chat: boolean;
  /** Somebody really in the park, tapped. */
  live: boolean;
  /** A stranger or a match in the town, tapped. */
  agent: boolean;
  quests: boolean;
  voices: boolean;
  people: boolean;
  /** What the two agents said, over the map after a round. */
  exchange: boolean;
  /** In Cubbon Park: Back is "‹ Bengaluru". */
  inPark: boolean;
  /** Entering or leaving the park: Back waits rather than quitting halfway. */
  moving: boolean;
}

export type BackStep = Exclude<keyof BackState, 'moving'> | 'wait' | null;

/** The one thing Back does now; null lets it leave the app. */
export function backStep(s: BackState): BackStep {
  if (s.moving) return 'wait';
  // What was opened from another thing sits on top of it: the chat and a person's card are
  // opened from the people list, and all of them over the park.
  for (const k of ['chat', 'live', 'agent', 'quests', 'voices', 'people', 'exchange', 'inPark'] as const) {
    if (s[k]) return k;
  }
  return null;
}
