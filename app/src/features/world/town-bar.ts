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

/** Under the button: how many people it can reach, and visits left today. */
export function townCounts(people: string, visitsLeft: number): string {
  return `${people} people nearby · ${visitsLeft} ${visitsLeft === 1 ? 'visit' : 'visits'} left today`;
}
