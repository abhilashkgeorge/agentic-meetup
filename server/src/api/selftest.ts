/**
 * The self-test, over HTTP.
 *
 * Deliberately three tiny endpoints rather than one clever one: asking costs a model
 * call and grading does not, so they must not share a request. A person who opens the
 * screen and closes it should not have been charged for five answers.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { resolveCtx, Unauthorized } from '../auth.js';
import { tenantSession } from '../db/client.js';
import { checkBudget, record, BudgetExceeded } from '../metering.js';
import { gradeSelfTest, nextSelfTest, readiness, PASS_MARK, TEST_SIZE } from '../memory/selftest.js';
import { log } from '../log.js';

export const selfTestRoutes = new Hono()
  .get('/v1/selftest', async (c) => {
    let ctx;
    try {
      ctx = await resolveCtx(c.req.header('authorization'));
    } catch (err) {
      if (err instanceof Unauthorized) return c.json({ error: 'unauthorized' }, 401);
      throw err;
    }
    const r = await tenantSession(ctx, (db) => readiness(db, ctx.userId));
    return c.json({ ...r, passMark: PASS_MARK, testSize: TEST_SIZE });
  })

  .post('/v1/selftest/next', async (c) => {
    let ctx;
    try {
      ctx = await resolveCtx(c.req.header('authorization'));
    } catch (err) {
      if (err instanceof Unauthorized) return c.json({ error: 'unauthorized' }, 401);
      throw err;
    }

    try {
      await tenantSession(ctx, (db) => checkBudget(db, ctx.tenantId, ctx.userId));
    } catch (err) {
      if (err instanceof BudgetExceeded) return c.json({ error: 'budget_exceeded' }, 429);
      throw err;
    }

    const item = await tenantSession(ctx, (db) => nextSelfTest(db, ctx));
    if (!item) {
      return c.json({
        error: 'nothing to test',
        message: 'Tell it one true thing about you first.',
      }, 400);
    }
    return c.json(item);
  })

  .post('/v1/selftest/grade', async (c) => {
    let ctx;
    try {
      ctx = await resolveCtx(c.req.header('authorization'));
    } catch (err) {
      if (err instanceof Unauthorized) return c.json({ error: 'unauthorized' }, 401);
      throw err;
    }
    const body = z
      .object({
        id: z.string().uuid(),
        verdict: z.enum(['me', 'not_me']),
        correction: z.string().max(2000).optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);

    const { id, verdict, correction } = body.data;
    const ok = await tenantSession(ctx, async (db) => {
      const done = await gradeSelfTest(db, ctx, id, verdict, correction);
      if (!done) return null;
      return readiness(db, ctx.userId);
    });

    if (!ok) return c.json({ error: 'already graded' }, 409);
    log.info({ userId: ctx.userId, verdict }, 'self-test graded');
    return c.json({ ...ok, passMark: PASS_MARK, testSize: TEST_SIZE });
  });
