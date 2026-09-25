/**
 * The interview: one question at a time, until there is nothing left worth asking.
 *
 * This is the spine of onboarding. The strongest published method for making an agent
 * answer like a particular person is a long structured interview, and the variance
 * that actually predicts somebody sits in how they answer specific questions rather
 * than in a stable profile. A form cannot reach it; a conversation of questions can.
 *
 * Costs nothing per question: the options are fixed, the answer maps straight onto a
 * predicate, and which question comes next is fixed code -- the three basics, the five
 * core cards, the one sentence -- with a SQL count over the candidate pool choosing
 * only among the optional chips after that (next-question.ts).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { deriveValue } from '@clone/shared';
import { resolveCtx, Unauthorized } from '../auth.js';
import { matchSession, tenantSession } from '../db/client.js';
import { commit } from '../memory/facts.js';
import { rebuildMatchProfile, setPreference } from '../matching/profile.js';
import { candidateIds, shownCount } from '../matching/candidates.js';
import { BY_ID, CORE_CARDS, GATING, type Question } from '../onboarding/questions.js';
import { nextQuestion } from '../onboarding/next-question.js';
import { metered } from '../metering.js';
import { mapDealbreaker } from '../onboarding/dealbreaker.js';
import { log } from '../log.js';

async function ctxOr401(c: { req: { header: (k: string) => string | undefined } }) {
  try {
    return { ctx: await resolveCtx(c.req.header('authorization')), res: null } as const;
  } catch (err) {
    if (err instanceof Unauthorized) return { ctx: null, res: 'unauthorized' } as const;
    throw err;
  }
}

const askedSet = async (
  db: import('pg').PoolClient,
  userId: string,
): Promise<{ answered: Set<string>; skipped: Set<string> }> => {
  const { rows } = await db.query<{ question_id: string; skipped: boolean }>(
    `SELECT question_id, skipped FROM question_answers WHERE user_id = $1`, [userId],
  );
  return {
    answered: new Set(rows.map((r) => r.question_id)),
    skipped: new Set(rows.filter((r) => r.skipped).map((r) => r.question_id)),
  };
};

/**
 * The Who's-fine row of a core card, as the app sends it.
 *
 * Exactly one of two shapes, and `.strict()` so a body carrying both is refused
 * rather than read as whichever branch zod tries first.
 */
const WhoFineBody = z.union([
  z.object({ anyone: z.literal(true) }).strict(),
  z.object({ only: z.array(z.string().min(1).max(120)).max(20) }).strict(),
]);

/** What a card's Who's-fine answer means, after checking it against the card. */
type WhoFine = { anyone: true } | { only: string[] };

/** The five core cards by the predicate they write, for landing a mapped sentence. */
const CORE_CARDS_BY_PREDICATE: ReadonlyMap<string, Question> = new Map(
  CORE_CARDS.map((c) => [c.predicate, BY_ID.get(c.id)!] as const),
);

/**
 * The Who's-fine choice a card holds now, or null when the card has none on record.
 *
 * Read from the stored answer rather than from `preferences`: "anyone is fine" writes
 * no rule, so the rule table cannot tell it from a card nobody answered. The stored
 * `{values, whoFine}` can.
 */
async function storedWhoFine(
  db: import('pg').PoolClient, userId: string, cardId: string,
): Promise<WhoFine | null> {
  const { rows } = await db.query<{ answer: { whoFine?: WhoFine } | null }>(
    `SELECT answer FROM question_answers WHERE user_id = $1 AND question_id = $2`,
    [userId, cardId],
  );
  const w = rows[0]?.answer?.whoFine;
  if (!w || typeof w !== 'object') return null;
  if ('anyone' in w) return { anyone: true };
  return Array.isArray((w as { only?: unknown }).only) ? { only: (w as { only: string[] }).only } : null;
}

/**
 * Check a Who's-fine answer against the card it is for, or say why not.
 *
 * `only` must be a NON-EMPTY subset of the card's own values. Empty would be a rule
 * nobody passes, and a value the card does not have is a rule about a word no
 * profile can hold -- both empty the pool with nothing on screen saying why. A list
 * naming every option is "anyone", said the long way, and is stored as that: it
 * excludes nobody, so it must not write a rule that looks like it does.
 */
