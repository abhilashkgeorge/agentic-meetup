/**
 * Your character.
 *
 * GET returns the one you saved, or the free one your seed gives you until then, plus
 * what you own. PUT saves one -- validated against the catalog in shared/look.ts, and
 * refused with 402 if it wears anything you have not bought, so the shop's rule is
 * the server's rule and not the builder's. Points and buying land in 0057; until
 * then `owned` is empty and `balance` is 0.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { Look, clampLook, lockedIn, starterLookFor } from '@clone/shared';
import { resolveCtx, Unauthorized } from '../auth.js';
import { tenantSession } from '../db/client.js';
import { lookSeed } from '../looks/store.js';

async function ctxOr401(c: { req: { header: (k: string) => string | undefined } }) {
  try {
    return { ctx: await resolveCtx(c.req.header('authorization')), res: null } as const;
  } catch (err) {
    if (err instanceof Unauthorized) return { ctx: null, res: 'unauthorized' } as const;
    throw err;
  }
}

export const lookRoutes = new Hono()
  .get('/v1/look', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const out = await tenantSession(ctx, async (db) => {
      const { rows } = await db.query<{ look: unknown }>('SELECT look FROM looks WHERE user_id = $1', [ctx.userId]);
      const { rows: items } = await db.query<{ item: string }>('SELECT item FROM look_items WHERE user_id = $1', [ctx.userId]);
      return {
        saved: rows.length > 0,
        look: rows[0] ? clampLook(rows[0].look) : starterLookFor(lookSeed(ctx.userId)),
        owned: items.map((i) => i.item),
      };
    });
    return c.json({ ...out, balance: 0 });
  })

  .put('/v1/look', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const body = z.object({ look: Look }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);
    const look = body.data.look;

    const result = await tenantSession(ctx, async (db) => {
      const { rows: items } = await db.query<{ item: string }>('SELECT item FROM look_items WHERE user_id = $1', [ctx.userId]);
      // The shop's rule, enforced where it counts: nothing unpaid is ever saved.
      const locked = lockedIn(look, new Set(items.map((i) => i.item)));
      if (locked.length) return { locked } as const;
      const { rows } = await db.query<{ inserted: boolean }>(
        `INSERT INTO looks (user_id, tenant_id, look) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET look = EXCLUDED.look, updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [ctx.userId, ctx.tenantId, look],
      );
      return { first: rows[0]?.inserted === true } as const;
    });
    if ('locked' in result) return c.json({ error: 'locked', items: result.locked.map((i) => i.id) }, 402);
    return c.json({ look, first: result.first, awarded: 0 });
  });
