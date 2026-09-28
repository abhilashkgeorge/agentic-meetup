/**
 * What the two agents said to each other, as a card and the town show it.
 *
 * Pure, so the rules hold without a phone (tests/exchange.test.ts). Every word that
 * reaches the screen comes from one of four places: the fixed question bank on the
 * server (matching/answer-sheet.ts), a sentence a person typed -- checked there, word
 * for word, as theirs -- a fixed reaction, or "I don't know". The one exception is the
 * date idea, a suggestion the server checks says nothing about anybody (talk.ts
 * safeIdea). Nothing here writes a sentence about a person, and nothing fills in an
 * answer that is missing.
 *
 * TWO SOURCES, one screen. When the agents talked (server talk.ts) the card carries
 * their talk; when they did not -- the call failed, or it is switched off -- it carries
 * the answer-sheet exchange (`qa`), and the town plays that instead.
 */
import type { MatchCard, QaLine, Talk } from '../../lib/api';

export const DONT_KNOW = "I don't know";

/** One side's answer, and how it may be drawn. */
export type Said =
  /** Their own sentence, verbatim: the only kind drawn in quotation marks. */
  | { kind: 'words'; text: string }
  /** A practice profile's template: never in quotation marks, and labelled. */
  | { kind: 'practice'; text: string }
  /** Nothing they ever said answers it. */
  | { kind: 'dunno'; text: string };

const said = (text: string | null, practice = false): Said =>
  !text ? { kind: 'dunno', text: DONT_KNOW }
  : practice ? { kind: 'practice', text }
  : { kind: 'words', text };

/** A line nobody could answer says nothing; the server drops it too. */
const answered = (qa: readonly QaLine[] | undefined): QaLine[] =>
  (qa ?? []).filter((l) => l.theirs !== null || l.mine !== null);

export interface ExchangeRow { label: string; them: Said; you: Said }

/** The card's rows, in the server's order: the label, their answer, yours. */
export function exchangeRows(qa: readonly QaLine[] | undefined): ExchangeRow[] {
  return answered(qa).map((l) => ({ label: l.q, them: said(l.theirs, l.practice), you: said(l.mine) }));
}

/** How the card draws one answer: quotation marks for a person's own words only. */
export function sayOnCard(s: Said): string {
  return s.kind === 'words' ? `“${s.text}”` : s.kind === 'practice' ? `${s.text} (practice)` : s.text;
}

// ── the town ────────────────────────────────────────────────────────────────

export interface Bubble {
  who: 'you' | 'them';
  /** `react` is a fixed reaction; `date` is the agents' joint idea, drawn in the middle. */
  kind: 'ask' | Said['kind'] | 'react' | 'date';
  text: string;
}

/** How many questions the town plays before it hands over to the card. */
export const TOWN_QUESTIONS = 3;

/**
 * The questions the town plays: the first ones the card has, keeping room for one
 * "I don't know" when there is one -- an agent that says it rather than invent is the
 * point of the whole exchange, and the card lists every line anyway. Theirs first: it
 * is the one the card's "Ask them about ..." comes from.
 */
function townLines(qa: readonly QaLine[] | undefined, max: number): QaLine[] {
  const lines = answered(qa);
  const dunno = lines.find((l) => l.theirs === null) ?? lines.find((l) => l.mine === null);
  const rest = lines.filter((l) => l !== dunno);
  if (!dunno) return rest.slice(0, max);
  const out = rest.slice(0, max - 1);
  // Played where it sits on the card, so the order is still the server's.
  return [...out, dunno].sort((a, b) => lines.indexOf(a) - lines.indexOf(b));
}

/**
 * The exchange as speech. Per question: one agent asks, the other answers, and then
 * the asker answers the same question -- both agents answer every question, which is
 * the whole idea. Yours asks first; they take turns.
 */
export function bubblesFor(qa: readonly QaLine[] | undefined, max = TOWN_QUESTIONS): Bubble[] {
  const out: Bubble[] = [];
  townLines(qa, max).forEach((l, i) => {
    const asker = i % 2 === 0 ? 'you' : 'them';
    const other = asker === 'you' ? 'them' : 'you';
    out.push({ who: asker, kind: 'ask', text: l.ask });
    for (const who of [other, asker] as const) {
      const s = who === 'them' ? said(l.theirs, l.practice) : said(l.mine);
      out.push({ who, kind: s.kind, text: s.text });
    }
  });
  return out;
}

/**
 * The bubbles on screen once `shown` have played: the current question's, no more. A
 * date idea is a moment of its own.
 */
export function onScreen(bubbles: readonly Bubble[], shown: number): Bubble[] {
  const upto = bubbles.slice(0, Math.max(0, Math.min(shown, bubbles.length)));
  let start = 0;
  upto.forEach((b, i) => { if (b.kind === 'ask' || b.kind === 'date') start = i; });
  return upto.slice(start);
}

