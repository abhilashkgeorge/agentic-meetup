/**
 * The dating endpoints: the six essentials, the live pool, and matches.
 *
 * All three exist because of one rule the app enforces on screen: an agent cannot go
 * out until it can answer the five questions every candidate query asks. Four out of
 * five is the same as none to somebody waiting to be matched.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { MIN_AGE, deriveValue, findPlace, isAdult, canFilterOn, type Look } from '@clone/shared';
import { resolveCtx, Unauthorized } from '../auth.js';
import { matchSession, matchmakerSession, tenantSession } from '../db/client.js';
import { commit } from '../memory/facts.js';
import { rebuildMatchProfile, touchActive } from '../matching/profile.js';
import { candidateCount, poolBreakdown } from '../matching/candidates.js';
import { decide, runRound } from '../matching/orchestrator.js';
import { DailyTargetsExceeded, enqueueRound, latestRound } from '../matching/rounds.js';
import { resolveAgentRef } from '../matching/world.js';
import { lookOf, looksFor } from '../looks/store.js';
import { BudgetExceeded, checkBudget } from '../metering.js';
import { log } from '../log.js';

async function ctxOr401(c: { req: { header: (k: string) => string | undefined } }) {
  try {
    return { ctx: await resolveCtx(c.req.header('authorization')), res: null } as const;
  } catch (err) {
    if (err instanceof Unauthorized) return { ctx: null, res: 'unauthorized' } as const;
    throw err;
  }
}

const Essential = z.object({
  predicate: z.string().min(1).max(64),
  /** null means "prefer not to say", which is an ANSWER and is recorded as one. */
  value: z.unknown().nullable(),
  /**
   * A position the phone worked out for itself, for `lives_in` only.
   *
   * Without this, a city is only matchable on distance if it appears in the 46-entry
   * table in shared/places.ts -- so somebody in Nagpur or Nottingham types their city,
   * `findPlace` returns null, and they silently lose distance matching for ever. A
   * device that already knows where it is should not be made to guess.
   *
   * Bounded to two decimal places by the CLIENT before it is sent (see
   * lib/location.ts): the answer wanted here is a city, and a street is nobody's
   * business. `precisionKm` records how coarse the number already is.
   */
  place: z
    .object({
      city: z.string().min(1).max(80),
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      precisionKm: z.number().min(0).max(500),
    })
    .optional(),
});

/**
 * Where somebody said they live, as a point on the map.
 *
 * Exported and pure so the decision can be tested without standing up a request. It
 * is three cases, and the order matters:
 *
 *   we list the city        use the table's centre, so a typed answer and an
 *                           auto-filled one land on exactly the same point.
 *   we do not, but the       use the phone's, already coarsened by the client to
 *   phone found it           about a kilometre -- `precisionKm` carries how coarse.
 *                           This is the case the feature exists for: places.ts lists
 *                           46 cities, so before this everybody outside those 46 lost
 *                           distance matching and was never told.
 *   neither                  null. An unknown town still commits -- it is simply not
 *                           matchable on distance, which is a question rather than
 *                           an exclusion.
 *
 * THE TEXT IS THE AUTHORITY, NOT THE POSITION. A supplied place is ignored unless it
 * still names the same city as the words being stored. The field stays editable after
 * the phone fills it in, so somebody can auto-fill "Bangalore", type "Mysore" over it
 * and commit -- and without this check they would be filed under Mysore at
 * Bangalore's coordinates, with the display text and the map disagreeing for ever and
 * nothing anywhere reporting it.
 */
export function resolveLivesIn(
  text: string,
  sent?: { city: string; lat: number; lon: number; precisionKm: number },
): { city: string; lat: number; lon: number; precision_km: number } | null {
  // The table FIRST, even when the phone supplied a position. Two people in one city
  // must sit on one point or every distance between them is wrong by however far
  // apart their two phones were -- so a listed city always resolves to its centre,
  // whichever way the answer arrived.
  const place = findPlace(text);
  if (place) return { city: place.city, lat: place.lat, lon: place.lon, precision_km: 20 };

  // Not a city we list. Now the phone is the only thing that can place them, and it
  // is used only if it still names the city being stored.
  if (sent && sent.city.trim().toLowerCase() === text.trim().toLowerCase()) {
    return { city: sent.city, lat: sent.lat, lon: sent.lon, precision_km: sent.precisionKm };
  }
  return null;
}

