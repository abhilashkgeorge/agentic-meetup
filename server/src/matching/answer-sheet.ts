/**
 * Answer sheets: what a person's agent says when another person's agent asks it
 * something -- and "I don't know" whenever the person never said.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-24). When an agent goes out -- "send my agent
 * out", or one of the day's visits -- let the two agents ask each other questions,
 * the SAME questions, which both can answer from what their person actually said; and
 * a question it has no answer for gets "I don't know", never an invention. It is the
 * trekking-vs-waffles problem, solved where it lives: one person said they trek, the
 * other that they love waffles, and nothing lined the two up. Here both agents answer
 * the same twelve questions, so the answers line up -- and the "I don't know"s become
 * what the two people talk about when they meet.
 *
 * THE RULE THAT MAKES IT SAFE: AN AGENT ANSWERS ONLY IN ITS PERSON'S OWN WORDS. A model
 * may POINT at a sentence the person typed; it may never WRITE one. It sees the
 * person's own verified sentences numbered, and returns a number or null per question.
 * Only the numbers are kept, resolved to fact ids; whatever else it produces is
 * discarded. That is exactly what would have stopped the conversations inventing a
 * comedy-writer life on a real user's card (0061's header).
 *
 * THE TRICK THAT MAKES IT FREE: A PERSON'S ANSWERS DO NOT DEPEND ON WHO IS ASKING. So
 * the sheet is built once, by the person's own session, when what they have said
 * changes -- and every meeting afterwards only reads two sheets side by side. A round
 * still makes zero model calls. And the person reads their own sheet first, on "How
 * you appear", with a Hide on every answer.
 *
 * NOT THE CARDS. Kids, one person or open, smoking, drinking and food are private,
 * already checked both ways by code, and never named on a card; an agent saying "she
 * smokes daily" on a stranger's screen would leak exactly what the brief protects. The
 * bank is everyday things, and every answer passes the same core-value check a card's
 * quotes do, and holds no contact detail (mayRepeat).
 */
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { tenantSession } from '../db/client.js';
import { llm, modelFor } from '../llm/index.js';
import { metered } from '../metering.js';
import { log } from '../log.js';
import { QUOTABLE, loadQuotes, mayRepeat } from './brief.js';
import type { QaLine } from './brief.js';

export type { QaLine };

export interface SheetQuestion {
  id: string;
  /** How one agent asks it. */
  ask: string;
  /** The label beside the answers on a card. */
  short: string;
}

/**
 * THE BANK: twelve everyday questions, the same for everybody. Start small and keep
 * the ones people actually have answers to -- the measurement is how often each one is
 * answered, read off the stored sheets.
 */
export const SHEET: readonly SheetQuestion[] = [
  { id: 'weekends', ask: 'What do you do on weekends?', short: 'Weekends' },
  { id: 'food', ask: 'What food could you eat every day?', short: 'Favourite food' },
  { id: 'music', ask: 'What are you listening to lately?', short: 'Music' },
  { id: 'watching', ask: 'What have you watched lately and loved?', short: 'Films and shows' },
  { id: 'reading', ask: 'What are you reading, or what did you last love reading?', short: 'Reading' },
  { id: 'travel', ask: 'Where have you loved travelling, or where next?', short: 'Travel' },
  { id: 'work', ask: 'What do you do for work?', short: 'Work' },
  { id: 'goal', ask: 'What are you working towards right now?', short: 'Goals' },
  { id: 'pets', ask: 'Any pets, or one you want?', short: 'Pets' },
  { id: 'active', ask: 'How do you stay active?', short: 'Staying active' },
  { id: 'evening', ask: "What's a perfect evening for you?", short: 'A good evening' },
  { id: 'learning', ask: 'What are you learning at the moment?', short: 'Learning' },
];
const BY_ID = new Map(SHEET.map((q) => [q.id, q]));

/**
 * The kinds of fact an answer may come from: every kind a card may quote, plus what
 * someone is working towards and what they cannot stand. Never a kind NEVER_PUBLIC
 * names -- loadQuotes reads only public facts, and none of these is one of those.
 */
