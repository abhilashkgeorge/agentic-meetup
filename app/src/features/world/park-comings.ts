/**
 * Who has just come into the park near you, and who has just gone (the founder,
 * 2026-10-03: "show a smoke magical effect when someone joins" -- and then, of the smoke,
 * "doesn't look good ... like the emergency pickup feature in PUBG"). Somebody who comes
 * in comes down by parachute; somebody who goes is taken up by the plane (flight.ts drop
 * and away) -- each phone plays both for itself, so nothing about them is sent.
 *
 * Not for the crowd already here as you walk in (they did not just arrive), not for
 * somebody who simply walked into or out of range (further than NEAR by then), and not
 * for somebody mid-pickup, whose flight is already being shown.
 */

/** How far away a coming or going may be for it to be worth showing: well inside the mist. */
export const NEAR = 15;

type Here = ReadonlyMap<string, { x: number; z: number; fly?: unknown }>;

export function comings(before: Here, after: Here, me: { x: number; z: number } | null, first: boolean): { came: string[]; went: string[] } {
  if (first || !me) return { came: [], went: [] };
  const near = (p: { x: number; z: number }) => Math.hypot(p.x - me.x, p.z - me.z) <= NEAR;
  const came: string[] = [];
  const went: string[] = [];
  for (const [ref, p] of after) if (!before.has(ref) && !p.fly && near(p)) came.push(ref);
  for (const [ref, p] of before) if (!after.has(ref) && !p.fly && near(p)) went.push(ref);
  return { came, went };
}
