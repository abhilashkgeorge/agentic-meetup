/**
 * "Check your photos": two selfies in, a verdict out, nothing kept.
 *
 * Two requests, not one multipart, because the phone cannot build multipart (see
 * uploadPhoto in the app) and two raw bodies is the honest shape anyway: the first
 * frame opens a check, the second queues it. The worker (photos/facecheck.ts) does
 * the rest and deletes both frames. GET says where the last check stands and whether
 * it still covers every photo -- adding a photo takes the badge off.
 *
 * When FACE_CHECK is off the GET says `unavailable` and the app never offers this.
 */
import { Hono } from 'hono';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolveCtx, Unauthorized } from '../auth.js';
import { tenantSession } from '../db/client.js';
import { faceCheckEnabled } from '../photos/face.js';
import * as photos from '../photos/store.js';

async function ctxOr401(c: { req: { header: (k: string) => string | undefined } }) {
  try {
    return { ctx: await resolveCtx(c.req.header('authorization')), res: null } as const;
  } catch (err) {
    if (err instanceof Unauthorized) return { ctx: null, res: 'unauthorized' } as const;
    throw err;
  }
}

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

async function frame(c: { req: { header: (k: string) => string | undefined; arrayBuffer: () => Promise<ArrayBuffer> } }) {
  if (!(c.req.header('content-type') ?? '').startsWith('image/')) return null;
  return photos.selfieFrame(Buffer.from(await c.req.arrayBuffer()));
}

export const verifyRoutes = new Hono()
  .get('/v1/photos/verify', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    if (!faceCheckEnabled()) return c.json({ status: 'unavailable' });
    const out = await tenantSession(ctx, async (db) => {
      const { rows } = await db.query<{ status: string; result: string | null; finished_at: Date | null }>(
        'SELECT status, result, finished_at FROM photo_checks WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 1',
        [ctx.userId]);
      const { rows: cov } = await db.query<{ covers: boolean }>('SELECT photos_checked($1, $1) AS covers', [ctx.userId]);
      const last = rows[0];
      return {
        status: last?.status ?? 'none',
        result: last?.result ?? null,
        covers: cov[0]?.covers === true,
        checkedAt: last?.finished_at ? last.finished_at.toISOString() : null,
      };
    });
    return c.json(out);
  })

  /** Frame one: facing the camera. Opens a check. */
  .post('/v1/photos/verify', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    if (!faceCheckEnabled()) return c.json({ error: 'unavailable' }, 503);
    let jpeg: Buffer | null;
    try {
      jpeg = await frame(c);
    } catch (err) {
      if (err instanceof photos.BadImage) return c.json({ error: 'bad image', message: err.message }, 400);
      throw err;
    }
    if (!jpeg) return c.json({ error: 'bad request', message: 'Send the picture as the body.' }, 400);

    const id = await tenantSession(ctx, async (db) => {
      try {
        const { rows } = await db.query<{ id: string }>(
          'INSERT INTO photo_checks (tenant_id, user_id) VALUES ($1, $2) RETURNING id', [ctx.tenantId, ctx.userId]);
        return rows[0]!.id;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') return null;   // one at a time
        throw err;
      }
    });
    if (!id) return c.json({ error: 'busy' }, 409);
    await mkdir(photos.checkDir(ctx.userId), { recursive: true });
    await writeFile(photos.framePath(ctx.userId, id, 'a'), jpeg);
    return c.json({ checkId: id }, 202);
  })

  /** Frame two: head turned. Queues the check. */
  .post('/v1/photos/verify/:checkId', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const checkId = c.req.param('checkId');
    if (!isUuid(checkId)) return c.json({ error: 'bad id' }, 400);
    let jpeg: Buffer | null;
    try {
      jpeg = await frame(c);
    } catch (err) {
      if (err instanceof photos.BadImage) return c.json({ error: 'bad image', message: err.message }, 400);
      throw err;
    }
    if (!jpeg) return c.json({ error: 'bad request', message: 'Send the picture as the body.' }, 400);

    await mkdir(photos.checkDir(ctx.userId), { recursive: true });
    await writeFile(photos.framePath(ctx.userId, checkId, 'b'), jpeg);
    const { rowCount } = await tenantSession(ctx, (db) => db.query(
      `UPDATE photo_checks SET status = 'queued', requested_at = now()
        WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [checkId, ctx.userId]));
    if (!rowCount) return c.json({ error: 'not found' }, 404);
    return c.json({ checkId, status: 'queued' }, 202);
  });
