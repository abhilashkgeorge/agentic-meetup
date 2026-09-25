/**
 * Wants: what a person said they want in someone -- or could not be with -- checked
 * against the other person's own sentences. Evidence, never a verdict.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-25). For each free-text want, read the other
 * person's own sentences and mark met / not met / unknown, ALWAYS citing the exact
 * quote. It never excludes anyone; it can only lower the rank. And the brief shows her
 * want next to his quote -- not a verdict word. So:
 *   - a person is never filtered out by this: the cards and SQL decide who is possible,
 *     and nothing here removes anybody from that;
 *   - a not-met want moves a candidate later in the round's pick order, within their own
 *     group (real people stay ahead of practice profiles -- candidates.ts), and a met
 *     one moves nobody up. Only down;
 *   - the card carries the want and the quote side by side; the status is kept on the
 *     stored brief for measurement and never sent to a phone (brief.ts readBrief).
 *
 * WHERE WANTS COME FROM: the person's own `seeking` and `dealbreaker` sentences -- the
 * interview's "Anyone else you couldn't be with?", what chat heard them say they look
 * for, and "What would you love in someone?" on the stories screen. Split into single
 * sentences, five at most.
 *
 * NEVER DROPPED SILENTLY (the founder, 2026-09-25). Every want is on the card. One that
 * touches a private topic -- kids, one person or open, smoking, drinking, food, faith --
 * is CHECK-ONLY: the model maps it to the card it is about and the answers on that card
 * that satisfy it (it is never shown anybody's answer), and code compares the other
 * person's card answer: "Matches" / "Doesn't match", never a quote. One that cannot be
 * checked -- no card covers it, they have not answered that card, or the check did not
 * run -- says "We can't check this one yet".
 *
 * THE MODEL POINTS, AS EVERYWHERE ELSE (talk.ts). It returns, per want and person, a
 * status and the NUMBER of the person's own sentence that shows it. A met or not-met
 * with no valid number is unknown. Every quote shown is looked up from the number.
 */
import { z } from 'zod';
import { matchmakerSession, tenantSession } from '../db/client.js';
import { llm, modelFor } from '../llm/index.js';
import { log } from '../log.js';
import { loadQuotes, mayRepeat, namesCoreValue, type WantRow } from './brief.js';
import { ALL_CARDS, BY_ID } from '../onboarding/questions.js';
import { TALK_SOURCES, practiceSentences, type TalkSentence } from './talk.js';

export const WANT_SOURCES = ['seeking', 'dealbreaker'] as const;
export const MAX_WANTS = 5;

/**
 * One want: the person's own words, whether it is something wanted or ruled out, and
 * whether it touches a private topic -- checked against a card, never quoted.
 */
export interface Want { text: string; kind: 'wants' | 'not'; private: boolean }

/** `cant_check`: nothing could check it -- said on the card, never left off it. */
export type WantStatus = 'met' | 'not_met' | 'unknown' | 'cant_check';

/** One want checked against one person: the status, and their sentence that shows it. */
export interface WantResult {
  want: string; kind: Want['kind']; status: WantStatus; quote: string | null;
  private?: boolean; practice?: boolean;
  /** A private want's card, when the model mapped it onto one (card answers are read by code). */
  card?: string;
}

/**
 * The cards a private want is checked against, with the answers each can have: the
 * five, and faith. A person's card answer is read by code; the model only ever sees
 * this list and the want.
 */
export const WANT_CARDS: ReadonlyMap<string, readonly string[]> = new Map(
  ALL_CARDS.map((c) => [c.predicate, BY_ID.get(c.id)!.options.map((o) => o.value)]),
);

/** A sentence at a time: "Must love dogs. Someone who reads." is two wants. */
export function splitWants(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim().replace(/[.!;]+$/, '').trim()).filter((s) => s.length >= 4);
}

/** A person's wants, read as them. Never throws: no wants is an ordinary answer. */
export async function loadWants(who: { tenantId: string; userId: string }): Promise<Want[]> {
  try {
    const rows = await tenantSession(who, async (c) => (await c.query<{ predicate: string; object_text: string }>(
      `SELECT predicate, object_text FROM facts
        WHERE user_id = $1 AND predicate = ANY($2) AND status = 'active' AND valid_to IS NULL
        ORDER BY recorded_at DESC`,
      [who.userId, [...WANT_SOURCES]])).rows);
    const out: Want[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      for (const text of splitWants(r.object_text)) {
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ text, kind: r.predicate === 'dealbreaker' ? 'not' : 'wants', private: namesCoreValue(text) });
      }
    }
    return out.slice(0, MAX_WANTS);
  } catch (err) {
    log.warn({ err, userId: who.userId }, 'wants not read');
    return [];
  }
}

// ── the check ───────────────────────────────────────────────────────────────

