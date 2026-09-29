import { Hono } from 'hono';
import { z } from 'zod';
import { resolveCtx, Unauthorized } from '../auth.js';
import { tenantSession } from '../db/client.js';
import { completion } from '../memory/completion.js';
import {
  confirmStagedFact, pendingConfirmation, rejectStagedFact, reviewable,
} from '../memory/pasteImport.js';
import { currentState, history } from '../memory/facts.js';
import { openGaps } from '../memory/gaps.js';
import { log } from '../log.js';

/** Auth or 401, written once because eleven routes needed the same six lines. */
async function ctxOr401(c: { req: { header: (k: string) => string | undefined } }) {
  try {
    return { ctx: await resolveCtx(c.req.header('authorization')), res: null } as const;
  } catch (err) {
    if (err instanceof Unauthorized) return { ctx: null, res: 'unauthorized' } as const;
    throw err;
  }
}

/**
 * The meter is PRIVATE. It is scoped to the caller's own token and there is no
 * endpoint that returns anyone else's. A completion gauge other people can see turns
 * self-disclosure into a scored performance, which is a different and worse product --
 * that variant was cut deliberately, not overlooked.
 */
export const profileRoutes = new Hono().get('/v1/profile', async (c) => {
  const { ctx, res } = await ctxOr401(c);
  if (!ctx) return c.json({ error: res }, 401);

  const body = await tenantSession(ctx, async (db) => {
    const comp = await completion(db, ctx.userId);
    // One at a time, never a wall.
    const [next] = await pendingConfirmation(db, ctx.userId, 1);
    return { comp, next };
  });

  return c.json({
    // Framed as a relationship state, not a form to finish. The band carries the
    // meaning; the number alone reads as a grade.
    knowsYou: {
      band: body.comp.band,
      score: Math.round(body.comp.score * 100),
    },
    coverage: {
      essentials: `${body.comp.hardCovered}/${body.comp.hardTotal}`,
      texture: `${body.comp.softCovered}/${body.comp.softTotal}`,
      details: body.comp.textureFacts,
    },
    // ONE thing. A checklist turns this back into the intake form it exists to avoid.
    askNext: body.comp.nextQuestion?.question ?? null,
    confirm: body.next
      ? {
          factId: body.next.id,
          claim: `${body.next.predicate.replace(/_/g, ' ')}: ${body.next.objectText}`,
          from: body.next.sourceQuote,
        }
      : null,
    awaitingConfirmation: body.comp.awaitingConfirmation,
  });
});

/**
 * The trust surface, in three parts, and the split is the product.
 *
 *   knows        — what it believes, each with where it came from
 *   wontGuess    — questions it is holding rather than inventing answers to
 *   changedMind  — facts that used to be true and are not any more
 *
 * The second and third are the ones no rival can render. A store that overwrites has
 * nothing to show for "changed its mind", and a store that fills gaps by inference has
 * nothing to show for "won't guess".
 */
