/**
 * The town's edges, in words (hud.tsx TownBar and the bottom column). Plain, so it can be
 * tested without a phone.
 */

export interface Nudge { label: string; onPress: () => void }

/**
 * The ONE thing worth a tap now, most useful first: a question waiting for you (it came
 * from a meeting), then your first name (a reveal says "Someone" without it), then your
 * part of town (distance is guessed without it). They were three chips among eleven; now
 * one shows at a time, and the next when it is done.
 */
export function nudgeFor(
  wants: { question: boolean; askName: boolean; askArea: boolean },
  go: { question: () => void; name: () => void; area: () => void },
): Nudge | null {
  if (wants.question) return { label: 'A question for you', onPress: go.question };
  if (wants.askName) return { label: 'Add your first name', onPress: go.name };
  if (wants.askArea) return { label: 'Which part of town?', onPress: go.area };
  return null;
}

/**
 * Under "Send my agent out": how many people it can reach, and whether it can go out
 * again today. It said "5 visits left today" -- the visits to one person, a budget of
 * their own, counted in the agent's sheet -- under a button allowed once a day, which then
 * refused with "Your agent has been out enough for today" (the two-phone test, 2026-10-02).
 * An older server sends no count: then the people alone.
 */
export function townCounts(people: string, outsLeft: number | undefined): string {
  const here = `${people} people nearby`;
  if (outsLeft === undefined) return here;
  return `${here} · ${outsLeft === 0 ? 'out again tomorrow' : outsLeft === 1 ? 'can go out today' : `can go out ${outsLeft} more times today`}`;
}
