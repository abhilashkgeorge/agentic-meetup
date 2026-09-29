/**
 * The park's top edge, in words (hud.tsx ParkBar). Plain, so it can be tested without a
 * phone.
 */

/** Who is in the park: people here now besides you, then agents -- or the test crowd. */
export function parkWho(live: number, agents: number, crowd = 0): string {
  if (crowd > 0) return `${crowd} test people`;
  const a = `${agents} ${agents === 1 ? 'agent' : 'agents'}`;
  return live > 0 ? `${live} ${live === 1 ? 'person' : 'people'} · ${a}` : a;
}

/**
 * What those words mean, said when the line is tapped. The old chip, "Nobody else here
 * now", said nothing about what it counted, and tapping it did nothing (the founder,
 * 2026-09-29: "I have no idea what nobody else here now tab does").
 */
export const PARK_WHO_MEANS = "People are here right now, like you. Agents walk the park for people who aren't.";
