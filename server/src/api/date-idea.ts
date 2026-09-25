/**
 * "Propose this date": the agents' idea, sent as a message from the person.
 *
 * THE FOUNDER'S ITEM 7: a button that sends the date idea as a normal chat message from
 * me; the agent never schedules. So there is no day, no time, no place picked, and no
 * message the agent sends on anybody's behalf: the person taps, and what arrives in
 * the conversation is a message from them, the same as one they typed -- same block
 * check, same row, same receipts, same erasure.
 *
 * THE WORDS ARE BUILT HERE, NEVER TAKEN FROM THE PHONE. The idea is the one the two
 * agents came back with (matching/talk.ts), read from the caller's own brief and
 * checked again NOW, the way every card is (brief.ts liveCard): withdrawn if the other
 * person has since hidden the sentence it was built on, and run through safeIdea again
 * -- the contact-detail block and the no-claims rules -- in case either has tightened
 * since it was written. A client that sends words of its own has them ignored.
 *
 * Only once the two have been introduced, and never across a block or a ban.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { resolveCtx, Unauthorized } from '../auth.js';
import { matchmakerSession, tenantSession, type TenantCtx } from '../db/client.js';
import { liveCard, readBrief, sentenceKey } from '../matching/brief.js';
import { safeIdea } from '../matching/talk.js';
import * as hub from '../messaging/hub.js';
import * as messages from '../messaging/store.js';
import { log } from '../log.js';

/** The message a proposal sends. The idea, framed as a question -- nothing added. */
export const proposalText = (idea: string): string => `How about this: ${idea}?`;

/** This conversation's date idea for the caller, checked now, or null. */
async function liveIdea(ctx: TenantCtx, rendezvousId: string): Promise<{ idea: string; otherId: string } | null> {
  const row = await tenantSession(ctx, async (db) => {
    const { rows } = await db.query<{
      headline: string; overlap_quotes: unknown; questions: unknown; other_id: string; synthetic: boolean | null;
    }>(
      `SELECT b.headline, b.overlap_quotes, b.questions,
              CASE WHEN r.user_a = $2 THEN r.user_b ELSE r.user_a END AS other_id,
              rendezvous_other_is_synthetic(r.id, $2) AS synthetic
         FROM rendezvous r
         JOIN rendezvous_briefs b ON b.rendezvous_id = r.id AND b.for_user = $2
        WHERE r.id = $1 AND r.status = 'introduced' AND (r.user_a = $2 OR r.user_b = $2)
          AND NOT apart($2, CASE WHEN r.user_a = $2 THEN r.user_b ELSE r.user_a END)`,
      [rendezvousId, ctx.userId]);
    return rows[0] ?? null;
  });
  if (!row) return null;

  // What the other person still shows -- the matchmaker's view of anybody.
  const live = row.synthetic ? null : await matchmakerSession(async (db) => {
    const { rows } = await db.query<{ source_quote: string }>(
      `SELECT source_quote FROM facts
        WHERE user_id = $1 AND disclosure = 'public' AND status = 'active' AND valid_to IS NULL`,
      [row.other_id]);
    return new Set(rows.map((r) => sentenceKey(r.source_quote)));
  });
  const raw = liveCard(readBrief(row), live).talk?.date?.idea;
  const idea = raw ? safeIdea(raw) : null;
  return idea ? { idea, otherId: row.other_id } : null;
}

async function proposed(ctx: TenantCtx, rendezvousId: string): Promise<boolean> {
  return tenantSession(ctx, async (db) => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM messages WHERE rendezvous_id = $1 AND kind = 'date_idea'`, [rendezvousId]);
    return rows[0]!.n > 0;
  });
}

async function ctxOf(header: string | undefined): Promise<TenantCtx | null> {
  try {
    return await resolveCtx(header);
  } catch (err) {
    if (err instanceof Unauthorized) return null;
    throw err;
  }
}

const Id = z.uuid();

export const dateIdeaRoutes = new Hono()
  /** The idea, and whether either of them has proposed it yet. */
  .get('/v1/conversations/:id/date', async (c) => {
    const ctx = await ctxOf(c.req.header('authorization'));
    if (!ctx) return c.json({ error: 'unauthorized' }, 401);
    const id = Id.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not found' }, 404);
    const idea = await liveIdea(ctx, id.data);
    return c.json({ idea: idea?.idea ?? null, proposed: idea ? await proposed(ctx, id.data) : false });
  })

  /**
   * Send it, as the caller. `messageId` is the phone's own id, so a retry after a
   * dropped response writes nothing new -- the same idempotence as every message.
   */
  .post('/v1/conversations/:id/date', async (c) => {
    const ctx = await ctxOf(c.req.header('authorization'));
    if (!ctx) return c.json({ error: 'unauthorized' }, 401);
    const id = Id.safeParse(c.req.param('id'));
    const body = z.object({ messageId: z.uuid() }).safeParse(await c.req.json().catch(() => null));
    if (!id.success) return c.json({ error: 'not found' }, 404);
    if (!body.success) return c.json({ error: 'bad request' }, 400);

    const found = await liveIdea(ctx, id.data);
    if (!found) return c.json({ error: 'no_idea', message: 'There is no date idea to propose here.' }, 404);

    let result;
    try {
      result = await tenantSession(ctx, async (db) => {
        // One proposal per conversation: after it, they are talking about it. A retry
        // of the same message is not a second one.
        const { rows } = await db.query<{ id: string }>(
          `SELECT id FROM messages WHERE rendezvous_id = $1 AND kind = 'date_idea'`, [id.data]);
        if (rows.length && rows[0]!.id !== body.data.messageId) return null;
        return messages.send(db, {
          id: body.data.messageId, rendezvousId: id.data, senderId: ctx.userId, recipientId: found.otherId,
          body: proposalText(found.idea), kind: 'date_idea',
        });
      });
    } catch (err) {
      if (err instanceof messages.Blocked) return c.json({ error: 'not found' }, 404);
      throw err;
    }
    if (!result) return c.json({ error: 'already_proposed', message: 'A date has already been proposed here.' }, 409);

    const wire = messages.toWire(result.message);
    if (result.fresh) {
      // To both: the sender's other devices, and the other person -- as the socket does.
      hub.pushTo(ctx.userId, { type: 'dm.message', message: wire });
      hub.pushTo(found.otherId, { type: 'dm.message', message: wire });
      log.info({ rendezvousId: id.data }, 'date proposed');
    }
    return c.json({ message: wire });
  });
