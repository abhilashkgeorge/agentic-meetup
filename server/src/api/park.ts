/**
 * Block or report somebody you met in the park.
 *
 * In the park a stranger is a ref, never a user id (the square's rule), so these take
 * the ref you were given and look the person up in the room -- among the people here
 * now whom you can see. Somebody who has left the park since cannot be looked up; the
 * app says so. Both keep you apart from that moment: neither sees nor hears the other
 * in the park again, and the block is the same one every other screen honours.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { resolveCtx, Unauthorized } from '../auth.js';
import { tenantSession } from '../db/client.js';
import * as messages from '../messaging/store.js';
import { log } from '../log.js';
import { REPORT_REASONS } from './messages.js';
import { park, pairs, refreshVoice, separate } from '../park/socket.js';
import { PARK_ROOM, VOICE_REPORT, benchRoom, silence, voiceBannedUntil } from '../park/voice.js';

async function ctxOr401(c: { req: { header: (k: string) => string | undefined } }) {
  try {
    return { ctx: await resolveCtx(c.req.header('authorization')), res: null } as const;
  } catch (err) {
    if (err instanceof Unauthorized) return { ctx: null, res: 'unauthorized' } as const;
    throw err;
  }
}

const Ref = z.string().regex(/^[0-9a-f]{32}$/);

export const parkRoutes = new Hono()
  .post('/v1/park/block', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const body = z.object({ ref: Ref }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);
    const other = park.resolve(ctx.userId, body.data.ref);
    if (!other) return c.json({ error: 'not_here' }, 404);
    await tenantSession(ctx, (db) => messages.block(db, ctx.userId, other));
    await separate(ctx.userId, other);
    log.info({ userId: ctx.userId }, 'park: blocked someone');
    return c.json({ ok: true });
  })

  .post('/v1/park/report', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const body = z.object({
      ref: Ref,
      reason: z.enum(REPORT_REASONS),
      detail: z.string().max(2000).default(''),
      /** About what they said out loud (park/voice.ts): counts towards a voice ban. */
      voice: z.boolean().default(false),
    }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);
    const other = park.resolve(ctx.userId, body.data.ref);
    if (!other) return c.json({ error: 'not_here' }, 404);
    await tenantSession(ctx, (db) => messages.report(db, {
      reporterId: ctx.userId, reportedId: other, rendezvousId: null,
      reason: body.data.reason, detail: `${body.data.voice ? VOICE_REPORT : 'In the park.'} ${body.data.detail}`,
    }));
    await separate(ctx.userId, other);
    log.warn({ reason: body.data.reason, voice: body.data.voice }, 'park: report filed');
    // Enough people reporting somebody's voice and their mic goes, now: taken on the
    // voice server at once, and their next pass says so.
    if (body.data.voice && (await voiceBannedUntil(other))) {
      const voice = park.members.get(other)?.voice;
      const partner = pairs.partnerOf(other);
      if (voice) {
        await silence(PARK_ROOM, voice);
        if (partner && pairs.benchOf(other) != null) await silence(benchRoom(other, partner), voice);
      }
      await refreshVoice(other);
      log.warn({}, 'park voice: a voice ban began');
    }
    return c.json({ ok: true, message: 'Thanks. They cannot see or talk to you any more, and somebody will look at this.' });
  });
