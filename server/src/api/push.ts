/**
 * A phone saying where it can be woken: its Expo push token, for this account.
 *
 * The token is the phone's, handed out by Expo on the device; the server only keeps it
 * against the person signed in (0076, row-level security like every user table) and
 * gives it to the push sender (push/index.ts). No route ever sends a token back out.
 * Registered after sign-in, dropped at sign-out -- a phone that changes hands must not
 * keep waking the previous person's matches onto the new person's lock screen.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { resolveCtx, Unauthorized } from '../auth.js';
import { tenantSession } from '../db/client.js';
import { log } from '../log.js';

/** What Expo hands a device: ExponentPushToken[...] (or the newer ExpoPushToken[...]). */
const Token = z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,120}\]$/);
const Register = z.object({ token: Token, platform: z.enum(['android', 'ios']) });
const Drop = z.object({ token: Token });

async function who(header: string | undefined) {
  try {
    return await resolveCtx(header);
  } catch (err) {
    if (err instanceof Unauthorized) return null;
    throw err;
  }
}

export const pushRoutes = new Hono()
  .post('/v1/push/token', async (c) => {
    const ctx = await who(c.req.header('authorization'));
    if (!ctx) return c.json({ error: 'unauthorized' }, 401);
    const body = Register.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);
    await tenantSession(ctx, (db) => db.query('SELECT claim_push_token($1, $2)', [body.data.token, body.data.platform]));
    log.info({ userId: ctx.userId, platform: body.data.platform }, 'push token registered');
    return c.json({ ok: true });
  })
  .delete('/v1/push/token', async (c) => {
    const ctx = await who(c.req.header('authorization'));
    if (!ctx) return c.json({ error: 'unauthorized' }, 401);
    const body = Drop.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);
    // Own rows only: the policy (0076) sees nobody else's token.
    await tenantSession(ctx, (db) => db.query('DELETE FROM push_tokens WHERE token = $1', [body.data.token]));
    return c.json({ ok: true });
  });
