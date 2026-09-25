/**
 * The question of the day (matching/unknowns.ts): what other agents asked this person's
 * agent that it could not answer. At most two a day, skippable, and never who asked.
 * No model call on any route here.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { resolveCtx, Unauthorized } from '../auth.js';
import { log } from '../log.js';
import { STORY_MAX, STORY_MIN } from '../onboarding/stories.js';
import {
  QUIET_DAYS, SHEET_IDS, answerDailyQuestion, questionOfDay, skipDailyQuestion,
} from '../matching/unknowns.js';

async function ctxOr401(c: { req: { header: (k: string) => string | undefined } }) {
  try {
    return { ctx: await resolveCtx(c.req.header('authorization')), res: null } as const;
  } catch (err) {
    if (err instanceof Unauthorized) return { ctx: null, res: 'unauthorized' } as const;
    throw err;
  }
}

export const questionOfDayRoutes = new Hono()
  /**
   * Today's question, or null. The reason is a count and nothing else: NEVER who asked,
   * which the database does not know (0062).
   */
  .get('/v1/question-of-day', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const q = await questionOfDay(ctx);
    return c.json({ question: q ? { id: q.id, ask: q.ask, count: q.count } : null, min: STORY_MIN, max: STORY_MAX });
  })

  /** Their answer, in their own words: on their sheet at once. */
  .post('/v1/question-of-day', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const body = z.object({ id: z.string().min(1).max(64), text: z.string().max(2000) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success || !SHEET_IDS.has(body.data.id)) return c.json({ error: 'bad request' }, 400);
    const text = body.data.text.trim();
    if (text.length < STORY_MIN) return c.json({ error: 'too_short', min: STORY_MIN }, 400);
    if (text.length > STORY_MAX) return c.json({ error: 'too_long', max: STORY_MAX }, 400);
    const out = await answerDailyQuestion(ctx, body.data.id, text);
    log.info({ userId: ctx.userId, question: body.data.id, usable: out.usable }, 'question of the day answered');
    // Saved either way; `usable` false means no agent will ever say it, and why.
    return c.json({ ok: true, factId: out.factId, usable: out.usable, reason: out.reason });
  })

  /** Not now. Not offered again for QUIET_DAYS, and it counts toward today's two. */
  .post('/v1/question-of-day/skip', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const body = z.object({ id: z.string().min(1).max(64) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success || !SHEET_IDS.has(body.data.id)) return c.json({ error: 'bad request' }, 400);
    await skipDailyQuestion(ctx, body.data.id);
    return c.json({ ok: true, quietDays: QUIET_DAYS });
  });
