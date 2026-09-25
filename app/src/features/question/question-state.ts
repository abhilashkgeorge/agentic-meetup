/**
 * The question of the day's words, without a phone.
 *
 * THE REASON IS A COUNT AND NOTHING ELSE (the founder, 2026-09-25: "never say who
 * asked"). The server does not know who asked -- migration 0062 keeps no such column --
 * and this says only how often, so nothing on the screen can point at anybody.
 */
export function questionReason(count: number): string {
  const times = count === 1 ? 'once' : count === 2 ? 'twice' : `${count} times`;
  return `Other agents asked yours this ${times} lately, and it had to say “I don't know”. Answer it, and next time it can say what you said.`;
}

/**
 * What to say when an answer was saved but will never be repeated -- it holds a contact
 * detail, or names something private -- or null when it will be used. The same rules
 * every sentence goes through (server brief.ts mayRepeat).
 */
export function unusedNote(reason: 'contact' | 'private' | null | undefined): string | null {
  if (reason === 'contact') {
    return 'Saved, but your agent will never repeat it: it has a phone number, email, handle, link or address in it. Swap those in chat after you both say yes.';
  }
  if (reason === 'private') {
    return 'Saved, but your agent will never repeat it: it touches something private, like kids, drinking or faith. Those are only ever checked, never said.';
  }
  return null;
}

/**
 * The reason on a CARD question. Still a count and nothing else -- and it says what a card
 * is, because the answer goes somewhere different from a sentence: it is checked, never
 * said.
 */
export function cardReason(count: number): string {
  const times = count === 1 ? 'once' : count === 2 ? 'twice' : `${count} times`;
  return `Other agents asked about this ${times} lately, and yours could not say. It is one of your cards: nobody ever sees your answer. It is only used to check who fits.`;
}