export function readWhoFine(q: Question, sent: z.infer<typeof WhoFineBody>): WhoFine | null {
  if ('anyone' in sent) return { anyone: true };
  const allowed = new Set((q.whoFine?.options ?? q.options).map((o) => o.value));
  const only = [...new Set(sent.only)];
  if (!only.length || only.some((v) => !allowed.has(v))) return null;
  if (only.length === allowed.size) return { anyone: true };
  // Card order, not tap order: the rule is a set, and two people who ticked the same
  // boxes should store the same row.
  const order = [...allowed];
  return { only: only.sort((a, b) => order.indexOf(a) - order.indexOf(b)) };
}

export const interviewRoutes = new Hono()
  /** The next question, or null when the interview is done. */
  .get('/v1/interview/next', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const state = await tenantSession(ctx, async (db) => ({
      asked: await askedSet(db, ctx.userId),
      profile: await rebuildMatchProfile(db, ctx),
    }));

    // Candidates are only measurable once the gating answers exist. Before that the
    // pool is empty and any "which question splits it best" is a coin toss, so the
    // gating questions are asked first regardless.
    const candidates = state.profile.inPool
      ? await matchSession((db) => candidateIds(db, ctx.userId, 500)).catch(() => [])
      : [];

    // A BASIC ANSWERED SOMEWHERE ELSE IS ANSWERED. The picker counts a question as done
    // by its question_answers row, and three of the six real users gave their gender,
    // who they want to meet and what they are here for through the essentials wizard,
    // which writes the fact and no row. "Finish setting it up" now sends everybody
    // missing a card here, so they were asked all three again -- with no skip button,
    // because the basics are required -- before the first card. The pool's own
    // `missing` list is the test: a basic it does not name is known.
    const answered = new Set(state.asked.answered);
    for (const id of GATING) {
      if (!state.profile.missing.includes(BY_ID.get(id)!.predicate)) answered.add(id);
    }

    // ONE CARD, BY ID (the question of the day, matching/unknowns.ts): a card the person
    // may already have answered or declined, opened again so a gap another agent hit can
    // be filled with a card answer. Only a card is asked this way; any other id gets the
    // ordinary next question.
    const one = c.req.query('card');
    const pinned = one ? BY_ID.get(one) : undefined;
    const next = pinned?.whoFine
      ? { question: pinned, remaining: 0 }
      : await tenantSession(ctx, (db) =>
          nextQuestion(db, ctx.userId, answered, candidates, state.asked.skipped),
        );

    return c.json({
      question: next
        ? {
            id: next.question.id,
            text: next.question.text,
            why: next.question.why ?? null,
            options: next.question.options,
            multi: next.question.multi ?? false,
            kind: next.question.kind,
            /** No skip button for these: without them the agent cannot go out. */
            required: GATING.includes(next.question.id),
            tier: next.question.tier,
            /** Whether "Prefer not to say" is offered. On a core card, the You row only. */
            declinable: next.question.declinable,
            // Core cards only: the second row, never pre-ticked. The app must get an
            // explicit tap on the partner row, and the answer route refuses a card that
            // arrives without it. `topic` titles the card's screen.
            ...(next.question.whoFine ? { whoFine: next.question.whoFine } : {}),
            ...(next.question.topic ? { topic: next.question.topic } : {}),
            // A card that may be skipped whole (faith): the app offers "Skip this one".
            ...(next.question.optional ? { optional: true } : {}),
          }
        : null,
      answered: state.asked.answered.size,
      remaining: next?.remaining ?? 0,
      /** Can the agent go out yet? The thing the person actually wants to know. */
      ready: state.profile.inPool,
      missing: state.profile.missing,
      poolSize: shownCount(candidates.length),
    });
  })

  /**
   * One answer.
   *
   * A FACT answer commits as owner-asserted — typed by the person, about themselves,
   * in their own app. ONE THING HERE WRITES A HARD RULE: a CORE CARD's Who's-fine
   * row, where "Anyone is fine" writes none and a narrowed list writes one
   * `in [accepted]` dealbreaker. The one SENTENCE is mapped onto a card by a model,
   * but only as a PROPOSAL returned to the app (proposeFromSentence); it becomes a
   * rule only when the person confirms it through POST /v1/interview/who-fine. The
   * one PREFERENCE question left names its own values and writes a `strong` want,
   * which never excludes.
   */
  .post('/v1/interview/answer', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const body = z
      .object({
        questionId: z.string().min(1).max(64),
        /** Empty means skipped, which is a recorded answer rather than a gap. */
        values: z.array(z.string().min(1).max(120)).max(20).default([]),
        /** A sentence, for a `free` question. Same "empty means skipped" rule. */
        text: z.string().max(400).optional(),
        /** A core card's second row. Required on a core card; ignored on anything else. */
        whoFine: WhoFineBody.optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);

    const q = BY_ID.get(body.data.questionId);
    if (!q) return c.json({ error: 'unknown question' }, 400);

    // A GATING question cannot be skipped, and the refusal lives here rather than only
    // in the app. These three -- what you are, who you want to meet, what you are here
    // for -- are the questions the candidate query cannot run without: skip one and
    // the agent never leaves the building, having been told it was finished. Hiding
    // the button is the courtesy; this is the rule.
    if (GATING.includes(q.id) && body.data.values.length === 0) {
      return c.json({
        error: 'required',
        message: 'This one decides who your agent can reach, so it has to be answered.',
      }, 400);
    }
    const values = body.data.values;
    const sentence = (body.data.text ?? '').trim();

    // ── a core card: both rows, checked before anything is written ──────────
    //
    // The Who's-fine row is REQUIRED. "Prefer not to say" is allowed on the You row
    // only, and it does not answer the other question: somebody who will not say
    // whether they smoke may still mind very much whether you do. A card without it
    // would be recorded as done with no choice made, which is the pre-ticked default
    // the card exists to avoid -- defaults stick, and a silent one makes people look
    // more open than they are.
    let whoFine: WhoFine | null = null;
    // An optional card (faith) may be skipped whole -- nothing on either row -- which is
    // recorded like any skip and writes no fact and no rule.
    const skippingOptional = q.optional === true && values.length === 0 && !body.data.whoFine;
    if (q.tier === 'core' && !skippingOptional) {
      if (!body.data.whoFine) {
        return c.json({
          error: 'who_fine_required',
          message: 'Pick "Anyone is fine", or choose who is.',
        }, 400);
      }
      whoFine = readWhoFine(q, body.data.whoFine);
      if (!whoFine) {
        return c.json({
          error: 'who_fine_invalid',
          message: 'Choose at least one of the options on this card.',
        }, 400);
      }
      // One answer about yourself, and one of the card's own. Anything else would
      // commit a fact whose value no rule can ever be tested against.
      const own = new Set(q.options.map((o) => o.value));
      if (values.length > 1 || values.some((v) => !own.has(v))) {
        return c.json({ error: 'bad request' }, 400);
      }
    }

    const after = await tenantSession(ctx, async (db) => {
      // What is stored. A core card keeps BOTH rows -- `{values, whoFine}` -- so
      // "anyone is fine" is on record as a choice somebody made, distinct from a card
      // nobody has answered. Everything else keeps the plain list it always had.
      const stored =
        q.kind === 'free' ? [sentence].filter(Boolean)
        : whoFine ? { values, whoFine }
        : values;
      await db.query(
        `INSERT INTO question_answers (tenant_id, user_id, question_id, answer, skipped)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, question_id)
         DO UPDATE SET answer = EXCLUDED.answer, skipped = EXCLUDED.skipped,
                       answered_at = now()`,
        [ctx.tenantId, ctx.userId, q.id, JSON.stringify(stored),
         q.kind === 'free' ? !sentence : values.length === 0],
      );

      if (q.kind === 'free') {
        // Handled outside this transaction: mapping the sentence to a rule is a model
        // call, and this codebase does not hold a transaction open across one.
        return rebuildMatchProfile(db, ctx);
      }

      if (whoFine) await writeCard(db, ctx, q, values, whoFine);
      else if (values.length === 0) return rebuildMatchProfile(db, ctx);
      else if (q.kind === 'fact') await writeFact(db, ctx, q, values);
      else {
        // THE ONE PREFERENCE QUESTION LEFT names its values ("any field you would like
        // them to be in?"), so the answer IS the rule. `anything` is a way of saying no
        // preference and is not a field anybody works in, so it is dropped rather than
        // stored -- stored, it tests people against a value no profile can hold.
        //
        // The single "same as me" kind is gone, and so is its writer. It copied the
        // person's OWN answer into the rule: a daily smoker who said "No" to "Could you
        // be with a smoker?" got `smoking in ["daily"]`, a rule only daily smokers
        // pass. The core cards ask which values are fine and store exactly those.
        //
        // "Doesn't matter" as the first pick is an answer too, and the right response
        // to it is no rule at all rather than a weak one that reorders everybody.
        const choice = values[0]!;
        const wanted = choice === 'none' || choice === 'anything' ? [] : values
          .filter((v) => v !== 'anything' && v !== 'none')
          .map((v) => deriveValue(q.predicate, v) ?? v);
        if (wanted.length) {
          await setPreference(db, ctx, {
            predicate: q.predicate,
            operator: 'in',
            value: wanted,
            strength: 'strong',
            sourceQuote: q.text,
          });
        }
      }

      return rebuildMatchProfile(db, ctx);
    });

    // ── a sentence, after the transaction closed ───────────────────────────
    //
    // The SENTENCE is kept whatever else fails, as the person's own record of what
    // they said. It is a `matchable_only` fact (see defaultDisclosure): no agent may
    // volunteer it, it is never quoted on anybody's brief, and it is not shown to
    // another person. Mapping it is best effort, can land only on one of the five core
    // cards (dealbreaker.ts), and produces a PROPOSAL, never a rule; "someone who talks
    // through films" is a real dealbreaker with no card, and stays a sentence.
    let mapped: {
      predicate: string | null;
      excludes: string[];
      proposal: ReturnType<typeof proposeFromSentence>;
    } | null = null;
    if (q.kind === 'free' && sentence) {
      await tenantSession(ctx, (db) =>
        commit(db, ctx, {
          predicate: 'dealbreaker',
          objectText: sentence,
          stance: 'asserted',
          originClass: 'owner',
          sourceQuote: sentence,
          sourceEpisodeIds: [],
          extractorModel: 'interview',
          extractorVersion: '1',
          promptVersion: q.id,
        }),
      );

      try {
        // Metered. This was the clearest unmetered path in the system: a model call
        // fired from a question in setup, with no budget check before it and no row
        // in llm_calls after it. The whole point of the free-text dealbreaker is that
        // everybody answers it, which makes it the last call site that should have
        // been invisible to the cap.
        const m = await metered(ctx, 'extract', () => mapDealbreaker(ctx, sentence));

        // A PROPOSAL, NOT A RULE. Nothing is written here: see proposeFromSentence.
        // The proposal lands on the card the person has already answered, starting
        // from what that card accepts now, and waits for POST /v1/interview/who-fine.
        const card = m.predicate ? CORE_CARDS_BY_PREDICATE.get(m.predicate) : undefined;
        let proposal: ReturnType<typeof proposeFromSentence> = null;
        if (card && m.excludes.length) {
          const current = await tenantSession(ctx, (db) => storedWhoFine(db, ctx.userId, card.id));
          proposal = proposeFromSentence(card, m.excludes, current);
        }
        mapped = { predicate: m.predicate, excludes: m.excludes, proposal };
      } catch (err) {
        // A failed mapping costs a filter, not the answer. The sentence is already in.
        log.warn({ err, userId: ctx.userId }, 'dealbreaker not mapped');
      }
    }

    log.info(
      { userId: ctx.userId, questionId: q.id,
        skipped: q.kind === 'free' ? !sentence : values.length === 0,
        // Which way the Who's-fine row went, never the values: the decline and
        // "chose narrowing" rates per card are the numbers the bank changes on.
        whoFine: whoFine ? ('anyone' in whoFine ? 'anyone' : 'narrowed') : undefined,
        mappedTo: mapped?.predicate ?? null },
      'answered',
    );
    return c.json({ ok: true, ready: after.inPool, missing: after.missing, mapped });
  })

  /**
   * Change who's fine on a card the person has already answered -- and nothing else.
   *
   * This is where a PROPOSAL becomes a rule: the person saw what their sentence would
   * untick on one of their cards, adjusted it or not, and tapped to keep it. It is the
   * only way a mapped sentence ever filters anybody (see proposeFromSentence). It
   * touches the Who's-fine half only; the You half, and the fact behind it, are left
   * exactly as the person gave them.
   *
   * A card with no answer on record is refused: a Who's-fine row with no You row would
   * be a card half-answered by a side door, and the pool counts a card as done by its
   * answer row.
   */
  .post('/v1/interview/who-fine', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const body = z.object({ questionId: z.string().min(1).max(64), whoFine: WhoFineBody })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);

    const q = BY_ID.get(body.data.questionId);
    if (!q || q.tier !== 'core') return c.json({ error: 'not a card' }, 400);
    const whoFine = readWhoFine(q, body.data.whoFine);
    if (!whoFine) {
      return c.json({
        error: 'who_fine_invalid',
        message: 'Choose at least one of the options on this card.',
      }, 400);
    }

    const after = await tenantSession(ctx, async (db) => {
      const { rowCount } = await db.query(
        `UPDATE question_answers
            SET answer = jsonb_set(answer, '{whoFine}', $3::jsonb, true), answered_at = now()
          WHERE user_id = $1 AND question_id = $2 AND jsonb_typeof(answer) = 'object'`,
        [ctx.userId, q.id, JSON.stringify(whoFine)],
      );
      if (!rowCount) return null;
      await writeWhoFine(db, ctx, q, whoFine);
      return rebuildMatchProfile(db, ctx);
    });
    if (!after) return c.json({ error: 'card_not_answered' }, 409);

    log.info(
      { userId: ctx.userId, questionId: q.id, via: 'who-fine',
        whoFine: 'anyone' in whoFine ? 'anyone' : 'narrowed' },
      'who fine changed',
    );
    return c.json({ ok: true, ready: after.inPool, missing: after.missing });
  });

