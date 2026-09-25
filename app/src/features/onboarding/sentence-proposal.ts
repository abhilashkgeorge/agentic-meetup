/**
 * What happens after "Anyone else you couldn't be with?". Plain state, no React.
 *
 * THE MODEL PROPOSES AND THE PERSON DECIDES. The sentence used to become a hard rule
 * the moment a model read it: one line, mapped by a model, silently removing people
 * from somebody's pool -- and a wrong mapping is invisible, because nobody sees who it
 * removed. Now the server maps it onto one of the five cards and sends back a
 * PROPOSAL: that card's Who's-fine row with the options the sentence ruled out already
 * unticked. Nothing changes until the person looks at it and taps "Keep this".
 *
 * PRESET IS RIGHT HERE, and it is not the pre-ticked row core-card.ts forbids. A card
 * opens empty because a default would stand in for a choice the person never made.
 * This row is preset FROM THE PERSON'S OWN WORDS, one screen after they typed them,
 * and the whole point of the step is that they check it. They can still tick anybody
 * back in; the last option cannot be unticked, for the same reason as on the card: a
 * rule that accepts nobody is an empty pool with nothing on screen to say why.
 *
 * Three outcomes, and the screen draws each one:
 *   confirm   the sentence lands on a card and would change it
 *   note      it was read, and either names no card ("talks through films") or the
 *             card already says it -- the person is told which, not left guessing
 *   next      nothing to say: the sentence was skipped, or mapping failed (the
 *             sentence is saved either way; a failed mapping costs a proposal, not
 *             the answer)
 */
import type { SentenceProposal, WhoFine } from '../../lib/api';

export interface ProposalState {
  questionId: string;
  /** Which card: its own question. */
  card: string;
  text: string;
  options: { value: string; label: string }[];
  accepted: string[];
}

/** Said when the sentence is about something no card holds. */
export const NO_CARD_NOTE = "We can't check that on paper. You'll spot it in the first chat.";
/** Said when a card already rules out what the sentence names. */
export const COVERED_NOTE = 'Your cards already cover that.';

export type AfterSentence =
  | { kind: 'confirm'; proposal: ProposalState }
  | { kind: 'note'; text: string }
  | { kind: 'next' };

/** What the answer route said about the sentence, turned into what the screen shows. */
export function afterSentence(
  mapped: { predicate: string | null; proposal?: SentenceProposal | null } | null | undefined,
): AfterSentence {
  if (!mapped) return { kind: 'next' };
  if (mapped.proposal) return { kind: 'confirm', proposal: fromProposal(mapped.proposal) };
  return { kind: 'note', text: mapped.predicate ? COVERED_NOTE : NO_CARD_NOTE };
}

/** The proposal as the person first sees it: what their sentence would keep. */
export function fromProposal(p: SentenceProposal): ProposalState {
  const known = new Set(p.options.map((o) => o.value));
  const accepted = p.accept.filter((v) => known.has(v));
  return { questionId: p.questionId, card: p.card, text: p.text, options: p.options, accepted };
}

/** A tap on one option. The last one ticked stays ticked. */
export function toggleProposed(s: ProposalState, value: string): ProposalState {
  const on = s.accepted.includes(value);
  if (on && s.accepted.length === 1) return s;
  const accepted = on ? s.accepted.filter((v) => v !== value) : [...s.accepted, value];
  // Card order, so two people who tick the same boxes send the same rule.
  const order = s.options.map((o) => o.value);
  accepted.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { ...s, accepted };
}

/** What "Keep this" sends. Every option ticked is "anyone", said the long way. */
export function proposedWhoFine(s: ProposalState): WhoFine {
  return s.accepted.length === s.options.length ? { anyone: true } : { only: s.accepted };
}