export const SHEET_SOURCES: readonly string[] = [...QUOTABLE, 'goal', 'dislikes'];

/** At most this many of a person's sentences go to the pointer, most recent first. */
export const MAX_SENTENCES = 40;

/** One answer on a sheet, in the person's own words. */
export interface SheetAnswer {
  factId: string | null;
  text: string;
  /** True when this is a practice profile's templated answer, never a person's. */
  practice?: boolean;
}
export type Sheet = ReadonlyMap<string, SheetAnswer>;

// ── building ────────────────────────────────────────────────────────────────

const Pointed = z.object({
  answers: z.array(z.object({
    question: z.string(),
    sentence: z.number().int().nullable(),
  })),
});

const POINTER = `You match questions to sentences a person wrote about themselves.

For each question, give the number of the ONE sentence that answers it directly, or null.

Rules:
- The sentence must answer the question on its own. If you would have to guess, infer, or join two sentences, answer null.
- A sentence that only mentions the topic in passing is not an answer. Answer null.
- Never write any words of your own. Output numbers or null, nothing else.

Null is always safe. A wrong number is shown to another person as something this person said.`;

/**
 * A fingerprint of the sentences a sheet was built from. Same sentences, same sheet:
 * no model call. Order-free, so a sentence moving in the list is not a change.
 */
export function basisOf(sentences: readonly { id: string; text: string }[]): string {
  return createHash('sha256')
    .update(sentences.map((s) => `${s.id}\u0000${s.text}`).sort().join('\n'))
    .digest('hex')
    .slice(0, 32);
}

/**
 * The pointer's answer, turned into question -> fact id. Pure, and the only reader of
 * what the model returned: numbers in range are kept, anything else is dropped, and a
 * sentence answers at most one question (the first, in bank order) so a card never
 * shows one sentence twice.
 */
export function pointedToAnswers(
  parsed: unknown,
  sentences: readonly { id: string }[],
): Record<string, string> {
  const p = Pointed.safeParse(parsed);
  if (!p.success) return {};
  const said = new Map(p.data.answers.map((a) => [a.question, a.sentence]));
  const used = new Set<number>();
  const out: Record<string, string> = {};
  for (const q of SHEET) {
    const n = said.get(q.id);
    if (n === null || n === undefined) continue;
    const i = n - 1;                       // numbered from 1 in the prompt
    if (i < 0 || i >= sentences.length || used.has(i)) continue;
    used.add(i);
    out[q.id] = sentences[i]!.id;
  }
  return out;
}

/**
 * A sheet with the person's own explicit answers laid over what the pointer chose: a
 * sentence they typed IN ANSWER to a question (the question of the day, unknowns.ts)
 * answers that question, whatever the model pointed at -- and answers only that one.
 * Pure. `explicit` holds only sentences that passed the quote check.
 */
export function withExplicit(
  answers: Readonly<Record<string, string>>,
  explicit: ReadonlyMap<string, string>,
): Record<string, string> {
  const taken = new Set(explicit.values());
  const out: Record<string, string> = {};
  for (const [q, factId] of Object.entries(answers)) if (!taken.has(factId)) out[q] = factId;
  for (const [q, factId] of explicit) if (BY_ID.has(q)) out[q] = factId;
  return out;
}

/**
 * Build the person's sheet if what they have said has changed since it was built.
 *
 * Runs as the person (their own session reads their own episodes, which is what makes
 * a sentence verifiable) and never inside a round. At most one small model call, and
 * none at all when nothing changed or there is nothing to point at. A failure --
 * including the day's cap -- keeps the sheet they had; it never throws at the caller.
 */
