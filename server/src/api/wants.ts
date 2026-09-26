/**
 * Your wants, each with the question the other person answers.
 *
 * THE FOUNDER'S PLAN (2026-09-26): a want like "a saver, not an impulse spender" is
 * checked against the other person's answer to the right question -- "You get an
 * unexpected ₹50,000. What happens to most of it?" -- not guessed from a label. This is
 * where the person sees which question their want will use (want-questions.ts, by code)
 * and ticks which answers are fine. What they tick is an ordinary rule on that answer
 * (preferences, `in [ticked]`), its source the want's own words, and it shows on "What
 * you're looking for" with Must have / Really want / Nice to have like every rule.
 *
 * NOTHING IS TICKED FOR THEM, and ticking every answer is no rule at all -- a list that
 * accepts everybody is not a want. A want that matches no question stays a sentence,
 * checked against what people write, and only ever moves people down. A private topic
 * stays on its card.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { resolveCtx, Unauthorized } from '../auth.js';
import { tenantSession, type TenantCtx } from '../db/client.js';
import { setPreference } from '../matching/profile.js';
import { loadWants } from '../matching/wants.js';
import { WANT_QUESTION_PREDICATES, questionForWant, wantQuestion } from '../matching/want-questions.js';
import { BY_ID } from '../onboarding/questions.js';

async function ctxOf(header: string | undefined): Promise<TenantCtx | null> {
  try {
    return await resolveCtx(header);
  } catch (err) {
    if (err instanceof Unauthorized) return null;
    throw err;
  }
}

/** The rules the person's wants wrote: by the want's words. */
async function rulesOf(ctx: TenantCtx, texts: readonly string[]) {
  return tenantSession(ctx, async (db) => (await db.query<{ id: string; predicate: string; strength: string; source_quote: string }>(
    `SELECT id, predicate, strength, source_quote FROM preferences
      WHERE user_id = $1 AND retired_at IS NULL AND operator = 'in'
        AND predicate = ANY($2) AND source_quote = ANY($3)`,
    [ctx.userId, [...WANT_QUESTION_PREDICATES], [...texts]])).rows);
}

const Body = z.object({ want: z.string().min(1).max(400), questionId: z.string().min(1).max(64), accepted: z.array(z.string().min(1).max(64)).max(20) });

export const wantRoutes = new Hono()
  .get('/v1/me/wants', async (c) => {
    const ctx = await ctxOf(c.req.header('authorization'));
    if (!ctx) return c.json({ error: 'unauthorized' }, 401);
    const wants = await loadWants(ctx);
    const rules = new Map((await rulesOf(ctx, wants.map((w) => w.text))).map((r) => [r.source_quote, r]));
    return c.json({
      wants: wants.map((w) => {
        // On a private topic the card is the question; nothing to choose here.
        const q = w.private ? null
          : w.ask ? BY_ID.get(w.ask.questionId) ?? null
          : questionForWant(w.text)?.question ?? null;
        const rule = rules.get(w.text);
        return {
          text: w.text, kind: w.kind, private: w.private,
          question: q ? { id: q.id, text: q.text, topic: q.topic ?? null, options: q.options, multi: q.multi ?? false } : null,
          accepted: w.ask?.accepted ?? null,
          rule: rule ? { id: rule.id, strength: rule.strength } : null,
        };
      }),
    });
  })

  /** Tie a want to its question: the answers that are fine. Replaces what it had. */
  .post('/v1/me/wants/question', async (c) => {
    const ctx = await ctxOf(c.req.header('authorization'));
    if (!ctx) return c.json({ error: 'unauthorized' }, 401);
    const body = Body.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);
    const { want, questionId, accepted } = body.data;

    const mine = (await loadWants(ctx)).find((w) => w.text === want);
    if (!mine) return c.json({ error: 'not_your_want' }, 404);
    if (mine.private) return c.json({ error: 'private', message: 'This one is checked against your card.' }, 400);
    const wq = wantQuestion(questionId);
    if (!wq) return c.json({ error: 'unknown_question' }, 400);
    const values = new Set(wq.question.options.map((o) => o.value));
    const ticked = [...new Set(accepted)];
    if (!ticked.length || ticked.some((v) => !values.has(v))) {
      return c.json({ error: 'pick_answers', message: 'Tick at least one answer that is fine.' }, 400);
    }

    await tenantSession(ctx, async (db) => {
      const before = (await rulesOf(ctx, [want]))[0];
      // Whatever this want wrote before goes: retired, never deleted.
      await db.query(
        `UPDATE preferences SET retired_at = now()
          WHERE user_id = $1 AND retired_at IS NULL AND operator = 'in' AND source_quote = $2 AND predicate = ANY($3)`,
        [ctx.userId, want, [...WANT_QUESTION_PREDICATES]]);
      // EVERY ANSWER TICKED IS NO RULE: it accepts everybody.
      if (ticked.length === values.size) return;
      await setPreference(db, ctx, {
        predicate: wq.question.predicate, operator: 'in', value: ticked,
        // A re-tick keeps the strength they chose on "What you're looking for".
        strength: (before?.strength as 'dealbreaker' | 'strong' | 'mild' | undefined) ?? 'strong',
        sourceQuote: want,
      });
    });
    return c.json({ ok: true, rule: ticked.length === values.size ? null : { predicate: wq.question.predicate, accepted: ticked } });
  })

  /** Stop checking a want against its question. It is a sentence again. */
  .post('/v1/me/wants/question/clear', async (c) => {
    const ctx = await ctxOf(c.req.header('authorization'));
    if (!ctx) return c.json({ error: 'unauthorized' }, 401);
    const body = z.object({ want: z.string().min(1).max(400) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);
    await tenantSession(ctx, (db) => db.query(
      `UPDATE preferences SET retired_at = now()
        WHERE user_id = $1 AND retired_at IS NULL AND operator = 'in' AND source_quote = $2 AND predicate = ANY($3)`,
      [ctx.userId, body.data.want, [...WANT_QUESTION_PREDICATES]]));
    return c.json({ ok: true });
  });
