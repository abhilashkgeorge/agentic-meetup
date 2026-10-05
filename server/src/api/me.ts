import { Hono } from 'hono';
import { z } from 'zod';
import { NEVER_PUBLIC, namesPlace } from '@clone/shared';
import { resolveCtx, Unauthorized } from '../auth.js';
import { tenantSession } from '../db/client.js';
import { eraseUser, exportUser } from '../memory/erasure.js';
import { BRIEF_LINE, TAGGABLE, cardFacts, headlineOf, loadQuotes, tagWords } from '../matching/brief.js';
import { publicTags } from '../matching/rendezvous.js';
import { readback } from '../matching/readback.js';
import { ALL_CARDS } from '../onboarding/questions.js';
import { log } from '../log.js';
import { MAX_SENTENCES, SHEET_SOURCES, ensureSheet, readOwnSheet } from '../matching/answer-sheet.js';

async function ctxOr401(c: { req: { header: (k: string) => string | undefined } }) {
  try {
    return { ctx: await resolveCtx(c.req.header('authorization')), res: null } as const;
  } catch (err) {
    if (err instanceof Unauthorized) return { ctx: null, res: 'unauthorized' } as const;
    throw err;
  }
}

/** A brief shows up to this many of a person's own sentences. */
const QUOTES_ON_A_CARD = 2;

/**
 * LEARNED, NOT YET SHARED (extract.ts, 2026-09-25): what the clone picked up in chat that
 * passes every check but the person's say-so. Their agent uses it for matching; it is
 * quoted nowhere until they tap "OK to share", which writes 'public' through the
 * disclosure route below.
 */