/** Long enough for a date to have happened; short enough to still be remembered. */
const MET_ASK_AFTER_MS = 3 * 24 * 60 * 60_000;

export const datingRoutes = new Hono()
  /**
   * One structural answer, or a recorded refusal.
   *
   * A declined field and a never-asked field must not look the same. They do today --
   * both are simply an absent row -- which is why the question queue would otherwise
   * ask somebody their religion every week after they declined to say.
   */
  .post('/v1/essentials', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const body = Essential.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);
    const { predicate, value } = body.data;

    // Refused here as well as in `commit`, and the duplication is the point: the store
    // must refuse it whatever calls it, and a person typing their year into setup
    // deserves a sentence rather than a silently dropped fact.
    if (predicate === 'birth_date' && value !== null && value !== '') {
      const year = Number(Array.isArray(value) ? value[0] : value);
      if (!isAdult({ year, month: null })) {
        return c.json({
          error: 'under_age',
          message: `You need to be ${MIN_AGE} or older to use this.`,
        }, 400);
      }
    }

    const out = await tenantSession(ctx, async (db) => {
      if (value === null || value === '') {
        await db.query(
          `INSERT INTO predicate_status (tenant_id, user_id, predicate, state, reason, updated_at)
           VALUES ($1,$2,$3,'declined','never_mentioned', now())
           ON CONFLICT (user_id, predicate)
           DO UPDATE SET state = 'declined', updated_at = now()`,
          [ctx.tenantId, ctx.userId, predicate],
        );
        return rebuildMatchProfile(db, ctx);
      }

      // Several answers to one question (who you want to meet) become several facts,
      // because the predicate is multi-valued and each value stands alone.
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        const text = String(v);
        // The two that cannot be derived from the words alone.
        const objectValue =
          predicate === 'birth_date'
            ? { year: Number(text), month: null }
            : predicate === 'lives_in'
              ? resolveLivesIn(text, body.data.place)
              : predicate === 'max_distance_km'
                ? Number(text)
                : (deriveValue(predicate, text) ?? undefined);

        await commit(db, ctx, {
          predicate,
          objectText: text,
          ...(objectValue !== undefined ? { objectValue } : {}),
          stance: 'asserted',
          // Typed by the person, in their own app, about themselves. The strongest
          // provenance in the system.
          originClass: 'owner',
          sourceQuote: text,
          sourceEpisodeIds: [],
          extractorModel: 'direct',
          extractorVersion: '1',
          promptVersion: 'essentials.1',
        });
      }

      await db.query(
        `INSERT INTO predicate_status (tenant_id, user_id, predicate, state, updated_at)
         VALUES ($1,$2,$3,'known', now())
         ON CONFLICT (user_id, predicate) DO UPDATE SET state = 'known', updated_at = now()`,
        [ctx.tenantId, ctx.userId, predicate],
      );

      return rebuildMatchProfile(db, ctx);
    });

    log.info({ userId: ctx.userId, predicate, declined: value === null }, 'essential set');
    return c.json({ ok: true, inPool: out.inPool, missing: out.missing });
  })

  /**
   * The live pool, and what each rule costs.
   *
   * Over-filtering is otherwise invisible: the app never matches anybody and the person
   * cannot see why. Shown as a running total, it becomes a choice instead of a silent
   * failure.
   */
  .get('/v1/pool', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const { state, askDistance } = await tenantSession(ctx, async (db) => {
      const s = await rebuildMatchProfile(db, ctx);
      // Distance is the one optional essential and is settable only in the setup
      // wizard, so the server -- not a client heuristic -- decides whether it is still
      // worth asking: offer it until the person has either answered or DECLINED it.
      // This reads predicate_status because a "prefer not to say" leaves no fact, so a
      // fact-only check would ask again forever and re-open the exact "declined must
      // not look like never-asked" hole the whole flow exists to close.
      const { rows } = await db.query(
        `SELECT 1 FROM predicate_status
          WHERE user_id = $1 AND predicate = 'max_distance_km' AND state IN ('known', 'declined')`,
        [ctx.userId],
      );
      return { state: s, askDistance: rows.length === 0 };
    });
    if (!state.inPool) {
      // `missing` is the friendly sentences the cards print, and stays REQUIRED-only so
      // an optional field never shows up as "still needs". `need` is the raw predicate
      // keys the setup wizard asks -- the required ones, plus distance while it is still
      // worth offering -- so the wizard asks ONLY what is left instead of all six.
      const need = askDistance ? [...state.missing, 'max_distance_km'] : state.missing;
      return c.json({
        total: 0, steps: [], inPool: false,
        missing: friendly(state.missing), need,
      });
    }

    // Across tenants, through the role that can read almost nothing else.
    const [total, steps] = await matchSession(async (db) => [
      await candidateCount(db, ctx.userId),
      await poolBreakdown(db, ctx.userId),
    ]);

    return c.json({ total, steps, inPool: true, missing: [], need: [] });
  })

  /**
   * Every preference, said the way a person would say it.
   *
   * The screen's whole job is letting somebody move a rule between "must have" and
   * "want", because that is the single biggest lever on how many people they can
   * reach — and it is invisible until it is shown next to a live count.
   */
  .get('/v1/preferences', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const rows = await tenantSession(ctx, async (db) => {
      const { rows } = await db.query<{
        id: string; predicate: string; operator: string; value: unknown;
        strength: string; source_quote: string;
      }>(
        `SELECT id, predicate, operator, value, strength, source_quote
           FROM preferences WHERE user_id = $1 AND retired_at IS NULL
          ORDER BY strength, predicate`,
        [ctx.userId],
      );
      return rows;
    });

    return c.json({
      preferences: rows.map((r) => ({
        id: r.id,
        predicate: r.predicate,
        label: phrase(r.predicate, r.operator, r.value),
        strength: r.strength,
        sourceQuote: r.source_quote,
      })),
    });
  })

  .post('/v1/preferences/strength', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const body = z
      .object({ id: z.string().uuid(), strength: z.enum(['dealbreaker', 'strong', 'mild']) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);

    // Promoting a rule to a dealbreaker is drawing a line. If the line cannot be
    // enforced -- the predicate never reaches the traits the candidate query tests --
    // say so now rather than let the person believe a filter exists. See canFilterOn.
    if (body.data.strength === 'dealbreaker') {
      const pred = await tenantSession(ctx, async (db) => {
        const { rows } = await db.query<{ predicate: string }>(
          'SELECT predicate FROM preferences WHERE id = $1 AND user_id = $2',
          [body.data.id, ctx.userId]);
        return rows[0]?.predicate ?? null;
      });
      if (pred && !canFilterOn(pred)) {
        return c.json({
          error: 'cannot_filter',
          message: 'That one cannot rule anybody out. It can only move people up or down.',
        }, 400);
      }
    }
    await tenantSession(ctx, (db) =>
      db.query(`UPDATE preferences SET strength = $3 WHERE id = $1 AND user_id = $2`,
        [body.data.id, ctx.userId, body.data.strength]),
    );

    // The new count comes straight back, so the screen can show the consequence of
    // the change rather than the change alone.
    const total = await matchSession((db) => candidateCount(db, ctx.userId)).catch(() => 0);
    return c.json({ ok: true, total });
  })

  /**
   * Matches. Empty until agents actually talk, which is the next thing to build.
   *
   * The endpoint exists now so the screen is real rather than mocked: an empty list is
   * the honest state, and it is exactly what a new user sees anyway.
   */
  .get('/v1/matches', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    // Looking at your matches is being here. See touchActive.
    await tenantSession(ctx, (db) => touchActive(db, ctx.userId));

    // Own brief only, and the policy enforces it -- the other side's brief is the
    // other agent's private assessment of this person, and is never readable here.
    const rows = await tenantSession(ctx, async (db) => {
      const { rows } = await db.query<{
        id: string; headline: string; overlap_quotes: unknown; concern: string;
        questions: unknown; human_says_yes: boolean | null; first_mover: string | null;
        status: string; other_decided: boolean | null; other_is_synthetic: boolean | null;
        agreement: number | null; other_id: string;
      }>(
        `SELECT r.id, b.headline, b.overlap_quotes, b.concern, b.questions,
                b.human_says_yes, r.first_mover, r.status, r.agreement,
                CASE WHEN r.user_a = $1 THEN r.user_b ELSE r.user_a END AS other_id,
                -- Same shape and same reason as other_decided below: the caller's own
                -- session cannot read the other person's match_profile, and a card
                -- that does not say "practice" is a card that lies by omission.
                rendezvous_other_is_synthetic(r.id, $1) AS other_is_synthetic,
                -- Through a function, because the policy on rendezvous_briefs hides
                -- the other person's row -- correctly: their agent's assessment of
                -- this person is not this person's to read. The function returns one
                -- bit, and returns false for "said no" and "has not looked" alike.
                rendezvous_other_said_yes(r.id, $1) AS other_decided
           FROM rendezvous r
           JOIN rendezvous_briefs b ON b.rendezvous_id = r.id AND b.for_user = $1
          WHERE (r.user_a = $1 OR r.user_b = $1)
            AND r.status <> 'lapsed'
          -- THE QUEUE. What the conversations thought first, what the ranker thought
          -- second, newest last. A person sees the head of this and says yes or
          -- not-for-me; a no lapses the row and the next one is already here. The
          -- agreement rate ORDERS the list -- it used to gate it, and a pair the
          -- agents were unsure about was thrown away with nothing shown.
          ORDER BY r.agreement DESC NULLS LAST, r.rank_score DESC NULLS LAST,
                   r.decided_at DESC NULLS LAST`,
        [ctx.userId],
      );
      return rows;
    });
    const round = await tenantSession(ctx, (db) => latestRound(db, ctx.userId));
    // Their characters: what the card shows before the reveal shows a photo.
    const looks = rows.length
      ? await matchmakerSession((db) => looksFor(db, rows.map((r) => r.other_id),
          new Set(rows.filter((r) => r.other_is_synthetic === true).map((r) => r.other_id))))
      : new Map<string, Look>();

    return c.json({
      // How the last round went, or is going. The app polls this while a round is
      // queued or running and shows "your agent is out" -- truthfully, because the
      // row is what makes it true.
      round: round ? {
        id: round.id, status: round.status,
        skipped: round.result?.skipped ?? null,
        met: round.result?.metAll.length ?? 0,
        error: round.error,
      } : null,
      matches: rows
        // A card this person has already answered is gone. Answered yes and waiting is
        // shown as waiting; answered no is shown as nothing, ever again.
        .filter((r) => r.human_says_yes === null || (r.human_says_yes && r.status !== 'introduced'))
        .map((r) => {
          // Whose turn it is. The first mover decides alone; the second sees nothing
          // until the first has said yes, so their card says "waiting on them" rather
          // than offering a button that leads to a locked screen.
          const myTurn = r.first_mover === ctx.userId || r.other_decided === true;
          return {
            id: r.id,
            headline: r.headline,
            overlaps: r.overlap_quotes ?? [],
            concern: r.concern,
            questions: r.questions ?? [],
            waitingOnYou: r.human_says_yes === null && myTurn,
            // Never a hint about what they will say -- only that they have not looked.
            // A no is silent, so this state is also what a no looks like, for ever.
            waitingOnThem: r.human_says_yes === true || !myTurn,
            // Said plainly, on the card, before the person spends any feeling on it.
            practice: r.other_is_synthetic === true,
            look: looks.get(r.other_id),
            // How the agents got on, as a fraction of conversations that ended in a
            // mutual yes. The app turns this into words, never a percentage: a number
            // here would be read as compatibility, and pre-date self-report predicts
            // attraction badly enough that it would be a lie with a decimal point.
            agreement: r.agreement,
          };
        }),
    });
  })

  /**
   * The reveal. Who they actually are.
   *
   * Only for the side whose turn it is, and only after the agents passed. The order is
   * asymmetric on purpose -- whichever side receives more matches decides first and
   * alone, and only then is their profile shown back.
   */
  .get('/v1/matches/:id', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'bad id' }, 400);

    // Membership is checked under RLS first: a rendezvous this person is not half of
    // returns nothing, which is the same answer as one that does not exist.
    const seat = await tenantSession(ctx, async (db) => {
      const { rows } = await db.query<{
        first_mover: string | null; status: string; other_said_yes: boolean | null;
        other_is_synthetic: boolean | null;
      }>(
        `SELECT r.first_mover, r.status,
                rendezvous_other_said_yes(r.id, $2) AS other_said_yes,
                rendezvous_other_is_synthetic(r.id, $2) AS other_is_synthetic
           FROM rendezvous r WHERE r.id = $1`,
        [id, ctx.userId],
      );
      return rows[0] ?? null;
    });
    if (!seat) return c.json({ error: 'not found' }, 404);

    const other = await matchmakerSession(async (db) => {
      const { rows } = await db.query<{
        user_id: string; display_name: string | null; age: number | null;
        traits: Record<string, unknown>; attribute_tags: string[];
      }>(
        `SELECT p.user_id, p.display_name, p.age, p.traits, p.attribute_tags
           FROM rendezvous r
           JOIN match_profile p
             ON p.user_id = CASE WHEN r.user_a = $2 THEN r.user_b ELSE r.user_a END
          WHERE r.id = $1`,
        [id, ctx.userId],
      );
      const row = rows[0];
      if (!row) return null;
      return { ...row, look: await lookOf(db, row.user_id, seat.other_is_synthetic === true) };
    });
    if (!other) return c.json({ error: 'not found' }, 404);

    // The second mover sees the first mover's profile once the FIRST HAS SAID YES --
    // not once the status changes, which was a deadlock: `introduced` is set only
    // after both have answered, so the second person waited for a state that could
    // only be reached by their own answer.
    const mine = seat.first_mover === ctx.userId;
    if (!mine && seat.other_said_yes !== true) {
      return c.json({ waiting: true, message: 'They are looking at your profile first.' });
    }

    return c.json({
      waiting: false,
      // An invented profile, said so on the screen where the person decides. Nothing
      // about the brief changes -- the agents really did meet and this really is what
      // they made of each other. What changes is that there is no human on the far
      // side, and the person is told before they answer rather than after.
      practice: seat.other_is_synthetic === true,
      // Needed to fetch their pictures: the photo route is keyed on the owner as well
      // as the photo, so that holding an id is never by itself permission to see one.
      userId: other.user_id,
      name: other.display_name ?? 'Someone',
      age: other.age,
      // Tags, not sentences. What they have said in their own words belongs in the
      // brief, where it comes with a date and is quoted rather than summarised.
      tags: other.attribute_tags
        .filter((t) => t.startsWith('interest:') || t.startsWith('works_in:'))
        .map((t) => t.split(':')[1]?.replace(/[-_]/g, ' '))
        .filter(Boolean)
        .slice(0, 8),
      livesIn: typeof other.traits.lives_in === 'string' ? other.traits.lives_in : null,
      look: other.look,
    });
  })

  /**
   * The one decision the agent never makes.
   *
   * A no is silent in both directions, and final. Nobody is told they were passed on,
   * so nobody can compare notes about who said no to whom.
   */
  .post('/v1/matches/:id/decide', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'bad id' }, 400);

    const body = z.object({ yes: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);

    // Membership under RLS before anything is written. The matchmaker session that
    // does the write can see every rendezvous, so the check has to happen here.
    const member = await tenantSession(ctx, async (db) => {
      const { rowCount } = await db.query(
        'SELECT id FROM rendezvous WHERE id = $1', [id]);
      return Boolean(rowCount);
    });
    if (!member) return c.json({ error: 'not found' }, 404);

    const { introduced } = await decide(ctx.userId, id, body.data.yes);
    return c.json({ ok: true, introduced });
  })

  /**
   * "Did you two actually meet?" Hinge calls it "We Met", and it is the only outcome
   * label that means anything: a yes on a card is a guess, a date is a fact.
   *
   * GET says whether to ask -- three days after both said yes, once, and only if
   * this person has not already answered. POST records the answer for THIS side;
   * the other person answers for themselves. Never shown to the other side.
   */
  .get('/v1/matches/:id/met', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'bad id' }, 400);

    const row = await tenantSession(ctx, async (db) => {
      const { rows } = await db.query<{
        introduced_at: string | null; met: boolean | null;
      }>(
        `SELECT r.introduced_at, b.met
           FROM rendezvous r
           JOIN rendezvous_briefs b ON b.rendezvous_id = r.id AND b.for_user = $2
          WHERE r.id = $1`,
        [id, ctx.userId],
      );
      return rows[0] ?? null;
    });
    if (!row) return c.json({ error: 'not found' }, 404);

    const introduced = row.introduced_at ? new Date(row.introduced_at).getTime() : null;
    const askDue = introduced !== null
      && row.met === null
      && Date.now() - introduced >= MET_ASK_AFTER_MS;
    return c.json({ askDue, met: row.met });
  })

  .post('/v1/matches/:id/met', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'bad id' }, 400);
    const body = z.object({ yes: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);

    // Own brief only, under RLS. An answer is final: the first one stands.
    const { rowCount } = await tenantSession(ctx, (db) =>
      db.query(
        `UPDATE rendezvous_briefs SET met = $3, met_answered_at = now()
          WHERE rendezvous_id = $1 AND for_user = $2 AND met IS NULL`,
        [id, ctx.userId, body.data.yes],
      ));
    if (!rowCount) return c.json({ error: 'not found or already answered' }, 404);
    return c.json({ ok: true });
  })

  /**
   * Send the agent out, once.
   *
   * Manual for now, and rate-limited by cost rather than by policy: five simulated
   * conversations are a few cents and a couple of minutes. A weekly cadence is the
   * shape this wants -- one match, at a fixed time -- but that is a scheduler, and a
   * button that works is worth more today than a scheduler that is not wired up.
   */
  .post('/v1/matches/run', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    await tenantSession(ctx, (db) => touchActive(db, ctx.userId));

    // A TARGET is "send my agent over" from the square: one person, by the
    // per-viewer ref the roster gave out, and a real conversation with them (~$0.02).
    // The ref resolves only among people the candidate rules already allow, so a
    // block or a filter answers "not here" exactly as it would to a scan of the
    // square. No body at all is the plain "send my agent out".
    const body = z.object({ target: z.string().regex(/^[0-9a-f]{32}$/).optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'bad request' }, 400);
    let targetUserId: string | undefined;
    if (body.data.target) {
      // The day's budget, checked before a row is written. The worker would refuse
      // anyway -- but as a failed round, with a claim to release and nothing on the
      // screen to say why. Here it is an answer to the tap.
      try {
        await tenantSession(ctx, (db) => checkBudget(db, ctx.tenantId, ctx.userId));
      } catch (err) {
        if (err instanceof BudgetExceeded) return c.json({ error: 'budget_exceeded' }, 429);
        throw err;
      }
      const ref = body.data.target;
      const id = await matchSession((db) => resolveAgentRef(db, ctx.userId, ref));
      if (!id) return c.json({ error: 'not_here' }, 404);
      targetUserId = id;
    }

    // ASKED FOR, NOT RUN. The round is several minutes of model calls and used to run
    // inside this request, so the phone held a socket open for as long as five
    // conversations take and showed the eventual timeout as a rejection. Now this
    // writes one row and answers at once; the worker in matching/rounds.ts does the
    // rest, and the matches list says how it is going. Tapping twice returns the
    // round already in flight rather than starting another.
    try {
      const round = await enqueueRound(ctx, targetUserId ? { targetUserId } : {});
      return c.json({ roundId: round.id, status: round.status }, 202);
    } catch (err) {
      if (err instanceof DailyTargetsExceeded) return c.json({ error: 'daily_targets', limit: err.limit }, 429);
      throw err;
    }
  });

