/**
 * The interview: one question at a time, until there is nothing left worth asking.
 *
 * This is the spine of onboarding. The strongest published method for making an agent
 * answer like a particular person is a long structured interview, and the variance
 * that actually predicts somebody sits in how they answer specific questions rather
 * than in a stable profile. A form cannot reach it; a conversation of questions can.
 *
 * Costs nothing per question: the options are fixed, the answer maps straight onto a
 * predicate, and which question comes next is a SQL count over the candidate pool.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { deriveValue } from '@clone/shared';
import { resolveCtx, Unauthorized } from '../auth.js';
import { matchSession, tenantSession } from '../db/client.js';
import { commit } from '../memory/facts.js';
import { rebuildMatchProfile, setPreference } from '../matching/profile.js';
import { candidateIds } from '../matching/candidates.js';
import { BY_ID, GATING } from '../onboarding/questions.js';
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
): Promise<Set<string>> => {
  const { rows } = await db.query<{ question_id: string }>(
    `SELECT question_id FROM question_answers WHERE user_id = $1`, [userId],
  );
  return new Set(rows.map((r) => r.question_id));
};

export const interviewRoutes = new Hono()
  /** The next question, or null when the interview is done. */
  .get('/v1/interview/next', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const state = await tenantSession(ctx, async (db) => ({
      answered: await askedSet(db, ctx.userId),
      profile: await rebuildMatchProfile(db, ctx),
    }));

    // Candidates are only measurable once the gating answers exist. Before that the
    // pool is empty and any "which question splits it best" is a coin toss, so the
    // gating questions are asked first regardless.
    const candidates = state.profile.inPool
      ? await matchSession((db) => candidateIds(db, ctx.userId, 500)).catch(() => [])
      : [];

    const next = await tenantSession(ctx, (db) =>
      nextQuestion(db, ctx.userId, state.answered, candidates),
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
          }
        : null,
      answered: state.answered.size,
      remaining: next?.remaining ?? 0,
      /** Can the agent go out yet? The thing the person actually wants to know. */
      ready: state.profile.inPool,
      missing: state.profile.missing,
      poolSize: candidates.length,
    });
  })

  /**
   * One answer.
   *
   * A FACT answer commits as owner-asserted — typed by the person, about themselves,
   * in their own app. A PREFERENCE answer becomes a rule, and whether it excludes
   * anybody depends entirely on which option they chose: only the explicit "I
   * couldn't" turns into a dealbreaker. Everything else adds points.
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

    const after = await tenantSession(ctx, async (db) => {
      await db.query(
        `INSERT INTO question_answers (tenant_id, user_id, question_id, answer, skipped)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, question_id)
         DO UPDATE SET answer = EXCLUDED.answer, skipped = EXCLUDED.skipped,
                       answered_at = now()`,
        [ctx.tenantId, ctx.userId, q.id,
         JSON.stringify(q.kind === 'free' ? [sentence].filter(Boolean) : values),
         q.kind === 'free' ? !sentence : values.length === 0],
      );

      if (q.kind === 'free') {
        // Handled outside this transaction: mapping the sentence to a rule is a model
        // call, and this codebase does not hold a transaction open across one.
        return rebuildMatchProfile(db, ctx);
      }

      if (values.length === 0) return rebuildMatchProfile(db, ctx);

      if (q.kind === 'fact') {
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
      } else {
        const choice = values[0]!;
        // "Doesn't matter" is an answer, and the right response to it is to store no
        // rule at all rather than a weak one that quietly reorders everybody.
        if (choice !== 'none' && choice !== 'anything') {
          const strength =
            q.dealbreakerIf && choice === q.dealbreakerIf ? 'dealbreaker' as const
            : choice === 'strong' ? 'strong' as const
            : 'strong' as const;

          // For a matching preference ("theirs should match mine") the wanted value is
          // whatever the person answered on the paired fact, not the word they picked.
          const { rows } = await db.query<{ object_value: unknown }>(
            `SELECT object_value FROM facts
              WHERE user_id = $1 AND predicate = $2 AND status = 'active' AND valid_to IS NULL
              LIMIT 1`,
            [ctx.userId, q.predicate],
          );
          const mine = rows[0]?.object_value;
          const wanted =
            q.multi ? values.map((v) => deriveValue(q.predicate, v) ?? v)
            : mine !== null && mine !== undefined ? [mine]
            : values.map((v) => deriveValue(q.predicate, v) ?? v);

          await setPreference(db, ctx, {
            predicate: q.predicate,
            operator: 'in',
            value: wanted,
            strength,
            sourceQuote: q.text,
          });
        }
      }

      return rebuildMatchProfile(db, ctx);
    });

    // ── a sentence, after the transaction closed ───────────────────────────
    //
    // Two things happen to it, and the second may not. The SENTENCE is kept whatever
    // else fails: it is the only free text in this flow, so it is the only thing here
    // their agent can quote in a conversation. Mapping it to a rule is best effort,
    // because people say true things that no column represents -- "someone who talks
    // through films" is a real dealbreaker and there is no field for it.
    let mapped: { predicate: string | null; excludes: string[] } | null = null;
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
        mapped = { predicate: m.predicate, excludes: m.excludes };

        if (m.predicate && m.excludes.length) {
          await tenantSession(ctx, (db) =>
            setPreference(db, ctx, {
              predicate: m.predicate!,
              // NOT `in`. Excluding the values they named leaves everybody else,
              // including the many people who never answered that question -- and an
              // unknown must never be treated as a mismatch.
              operator: 'not_in',
              value: m.excludes,
              strength: 'dealbreaker',
              sourceQuote: sentence,
            }),
          );
        }
      } catch (err) {
        // A failed mapping costs a filter, not the answer. The sentence is already in.
        log.warn({ err, userId: ctx.userId }, 'dealbreaker not mapped');
      }
    }

    log.info(
      { userId: ctx.userId, questionId: q.id,
        skipped: q.kind === 'free' ? !sentence : values.length === 0,
        mappedTo: mapped?.predicate ?? null },
      'answered',
    );
    return c.json({ ok: true, ready: after.inPool, missing: after.missing, mapped });
  });