export async function ensureSheet(
  who: { tenantId: string; userId: string },
  /** Built as part of setting up (the first sentence): counted as setup (metering.ts). */
  opts: { setup?: boolean } = {},
): Promise<{ built: boolean; answered: number }> {
  try {
    const sentences = await loadQuotes(who, { predicates: SHEET_SOURCES, limit: MAX_SENTENCES });
    const basis = basisOf(sentences);
    const had = await tenantSession(who, (c) => c.query<{ basis: string }>(
      'SELECT basis FROM answer_sheets WHERE user_id = $1', [who.userId]));
    if (had.rows[0]?.basis === basis) return { built: false, answered: -1 };

    let answers: Record<string, string> = {};
    if (sentences.length) {
      const numbered = sentences.map((s, i) => `${i + 1}. ${s.text}`).join('\n');
      const questions = SHEET.map((q) => `${q.id}: ${q.ask}`).join('\n');
      const res = await metered(who, 'extract', () => llm.complete(
        {
          task: 'extract',
          instructions: POINTER,
          messages: [{ role: 'user', content: `SENTENCES\n${numbered}\n\nQUESTIONS\n${questions}` }],
          tenantId: who.tenantId,
          userId: who.userId,
          outputSchema: Pointed,
          outputSchemaName: 'answer_sheet',
          maxOutputTokens: 600,
          thinking: false,
        },
        modelFor('extract'),
      ), opts);
      answers = pointedToAnswers(res.parsed, sentences);
    }
    // THEIR OWN ANSWERS WIN: a sentence typed in answer to a question stays its answer.
    const verified = new Set(sentences.map((s) => s.id));
    const tagged = await tenantSession(who, (c) => c.query<{ id: string; prompt: string }>(
      `SELECT id, object_value->>'prompt' AS prompt FROM facts
        WHERE user_id = $1 AND predicate = 'prompt_answer' AND status = 'active' AND valid_to IS NULL
          AND object_value->>'prompt' LIKE 'sheet:%'`, [who.userId]));
    answers = withExplicit(answers, new Map(tagged.rows
      .filter((r) => verified.has(r.id))
      .map((r) => [r.prompt.slice('sheet:'.length), r.id])));

    await tenantSession(who, (c) => c.query(
      `INSERT INTO answer_sheets (user_id, tenant_id, answers, basis, built_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id) DO UPDATE
         SET answers = EXCLUDED.answers, basis = EXCLUDED.basis, built_at = now()`,
      [who.userId, who.tenantId, JSON.stringify(answers), basis]));
    log.info({ userId: who.userId, sentences: sentences.length, answered: Object.keys(answers).length },
      'answer sheet built');
    return { built: true, answered: Object.keys(answers).length };
  } catch (err) {
    log.warn({ err, userId: who.userId }, 'answer sheet not built; the old one stands');
    return { built: false, answered: -1 };
  }
}

// ── reading ─────────────────────────────────────────────────────────────────

/**
 * Sheets for a round, through the matchmaker's session.
 *
 * THE WORDS COME FROM `facts`, JOINED LIVE, which the matchmaker can read only where
 * public, active and current (0028). So a sentence hidden on "How you appear", retracted
 * or superseded since the sheet was built simply is not returned -- by row-level
 * security, not by this query remembering to check. The core-value check runs again
 * here: the last thing between a stored id and a stranger's card.
 */
export async function readSheets(c: PoolClient, userIds: readonly string[]): Promise<Map<string, Sheet>> {
  const out = new Map<string, Sheet>();
  if (!userIds.length) return out;
  const { rows } = await c.query<{ user_id: string; question: string; fact_id: string; source_quote: string }>(
    `SELECT s.user_id, a.key AS question, f.id AS fact_id, f.source_quote
       FROM answer_sheets s
      CROSS JOIN LATERAL jsonb_each_text(s.answers) a(key, value)
       JOIN facts f ON f.user_id = s.user_id AND f.id = a.value::uuid
      WHERE s.user_id = ANY($1::uuid[])`,
    [userIds]);
  for (const r of rows) {
    if (!BY_ID.has(r.question) || !mayRepeat(r.source_quote)) continue;
    const sheet = (out.get(r.user_id) ?? new Map<string, SheetAnswer>()) as Map<string, SheetAnswer>;
    sheet.set(r.question, { factId: r.fact_id, text: r.source_quote.trim() });
    out.set(r.user_id, sheet);
  }
  return out;
}

