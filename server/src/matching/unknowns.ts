/**
 * The question of the day: what other agents asked a person's agent that it could not
 * answer -- asked, instead, of the person.
 *
 * WHY (the founder, 2026-09-25). When two agents meet, one often says "I don't know"
 * (talk.ts, answer-sheet.ts): its person never said. Nothing asked the person, so every
 * later meeting hit the same gap. Now a round records each "I don't know" by the bank
 * question it answered (migration 0062), and the person is offered the one most asked:
 * at most TWO a day, always skippable, with the reason shown -- how many times, never
 * who. The table cannot say who: it has no such column.
 *
 * AN ANSWER IS THEIR OWN SENTENCE. It is saved the way a story is (stories.ts
 * saveOwnSentence): an episode with the words and a quotable fact tagged
 * `sheet:<question>`, so the quote check accepts it -- and it becomes that question's
 * answer on their sheet at once, and stays it through every rebuild (ensureSheet's
 * explicit answers). The next agent that asks gets their words instead of "I don't know".
 * No model call anywhere here.
 */
import type { PoolClient } from 'pg';
import { tenantSession } from '../db/client.js';
import { saveOwnSentence } from '../onboarding/stories.js';
import { SHEET, readOwnSheet } from './answer-sheet.js';
import { mayRepeat, namesCoreValue, type QaLine, type TalkView } from './brief.js';
import { ALL_CARDS, BY_ID } from '../onboarding/questions.js';
import type { WantResult } from './wants.js';
import { WANT_QUESTIONS } from './want-questions.js';

/** At most this many questions a day, answered or skipped. */
export const DAILY_QUESTIONS = 2;
/** A skipped question is not offered again for this long. */
export const QUIET_DAYS = 7;
/** "I don't know"s older than this no longer count. */
export const WINDOW_DAYS = 14;

const ID_BY_SHORT = new Map(SHEET.map((q) => [q.short, q.id]));
const ID_BY_ASK = new Map(SHEET.map((q) => [q.ask, q.id]));
export const SHEET_IDS: ReadonlySet<string> = new Set(SHEET.map((q) => q.id));

/**
 * THE CARDS AS QUESTIONS (the founder, 2026-09-25). A private want is checked against
 * the other person's card answer (wants.ts); when they have none -- never answered, or
 * "prefer not to say" -- it could not be checked. That gap is theirs to fill, and on a
 * card topic the way to fill it is THE CARD: both rows, their answer read by code, never
 * said, so it counts as a check-only match. `card:<predicate>` is how such a gap is
 * recorded; the question of the day then opens that card instead of a text box.
 */
/*
 * AND THE QUESTIONS WANTS ARE TIED TO (2026-09-26): somebody's "a saver, not an impulse
 * spender" is checked against the other person's answer to the ₹50,000 question
 * (want-questions.ts). When they have none, that is their gap, recorded as
 * `ask:<question id>` and asked the same way a card is: opened by its id, answered with
 * one tap, never saying who wanted to know.
 */
export const CARD_QUESTIONS: ReadonlyMap<string, { questionId: string; predicate: string; text: string; topic: string }> =
  new Map([
    ...ALL_CARDS.map((c) => {
      const q = BY_ID.get(c.id)!;
      return [`card:${c.predicate}`, { questionId: c.id, predicate: c.predicate, text: q.text, topic: q.topic ?? q.text }] as const;
    }),
    ...WANT_QUESTIONS.map((w) => {
      const q = BY_ID.get(w.questionId)!;
      return [`ask:${q.id}`, { questionId: q.id, predicate: q.predicate, text: q.text, topic: q.topic ?? q.text }] as const;
    }),
  ]);

/** Everything a gap may be recorded as: a bank question, or a card. */
export const QUESTION_IDS: ReadonlySet<string> = new Set([...SHEET_IDS, ...CARD_QUESTIONS.keys()]);

/**
 * The cards a want check could not read for the other person: private wants mapped onto
 * a card they have no answer on. Pure.
 */
export function unknownCardsOf(results: readonly WantResult[] | undefined): string[] {
  const out = new Set<string>();
  for (const r of results ?? []) {
    if (r.private && r.status === 'cant_check' && r.card && CARD_QUESTIONS.has(`card:${r.card}`)) out.add(`card:${r.card}`);
  }
  return [...out];
}

/**
 * The questions a want tied to one could not read for the other person: they never
 * answered it. Those are theirs to fill, as their question of the day. Pure.
 */