/** No nullable field: "no sentence" is 0, which every provider can say. */
export const WantsOut = z.object({
  checks: z.array(z.object({
    person: z.number().int(),
    want: z.number().int(),
    status: z.enum(['met', 'not_met', 'unknown']),
    sentence: z.number().int(),
  })),
  // For each PRIVATE want: the card it is about, and the answers on it that satisfy
  // it. Card "" when it is about none of them.
  // Defaulted: a reply for wants that are none of them private need not carry it.
  cards: z.array(z.object({ want: z.number().int(), card: z.string(), values: z.array(z.string()) })).default([]),
});

const INSTRUCTIONS = `You check what one person asked for in a partner against what other people wrote about themselves.

For EVERY want and EVERY person, give one entry:
- "met": one of THAT person's own numbered sentences clearly shows the want is satisfied. Give its number.
- "not_met": one of THAT person's own numbered sentences clearly shows it is not. Give its number.
- "unknown": nothing they wrote settles it. Use sentence 0.

A want marked "could not be with" is satisfied when the sentence shows the person is NOT that way, and not met when the sentence shows they ARE.

Judge only from the one sentence you cite. Never infer from anything else and never guess: when in doubt, "unknown". A wrong answer puts words next to a want that do not answer it.

Some wants are marked PRIVATE. Never use anybody's sentences for those, and give no "checks" entries for them. Instead, under "cards", give the card from CARDS that the want is about and EVERY answer on that card that satisfies it (for a "could not be with" want, the answers that are fine). Use card "" when the want is about none of them.`;

/**
 * THE ONLY READER OF THE REPLY. Pure. Per person, per want: the first entry for that
 * pair; met or not_met only with a valid number from that person's list, otherwise
 * unknown; anything missing is unknown. The quote is looked up, never taken from the
 * reply.
 */
export function readWantChecks(
  parsed: unknown,
  wants: readonly Want[],
  people: readonly (readonly TalkSentence[])[],
  /** Each person's card answers (match_profile.traits), for the private wants. */
  cardsOf: readonly (Readonly<Record<string, unknown>> | null)[] = [],
): WantResult[][] {
  const p = WantsOut.safeParse(parsed);
  const first = new Map<string, z.infer<typeof WantsOut>['checks'][number]>();
  const mapped = new Map<number, { card: string; values: Set<string> }>();
  if (p.success) {
    for (const c of p.data.checks) {
      const key = `${c.person}:${c.want}`;
      if (!first.has(key)) first.set(key, c);
    }
    // A mapping counts only onto a real card, with every value one that card has.
    for (const m of p.data.cards) {
      const options = WANT_CARDS.get(m.card);
      if (mapped.has(m.want) || !options || !m.values.length || !m.values.every((v) => options.includes(v))) continue;
      mapped.set(m.want, { card: m.card, values: new Set(m.values) });
    }
  }
  return people.map((list, pi) => wants.map((w, wi) => {
    if (w.private) {
      // CHECK-ONLY. Their card answer against what satisfies the want -- by code -- and
      // never a quote. No card, or no answer on it: it cannot be checked, and says so.
      const m = mapped.get(wi + 1);
      const answer = m ? cardsOf[pi]?.[m.card] : undefined;
      const status: WantStatus = !m || typeof answer !== 'string' ? 'cant_check'
        : m.values.has(answer) ? 'met' : 'not_met';
      return { want: w.text, kind: w.kind, status, quote: null, private: true, ...(m ? { card: m.card } : {}) };
    }
    const c = first.get(`${pi + 1}:${wi + 1}`);
    const s = c && c.status !== 'unknown' && c.sentence >= 1 && c.sentence <= list.length ? list[c.sentence - 1]! : null;
    if (!c || !s || !mayRepeat(s.text)) return { want: w.text, kind: w.kind, status: 'unknown' as const, quote: null };
    return { want: w.text, kind: w.kind, status: c.status, quote: s.text, ...(s.practice ? { practice: true } : {}) };
  }));
}

/**
 * One reader's wants against several people's sentences, in one call. Must run under an
 * open meter. Null when there is nothing to check or the call fails -- the round then
 * goes on exactly as it would have without wants. Never throws.
 */
export async function checkWants(
  who: { tenantId: string; userId: string },
  wants: readonly Want[],
  people: readonly (readonly TalkSentence[])[],
  cardsOf: readonly (Readonly<Record<string, unknown>> | null)[] = [],
): Promise<{ results: WantResult[][]; costUsd: number } | null> {
  if (!wants.length || !people.length) return null;
  try {
    const wantLines = wants.map((w, i) =>
      `${i + 1}. ${w.private ? 'PRIVATE ' : ''}${w.kind === 'not' ? 'Could not be with: ' : 'Wants: '}${w.text}`).join('\n');
    const peopleText = people.map((list, i) =>
      `PERSON ${i + 1}\n${list.map((s, j) => `${j + 1}. ${s.text}`).join('\n') || '(nothing written)'}`).join('\n\n');
    // The cards and their possible answers -- never anybody's own answer.
    const cardsText = [...WANT_CARDS].map(([card, values]) => `${card}: ${values.join(', ')}`).join('\n');
    const res = await llm.complete(
      {
        task: 'extract',
        instructions: INSTRUCTIONS,
        messages: [{ role: 'user', content: `WANTS\n${wantLines}\n\n${peopleText}\n\nCARDS\n${cardsText}` }],
        tenantId: who.tenantId,
        userId: who.userId,
        outputSchema: WantsOut,
        outputSchemaName: 'want_checks',
        maxOutputTokens: 2000,
        thinking: false,
      },
      modelFor('extract'),
    );
    const results = readWantChecks(res.parsed, wants, people, cardsOf);
    log.info({ userId: who.userId, wants: wants.length, people: people.length,
               notMet: results.flat().filter((r) => r.status === 'not_met').length }, 'wants checked');
    return { results, costUsd: res.usage.costUsd };
  } catch (err) {
    log.warn({ err, userId: who.userId }, 'wants not checked; the pick order stands');
    return null;
  }
}