/** One question on the person's own sheet, as they see it on "How you appear". */
export interface OwnAnswer {
  id: string;
  ask: string;
  short: string;
  answer: { factId: string; text: string } | null;
}

/**
 * The person's own sheet, every question in bank order, "I don't know" as null. Read
 * as them, and only public facts count -- the same view a stranger's agent gets, so
 * what they see here is exactly what would be said.
 */
export async function readOwnSheet(who: { tenantId: string; userId: string }): Promise<OwnAnswer[]> {
  const rows = await tenantSession(who, async (c) => (await c.query<{ question: string; fact_id: string; source_quote: string }>(
    `SELECT a.key AS question, f.id AS fact_id, f.source_quote
       FROM answer_sheets s
      CROSS JOIN LATERAL jsonb_each_text(s.answers) a(key, value)
       JOIN facts f ON f.user_id = s.user_id AND f.id = a.value::uuid
      WHERE s.user_id = $1 AND f.status = 'active' AND f.valid_to IS NULL AND f.disclosure = 'public'`,
    [who.userId])).rows);
  const byQ = new Map(rows.filter((r) => mayRepeat(r.source_quote)).map((r) => [r.question, r]));
  return SHEET.map((q) => {
    const r = byQ.get(q.id);
    return { id: q.id, ask: q.ask, short: q.short, answer: r ? { factId: r.fact_id, text: r.source_quote.trim() } : null };
  });
}

// ── practice profiles ───────────────────────────────────────────────────────

const words = (tag: string) => tag.replace(/[-_]+/g, ' ').trim();

/**
 * A practice profile's sheet, from its tags, by template. Zero model calls.
 *
 * An invented profile has nothing it ever typed -- no episodes -- so it could answer
 * nothing and every practice meeting would read as a wall of "I don't know". It is an
 * invented person, so a templated answer invents nothing about anybody real; each one
 * is marked `practice` and says so on the card. Three questions only, the ones its tags
 * actually speak to; the rest are honestly "I don't know".
 */
export function practiceSheet(tags: readonly string[]): Sheet {
  const first = (kind: string) => tags.find((t) => t.startsWith(`${kind}:`))?.slice(kind.length + 1);
  const out = new Map<string, SheetAnswer>();
  const put = (id: string, text: string | null) => {
    if (text && mayRepeat(text)) out.set(id, { factId: null, text, practice: true });
  };
  const work = first('works_in');
  const interest = first('interest');
  const media = first('media_taste');
  put('work', work ? `I work in ${words(work)}.` : null);
  put('weekends', interest ? `Mostly ${words(interest)}.` : null);
  put('watching', media ? `A lot of ${words(media)}.` : null);
  return out;
}

// ── two sheets, side by side ────────────────────────────────────────────────

/** How many exchanges a card shows, and how many of those are "ask them" ones. */
const LINES = 4;
const ASK_THEM = 2;

/**
 * What the reader's agent and the other agent found when they asked each other the
 * bank. Pure: two sheets in, lines out, the same every time.
 *
 * Order: questions both answered first -- the trekking and the waffles, side by side --
 * then ones only they answered, then up to two they could not answer that the reader
 * did. Those last are the point of "I don't know": what to ask them in person.
 * Questions neither answered are not shown at all.
 */
export function compareSheets(mine: Sheet | undefined, theirs: Sheet | undefined): QaLine[] {
  const both: QaLine[] = [];
  const onlyTheirs: QaLine[] = [];
  const askThem: QaLine[] = [];
  for (const q of SHEET) {
    const t = theirs?.get(q.id);
    const m = mine?.get(q.id);
    const line: QaLine = {
      q: q.short, ask: q.ask, theirs: t?.text ?? null, mine: m?.text ?? null,
      ...(t?.practice ? { practice: true } : {}),
    };
    if (t && m) both.push(line);
    else if (t) onlyTheirs.push(line);
    else if (m) askThem.push(line);
  }
  const answered = [...both, ...onlyTheirs].slice(0, LINES);
  return [...answered, ...askThem.slice(0, ASK_THEM)];
}
