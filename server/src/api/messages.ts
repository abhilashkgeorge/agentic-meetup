/**
 * History, the conversation list, and the safety actions.
 *
 * The socket carries what is happening now; this carries what happened. Splitting them
 * is deliberate — scrolling back through a year of messages over a WebSocket means
 * reimplementing paging, retries and caching that HTTP already has.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { resolveCtx, Unauthorized } from '../auth.js';
import { matchmakerSession, tenantSession } from '../db/client.js';
import { lookOf, looksFor } from '../looks/store.js';
import type { Look } from '@clone/shared';
import * as messages from '../messaging/store.js';
import { log } from '../log.js';

async function ctxOr401(c: { req: { header: (k: string) => string | undefined } }) {
  try {
    return { ctx: await resolveCtx(c.req.header('authorization')), res: null } as const;
  } catch (err) {
    if (err instanceof Unauthorized) return { ctx: null, res: 'unauthorized' } as const;
    throw err;
  }
}

/** The reasons a report may give: fixed, so the reviewer's queue reads the same every time. */
export const REPORT_REASONS = [
  'harassment', 'inappropriate', 'fake_profile', 'underage', 'spam', 'felt_unsafe', 'other',
] as const;

/**
 * Who a block or report is about: the person named, or the other half of the named
 * match -- which the caller must be half of (their session reads only their own
 * rendezvous rows), or it is nobody.
 */
async function otherPerson(
  ctx: { tenantId: string; userId: string },
  by: { userId?: string | undefined; rendezvousId?: string | undefined },
): Promise<string | null> {
  if (by.userId) return by.userId === ctx.userId ? null : by.userId;
  if (!by.rendezvousId) return null;
  const { rows } = await tenantSession(ctx, (db) => db.query<{ other: string }>(
    `SELECT CASE WHEN user_a = $2 THEN user_b ELSE user_a END AS other
       FROM rendezvous WHERE id = $1 AND (user_a = $2 OR user_b = $2)`, [by.rendezvousId, ctx.userId]));
  return rows[0]?.other ?? null;
}