/**
 * The agents' talk as speech: every line in the order they said it, then the date
 * idea. Their person's words go out as `words` (or `practice`), and nothing else is
 * ever drawn as a quotation.
 */
export function talkBubbles(talk: Talk | null | undefined): Bubble[] {
  if (!talk) return [];
  const out: Bubble[] = talk.lines.map((l) => ({
    who: l.who,
    kind: l.kind === 'say' ? (l.practice ? 'practice' : 'words') : l.kind === 'dunno' ? 'dunno' : l.kind,
    text: l.kind === 'dunno' ? DONT_KNOW : l.text,
  }));
  if (talk.date) out.push({ who: 'you', kind: 'date', text: talk.date.idea });
  return out;
}

/** What the town plays for a card: the talk when there was one, else the exchange. */
export function bubblesForCard(card: MatchCard): Bubble[] {
  const talk = talkBubbles(card.talk);
  return talk.length ? talk : bubblesFor(card.qa);
}

/**
 * The card whose exchange the town plays when a round comes back: the first of that
 * round's own cards -- the newest `met` in /v1/matches, which lists a round's cards
 * together, newest round first -- that carries one. The list is the server's, so the
 * reveal rule is already applied: a card this person may not read yet is the plain
 * card, with no exchange, and is passed over.
 */
export function pickExchange(matches: readonly MatchCard[], met: number): MatchCard | null {
  return matches.slice(0, Math.max(0, met)).find((m) => bubblesForCard(m).length > 0) ?? null;
}

// ── the talk on a card ──────────────────────────────────────────────────────

/** One line of the chat as the card lists it. */
export interface ChatRow { speaker: 'Your agent' | 'Their agent'; text: string; dim: boolean }

/**
 * The talk as the card's "Read the chat" lists it. A person's own sentence is in
 * quotation marks -- and only that; a practice template is labelled; "I don't know" is
 * set back.
 */
export function chatRows(talk: Talk | null | undefined): ChatRow[] {
  return (talk?.lines ?? []).map((l) => ({
    speaker: l.who === 'you' ? 'Your agent' : 'Their agent',
    text: l.kind === 'say'
      ? sayOnCard(l.practice ? { kind: 'practice', text: l.text } : { kind: 'words', text: l.text })
      : l.kind === 'dunno' ? DONT_KNOW : l.text,
    dim: l.kind === 'dunno',
  }));
}

/** A shared pair or a date's reasons, as the card's two answers. */
export const sharedSaid = (x: { mine: string; theirs: string; practice?: boolean }): { them: Said; you: Said } => ({
  them: x.practice ? { kind: 'practice', text: x.theirs } : { kind: 'words', text: x.theirs },
  you: { kind: 'words', text: x.mine },
});

// ── what you asked for ──────────────────────────────────────────────────────

export const NOTHING_YET = "Nothing they've said covers this yet.";
export const CANT_CHECK = "We can't check this one yet.";
/**
 * A want on a private topic -- faith, drinking, smoking, kids, food, one person or open.
 * The same words whatever the check found, or whether it ran (the founder, 2026-09-28):
 * "Matches" beside "Someone who doesn't drink" told you their card answer, which they
 * were promised nobody ever sees. The check still moves people later in your agent's
 * list, quietly.
 */
export const PRIVATE_TOPIC = 'A private topic. Their answer is never shown.';

/**
 * One of your wants on the card: your words, then theirs -- or, for a private topic, only
 * whether it matches. `prefix` is "They said" when their words (or their silence) follow,
 * and null when a check does.
 */
export interface WantRowView { label: string; want: string; prefix: string | null; theirs: string; dim: boolean }

/**
 * Your wants as the card lists them. Your own words in quotation marks, then theirs in
 * quotation marks (a practice profile's labelled), or that nothing they said covers it.
 * Whether an ordinary want was met is never said -- the server does not send it. A want
 * tied to a question says only "Matches" or "Doesn't match", never beside a quote; one
 * about a private topic says only that it was checked privately; one nothing could
 * check says so. None is ever left off.
 */
export function wantRowsView(wants: MatchCard['wants']): WantRowView[] {
  return (wants ?? []).map((w) => {
    const label = w.kind === 'not' ? "You couldn't be with" : 'You asked for';
    const want = `“${w.want}”`;
    if (w.check) {
      const theirs = w.check === 'private' ? PRIVATE_TOPIC
        : w.check === 'matches' ? 'Matches' : w.check === 'doesnt_match' ? "Doesn't match" : CANT_CHECK;
      return { label, want, prefix: null, theirs, dim: w.check === 'cant_check' || w.check === 'private' };
    }
    return {
      label, want, prefix: 'They said',
      theirs: w.theirs === null ? NOTHING_YET
        : sayOnCard(w.practice ? { kind: 'practice', text: w.theirs } : { kind: 'words', text: w.theirs }),
      dim: w.theirs === null,
    };
  });
}