/**
 * How many of each candidate's wants were not met: what `demote` sorts on. A met want
 * counts nothing -- it must never lift anybody -- and neither does an unknown one.
 */
export function notMetCounts(byId: ReadonlyMap<string, readonly WantResult[]>): Map<string, number> {
  return new Map([...byId].map(([id, rs]) => [id, rs.filter((r) => r.status === 'not_met').length]));
}

/**
 * ONLY DOWN. The round's pick order with every candidate who has a not-met want moved
 * behind those who have none -- fewer not-mets first -- inside their own group, so a
 * real person is never put behind a practice profile by this. Met and unknown move
 * nobody. Stable: equal candidates keep the candidate query's order.
 */
export function demote<T extends { userId: string; synthetic: boolean }>(
  order: readonly T[],
  notMet: ReadonlyMap<string, number>,
): T[] {
  const key = (c: T, i: number) => [c.synthetic ? 1 : 0, notMet.get(c.userId) ?? 0, i] as const;
  return order
    .map((c, i) => ({ c, k: key(c, i) }))
    .sort((x, y) => x.k[0] - y.k[0] || x.k[1] - y.k[1] || x.k[2] - y.k[2])
    .map((x) => x.c);
}

// ── the round's shortlist ───────────────────────────────────────────────────

/** How many of the shortlist are checked, and how many sentences of each. */
export const WANT_WINDOW = 12;
export const WANT_SENTENCES = 10;

/**
 * The starter's wants against the first WANT_WINDOW of the shortlist: each person's own
 * sentences -- a real person's through the quote check under their own session, an
 * invented one's template lines -- then one call. Must run under an open meter. Null
 * when the call did not happen or failed; the order then stands.
 */
export async function checkShortlist(
  who: { tenantId: string; userId: string },
  wants: readonly Want[],
  order: readonly { userId: string; tenantId: string; synthetic: boolean }[],
): Promise<{ byId: Map<string, WantResult[]>; costUsd: number } | null> {
  const checked = order.slice(0, WANT_WINDOW);
  const people: TalkSentence[][] = [];
  for (const cand of checked) {
    people.push(cand.synthetic
      ? (await matchmakerSession((c) => practiceSentences(c, cand.userId))).slice(0, WANT_SENTENCES)
      : (await loadQuotes(cand, { predicates: TALK_SOURCES, limit: WANT_SENTENCES })).map((q) => ({ text: q.text })));
  }
  const cards = await cardAnswers(checked.map((c) => c.userId));
  const r = await checkWants(who, wants, people, checked.map((c) => cards.get(c.userId) ?? null));
  if (!r) return null;
  return { byId: new Map(checked.map((cand, i) => [cand.userId, r.results[i]!])), costUsd: r.costUsd };
}

/**
 * The card answers of the given people, as the matchmaker sees them -- the same
 * `traits` their rules are tested against. Read by code only; never sent to a model.
 */
export async function cardAnswers(userIds: readonly string[]): Promise<Map<string, Record<string, unknown>>> {
  if (!userIds.length) return new Map();
  return matchmakerSession(async (c) => {
    const { rows } = await c.query<{ user_id: string; traits: Record<string, unknown> | null }>(
      'SELECT user_id, traits FROM match_profile WHERE user_id = ANY($1::uuid[])', [[...userIds]]);
    return new Map(rows.map((r) => [r.user_id, r.traits ?? {}]));
  });
}

/** Every want, unchecked: what a card says when the check did not run. Never nothing. */
export const cantCheck = (wants: readonly Want[]): WantResult[] =>
  wants.map((w) => ({ want: w.text, kind: w.kind, status: 'cant_check' as const, quote: null,
                      ...(w.private ? { private: true } : {}) }));

/** One reader's results as the rows a card carries. */
export const wantRows = (results: readonly WantResult[] | undefined): WantRow[] =>
  (results ?? []).map((r) => ({
    want: r.want, kind: r.kind, theirs: r.private ? null : r.quote, status: r.status,
    ...(r.private ? { private: true } : {}), ...(r.practice ? { practice: true } : {}),
  }));
