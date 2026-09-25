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
      if (!SHEET_IDS.has(q)) continue;
      await c.query('INSERT INTO unknown_asks (tenant_id, user_id, question_id) VALUES ($1,$2,$3)', [r.tenantId, r.userId, q]);
    }
  }
}

export interface DailyQuestion {
  id: string;
  /** The question, as the bank asks it. */
  ask: string;
  /** How many times other agents asked it lately. Never who. */
  count: number;
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
    for (const q of SHEET) {
      const count = n.get(q.id) ?? 0;
      if (!count || known.has(q.id) || quiet.has(q.id)) continue;
      if (!best || count > best.count) best = { id: q.id, ask: q.ask, count };
    }
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