type Ctx = { tenantId: string; userId: string };

/** A chip answer about yourself: one owner-asserted fact per value, as it always was. */
async function writeFact(
  db: import('pg').PoolClient, ctx: Ctx, q: Question, values: readonly string[],
): Promise<void> {
  for (const v of values) {
    await commit(db, ctx, {
      predicate: q.predicate,
      objectText: v,
      objectValue: deriveValue(q.predicate, v) ?? undefined,
      stance: 'asserted',
      originClass: 'owner',
      sourceQuote: `${q.text} ${v}`,
      sourceEpisodeIds: [],
      extractorModel: 'interview',
      extractorVersion: '1',
      promptVersion: q.id,
    });
  }
}

/**
 * Both rows of a core card, in the caller's transaction.
 *
 * THE YOU ROW. An answer is a fact exactly as any chip answer is, and predicate_status
 * says `known`. "Prefer not to say" says `declined`, and it RETIRES whatever the
 * person had said before on that predicate -- retired, never deleted: the row keeps
 * its history with `valid_to` set. Declined has to mean unknown everywhere, and a
 * value left standing from an earlier answer would go on being matched on after the
 * person said they would rather not say. Unknown passes every rule (0020), so this
 * costs them nobody.
 *
 * THE WHO'S-FINE ROW. Whatever rule was live on this predicate is retired first --
 * again `retired_at`, never DELETE -- so a re-answered card replaces its rule and
 * the old one stays on record. Then `only` writes the one hard rule `in [accepted]`,
 * and `anyone` writes nothing.
 */
