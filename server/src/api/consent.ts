/**
 * Recording that somebody agreed, and to what.
 *
 * NOTHING EVER AGREED TO ANYTHING. No terms, no privacy notice, no age attestation
 * was captured anywhere in this product. Migration 0036 enforces eighteen, which is
 * the part that protects a minor; this is the part that records the person saying it,
 * which is what you need when somebody asks later.
 *
 * THREE DOCUMENTS, NOT ONE CHECKBOX. Terms, privacy and age are versioned separately
 * because they change separately, and a single boolean cannot express "accepted the
 * old privacy notice, has not seen the new one". A person who has agreed to v1 and
 * not to v2 is a real state that has to be representable.
 *
 * WRITE ONCE. `consents` grants the application SELECT and INSERT and nothing else
 * (0039): a consent record that the party relying on it can edit is not evidence of
 * anything. A withdrawal, when there is one, will be a new row saying so.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { resolveCtx, Unauthorized } from '../auth.js';
import { tenantSession } from '../db/client.js';
import { log } from '../log.js';

/**
 * What a person has to have accepted before their agent may go out.
 *
 * Bumping a version here makes everybody re-accept that one document, which is the
 * intended and only way to do it. The app reads this list rather than hardcoding it,
 * so the two cannot drift.
 */
export const REQUIRED = [
  { document: 'age', version: '1', title: 'You are 18 or older' },
  { document: 'terms', version: '1', title: 'Terms of use' },
  { document: 'privacy', version: '1', title: 'How your data is used' },
] as const;

const Body = z.object({
  accept: z.array(z.object({ document: z.string().max(40), version: z.string().max(20) })).min(1),
});

async function ctxOr401(header: string | undefined) {
  try {
    return { ctx: await resolveCtx(header), res: null };
  } catch (err) {
    if (err instanceof Unauthorized) return { ctx: null, res: 'unauthorized' as const };
    throw err;
  }
}

export const consentRoutes = new Hono()
  /** What this person still owes, and what the app must show them. */
  .get('/v1/consent', async (c) => {
    const { ctx, res } = await ctxOr401(c.req.header('authorization'));
    if (!ctx) return c.json({ error: res }, 401);

    const given = await tenantSession(ctx, async (db) => {
      const { rows } = await db.query<{ document: string; version: string; accepted_at: string }>(
        'SELECT document, version, accepted_at FROM consents WHERE user_id = $1', [ctx.userId]);
      return rows;
    });

    const has = new Set(given.map((g) => `${g.document}@${g.version}`));
    const outstanding = REQUIRED.filter((r) => !has.has(`${r.document}@${r.version}`));

    return c.json({
      required: REQUIRED,
      accepted: given.map((g) => ({
        document: g.document, version: g.version,
        at: new Date(g.accepted_at).toISOString(),
      })),
      outstanding,
      settled: outstanding.length === 0,
    });
  })

  /** Record an acceptance. Idempotent: accepting twice is not an error. */
  .post('/v1/consent', async (c) => {
    const { ctx, res } = await ctxOr401(c.req.header('authorization'));
    if (!ctx) return c.json({ error: res }, 401);

    const body = Body.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);

    // Only documents this server actually asked for. Accepting an invented document
    // would let a client manufacture a record of consent to something nobody wrote.
    const known = new Set(REQUIRED.map((r) => `${r.document}@${r.version}`));
    const wanted = body.data.accept.filter((a) => known.has(`${a.document}@${a.version}`));
    if (!wanted.length) return c.json({ error: 'nothing to accept' }, 400);

    const settled = await tenantSession(ctx, async (db) => {
      for (const a of wanted) {
        await db.query(
          `INSERT INTO consents (tenant_id, user_id, document, version)
           VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, document, version) DO NOTHING`,
          [ctx.tenantId, ctx.userId, a.document, a.version],
        );
      }
      const { rows } = await db.query<{ n: string }>(
        `SELECT count(*) AS n FROM consents
          WHERE user_id = $1 AND (document, version) IN (${
            REQUIRED.map((_, i) => `($${i * 2 + 2}, $${i * 2 + 3})`).join(', ')
          })`,
        [ctx.userId, ...REQUIRED.flatMap((r) => [r.document, r.version])],
      );
      return Number(rows[0]!.n) === REQUIRED.length;
    });

    log.info({ userId: ctx.userId, accepted: wanted.map((w) => w.document) }, 'consent recorded');
    return c.json({ ok: true, settled });
  });