export const messageRoutes = new Hono()
  /**
   * Every conversation, newest activity first, with unread counts.
   *
   * The inbox. A conversation appears here only once both people have been
   * introduced, so there is no such thing as a message request.
   */
  .get('/v1/conversations', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const rows = await tenantSession(ctx, async (db) => {
      const { rows } = await db.query<{
        id: string; other_id: string; last_text: string | null;
        last_at: Date | null; last_sender: string | null; unread: string;
      }>(
        `SELECT r.id,
                CASE WHEN r.user_a = $1 THEN r.user_b ELSE r.user_a END AS other_id,
                m.body    AS last_text,
                -- NOT ::text. Postgres renders a timestamp as
                -- "2026-09-12 23:53:52.900997+00" -- a space instead of a T, six
                -- decimal places, "+00" instead of "Z". Node parses that; Hermes, the
                -- engine on the phone, follows the spec and refuses it, so the chat
                -- list showed "Invalid Date" beside every conversation. Left as a
                -- timestamp here and turned into ISO below.
                m.sent_at AS last_at,
                m.sender_id     AS last_sender,
                (SELECT count(*) FROM messages u
                  WHERE u.rendezvous_id = r.id AND u.sender_id <> $1 AND u.read_at IS NULL
                ) AS unread
           FROM rendezvous r
           -- The most recent message in each conversation, or none.
           LEFT JOIN LATERAL (
             SELECT body, sent_at, sender_id FROM messages
              WHERE rendezvous_id = r.id ORDER BY seq DESC LIMIT 1
           ) m ON true
          WHERE (r.user_a = $1 OR r.user_b = $1)
            AND r.status = 'introduced'
            -- A blocked conversation disappears from the list entirely, in both
            -- directions. Leaving it visible keeps the person in your day.
            --
            -- Through the function, not a subquery on blocks: the policy there shows
            -- you only the blocks YOU wrote, so a direct query found nothing when run
            -- on behalf of the person who was blocked, and their conversation stayed
            -- in their inbox. Same cause as the bug where their messages kept
            -- arriving -- asking the yes/no question needs permission that reading the
            -- table must not carry.
            -- apart() is block_exists either way, or the other person banned (0064).
            AND NOT apart($1, CASE WHEN r.user_a = $1 THEN r.user_b ELSE r.user_a END)
          ORDER BY m.sent_at DESC NULLS LAST, r.decided_at DESC`,
        [ctx.userId],
      );
      return rows;
    });

    // Names come from the matching connection, which is the only session that can see
    // another tenant's profile row -- and can see nothing about them but this. An id
    // is not a person, and a conversation list of uuids is not a conversation list.
    const names = new Map<string, string>();
    let looks = new Map<string, Look>();
    if (rows.length) {
      looks = await matchmakerSession(async (db) => {
        const { rows: who } = await db.query<{ user_id: string; display_name: string | null; is_synthetic: boolean }>(
          'SELECT user_id, display_name, is_synthetic FROM match_profile WHERE user_id = ANY($1::uuid[])',
          [rows.map((r) => r.other_id)],
        );
        for (const w of who) if (w.display_name) names.set(w.user_id, w.display_name);
        // Their character: the face of the row until there is a photo to show.
        return looksFor(db, rows.map((r) => r.other_id), new Set(who.filter((w) => w.is_synthetic).map((w) => w.user_id)));
      });
    }

    // Their first photo, if this person is allowed it -- which by here they are, since
    // an introduced pair have both said yes. A list of grey circles reads as a
    // wireframe however well the type is set.
    const faces = new Map<string, string>();
    await tenantSession(ctx, async (db) => {
      for (const r of rows) {
        const { rows: pics } = await db.query<{ id: string }>(
          'SELECT id FROM visible_photos($1, $2) LIMIT 1', [r.other_id, ctx.userId]);
        if (pics[0]) faces.set(r.other_id, pics[0].id);
      }
    });

    return c.json({
      // The caller's own id, so the phone can tell its own messages from theirs on a
      // pushed event. It used to have no way to know, and guessed from `mine` on
      // history rows -- which live events do not carry.
      me: ctx.userId,
      conversations: rows.map((r) => ({
        id: r.id,
        otherId: r.other_id,
        name: names.get(r.other_id) ?? 'Someone',
        photoId: faces.get(r.other_id) ?? null,
        look: looks.get(r.other_id),
        lastMessage: r.last_text,
        lastAt: r.last_at ? r.last_at.toISOString() : null,
        lastFromMe: r.last_sender === ctx.userId,
        unread: Number(r.unread),
      })),
    });
  })

  /** One conversation, oldest-first, paged backwards from `before`. */
  .get('/v1/conversations/:id/messages', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'bad id' }, 400);
    const before = c.req.query('before');

    // RLS decides whether this person is in the conversation. An id they are not part
    // of returns an empty list, which is the same answer as one that does not exist.
    const rows = await tenantSession(ctx, (db) =>
      messages.history(db, id, 50, before && /^\d+$/.test(before) ? before : undefined),
    );

    // Who the other person is, returned WITH the messages. The thread can be opened
    // directly from the reveal ("say hello"), before the inbox has ever been loaded --
    // and a conversation screen that does not know whose it is cannot show a name or
    // offer a block.
    const { other, name, photoId, look } = await (async () => {
      const pair = await tenantSession(ctx, async (db) => {
        const { rows } = await db.query<{ other: string }>(
          `SELECT CASE WHEN user_a = $2 THEN user_b ELSE user_a END AS other
             FROM rendezvous WHERE id = $1`,
          [id, ctx.userId],
        );
        return rows[0]?.other ?? null;
      });
      if (!pair) return { other: null, name: null, photoId: null, look: null };
      const { named, look } = await matchmakerSession(async (db) => {
        const { rows } = await db.query<{ display_name: string | null; is_synthetic: boolean }>(
          'SELECT display_name, is_synthetic FROM match_profile WHERE user_id = $1', [pair]);
        return { named: rows[0]?.display_name ?? null, look: await lookOf(db, pair, rows[0]?.is_synthetic === true) };
      });
      const face = await tenantSession(ctx, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          'SELECT id FROM visible_photos($1, $2) LIMIT 1', [pair, ctx.userId]);
        return rows[0]?.id ?? null;
      });
      return { other: pair, name: named, photoId: face, look };
    })();

    return c.json({
      me: ctx.userId,
      otherId: other,
      name: name ?? 'Someone',
      photoId,
      look,
      messages: rows.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        text: m.body,
        sentAt: m.sentAt.toISOString(),
        seq: m.seq,
        deliveredAt: m.deliveredAt?.toISOString() ?? null,
        readAt: m.readAt?.toISOString() ?? null,
        mine: m.senderId === ctx.userId,
      })),
      hasMore: rows.length === 50,
    });
  })

  /**
   * Block. Silent, immediate, both directions.
   *
   * No confirmation is sent to the other person and their conversation simply stops
   * updating. Somebody told they have been blocked makes a second account.
   */
  .post('/v1/block', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    // By person (a conversation knows who), or by MATCH: a card never carries anybody's
    // id, so from a card or a profile the match names them, and only for its own two.
    const body = z.object({ userId: z.string().uuid().optional(), rendezvousId: z.string().uuid().optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);
    const other = await otherPerson(ctx, body.data);
    if (!other) return c.json({ error: 'not found' }, 404);

    await tenantSession(ctx, (db) => messages.block(db, ctx.userId, other));
    log.info({ userId: ctx.userId }, 'blocked someone');
    return c.json({ ok: true });
  })

  /**
   * Report, which also blocks.
   *
   * Nobody reports somebody they want to keep hearing from, and making it two separate
   * actions is exactly how a person ends up still receiving messages from the person
   * they just reported.
   */
  .post('/v1/report', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const body = z
      .object({
        userId: z.string().uuid().optional(),
        rendezvousId: z.string().uuid().nullable().default(null),
        // THE FIXED REASONS -- the app offers these and nothing else (REPORT_REASONS).
        reason: z.enum(REPORT_REASONS),
        detail: z.string().max(2000).default(''),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);
    const other = await otherPerson(ctx, { userId: body.data.userId, rendezvousId: body.data.rendezvousId ?? undefined });
    if (!other) return c.json({ error: 'not found' }, 404);

    await tenantSession(ctx, (db) =>
      messages.report(db, {
        reporterId: ctx.userId,
        reportedId: other,
        rendezvousId: body.data.rendezvousId,
        reason: body.data.reason,
        detail: body.data.detail,
      }),
    );

    log.warn({ reason: body.data.reason }, 'report filed');
    return c.json({
      ok: true,
      message: 'Thanks. They cannot contact you any more, and somebody will look at this.',
    });
  });