async function writeCard(
  db: import('pg').PoolClient, ctx: Ctx, q: Question, values: readonly string[], whoFine: WhoFine,
): Promise<void> {
  if (values.length) {
    await writeFact(db, ctx, q, values);
    await db.query(
      `INSERT INTO predicate_status (tenant_id, user_id, predicate, state, updated_at)
       VALUES ($1,$2,$3,'known', now())
       ON CONFLICT (user_id, predicate) DO UPDATE SET state = 'known', updated_at = now()`,
      [ctx.tenantId, ctx.userId, q.predicate],
    );
  } else {
    await db.query(
      `UPDATE facts SET status = 'retracted', valid_to = now(), invalidated_at = now()
        WHERE user_id = $1 AND predicate = $2 AND status = 'active' AND valid_to IS NULL`,
      [ctx.userId, q.predicate],
    );
    await db.query(
      `INSERT INTO predicate_status (tenant_id, user_id, predicate, state, reason, updated_at)
       VALUES ($1,$2,$3,'declined','never_mentioned', now())
       ON CONFLICT (user_id, predicate)
       DO UPDATE SET state = 'declined', updated_at = now()`,
      [ctx.tenantId, ctx.userId, q.predicate],
    );
  }

  await writeWhoFine(db, ctx, q, whoFine);
}

