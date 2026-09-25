/**
 * The "How you appear" list after a Hide or Show tap, before the server answers.
 *
 * Plain state, so the one rule that matters is tested without a phone: which sentences
 * are ON A CARD. A card carries up to two of a person's own sentences -- the first two
 * visible ones, identical wording counted once -- and a hidden one never. The server
 * says the same thing (server/src/api/me.ts); this repeats it so a tap moves the "On
 * your card" marks at once instead of after a round trip, and the next load confirms.
 *
 * THE ANSWER SHEET moves with the same tap. A sentence is hidden everywhere or nowhere
 * -- one disclosure on one fact -- so hiding an answer takes it off a card as well, and
 * an answer hidden from the sheet goes to the hidden list, where it can be shown again.
 * Showing one again brings it back to the list only: which question it answers is the
 * server's to say, on the next load.
 */
import type { Appearance, SheetEntry } from '../../lib/api';

export const QUOTES_ON_A_CARD = 2;

/** Recompute `shown` over the list as it stands. */
export function markShown(quotes: Appearance['quotes']): Appearance['quotes'] {
  const seen = new Set<string>();
  let onCard = 0;
  return quotes.map((q) => {
    const key = q.text.toLowerCase();
    const fresh = !seen.has(key);
    seen.add(key);
    const shown = !q.hidden && fresh && onCard < QUOTES_ON_A_CARD;
    if (shown) onCard++;
    return { ...q, shown };
  });
}

/** One sentence hidden or shown again, and the card marks and the sheet moved to match. */
export function withHidden(a: Appearance, factId: string, hidden: boolean): Appearance {
  const quotes = markShown(a.quotes.map((q) => (q.factId === factId ? { ...q, hidden } : q)));
  const listed = a.quotes.some((q) => q.factId === factId);
  const answer = a.sheet?.find((q) => q.answer?.factId === factId)?.answer ?? null;
  const rest = (a.hidden ?? []).filter((h) => h.factId !== factId);
  return {
    ...a,
    quotes,
    ...(a.sheet ? { sheet: a.sheet.map((q) => (hidden && q.answer?.factId === factId ? { ...q, answer: null } : q)) } : {}),
    // A quote has its own Show above; anything else hidden from the sheet is listed here.
    hidden: hidden && answer && !listed ? [...rest, { factId, text: answer.text }] : rest,
  };
}

/** The sheet as the screen lays it out: what your agent answers, then what it cannot. */
export function sheetView(sheet: readonly SheetEntry[] | undefined): {
  answered: (SheetEntry & { answer: NonNullable<SheetEntry['answer']> })[];
  unknown: string[];
} {
  const answered = (sheet ?? []).filter((q): q is SheetEntry & { answer: NonNullable<SheetEntry['answer']> } => q.answer !== null);
  return { answered, unknown: (sheet ?? []).filter((q) => q.answer === null).map((q) => q.short) };
}
