/**
 * WHAT YOUR CLONE LEARNED IN CHAT, AND WHETHER IT MAY SAY SO (the founder, 2026-10-04:
 * "when the agent learns something from the chat, okay to share should be shown as a
 * card in the chat UI or on the town square map; if more cards are present, it should
 * move to a new screen with all the things the agent has learned about the user from
 * the chat, and a button to okay to share all too"). Plain, no React.
 *
 * What was there: the list existed -- "Learned in chat", each with an "OK to share" chip
 * -- three screens deep under "How you appear", and nothing anywhere said there was
 * anything in it.
 *
 * A learned sentence is used to find people and quoted to nobody until you say so
 * (server me.ts, extract.ts). "OK to share" makes it something your agent may say
 * (POST /v1/facts/:id/disclosure); "Keep private" leaves it exactly as it was and only
 * stops the asking (lib/storage.ts keepPrivate).
 */
export interface Learned { factId: string; text: string }

/** Up to this many are asked about one by one in the chat; more go to their own screen. */
export const CARDS_AT_ONCE = 2;

/** What is still to ask about: learned, not shared, not kept private. */
export function stillToAsk(learned: readonly Learned[] | undefined, kept: readonly string[]): Learned[] {
  return (learned ?? []).filter((l) => !kept.includes(l.factId));
}

/** What the chat shows: each, when there are a few; otherwise one card that opens the list. */
export type Cards = { kind: 'none' } | { kind: 'each'; items: Learned[] } | { kind: 'review'; count: number };

export function cardsFor(items: readonly Learned[]): Cards {
  if (!items.length) return { kind: 'none' };
  if (items.length <= CARDS_AT_ONCE) return { kind: 'each', items: [...items] };
  return { kind: 'review', count: items.length };
}

/** The town's button to your clone: and how many new things wait there. */
export function clonePill(count: number): { label: string; detail?: string } {
  return count > 0 ? { label: 'Your clone', detail: `· ${count} new` } : { label: 'Your clone' };
}
