/**
 * The reviewer's desk.
 *
 * WHY IT EXISTS. `reports` has existed since migration 0024 and nothing in this
 * codebase has ever read it -- no endpoint, no script, no query. A person could
 * report somebody, the row was written, and that was the end of it. A report nobody
 * can read is worse than no report button at all: it tells the person something is
 * being done and nothing is.
 *
 * DELIBERATELY SMALL. Three routes and no interface. At one reviewer a curl command
 * is a perfectly good queue, and the thing that matters is that the decision is
 * recorded against the report rather than living in somebody's memory.
 *
 * AUTHORISATION IS AN ENV VAR, not a database flag. A flag can be set by anything
 * that can write to the database; this needs shell access to the machine. It also
 * means a compromised application role cannot promote itself. An unset list means
 * nobody, and every route here 404s -- not 403, because "there is no admin here" and
 * "you are not it" should look the same from outside.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { resolveCtx, Unauthorized } from '../auth.js';
import { adminSession, matchmakerSession } from '../db/client.js';
import { env } from '../env.js';
import { hide, unhide } from '../photos/store.js';
import { log } from '../log.js';

const admins = (): Set<string> =>
  new Set(env.ADMIN_USER_IDS.split(',').map((s) => s.trim()).filter(Boolean));

/**
 * Resolve the caller and require that they are a reviewer.
 *
 * Returns null for everybody else, including for a perfectly valid signed-in user --
 * the caller turns that into a 404.
 */
async function reviewer(authorization: string | undefined) {
  try {
    const ctx = await resolveCtx(authorization);
    return admins().has(ctx.userId) ? ctx : null;
  } catch (err) {
    if (err instanceof Unauthorized) return null;
    throw err;
  }
}

interface ReportRow {
  id: string;
  reporter_id: string | null;
  reported_id: string;
  reason: string;
  detail: string;
  created_at: string;
  reviewed_at: string | null;
  outcome: string | null;
  review_note: string;
  reports_against: number;
  distinct_reporters: number;
  photos: number;
  hidden_photos: number;
}