export function unknownAsksOf(results: readonly WantResult[] | undefined): string[] {
  const out = new Set<string>();
  for (const r of results ?? []) {
    if (r.question && r.status === 'cant_check' && CARD_QUESTIONS.has(`ask:${r.question}`)) out.add(`ask:${r.question}`);
  }
  return [...out];
}

/**
 * Whose agent said "I don't know", and to which question, in one pair's meeting. Pure.
 * From the talk when there was one (side A's view: a "dunno" right after a question
 * belongs to whoever said it); otherwise from the answer sheets (a line on A's card with
 * nothing of theirs is B's gap, and the other way round).
 */
export function unknownsOf(
  talkForA: TalkView | null,
  qaForA: readonly QaLine[],
  qaForB: readonly QaLine[],
): { a: string[]; b: string[] } {
  const a = new Set<string>();
  const b = new Set<string>();
  if (talkForA) {
    let asked: string | null = null;
    for (const l of talkForA.lines) {
      if (l.kind === 'ask') { asked = (l.q ? ID_BY_SHORT.get(l.q) : undefined) ?? ID_BY_ASK.get(l.text) ?? null; continue; }
      if (l.kind === 'dunno' && asked) (l.who === 'you' ? a : b).add(asked);
    }
  } else {
    for (const l of qaForA) if (l.theirs === null && l.mine !== null && ID_BY_SHORT.has(l.q)) b.add(ID_BY_SHORT.get(l.q)!);
    for (const l of qaForB) if (l.theirs === null && l.mine !== null && ID_BY_SHORT.has(l.q)) a.add(ID_BY_SHORT.get(l.q)!);
  }
  return { a: [...a], b: [...b] };
}

/** Write one meeting's "I don't know"s. A round's matchmaker connection; real people only. */
export async function recordUnknowns(
  c: PoolClient,
  rows: readonly { tenantId: string; userId: string; questionIds: readonly string[] }[],
): Promise<void> {
  for (const r of rows) {
    for (const q of r.questionIds) {
      if (!QUESTION_IDS.has(q)) continue;
      await c.query('INSERT INTO unknown_asks (tenant_id, user_id, question_id) VALUES ($1,$2,$3)', [r.tenantId, r.userId, q]);
    }
  }
}

export interface DailyQuestion {
  id: string;
  /** The question, as the bank -- or the card -- asks it. */
  ask: string;
  /** How many times other agents asked it lately. Never who. */
  count: number;
  /** On a card topic: the card to open, instead of a text box. */
  card?: { id: string; topic: string };
}

/**
 * Today's question, or null: the bank question other agents asked about most in the last
 * two weeks that the person has not answered on their sheet, has not answered here, and
 * has not skipped in the last week -- and nothing once two have been answered or skipped
 * today. Ties go to bank order.
 */
export async function questionOfDay(who: { tenantId: string; userId: string }): Promise<DailyQuestion | null> {
  const sheet = await readOwnSheet(who);
  const known = new Set(sheet.filter((q) => q.answer !== null).map((q) => q.id));
  return tenantSession(who, async (c) => {
    // A card is known when it holds an answer with a value -- a "prefer not to say" is
    // exactly the gap a want could not check.
    const { rows: cards } = await c.query<{ predicate: string }>(
      `SELECT DISTINCT predicate FROM facts
        WHERE user_id = $1 AND predicate = ANY($2) AND status = 'active' AND valid_to IS NULL
          AND object_value IS NOT NULL AND object_value <> 'null'::jsonb`,
      [who.userId, [...CARD_QUESTIONS.values()].map((q) => q.predicate)]);
    // Every tapped question on that field: its card, or the question a want is tied to.
    for (const r of cards) {
      for (const [id, q] of CARD_QUESTIONS) if (q.predicate === r.predicate) known.add(id);
    }
    const { rows: today } = await c.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM question_prompts WHERE user_id = $1 AND day = CURRENT_DATE', [who.userId]);
    if ((today[0]?.n ?? 0) >= DAILY_QUESTIONS) return null;
    const { rows: done } = await c.query<{ question_id: string }>(
      `SELECT question_id FROM question_prompts
        WHERE user_id = $1 AND (outcome = 'answered' OR day > CURRENT_DATE - $2::int)`, [who.userId, QUIET_DAYS]);
    const quiet = new Set(done.map((r) => r.question_id));
    const { rows: counts } = await c.query<{ question_id: string; n: number }>(
      `SELECT question_id, count(*)::int AS n FROM unknown_asks
        WHERE user_id = $1 AND at > now() - make_interval(days => $2)
        GROUP BY question_id`, [who.userId, WINDOW_DAYS]);
    const n = new Map(counts.map((r) => [r.question_id, r.n]));
    let best: DailyQuestion | null = null;
    const offer = (id: string, ask: string, card?: DailyQuestion['card']) => {
      const count = n.get(id) ?? 0;
      if (!count || known.has(id) || quiet.has(id)) return;
      if (!best || count > best.count) best = { id, ask, count, ...(card ? { card } : {}) };
    };
    for (const q of SHEET) offer(q.id, q.ask);
    for (const [id, q] of CARD_QUESTIONS) offer(id, q.text, { id: q.questionId, topic: q.topic });
    return best;
  });
}

