/**
 * Which waiting card is in front, and how many more there are (the founder, 2026-09-29:
 * "Show every waiting card, or at least '2 more waiting', so none expire unseen").
 *
 * The screen shows one card at a time on purpose (matches-screen.tsx): a list of people
 * reads as a menu. But the one in front used to be simply the first of the list -- newest
 * round first -- and the others sat unseen until each ran out of its three days. Now the
 * one in front is always the one that fades SOONEST, so a card can only run out while it is
 * the one on screen; and under it, how many more are waiting. Ordered by time left, never
 * by anything about the person.
 */
export interface Waiting { waitingOnYou?: boolean; fadesAt?: string | null }

/** Waiting cards, the soonest to fade first; a card with no end date last; ties keep their order. */
export function soonestFirst<T extends Waiting>(cards: readonly T[]): T[] {
  const end = (c: T) => (c.fadesAt ? Date.parse(c.fadesAt) : Number.POSITIVE_INFINITY);
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => end(a.c) - end(b.c) || a.i - b.i)
    .map(({ c }) => c);
}

/** The line under the card in front: "1 more waiting", "2 more waiting". */
export const moreWaiting = (n: number): string | null => (n > 0 ? `${n} more waiting` : null);
