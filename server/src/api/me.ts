import { Hono } from 'hono';
import { resolveCtx, Unauthorized } from '../auth.js';
import { tenantSession } from '../db/client.js';
import { eraseUser, exportUser } from '../memory/erasure.js';
import { log } from '../log.js';

export const meRoutes = new Hono()
  .get('/v1/me/export', async (c) => {
    let ctx;
    try {
      ctx = await resolveCtx(c.req.header('authorization'));
    } catch (err) {
      if (err instanceof Unauthorized) return c.json({ error: 'unauthorized' }, 401);
      throw err;
    }
    const data = await tenantSession(ctx, (db) => exportUser(db, ctx.userId));
    c.header('Content-Disposition', 'attachment; filename="clone-export.json"');
    return c.json(data);
  })

  .delete('/v1/me', async (c) => {
    let ctx;
    try {
      ctx = await resolveCtx(c.req.header('authorization'));
    } catch (err) {
      if (err instanceof Unauthorized) return c.json({ error: 'unauthorized' }, 401);
      throw err;
    }
    // Irreversible and unconfirmable afterwards, so the intent must be explicit in the
    // request rather than inferred from the method alone.
    if (c.req.query('confirm') !== 'delete-everything') {
      return c.json(
        { error: 'confirmation required', hint: 'DELETE /v1/me?confirm=delete-everything' },
        400,
      );
    }
    const r = await eraseUser(ctx);
    log.info({ userId: ctx.userId, verified: r.verified }, 'erasure requested');
    return c.json(r, r.verified ? 200 : 500);
  });