export const adminRoutes = new Hono()
  /**
   * The queue. Open reports first, because those are the ones with somebody waiting.
   */
  /**
   * What the after-date check-ins say about somebody, in counts. Two independent
   * people saying the photos or the age were wrong, or one who did not feel safe.
   * Never a row, never who said it, and never an automatic consequence (0039).
   */
  .get('/v1/admin/flags', async (c) => {
    const ctx = await reviewer(c.req.header('authorization'));
    if (!ctx) return c.json({ error: 'not found' }, 404);
    const rows = await matchmakerSession(async (db) => {
      const { rows } = await db.query<{
        about_user: string; no_photos: number; no_age: number; unsafe: number; checkins: number;
        last_at: string; reports_against: number; photos: number;
      }>(
        `SELECT f.about_user, f.no_photos, f.no_age, f.unsafe, f.checkins, f.last_at,
                (SELECT count(*)::int FROM reports x WHERE x.reported_id = f.about_user) AS reports_against,
                (SELECT count(*)::int FROM photos p WHERE p.user_id = f.about_user AND p.hidden_at IS NULL) AS photos
           FROM identity_flags() f
          ORDER BY f.last_at DESC`);
      return rows;
    });
    return c.json({
      flags: rows.map((r) => ({
        aboutId: r.about_user, noPhotos: r.no_photos, noAge: r.no_age, unsafe: r.unsafe,
        checkins: r.checkins, lastAt: r.last_at,
        context: { reportsAgainstThem: r.reports_against, photos: r.photos },
      })),
    });
  })

  .get('/v1/admin/reports', async (c) => {
    const ctx = await reviewer(c.req.header('authorization'));
    if (!ctx) return c.json({ error: 'not found' }, 404);

    const all = c.req.query('all') === '1';

    // The matchmaker session: reports span two people and two tenants by definition,
    // so there is no tenant session that can see both ends. Same reasoning as the
    // rendezvous tables.
    const rows = await matchmakerSession(async (db) => {
      const { rows } = await db.query<ReportRow>(
        `SELECT r.id, r.reporter_id, r.reported_id, r.reason, r.detail,
                r.created_at, r.reviewed_at, r.outcome, r.review_note,
                -- Context a reviewer needs before deciding, and which is tedious and
                -- error-prone to gather by hand one query at a time.
                (SELECT count(*)::int FROM reports x
                  WHERE x.reported_id = r.reported_id)                  AS reports_against,
                (SELECT count(DISTINCT x.reporter_id)::int FROM reports x
                  WHERE x.reported_id = r.reported_id
                    AND x.reporter_id IS NOT NULL)                      AS distinct_reporters,
                (SELECT count(*)::int FROM photos p
                  WHERE p.user_id = r.reported_id)                      AS photos,
                (SELECT count(*)::int FROM photos p
                  WHERE p.user_id = r.reported_id
                    AND p.hidden_at IS NOT NULL)                        AS hidden_photos
           FROM reports r
          WHERE ($1::bool OR r.reviewed_at IS NULL)
          ORDER BY r.reviewed_at NULLS FIRST, r.created_at DESC
          LIMIT 200`,
        [all],
      );
      return rows;
    });

    return c.json({
      open: rows.filter((r) => !r.reviewed_at).length,
      reports: rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        detail: r.detail,
        at: new Date(r.created_at).toISOString(),
        reportedId: r.reported_id,
        // An anonymised reporter stays anonymous to the reviewer as well. Knowing
        // WHETHER it was reported by a person or by the system is enough to act.
        reporterKnown: r.reporter_id !== null,
        reviewed: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
        outcome: r.outcome,
        note: r.review_note,
        context: {
          reportsAgainstThem: r.reports_against,
          distinctReporters: r.distinct_reporters,
          photos: r.photos,
          photosHidden: r.hidden_photos,
        },
      })),
    });
  })

  /**
   * Record a decision, and carry it out.
   *
   * The write and the action are one call on purpose: a reviewer who hides photos and
   * then forgets to close the report leaves a queue that lies, and one who closes the
   * report and forgets to hide leaves a face up.
   */
  .post('/v1/admin/reports/:id', async (c) => {
    const ctx = await reviewer(c.req.header('authorization'));
    if (!ctx) return c.json({ error: 'not found' }, 404);

    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'bad id' }, 400);

    const body = z
      .object({
        outcome: z.enum(['no_action', 'photos_hidden', 'account_blocked']),
        note: z.string().max(2000).default(''),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);
    const { outcome, note } = body.data;

    const target = await matchmakerSession(async (db) => {
      const { rows } = await db.query<{ reported_id: string }>(
        'SELECT reported_id FROM reports WHERE id = $1', [id]);
      return rows[0]?.reported_id ?? null;
    });
    if (!target) return c.json({ error: 'not found' }, 404);

    let photosHidden = 0;
    if (outcome === 'photos_hidden' || outcome === 'account_blocked') {
      photosHidden = await hide(target, `report ${id}: ${outcome}`);
    }

    if (outcome === 'account_blocked') {
      // Out of the pool immediately. Not a delete: erasure is the person's own right
      // to exercise, and a reviewer removing somebody's account outright would
      // destroy the evidence the report is about.
      //
      // `moderation_hidden`, not `in_pool`. in_pool is recomputed on every rebuild
      // from the person's own answers, so setting it here lasted exactly until the
      // moderated person next opened the app. The hidden flag is a separate column
      // that a trigger folds into in_pool on every write (0048), so nothing the
      // application computes can lift it.
      await matchmakerSession((db) =>
        db.query(
          'UPDATE match_profile SET moderation_hidden = true, in_pool = false WHERE user_id = $1',
          [target]));
    }

    await matchmakerSession((db) =>
      db.query(
        `UPDATE reports
            SET reviewed_at = now(), reviewed_by = $2, outcome = $3, review_note = $4
          WHERE id = $1`,
        [id, ctx.userId, outcome, note],
      ));

    log.warn({ reportId: id, by: ctx.userId, outcome, photosHidden }, 'report reviewed');
    return c.json({ ok: true, outcome, photosHidden });
  })

  /**
   * Put somebody's photographs back.
   *
   * A moderation decision that cannot be undone is a decision nobody will dare make
   * quickly, and reports need to be actioned quickly.
   */
  .post('/v1/admin/users/:id/photos/unhide', async (c) => {
    const ctx = await reviewer(c.req.header('authorization'));
    if (!ctx) return c.json({ error: 'not found' }, 404);

    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'bad id' }, 400);

    const restored = await unhide(id);
    log.warn({ userId: id, by: ctx.userId, restored }, 'photos unhidden');
    return c.json({ ok: true, restored });
  });

/** Whether anybody is configured to review. Used by the boot log, so it is visible. */
export const hasReviewer = (): boolean => admins().size > 0;

export { adminSession };
