/**
 * One core card: "You", and "Your partner". Plain state, no React, so the rule that
 * matters can be tested without a phone.
 *
 * WHAT THIS REPLACES. The interview used to ask about you ("Do you smoke?") and then,
 * on a separate screen, whether you could be with somebody different ("Could you be
 * with a smoker?"). The second answer was turned into "same as me": a daily smoker who
 * said No got a rule that only daily smokers passed. Four questions worked that way and
 * are gone from the bank; each of the five core cards now asks both halves on one
 * screen, and the second half names the options you accept instead of a strength.
 *
 * THE ONE RULE HERE: THE PARTNER ROW STARTS EMPTY. Nothing on it arrives ticked.
 * Defaults stick (Johnson & Goldstein 2003, organ donation: the box that comes ticked
 * is the answer most people give), and a row that arrives ticked makes people look more
 * open than they are -- their agent then brings them the smoker they would have ruled
 * out, and it reads as the agent not listening. So the person makes an explicit tap,
 * and Next stays dead until they have.
 *
 * THE PARTNER ROW IS THE SAME CHIPS AS THE YOU ROW (2026-09-24). It used to open on two
 * choices, "Anyone is fine" and "Let me choose", and only the second showed the
 * options, every one ticked for the person to untick. The founder, trying it: "why is
 * it in the partner the options shown only after I click let me choose. give the same
 * boxes". So the options are there from the start, none ticked; the person taps every
 * one that is okay, or "All are okay" for the lot in one tap. Every option left
 * unticked becomes a hard rule on the server, as before. Untick the last one and the
 * row is unanswered again: a list that accepts nobody is not a preference, it is an
 * empty pool with nothing on the screen to say why.
 */
import type { WhoFine } from '../../lib/api';

/** The You row. `declined` is "Prefer not to say", which is an answer. */
export type You =
  | { kind: 'unset' }
  | { kind: 'declined' }
  | { kind: 'picked'; values: string[] };

/** The partner row. `unset` is the only state a card may open in. */
export type Who =
  | { kind: 'unset' }
  | { kind: 'anyone' }
  | { kind: 'choose'; accepted: string[] };

export interface CardState { you: You; who: Who }

/** How every card opens: nothing on either row. */
export const emptyCard = (): CardState => ({ you: { kind: 'unset' }, who: { kind: 'unset' } });

/**
 * A tap on one of the You options. Single-choice replaces; multi-choice toggles, and
 * untoggling the last one puts the row back to unanswered rather than to "nothing",
 * because an empty pick is not an answer anybody gave.
 */
export function pickYou(s: CardState, value: string, multi: boolean): CardState {
  if (!multi) return { ...s, you: { kind: 'picked', values: [value] } };
  const had = s.you.kind === 'picked' ? s.you.values : [];
  const values = had.includes(value) ? had.filter((v) => v !== value) : [...had, value];
  return { ...s, you: values.length ? { kind: 'picked', values } : { kind: 'unset' } };
}

/** "Prefer not to say". Clears any option picked on the same row. */
export const declineYou = (s: CardState): CardState => ({ ...s, you: { kind: 'declined' } });

/** Whether one option shows ticked on the partner row. */
export const isFine = (s: CardState, value: string): boolean =>
  s.who.kind === 'anyone' || (s.who.kind === 'choose' && s.who.accepted.includes(value));

/** Whether every option is ticked: what "All are okay" shows. */
export const isAllFine = (s: CardState, options: readonly string[]): boolean =>
  options.every((o) => isFine(s, o));

/**
 * A tap on one option of the partner row: ticks it, or unticks it. Kept in the card's
 * own option order, so what is sent reads the way the screen did. Unticking the last
 * one leaves the row unanswered, never answered with nobody.
 */
export function toggleFine(s: CardState, value: string, options: readonly string[]): CardState {
  const had = options.filter((o) => isFine(s, o));
  const next = had.includes(value) ? had.filter((v) => v !== value) : [...had, value];
  const accepted = options.filter((o) => next.includes(o));
  return { ...s, who: accepted.length ? { kind: 'choose', accepted } : { kind: 'unset' } };
}

/**
 * "All are okay": every option in one tap, which writes no rule but is recorded as a
 * choice. Tapped again with everything ticked, it clears the row.
 */
export const allFine = (s: CardState, options: readonly string[]): CardState =>
  ({ ...s, who: isAllFine(s, options) ? { kind: 'unset' } : { kind: 'anyone' } });

/** Both rows answered, explicitly. The only thing that enables Next on a core card. */
export const canSubmit = (s: CardState): boolean =>
  s.you.kind !== 'unset'
  && s.who.kind !== 'unset'
  && (s.who.kind !== 'choose' || s.who.accepted.length > 0);

/**
 * What goes to POST /v1/interview/answer, or null while the card is not finished.
 *
 * `values: []` is "Prefer not to say" for the You row; the partner row is sent either
 * way, because it is about other people and still applies. Every option ticked one by
 * one is sent as the whole list -- the server treats that as anyone, and keeps the
 * record that the person went through the options and left none out.
 */
export function cardAnswer(s: CardState): { values: string[]; whoFine: WhoFine } | null {
  if (!canSubmit(s)) return null;
  const values = s.you.kind === 'picked' ? s.you.values : [];
  const whoFine: WhoFine = s.who.kind === 'choose' ? { only: s.who.accepted } : { anyone: true };
  return { values, whoFine };
}