/**
 * The Who's-fine half of a core card, on its own: retire whatever rule the card had,
 * and write the new one if the person narrowed.
 *
 * Its own function because two things change it. The card itself, answered in the
 * interview; and the person confirming a proposal made from their own sentence, which
 * must change the rule WITHOUT touching the You half -- re-running the whole card to
 * change one row would re-commit a fact they never re-typed. Retire, never delete:
 * the old rule stays on record with the moment it stopped applying.
 */
async function writeWhoFine(
  db: import('pg').PoolClient, ctx: Ctx, q: Question, whoFine: WhoFine, sourceQuote?: string,
): Promise<void> {
  await db.query(
    `UPDATE preferences SET retired_at = now()
      WHERE user_id = $1 AND predicate = $2 AND retired_at IS NULL`,
    [ctx.userId, q.predicate],
  );
  if ('only' in whoFine) {
    await setPreference(db, ctx, {
      predicate: q.predicate,
      operator: 'in',
      value: whoFine.only,
      strength: 'dealbreaker',
      sourceQuote: sourceQuote ?? q.whoFine?.text ?? q.text,
    });
  }
}

/**
 * What a mapped sentence would change on a card, for the person to confirm.
 *
 * THE MODEL PROPOSES AND THE PERSON DECIDES. The sentence "Anyone else you couldn't be
 * with?" used to become a hard rule the moment the mapper answered: a model, reading
 * one line, silently removing people from somebody's pool -- and a wrong mapping is
 * invisible, because the person never sees who it removed. The spec's rule is that no
 * model makes a filter decision. So the mapping becomes this proposal, drawn on the
 * card the person has just answered with the proposed options already unticked, and
 * nothing changes until they tap to keep it.
 *
 * The proposal starts from what the card ALREADY accepts, not from every option: a
 * person who said "only never or rarely" and then wrote "no smokers" is proposed
 * "never", not handed back "rarely" they had ruled out themselves.
 *
 * NULL -- nothing to confirm -- when the sentence names no card, when it would leave
 * nobody (a rule that accepts nobody is an empty pool with no reason on screen), and
 * when it changes nothing the card did not already say.
 */
export function proposeFromSentence(
  card: Question,
  excludes: readonly string[],
  current: WhoFine | null,
): {
  questionId: string;
  /** The card's own question -- "Do you smoke?" -- so the person sees which card this is. */
  card: string;
  /** The Who's-fine row's wording. */
  text: string;
  options: { value: string; label: string }[];
  accept: string[];
} | null {
  const options = card.whoFine?.options ?? card.options;
  const all = options.map((o) => o.value);
  const had = current && 'only' in current ? all.filter((v) => current.only.includes(v)) : all;
  const accept = had.filter((v) => !excludes.includes(v));
  if (!accept.length || accept.length === had.length) return null;
  return { questionId: card.id, card: card.text, text: card.whoFine?.text ?? card.text, options, accept };
}