/**
 * A stored rule, in English.
 *
 * `{predicate: works_in, operator: in, value: ["ai"]}` is a row; "works in AI" is what
 * a person recognises as the thing they said. Built here rather than in the app so the
 * app never has to know what an operator is.
 */
function phrase(predicate: string, operator: string, value: unknown): string {
  const subject = predicate.replace(/_/g, ' ');
  const list = Array.isArray(value)
    ? value.map((v) => String(v).replace(/[-_]/g, ' ')).join(' or ')
    : typeof value === 'object' && value !== null
      ? Object.values(value as Record<string, unknown>).join('–')
      : String(value).replace(/[-_]/g, ' ');

  switch (operator) {
    case 'in':       return `${subject} is ${list}`;
    case 'not_in':   return `${subject} is not ${list}`;
    case 'equals':   return `${subject} is ${list}`;
    case 'gte':      return `${subject} at least ${list}`;
    case 'lte':      return `${subject} at most ${list}`;
    case 'between':  return `${subject} between ${list}`;
    case 'contains': return `${subject} includes ${list}`;
    case 'absent':   return `no ${subject}`;
    default:         return `${subject}: ${list}`;
  }
}

/** The missing list, said the way a person would say it. */
function friendly(missing: readonly string[]): string[] {
  const words: Record<string, string> = {
    gender: 'It does not know your gender.',
    seeking_gender: 'It does not know who you want to meet.',
    birth_date: 'It does not know your age.',
    lives_in: 'It does not know where you are.',
    relationship_intent: 'It does not know what you are here for.',
  };
  return missing.map((m) => words[m] ?? `It still needs your ${m.replace(/_/g, ' ')}.`);
}
