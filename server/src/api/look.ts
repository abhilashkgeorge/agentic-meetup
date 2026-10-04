/**
 * Your character, and the points that dress it.
 *
 * GET returns the one you saved, or the free one your seed gives you until then, plus
 * what you own and what you have. PUT saves one -- validated against the catalog in
 * shared/look.ts, and refused with 402 if it wears anything you have not bought, so
 * the shop's rule is the server's rule and not the builder's. The first save is
 * worth 20 points, once. /buy spends them; /points shows them -- to you, and to
 * nobody else, by the ledger's own policy.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { CATALOG, Look, clampLook, figureForGender, lockedIn, starterLookFor } from '@clone/shared';
import { resolveCtx, Unauthorized } from '../auth.js';
import { tenantSession } from '../db/client.js';
import { lookSeed } from '../looks/store.js';
import { award, balance, buy, owned } from '../points/ledger.js';

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
      // Not built yet: the look everybody else sees of them (looks/store.ts), on the
      // figure for what they said they are, which the builder then starts from.
      const said = rows[0] ? null : (await db.query<{ gender: string | null }>(
        'SELECT gender FROM match_profile WHERE user_id = $1', [ctx.userId])).rows[0]?.gender;
      return {
        saved: rows.length > 0,
        look: rows[0] ? clampLook(rows[0].look) : starterLookFor(lookSeed(ctx.userId), figureForGender(said)),
        owned: await owned(db, ctx.userId),
        balance: await balance(db, ctx.userId),
      };
    });
    return c.json(out);
  })

  .put('/v1/look', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const body = z.object({ look: Look }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);
    const look = body.data.look;

    const result = await tenantSession(ctx, async (db) => {
      // The shop's rule, enforced where it counts: nothing unpaid is ever saved.
      const locked = lockedIn(look, new Set(await owned(db, ctx.userId)));
      if (locked.length) return { locked } as const;
      const { rows } = await db.query<{ inserted: boolean }>(
        `INSERT INTO looks (user_id, tenant_id, look) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET look = EXCLUDED.look, updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [ctx.userId, ctx.tenantId, look],
      );
      const first = rows[0]?.inserted === true;
      // Once, ever: the ledger's unique key makes a second first impossible.
      const awarded = first ? await award(db, ctx, 'look', 'self') : 0;
      return { first, awarded, balance: await balance(db, ctx.userId) } as const;
    });
    if ('locked' in result) return c.json({ error: 'locked', items: result.locked.map((i) => i.id) }, 402);
    return c.json({ look, first: result.first, awarded: result.awarded, balance: result.balance });
  })

  .post('/v1/look/buy', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const body = z.object({ item: z.string().min(3).max(32) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);
    const item = CATALOG.find((i) => i.id === body.data.item);
    // A starter item is not for sale; asking to buy one is a client bug, not a purchase.
    if (!item || item.cost === 0) return c.json({ error: 'unknown' }, 404);

    const out = await tenantSession(ctx, async (db) => {
      const r = await buy(db, ctx, item);
      return { ...r, owned: await owned(db, ctx.userId) };
    });
    if (out.status === 'short') return c.json({ error: 'not_enough', balance: out.balance }, 409);
    return c.json({ ok: true, balance: out.balance, owned: out.owned });
  })

  .get('/v1/points', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const out = await tenantSession(ctx, async (db) => {
      const { rows } = await db.query<{ reason: string; amount: number; created_at: Date }>(
        'SELECT reason, amount, created_at FROM points_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
        [ctx.userId]);
      return {
        balance: await balance(db, ctx.userId),
        // Reasons and amounts, never refs: a ledger line must not name the other person.
        ledger: rows.map((r) => ({ reason: r.reason, amount: r.amount, at: r.created_at.toISOString() })),
      };
    });
    return c.json(out);
  });