export const knowledgeRoutes = new Hono()
  .get('/v1/knowledge', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const data = await tenantSession(ctx, async (db) => {
      const live = await currentState(db, ctx.userId);
      const gaps = await openGaps(db, ctx.userId, 20);
      const { rows: changed } = await db.query<{
        predicate: string; old_text: string; new_text: string; changed_at: string;
      }>(
        `SELECT old.predicate,
                old.object_text AS old_text,
                new.object_text AS new_text,
                old.invalidated_at AS changed_at
           FROM facts old
           JOIN facts new ON new.id = old.superseded_by_id
          WHERE old.user_id = $1 AND old.superseded_by_id IS NOT NULL
          ORDER BY old.invalidated_at DESC NULLS LAST
          LIMIT 20`,
        [ctx.userId],
      );
      // One at a time for the few that matter; a list for the many that do not.
      const [confirm] = await pendingConfirmation(db, ctx.userId, 1);
      const review = await reviewable(db, ctx.userId);
      return { live, gaps, changed, confirm, review };
    });

    // Ordered by how much a fact DEFINES somebody, not alphabetically by predicate.
    // Unsorted, "did" sorts near the top and the first thing the app shows is four
    // debugging war stories rather than where the person lives.
    const RANK: Record<string, number> = {
      first_name: 0, preferred_name: 0, full_name: 1, birth_date: 2, gender: 3, seeking_gender: 4,
      lives_in: 5, relationship_intent: 6, works_in: 7, industry: 8, education_level: 9,
      relationship_status: 10, has_children: 11, wants_children: 12, height_cm: 13,
      diet: 14, exercise_habit: 15, religion_importance: 16, politics_importance: 17,
      value: 18, goal: 19, interest: 20, dislikes: 21, media_taste: 22,
    };
    const weight = (predicate: string) => RANK[predicate] ?? 90;

    return c.json({
      knows: [...data.live].sort((a, b) => weight(a.predicate) - weight(b.predicate)).map((f) => ({
        id: f.id,
        predicate: f.predicate,
        label: f.predicate.replace(/_/g, ' '),
        value: f.objectText,
        // Plain English, because "corroboration_count: 2, stance: asserted" is a
        // database row and this screen is meant to be readable by a person.
        because:
          f.corroborationCount > 1
            ? `You have said this ${f.corroborationCount} times`
            : 'You told it this',
      })),
      wontGuess: data.gaps.map((g) => ({ id: g.id, question: g.question })),
      changedMind: data.changed.map((r) => ({
        label: r.predicate.replace(/_/g, ' '),
        was: r.old_text,
        now: r.new_text,
        when: r.changed_at,
      })),
      confirm: data.confirm
        ? {
            factId: data.confirm.id,
            claim: `${data.confirm.predicate.replace(/_/g, ' ')}: ${data.confirm.objectText}`,
            from: data.confirm.sourceQuote,
          }
        : null,
      // Reviewed in bulk and rejected by exception. Asking about each of these
      // individually is the intake wall the design forbids, arriving by accident.
      review: data.review.map((f) => ({
        factId: f.id,
        label: f.predicate.replace(/_/g, ' '),
        value: f.objectText,
      })),
    });
  })

  /** Every value this predicate has ever had. The supersession story, on tap. */
  .get('/v1/knowledge/:predicate/history', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const predicate = c.req.param('predicate');
    if (!/^[a-z_]{1,64}$/.test(predicate)) return c.json({ error: 'bad predicate' }, 400);

    const rows = await tenantSession(ctx, (db) => history(db, ctx.userId, predicate));
    return c.json({
      label: predicate.replace(/_/g, ' '),
      entries: rows.map((f) => ({
        value: f.objectText,
        status: f.status,
        current: f.status === 'active' && f.validTo === null,
        recordedAt: f.recordedAt,
        stoppedAt: f.validTo,
      })),
    });
  })

  /**
   * Yes / No on a staged claim. These existed and were tested for weeks while the
   * app's buttons called router.push('/') -- the highest-quality signal the system
   * can get was collected by nothing.
   */
  /**
   * Accept the whole reviewed pile, minus whatever the person struck out.
   *
   * The rejected ids are sent, not the accepted ones. The list may be long and the
   * screen may be stale; "keep everything except these three" stays correct if
   * something new arrived since it loaded, whereas an accept-list would silently
   * drop it.
   */
  .post('/v1/knowledge/review', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const body = z
      .object({ reject: z.array(z.string().uuid()).max(500).default([]) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);

    const rejected = new Set(body.data.reject);
    const counts = await tenantSession(ctx, async (db) => {
      const pile = await reviewable(db, ctx.userId);
      let kept = 0;
      let dropped = 0;
      for (const f of pile) {
        if (rejected.has(f.id)) {
          await rejectStagedFact(db, ctx.userId, f.id);
          dropped++;
        } else {
          const r = await confirmStagedFact(db, ctx, f.id);
          if (r.confirmed) kept++;
        }
      }
      return { kept, dropped };
    });

    log.info({ userId: ctx.userId, ...counts }, 'bulk review');
    return c.json({
      ...counts,
      message: counts.dropped
        ? `Kept ${counts.kept}, dropped ${counts.dropped}.`
        : `Good — it believes all ${counts.kept} now.`,
    });
  })

  .post('/v1/knowledge/confirm', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const body = z
      .object({ factId: z.string().uuid(), verdict: z.enum(['yes', 'no']) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);

    const { factId, verdict } = body.data;
    const done = await tenantSession(ctx, async (db) =>
      verdict === 'yes'
        ? await confirmStagedFact(db, ctx, factId)
        : (await rejectStagedFact(db, ctx.userId, factId), { confirmed: true }),
    );

    log.info({ userId: ctx.userId, factId, verdict }, 'staged fact judged');
    // The card answer was kept (memory/card-guard.ts): say so, and where to change it.
    if (done.cardKept !== undefined) {
      return c.json({
        ok: true, keptCard: true,
        message: `Your card answer stays: ${done.cardKept}. If it has changed, change it on the card.`,
      });
    }
    return c.json({
      ok: done.confirmed,
      // Confirming re-commits as first-party, so it is now a belief rather than a
      // report. Saying so is the whole reward for answering.
      message: verdict === 'yes' ? 'Good. It believes you now.' : 'Dropped. It will not use that.',
    });
  });