async function learnedNotShared(ctx: { tenantId: string; userId: string }): Promise<{ factId: string; text: string }[]> {
  return (await loadQuotes(ctx, { disclosures: ['matchable_only'], predicates: SHEET_SOURCES, limit: MAX_SENTENCES }))
    .map((q) => ({ factId: q.id, text: q.text }));
}

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
  })

  /**
   * "How you appear": exactly what a card about this person shows somebody else.
   *
   * Built from the same functions a brief is (brief.ts): the headline, the line every
   * card carries, the tags that can show when a stranger shares them, and the person's
   * own verified sentences -- ALL of them that could ever reach a card, including the
   * ones they hid, so a hide can be undone, each flagged with whether it is on a card
   * right now. Nothing here is written by a model, and nothing is guessed: if it is not
   * on this screen it cannot be on anybody's card.
   */
  .get('/v1/me/appearance', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const { card, tags } = await tenantSession(ctx, async (db) => ({
      card: await cardFacts(db, ctx.userId),
      tags: tagWords(await publicTags(db, ctx.userId), TAGGABLE),
    }));
    const all = await loadQuotes(ctx, { includeHidden: true });
    // What your agent says when another agent asks, brought up to date first -- this is
    // where a person reads it before any stranger can.
    await ensureSheet(ctx);
    const sheet = await readOwnSheet(ctx);

    // The first two visible quotes, deduplicated the way composeBrief does, are the
    // ones on a card now; a hidden one never is.
    const seen = new Set<string>();
    let onCard = 0;
    const quotes = all.slice(0, 8).map((q) => {
      const key = q.text.toLowerCase();
      const fresh = !seen.has(key);
      seen.add(key);
      const shown = !q.hidden && fresh && onCard < QUOTES_ON_A_CARD;
      if (shown) onCard++;
      // NAMES A COMPANY, A COLLEGE OR A BUILDING (item 14, shared/identifying.ts): the
      // screen asks "Hide this?". A suggestion, never a block -- the person decides.
      return { factId: q.id, text: q.text, hidden: Boolean(q.hidden), shown, names: namesPlace(q.text) };
    });

    // SO A HIDE ON THE SHEET CAN BE UNDONE THERE. Hiding an answer takes it out of the
    // sheet (the rebuild no longer sees it, and a round could not read it anyway), so
    // the sheet alone would lose it for good. These are the sentences a sheet may draw
    // on that the person hid, less the ones already listed above with their own Show.
    const listed = new Set(quotes.map((q) => q.factId));
    const hidden = (await loadQuotes(ctx, { includeHidden: true, predicates: SHEET_SOURCES, limit: MAX_SENTENCES }))
      .filter((q) => q.hidden && !listed.has(q.id))
      .map((q) => ({ factId: q.id, text: q.text }));

    const learned = await learnedNotShared(ctx);

    // The same question on every answer the agent gives another agent.
    const sheetAsks = sheet.map((e) => (e.answer ? { ...e, answer: { ...e.answer, names: namesPlace(e.answer.text) } } : e));
    return c.json({ headline: headlineOf(card), line: BRIEF_LINE, tags, quotes, sheet: sheetAsks, hidden, learned });
  })

  /**
   * What the clone learned and has not been told it may say -- the list on "How you
   * appear", alone. For the town's "Your clone" and the cards in the chat with it, which
   * ask on every visit: this only reads. "How you appear" brings the answer sheet up to
   * date first, a model call whenever a sentence changed -- and one opening of the town
   * asked it three times at once, three of a new person's ten turns (the Pixel,
   * 2026-10-04).
   */
  .get('/v1/me/learned', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    return c.json({ learned: await learnedNotShared(ctx) });
  })

  /** The person's own rules, read back in words. A template, not a model (readback.ts). */
  .get('/v1/me/readback', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const input = await tenantSession(ctx, async (db) => {
      const { rows: prof } = await db.query<{ intent: string[] | null; max_distance_km: number | null }>(
        'SELECT intent, max_distance_km FROM match_profile WHERE user_id = $1', [ctx.userId]);
      const { rows: range } = await db.query<{ v: { min?: unknown; max?: unknown } | null }>(
        `SELECT object_value AS v FROM facts
          WHERE user_id = $1 AND predicate = 'age_range_sought' AND status = 'active' AND valid_to IS NULL
          ORDER BY recorded_at DESC LIMIT 1`, [ctx.userId]);
      const { rows: rules } = await db.query<{ predicate: string; value: unknown }>(
        `SELECT predicate, value FROM preferences
          WHERE user_id = $1 AND retired_at IS NULL AND operator = 'in' AND strength = 'dealbreaker'
            AND predicate = ANY($2)`, [ctx.userId, ALL_CARDS.map((k) => k.predicate)]);
      const r = range[0]?.v;
      return {
        intent: prof[0]?.intent ?? [],
        ageRange: typeof r?.min === 'number' && typeof r?.max === 'number' ? { min: r.min, max: r.max } : null,
        maxDistanceKm: prof[0]?.max_distance_km ?? null,
        rules: rules.map((x) => ({
          predicate: x.predicate,
          values: Array.isArray(x.value) ? x.value.map(String) : [],
        })),
      };
    });
    return c.json(readback(input));
  })

  /**
   * Hide one of your own sentences from every card, or show it again.
   *
   * Hiding writes 'private', which is only ever set this way; a brief reads 'public'
   * alone (brief.ts loadQuotes). Showing again writes 'public' -- except for the kinds
   * NEVER_PUBLIC names, and any fact learned on a private topic, which nobody can
   * volunteer whatever they set: an agent that can be talked into disclosing somebody's
   * health or faith is a headline, and the person unticking a box must not be the way
   * it happens. Own facts only: RLS scopes
   * the session, and the query names the user as well.
   */
  .post('/v1/facts/:id/disclosure', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const id = z.string().uuid().safeParse(c.req.param('id'));
    const body = z.object({ hidden: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!id.success || !body.success) return c.json({ error: 'bad request' }, 400);
    const hidden = body.data.hidden;

    const out = await tenantSession(ctx, async (db) => {
      const { rows } = await db.query<{ predicate: string; disclosure: string; private_topic: string | null }>(
        `SELECT predicate, disclosure, private_topic FROM facts
          WHERE id = $1 AND user_id = $2 AND status = 'active' AND valid_to IS NULL`,
        [id.data, ctx.userId]);
      const f = rows[0];
      if (!f) return 'not_found' as const;
      // A private topic -- relationship history filed as `did`, say -- is refused the same
      // way as the kinds NEVER_PUBLIC names: judged when it was learned (facts.ts
      // PRIVATE_TOPICS), and the database would refuse the write anyway (0077).
      if (!hidden && (NEVER_PUBLIC.has(f.predicate) || f.private_topic)) return 'never_public' as const;
      const to = hidden ? 'private' : 'public';
      if (f.disclosure !== to) {
        await db.query('UPDATE facts SET disclosure = $3 WHERE id = $1 AND user_id = $2',
          [id.data, ctx.userId, to]);
        await db.query(
          `INSERT INTO memory_audit (tenant_id, user_id, fact_id, op, before, after, actor)
           VALUES ($1,$2,$3,'disclosure',$4,$5,'owner')`,
          [ctx.tenantId, ctx.userId, id.data,
           JSON.stringify({ disclosure: f.disclosure }), JSON.stringify({ disclosure: to })]);
      }
      return 'ok' as const;
    });

    if (out === 'not_found') return c.json({ error: 'not found' }, 404);
    if (out === 'never_public') {
      return c.json({ error: 'never_public', message: 'This kind of thing is never shown to anyone.' }, 400);
    }
    log.info({ userId: ctx.userId, factId: id.data, hidden }, 'disclosure changed');
    return c.json({ ok: true });
  });