/**
 * Their answer: their own sentence, saved and made that question's answer on their sheet
 * at once. The caller has checked the id and the length.
 *
 * THE SAME RULES AS ANY SENTENCE. An answer holding a contact detail, or naming a
 * private topic, is kept -- it is theirs -- but never goes on the sheet, so no agent ever
 * gives it (brief.ts mayRepeat); the readers would drop it anyway, and this does not
 * leave it lying in `answers` for them to drop. `usable` says which it was, so the screen
 * can tell them.
 */
export async function answerDailyQuestion(
  who: { tenantId: string; userId: string }, questionId: string, text: string,
): Promise<{ factId: string; usable: boolean; reason: 'contact' | 'private' | null }> {
  const words = text.trim();
  const reason = namesCoreValue(words) ? 'private' as const : !mayRepeat(words) ? 'contact' as const : null;
  return tenantSession(who, async (c) => {
    const { factId } = await saveOwnSentence(c, who, `sheet:${questionId}`, words);
    await c.query(
      `INSERT INTO question_prompts (user_id, tenant_id, question_id, outcome) VALUES ($1,$2,$3,'answered')
       ON CONFLICT (user_id, question_id, day) DO UPDATE SET outcome = 'answered', at = now()`,
      [who.userId, who.tenantId, questionId]);
    if (reason) return { factId, usable: false, reason };
    // On the sheet now, not at the next rebuild: the basis is left as it was, so the
    // next ensureSheet rebuilds -- and keeps this, because explicit answers win.
    await c.query(
      `INSERT INTO answer_sheets (user_id, tenant_id, answers, basis)
       VALUES ($1, $2, jsonb_build_object($3::text, $4::text), '')
       ON CONFLICT (user_id) DO UPDATE SET answers = answer_sheets.answers || jsonb_build_object($3::text, $4::text)`,
      [who.userId, who.tenantId, questionId, factId]);
    return { factId, usable: true, reason: null };
  });
}

/** Not now: not offered again for a week, and it counts toward today's two. */
export async function skipDailyQuestion(who: { tenantId: string; userId: string }, questionId: string): Promise<void> {
  await tenantSession(who, (c) => c.query(
    `INSERT INTO question_prompts (user_id, tenant_id, question_id, outcome) VALUES ($1,$2,$3,'skipped')
     ON CONFLICT (user_id, question_id, day) DO NOTHING`,
    [who.userId, who.tenantId, questionId]));
}

/**
 * A card question of the day, answered THROUGH THE CARD (POST /v1/interview/answer): this
 * only records that it was, once the card's own answer is on file from the last hour.
 * False when it is not -- the card was never opened, or the answer did not save.
 */
export async function markCardAnswered(who: { tenantId: string; userId: string }, id: string): Promise<boolean> {
  const card = CARD_QUESTIONS.get(id);
  if (!card) return false;
  return tenantSession(who, async (c) => {
    const { rows } = await c.query(
      `SELECT 1 FROM question_answers
        WHERE user_id = $1 AND question_id = $2 AND answered_at > now() - interval '1 hour'`,
      [who.userId, card.questionId]);
    if (!rows.length) return false;
    await c.query(
      `INSERT INTO question_prompts (user_id, tenant_id, question_id, outcome) VALUES ($1,$2,$3,'answered')
       ON CONFLICT (user_id, question_id, day) DO UPDATE SET outcome = 'answered', at = now()`,
      [who.userId, who.tenantId, id]);
    return true;
  });
}
