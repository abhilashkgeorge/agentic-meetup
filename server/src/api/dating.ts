/**
 * The dating endpoints: the six essentials, the live pool, and matches.
 *
 * All three exist because of one rule the app enforces on screen: an agent cannot go
 * out until it can answer the five questions every candidate query asks. Four out of
 * five is the same as none to somebody waiting to be matched.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { MIN_AGE, ageFromYear, deriveValue, findArea, findPlace, firstName, isAdult, canFilterOn, type Look } from '@clone/shared';
import { resolveCtx, Unauthorized } from '../auth.js';
import { matchSession, matchmakerSession, tenantSession, type TenantCtx } from '../db/client.js';
import { commit } from '../memory/facts.js';
import { poolNow, rebuildMatchProfile, shouldAskArea, shouldAskName, touchActive } from '../matching/profile.js';
import { candidateCount, poolBreakdown, shownBreakdown, shownCount } from '../matching/candidates.js';
import { decide, runRound } from '../matching/orchestrator.js';
import { DailyRoundsExceeded, DailyTargetsExceeded, enqueueRound, latestRound } from '../matching/rounds.js';
import { resolveAgentRef } from '../matching/world.js';
import { liveCard, mayRepeat, plainCard, readBrief, sentenceKey, wantCheck } from '../matching/brief.js';
import { publicTags } from '../matching/rendezvous.js';
import { expireDue } from '../matching/expiry.js';
import { roundRecap } from '../matching/recap.js';
import { ruleLabel } from '../matching/want-questions.js';
import { cardRuleLine } from '../matching/readback.js';
import { loadWants } from '../matching/wants.js';
import { mustHaveAllowed } from '../onboarding/questions.js';
import { lookOf, looksFor } from '../looks/store.js';
import { award } from '../points/ledger.js';
import { ANSWERS, WHY_NOT, checkinQuestions, type CheckinQuestion, type Shown } from '../checkin/questions.js';
import type { PoolClient } from 'pg';
import { BudgetExceeded, checkBudget } from '../metering.js';
import { log } from '../log.js';
import { ensureSheet } from '../matching/answer-sheet.js';

async function ctxOr401(c: { req: { header: (k: string) => string | undefined } }) {
  try {
    return { ctx: await resolveCtx(c.req.header('authorization')), res: null } as const;
  } catch (err) {
    if (err instanceof Unauthorized) return { ctx: null, res: 'unauthorized' } as const;
    throw err;
  }
}

/** The app's age-range pre-fill: own age, this many years either side ... */
const PREFILL_SPREAD = 5;
/** ... and never above this. The floor is MIN_AGE. Mirrors app/src/features/profile/age-range.ts. */
const PREFILL_CEIL = 99;

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

/**
 * Long enough for a date to have happened; short enough to still be remembered.
 * Overridable so the flow can be walked on a desk without waiting three days.
 */
const MET_ASK_AFTER_MS = Number(process.env.MET_ASK_AFTER_HOURS ?? 72) * 60 * 60_000;

interface OtherRow {
  user_id: string; display_name: string | null; age: number | null;
  traits: Record<string, unknown>; attribute_tags: string[]; look: Look;
}

/** The other person in a rendezvous, as the matchmaker may see them. Null if none. */
async function otherOf(id: string, me: string, synthetic: boolean): Promise<OtherRow | null> {
  return matchmakerSession(async (db) => {
    const { rows } = await db.query<Omit<OtherRow, 'look'>>(
      `SELECT p.user_id, p.display_name, p.age, p.traits, p.attribute_tags
         FROM rendezvous r
         JOIN match_profile p
           ON p.user_id = CASE WHEN r.user_a = $2 THEN r.user_b ELSE r.user_a END
        WHERE r.id = $1`,
      [id, me],
    );
    const row = rows[0];
    if (!row) return null;
    // SHAREABLE TAGS ONLY (the founder, 2026-09-28). The profile row's tags are built
    // from every live fact, for matching -- chat-learned ones the person never shared,
    // and ones they hid, included. Shown to another person, a tag must come from a fact
    // they made shareable, like every other thing a card says (publicTags, per fact).
    return { ...row, attribute_tags: await publicTags(db, row.user_id), look: await lookOf(db, row.user_id, synthetic) };
  });
}

/**
 * The reveal, and the record of what it showed.
 *
 * One function builds both, so the after-date questions (checkin/questions.ts) can
 * only ever be about what this person actually saw. `payload` is what GET
 * /v1/matches/:id sends; `shown` is the same facts kept raw for the generator.
 */
export function revealOf(other: OtherRow, practice: boolean, photosVisible: boolean) {
  // Tags, not sentences. What they have said in their own words belongs in the
  // brief, where it comes with a date and is quoted rather than summarised.
  // Shareable facts only (otherOf passes publicTags), and never a word on a private
  // topic -- "temple visits" or "whisky" is a sentence no card would say.
  const tags = other.attribute_tags
    .filter((t) => t.startsWith('interest:') || t.startsWith('works_in:'))
    .map((raw) => ({ raw, word: raw.split(':')[1]?.replace(/[-_]/g, ' ') ?? '' }))
    .filter((t) => t.word && mayRepeat(t.word))
    .slice(0, 8);
  const name = other.display_name ?? 'Someone';
  const livesIn = typeof other.traits.lives_in === 'string' ? other.traits.lives_in : null;
  return {
    payload: {
      waiting: false as const,
      // An invented profile, said so on the screen where the person decides. Nothing
      // about the brief changes -- the agents really did meet and this really is what
      // they made of each other. What changes is that there is no human on the far
      // side, and the person is told before they answer rather than after.
      practice,
      // Needed to fetch their pictures: the photo route is keyed on the owner as well
      // as the photo, so that holding an id is never by itself permission to see one.
      userId: other.user_id,
      name,                         // FIRST NAME ONLY (0027)
      age: other.age,
      tags: tags.map((t) => t.word),
      livesIn,
      look: other.look,
    },
    shown: { name, age: other.age, livesIn, tags: tags.map((t) => t.raw), photosVisible } satisfies Shown,
  };
}

/**
 * What a locked reveal says, in the words of where this person stands. Nothing of the
 * other person is in any of them -- not even whether they have looked.
 */
export function waitingWords(seat: { first_mover: string | null; mine: boolean | null }, me: string): string {
  if (seat.mine === true) return 'They see your profile now. Theirs shows here if they share it back.';
  if (seat.first_mover === me) return 'Their photos and name show only after they share them. You decide first, on the card.';
  return 'They decide first. If they share their profile, you will see it here.';
}

/** One row: where this person stands with a rendezvous, for the check-in. */
async function checkinSeat(db: PoolClient, id: string, me: string) {
  const { rows } = await db.query<{
    status: string; introduced_at: string | null; met: boolean | null; other_id: string;
    other_is_synthetic: boolean | null; again: boolean; answered: boolean; photos: number;
  }>(
    `SELECT r.status, r.introduced_at, b.met,
            CASE WHEN r.user_a = $2 THEN r.user_b ELSE r.user_a END AS other_id,
            rendezvous_other_is_synthetic(r.id, $2) AS other_is_synthetic,
            checkin_mutual_again(r.id, $2) AS again,
            EXISTS (SELECT 1 FROM date_checkins c WHERE c.rendezvous_id = r.id AND c.for_user = $2) AS answered,
            (SELECT count(*) FROM visible_photos(CASE WHEN r.user_a = $2 THEN r.user_b ELSE r.user_a END, $2))::int AS photos
       FROM rendezvous r
       JOIN rendezvous_briefs b ON b.rendezvous_id = r.id AND b.for_user = $2
      WHERE r.id = $1`,
    [id, me],
  );
  return rows[0] ?? null;
}

/**
 * The reader's wants their card for this match showed as "Matches", each tied to its
 * question: what the check-in may ask about in their own words (checkin/questions.ts).
 * Read from their own brief -- what they were shown -- and their own tied wants.
 *
 * BY WHAT THE CARD SHOWED (wantCheck), not by the stored result (the founder's (b),
 * 2026-09-29). A want tied to a situation question now shows only "A private topic" on
 * the card; asking after the date "You wanted a saver. Did they seem that way?" -- only
 * when she was one -- would have told the reader her answer all the same.
 */
async function matchedWants(ctx: TenantCtx, rendezvousId: string): Promise<{ key: string; text: string; kind: 'wants' | 'not' }[]> {
  const rows = await tenantSession(ctx, async (db) => (await db.query<{
    overlap_quotes: { wants?: { want: string; kind: 'wants' | 'not'; status: 'met' | 'not_met' | 'unknown' | 'cant_check'; private?: boolean }[] } | null;
  }>('SELECT overlap_quotes FROM rendezvous_briefs WHERE rendezvous_id = $1 AND for_user = $2', [rendezvousId, ctx.userId])).rows);
  const shown = (rows[0]?.overlap_quotes?.wants ?? []).filter((w) => wantCheck(w) === 'matches');
  if (!shown.length) return [];
  const tied = new Map((await loadWants(ctx)).filter((w) => w.ask).map((w) => [w.text, w.ask!.questionId]));
  return shown.filter((w) => tied.has(w.want)).map((w) => ({ key: `want:${tied.get(w.want)}`, text: w.want, kind: w.kind }));
}

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

    // THE AGE RANGE THEY WANT, and until now nothing could write it. The candidate
    // query tests age BOTH ways -- my age inside your range, your age inside mine --
    // and every real user's side of that was NULL, which passes everybody. So the age
    // filter ran one way only: a 25-year-old could be sent to somebody whose range was
    // 30-40, and nothing on their own side stopped a 60-year-old reaching them.
    // rebuildMatchProfile already reads the fact (profile.ts); only this door was shut:
    // a {min,max} arrived here, went through String(), and committed as the text
    // "[object Object]" with no value.
    //
    // Checked here rather than left to VALUE_SHAPES, because a range that fails the
    // shape would still commit as a fact with no value -- stored, and silently useless.
    let ageRange: { min: number; max: number } | null = null;
    if (predicate === 'age_range_sought' && value !== null && value !== '') {
      const r = z.object({
        min: z.number().int().min(MIN_AGE).max(120),
        max: z.number().int().min(MIN_AGE).max(120),
      }).strict().safeParse(value);
      if (!r.success || r.data.min > r.data.max) {
        return c.json({
          error: 'bad_age_range',
          message: `Pick two ages between ${MIN_AGE} and 120, youngest first.`,
        }, 400);
      }
      ageRange = r.data;
    }

    // THE FIRST NAME, the only writer of it (commit refuses every other). One word of
    // letters, stored as the shared rule shows it, so what the person reads back on
    // their profile is exactly what somebody sees once they share it. A phone number
    // or a handle is a 400 with a sentence, never somebody's name.
    let name: string | null = null;
    if (predicate === 'first_name' && value !== null && value !== '') {
      name = typeof value === 'string' ? firstName(value) : null;
      if (!name) {
        return c.json({ error: 'bad_name', message: 'Just your first name, in letters.' }, 400);
      }
    }

    // A neighbourhood is typed or picked by name; what is stored is the id from the
    // public list of thirty. A name the list does not know is a 400 with a sentence,
    // not a silently dropped fact.
    if (predicate === 'area' && value !== null && value !== '') {
      const text = String(Array.isArray(value) ? value[0] : value);
      if (!findArea(text)) {
        return c.json({ error: 'unknown_area', message: 'That part of town is not on the map yet. Pick the nearest one.' }, 400);
      }
    }

    // Whether the age range that arrived is the one the app pre-filled. See below.
    let ageRangeKept: boolean | undefined;

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

      // HOW OFTEN THE PRE-FILL IS KEPT UNCHANGED, which the spec asks to measure: a
      // default that sticks is a rule nobody chose, and the rate says whether this one
      // does. The app offers own age ±5, clamped to 18..99
      // (app/src/features/profile/age-range.ts), and posts only the two numbers, so
      // whether the person changed them is worked out here from their own birth year
      // with the same arithmetic. One yes/no on the log line, never the ages. Unknown
      // (no birth year on file) is left off rather than guessed.
      if (ageRange) {
        const { rows: born } = await db.query<{ v: { year?: number } | null }>(
          `SELECT object_value AS v FROM facts
            WHERE user_id = $1 AND predicate = 'birth_date' AND status = 'active' AND valid_to IS NULL
            ORDER BY recorded_at DESC LIMIT 1`, [ctx.userId]);
        const year = born[0]?.v?.year;
        if (year) {
          const age = ageFromYear(year);
          const clamp = (n: number) => Math.min(PREFILL_CEIL, Math.max(MIN_AGE, n));
          ageRangeKept = ageRange.min === clamp(age - PREFILL_SPREAD) && ageRange.max === clamp(age + PREFILL_SPREAD);
        }
      }

      // Several answers to one question (who you want to meet) become several facts,
      // because the predicate is multi-valued and each value stands alone. An age
      // range is ONE answer that happens to be an object, and is stored as its words
      // ("26-34") with the checked {min,max} as the value.
      const values = ageRange ? [`${ageRange.min}-${ageRange.max}`] : name ? [name] : Array.isArray(value) ? value : [value];
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
                : predicate === 'area'
                  ? findArea(text)!.id
                  : ageRange
                    ? ageRange
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

    log.info({ userId: ctx.userId, predicate, declined: value === null, ageRangeKept }, 'essential set');
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

    const { state, askDistance, askArea, askName } = await tenantSession(ctx, async (db) => {
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
      // The neighbourhood is the other optional one, and only for a person the map
      // covers. It is asked right after the city, so the wizard's list keeps that order.
      // The first name is optional too, and asked first (app fields.ts order).
      return {
        state: s, askDistance: rows.length === 0,
        askArea: await shouldAskArea(db, ctx.userId), askName: await shouldAskName(db, ctx.userId),
      };
    });
    if (!state.inPool) {
      // `missing` is the friendly sentences the cards print, and stays REQUIRED-only so
      // an optional field never shows up as "still needs". `need` is the raw predicate
      // keys the setup wizard asks -- the required ones, plus the neighbourhood and
      // distance while they are still worth offering -- so the wizard asks ONLY what
      // is left instead of all six.
      const need = [...(askName ? ['first_name'] : []), ...state.missing, ...(askArea ? ['area'] : []), ...(askDistance ? ['max_distance_km'] : [])];
      return c.json({
        total: null, steps: [], inPool: false,
        missing: friendly(state.missing), need,
      });
    }

    // Across tenants, through the role that can read almost nothing else.
    const [total, steps] = await matchSession(async (db) => [
      await candidateCount(db, ctx.userId),
      await poolBreakdown(db, ctx.userId),
    ]);

    // In the pool, the only open questions are the first name and the neighbourhood:
    // the Home's chips ask them.
    // Every count through shownCount: rounded to ten, nothing under twenty.
    return c.json({
      total: shownCount(total), steps: shownBreakdown(steps), inPool: true, missing: [],
      need: [...(askName ? ['first_name'] : []), ...(askArea ? ['area'] : [])],
    });
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
        // A want's rule reads with its question's own words (want-questions.ts).
        // A card's rule reads as the rules read back ("They want kids"), never the column.
        label: (r.operator === 'in'
          ? ruleLabel(r.predicate, r.value) ?? (Array.isArray(r.value) ? cardRuleLine(r.predicate, r.value.map(String)) : null)
          : null) ?? phrase(r.predicate, r.operator, r.value),
        // Whether "Must have" is offered at all: only on a tapped answer.
        mustHave: canFilterOn(r.predicate) && mustHaveAllowed(r.predicate),
        strength: r.strength,
        sourceQuote: r.source_quote,
      })),
    });
  })

  /**
   * Remove a rule -- a must-have too (the founder, 2026-09-29: "a must-have can be
   * deleted"). Rules could only change strength, so a must-have stayed hiding people for
   * as long as the account lived. Retired, never deleted: the rule stays on record with
   * the moment it stopped applying. The new count comes back, as for a strength change.
   */
  .post('/v1/preferences/remove', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const body = z.object({ id: z.string().uuid() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);
    const { rowCount } = await tenantSession(ctx, (db) =>
      db.query('UPDATE preferences SET retired_at = now() WHERE id = $1 AND user_id = $2 AND retired_at IS NULL',
        [body.data.id, ctx.userId]));
    if (!rowCount) return c.json({ error: 'not found' }, 404);
    const total = await matchSession((db) => candidateCount(db, ctx.userId)).catch(() => 0);
    return c.json({ ok: true, total: shownCount(total) });
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
      // ONLY ON A TAPPED ANSWER (questions.ts mustHaveAllowed): this field can also come
      // from what people say in chat, and a must-have must never hide somebody over that.
      if (pred && !mustHaveAllowed(pred)) {
        return c.json({
          error: 'not_tapped',
          message: 'This one can only move people up or down. A must-have only hides someone over an answer they tapped, and people also say this one in chat.',
        }, 400);
      }
    }
    await tenantSession(ctx, (db) =>
      db.query(`UPDATE preferences SET strength = $3 WHERE id = $1 AND user_id = $2`,
        [body.data.id, ctx.userId, body.data.strength]),
    );

    // The new count comes straight back, so the screen can show the consequence of
    // the change rather than the change alone.
    // Rounded like every other count (shownCount): an exact total here, before and after
    // one toggle, is how many people that one rule removes.
    const total = await matchSession((db) => candidateCount(db, ctx.userId)).catch(() => 0);
    return c.json({ ok: true, total: shownCount(total) });
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
    // A card whose three days are up is expired before it is shown (0069).
    await matchmakerSession(expireDue);

    // Own brief only, and the policy enforces it -- the other side's brief is the
    // other agent's private assessment of this person, and is never readable here.
    // `concern` and `agreement` are not even selected: nothing a conversation
    // produced may reach this response, whatever is in the row.
    const rows = await tenantSession(ctx, async (db) => {
      const { rows } = await db.query<{
        id: string; headline: string; overlap_quotes: unknown;
        questions: unknown; human_says_yes: boolean | null; first_mover: string | null;
        status: string; other_decided: boolean | null; other_is_synthetic: boolean | null;
        other_id: string; answer_by: Date | null;
      }>(
        `SELECT r.id, b.headline, b.overlap_quotes, b.questions,
                b.human_says_yes, r.first_mover, r.status, r.answer_by,
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
            -- A no ('lapsed') and a card nobody answered in three days ('expired',
            -- 0069) are both gone -- recorded apart, shown alike: as nothing.
            AND r.status NOT IN ('lapsed', 'expired')
            -- KEPT APART (0064): blocked either way, or the other person banned. A card
            -- made before the block is gone from both screens, not only new ones.
            AND NOT apart($1, CASE WHEN r.user_a = $1 THEN r.user_b ELSE r.user_a END)
          -- THE QUEUE. Newest round first, and within a round an order that means
          -- nothing: a hash of the id. A person sees the head of this and says yes
          -- or not-for-me; a no lapses the row and the next one is already here.
          --
          -- NEVER BY A SCORE. This used to be agreement first, rank second, and a
          -- list ordered by a score teaches the person the score: the head of the
          -- queue reads as "the one it liked most", position becomes a verdict, and
          -- every yes compare-scorers later counts has been nudged by the scorer it
          -- is judging. The pairs of one round are claimed in one transaction and
          -- share a created_at to the microsecond, so a round is exactly the rows
          -- with the same created_at. COLLATE "C" so the hash sorts by bytes, not
          -- by whatever the database's locale thinks of hex.
          ORDER BY r.created_at DESC, md5(r.id::text) COLLATE "C"`,
        [ctx.userId],
      );
      return rows;
    });
    const round = await tenantSession(ctx, (db) => latestRound(db, ctx.userId));
    // What the agent did while it was out (matching/recap.ts): templates and the
    // person's own shareable words only. Once the round is done.
    const recap = round?.status === 'done' ? await roundRecap(ctx, round) : null;
    // WHAT EACH OTHER PERSON STILL SHOWS, read now (brief.ts liveCard): their public,
    // active, current sentences -- the only view the matchmaker has of anybody -- so a
    // sentence they hid since a card was written comes off that card as it is shown.
    const realOthers = [...new Set(rows.filter((r) => r.other_is_synthetic !== true).map((r) => r.other_id))];
    const liveBy = new Map<string, Set<string>>(realOthers.map((id) => [id, new Set()]));
    if (realOthers.length) {
      await matchmakerSession(async (db) => {
        const { rows: said } = await db.query<{ user_id: string; source_quote: string }>(
          `SELECT user_id, source_quote FROM facts
            WHERE user_id = ANY($1::uuid[]) AND disclosure = 'public' AND status = 'active' AND valid_to IS NULL`,
          [realOthers]);
        for (const r of said) liveBy.get(r.user_id)?.add(sentenceKey(r.source_quote));
      });
    }
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
        recap,
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
            // The code-written card: facts line, the constant line, shared tags,
            // their own verified words, an opener. A brief a model wrote before
            // 2026-09-23 comes back as the plain card; see readBrief.
            //
            // THE SECOND MOVER GETS THE PLAIN CARD until the first mover says yes.
            // The first mover decides alone and first, and only then is their profile
            // shown to the other -- the reveal below holds back their age, where they
            // live and their tags until then. The code-written facts line carries
            // exactly those (age, neighbourhood, shared tags), so without this the
            // busier side's age and neighbourhood reached every second mover they
            // were paired with, including the ones they go on to turn down. The row
            // is kept as written; it is shown the moment their yes makes it this
            // person's turn.
            ...(myTurn ? liveCard(readBrief(r), liveBy.get(r.other_id) ?? null) : plainCard()),
            waitingOnYou: r.human_says_yes === null && myTurn,
            // When the card fades out if this person does not answer (0069): only on
            // their turn, and only while it is open. The phone fades it toward this.
            fadesAt: r.human_says_yes === null && myTurn && r.status === 'decided' && r.answer_by
              ? new Date(r.answer_by).toISOString() : null,
            // Never a hint about what they will say -- only that they have not looked.
            // A no is silent, so this state is also what a no looks like, for ever.
            waitingOnThem: r.human_says_yes === true || !myTurn,
            // CONSENT FIRST (2026-09-28). Two plain facts, so the card can say which of
            // the two waits this is, and which button fits: they have shared their
            // profile with you (so you see it, and answer by sharing yours back), and you
            // have shared yours (so they see it, and the next move is theirs).
            sharedWithYou: r.other_decided === true,
            youShared: r.human_says_yes === true,
            // Said plainly, on the card, before the person spends any feeling on it.
            practice: r.other_is_synthetic === true,
            look: looks.get(r.other_id),
          };
        }),
    });
  })

  /**
   * The reveal. Who they actually are: first name, age, city, tags, photos.
   *
   * ONLY ONCE THEY HAVE SAID YES TO YOU (the founder, 2026-09-28): "nobody's photos or
   * name reach anyone until THAT person has said yes to them". The first mover decides
   * on the words card and the other's character; their "Yes, share my profile with
   * them" opens THEIR reveal to the other person, who answers "Yes, share mine back" or
   * "Not for me"; only that second yes opens the second person's reveal to the first.
   * The photo rule in the database is the same test (0073).
   */
  .get('/v1/matches/:id', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'bad id' }, 400);

    // Membership is checked under RLS first: a rendezvous this person is not half of
    // returns nothing, which is the same answer as one that does not exist. An expired
    // card (0069) is the same: its time is up, and its profile does not open.
    await matchmakerSession(expireDue);
    const seat = await tenantSession(ctx, async (db) => {
      const { rows } = await db.query<{
        first_mover: string | null; status: string; mine: boolean | null; other_said_yes: boolean | null;
        other_is_synthetic: boolean | null;
      }>(
        `SELECT r.first_mover, r.status, b.human_says_yes AS mine,
                rendezvous_other_said_yes(r.id, $2) AS other_said_yes,
                rendezvous_other_is_synthetic(r.id, $2) AS other_is_synthetic
           FROM rendezvous r
           JOIN rendezvous_briefs b ON b.rendezvous_id = r.id AND b.for_user = $2
          -- A pair that ended -- a no, or three days of silence -- opens nothing.
          WHERE r.id = $1 AND r.status NOT IN ('expired', 'lapsed')
            -- Kept apart (0064): the profile does not open, the same as no match.
            AND NOT apart($2, CASE WHEN r.user_a = $2 THEN r.user_b ELSE r.user_a END)`,
        [id, ctx.userId],
      );
      return rows[0] ?? null;
    });
    if (!seat) return c.json({ error: 'not found' }, 404);

    const other = await otherOf(id, ctx.userId, seat.other_is_synthetic === true);
    if (!other) return c.json({ error: 'not found' }, 404);

    // Nothing of theirs until they have said yes to you. Said plainly, in the words of
    // where this person stands, because a locked screen with no reason reads as a bug.
    if (seat.other_said_yes !== true) {
      return c.json({ waiting: true, message: waitingWords(seat, ctx.userId) });
    }

    const { payload } = revealOf(other, seat.other_is_synthetic === true, false);
    // How many dates said the basics were true. Zero is said as nothing on the screen.
    const trust = await tenantSession(ctx, async (db) => {
      const { rows } = await db.query<{ n: number; checked: boolean }>(
        'SELECT confirmations_of($1, $2) AS n, photos_checked($1, $2) AS checked', [other.user_id, ctx.userId]);
      return { confirmedBy: rows[0]?.n ?? 0, photosChecked: rows[0]?.checked === true };
    });
    // Introduced: both have shared, and there is nothing left to decide here.
    return c.json({ ...payload, ...trust, introduced: seat.status === 'introduced', youAnswered: seat.mine !== null });
  })

  /**
   * The after-date check-in: what to ask, and the answers.
   *
   * GET says where this person stands -- not yet, "did you two meet" is due, the
   * questions are ready, or done -- and, when ready, the questions themselves, built
   * from the reveal and nothing else. POST records the answers for THIS side, once.
   * The other person never sees them; `again` is the one bit that crosses, and only
   * when both said yes.
   */
  .get('/v1/matches/:id/checkin', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'bad id' }, 400);

    const seat = await tenantSession(ctx, (db) => checkinSeat(db, id, ctx.userId));
    if (!seat) return c.json({ error: 'not found' }, 404);
    const introduced = seat.introduced_at ? new Date(seat.introduced_at).getTime() : null;
    const due = introduced !== null && Date.now() - introduced >= MET_ASK_AFTER_MS;
    const state = seat.answered ? 'done' : seat.met === null ? (due ? 'ask_met' : 'not_yet') : 'ask';
    const practice = seat.other_is_synthetic === true;

    let questions: CheckinQuestion[] = [];
    if (state === 'ask' && seat.met) {
      const other = await otherOf(id, ctx.userId, practice);
      if (other) questions = checkinQuestions({ ...revealOf(other, practice, seat.photos > 0).shown, wants: await matchedWants(ctx, id) });
    }
    return c.json({ state, met: seat.met, practice, questions, whyNot: WHY_NOT, again: seat.again });
  })

  .post('/v1/matches/:id/checkin', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'bad id' }, 400);
    const raw = await c.req.json().catch(() => null);

    const seat = await tenantSession(ctx, (db) => checkinSeat(db, id, ctx.userId));
    if (!seat || seat.answered) return c.json({ error: 'not found or already answered' }, 404);
    if (seat.met === null) return c.json({ error: 'answer_met_first' }, 409);
    const practice = seat.other_is_synthetic === true;

    // What gets stored, by which question was actually asked.
    let row: { answers: Record<string, string>; feltSafe: boolean | null; seeAgain: boolean | null };
    if (seat.met) {
      const body = z.object({
        answers: z.record(z.string().max(64), z.enum(ANSWERS)),
        feltSafe: z.boolean(),
        seeAgain: z.boolean().nullable(),
      }).safeParse(raw);
      if (!body.success) return c.json({ error: 'bad request' }, 400);
      // The questions are regenerated here, not trusted from the client: an answer to
      // a question that was never asked is refused, and every identity question must
      // have one -- those are the ones that count for anybody.
      const other = await otherOf(id, ctx.userId, practice);
      if (!other) return c.json({ error: 'not found' }, 404);
      const questions = checkinQuestions({ ...revealOf(other, practice, seat.photos > 0).shown, wants: await matchedWants(ctx, id) });
      const allowed = new Set(questions.map((q) => q.key));
      for (const k of Object.keys(body.data.answers)) if (!allowed.has(k)) return c.json({ error: 'unknown_question', key: k }, 400);
      for (const q of questions) if (q.identity && !(q.key in body.data.answers)) return c.json({ error: 'missing_answer', key: q.key }, 400);
      row = { answers: body.data.answers, feltSafe: body.data.feltSafe, seeAgain: body.data.seeAgain };
    } else {
      const body = z.object({ whyNot: z.enum(WHY_NOT).optional() }).safeParse(raw ?? {});
      if (!body.success) return c.json({ error: 'bad request' }, 400);
      row = { answers: body.data.whyNot ? { why_not: body.data.whyNot } : {}, feltSafe: null, seeAgain: null };
    }

    const out = await tenantSession(ctx, async (db) => {
      // The policy proves membership, introduction, the other seat and the met flag;
      // a refusal from it and a second answer both read the same from here.
      try {
        await db.query(
          `INSERT INTO date_checkins (rendezvous_id, for_user, about_user, met, answers, felt_safe, see_again)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, ctx.userId, seat.other_id, seat.met, row.answers, row.feltSafe, row.seeAgain],
        );
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === '42501' || code === '23505') return null;
        throw err;
      }
      // Points for answering: the same whether they met or not, and none for a practice pair.
      const awarded = practice ? 0 : await award(db, ctx, 'checkin', id);
      const { rows } = await db.query<{ again: boolean }>('SELECT checkin_mutual_again($1, $2) AS again', [id, ctx.userId]);
      return { awarded, again: rows[0]?.again === true };
    });
    if (!out) return c.json({ error: 'not found or already answered' }, 404);
    return c.json({ ok: true, ...out });
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
    // does the write can see every rendezvous, so the check has to happen here. A card
    // whose three days are up takes no answer (0069): expired first, then not found.
    await matchmakerSession(expireDue);
    const seat = await tenantSession(ctx, async (db) => {
      const { rows } = await db.query<{
        status: string; first_mover: string | null; mine: boolean | null; other_said_yes: boolean | null;
      }>(
        `SELECT r.status, r.first_mover, b.human_says_yes AS mine,
                rendezvous_other_said_yes(r.id, $2) AS other_said_yes
           FROM rendezvous r
           JOIN rendezvous_briefs b ON b.rendezvous_id = r.id AND b.for_user = $2
          WHERE r.id = $1 AND r.status <> 'expired'
            AND NOT apart($2, CASE WHEN r.user_a = $2 THEN r.user_b ELSE r.user_a END)`, [id, ctx.userId]);
      return rows[0] ?? null;
    });
    if (!seat) return c.json({ error: 'not found' }, 404);
    // TURN ORDER ON THE SERVER, not only in the app (the founder, 2026-09-28): the
    // first mover answers first; the other person only after the first has shared.
    // decide() enforces the same in its own write, whatever calls it.
    if (seat.status !== 'decided' || seat.mine !== null) return c.json({ error: 'already_decided' }, 409);
    const myTurn = seat.first_mover === ctx.userId || seat.first_mover === null || seat.other_said_yes === true;
    if (!myTurn) return c.json({ error: 'not_your_turn' }, 409);

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
    const out = await tenantSession(ctx, async (db) => {
      const { rowCount } = await db.query(
        `UPDATE rendezvous_briefs SET met = $3, met_answered_at = now()
          WHERE rendezvous_id = $1 AND for_user = $2 AND met IS NULL`,
        [id, ctx.userId, body.data.yes],
      );
      if (!rowCount) return null;
      // Points for answering -- yes or no alike, so nobody is paid to say yes to the
      // one label the scorers are judged against -- and none for a practice pair.
      const { rows } = await db.query<{ s: boolean | null }>(
        'SELECT rendezvous_other_is_synthetic($1, $2) AS s', [id, ctx.userId]);
      const awarded = rows[0]?.s ? 0 : await award(db, ctx, 'met', id);
      return { awarded };
    });
    if (!out) return c.json({ error: 'not found or already answered' }, 404);
    return c.json({ ok: true, awarded: out.awarded });
  })

  /**
   * Send the agent out, once.
   *
   * Manual for now. A round makes no model call (orchestrator.ts), so what limits it
   * is the one-round-at-a-time index, ROUNDS_PER_DAY open rounds that met somebody,
   * and, for targets, five a day. A weekly cadence is the shape this wants -- one
   * match, at a fixed time -- but that is a scheduler, and a button that works is worth
   * more today than a scheduler that is not wired up.
   */
  .post('/v1/matches/run', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    // READY BEFORE QUEUED. This used to queue whatever the person's stored pool flag
    // said, and the worker checked the same stored flag (orchestrator.ts). A flag
    // written before the five core cards existed still said yes, so a person with no
    // card on file could send their agent out from the Home. poolNow rebuilds a yes
    // that the cards say is out of date, and a no answers here, with what is missing,
    // rather than as a round that fails a minute later with nothing on screen.
    const ready = await tenantSession(ctx, async (db) => {
      await touchActive(db, ctx.userId);
      return poolNow(db, ctx);
    });
    if (!ready.inPool) {
      return c.json({ error: 'not_ready', missing: friendly(ready.missing), need: ready.missing }, 409);
    }
    // YOUR AGENT'S ANSWERS, up to date before it goes out: what it says when another
    // agent asks (answer-sheet.ts). No call when nothing changed; never blocks the tap.
    await ensureSheet(ctx);

    // A TARGET is "send my agent over" from the square: one person, by the
    // per-viewer ref the roster gave out. It costs nothing in model calls now -- no
    // conversation is held -- and is still five a day, which now bounds how often
    // one person can put themselves in front of another rather than spend.
    // The ref resolves WITHOUT the rules (world.ts resolveAgentRef): a block, somebody
    // already met, or a ref never given out is "not here"; anybody else is a counted
    // visit, and the round checks the rules -- so no card answer can be read off the
    // tap for free. No body at all is the plain "send my agent out".
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
      // Everybody this person has already met, from their own rows: a pair meets once,
      // so a ref for one of them is "not here" whatever either card says.
      const met = await tenantSession(ctx, async (db) => new Set((await db.query<{ other: string }>(
        `SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS other
           FROM rendezvous WHERE user_a = $1 OR user_b = $1`, [ctx.userId])).rows.map((r) => r.other)));
      const id = await matchSession((db) => resolveAgentRef(db, ctx.userId, ref, met));
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
      if (err instanceof DailyRoundsExceeded) return c.json({ error: 'daily_rounds', limit: err.limit }, 429);
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
    // The five core cards (onboarding/questions.ts CORE). Each is done once answered or
    // declined, so the sentence asks for the card, not for a value.
    wants_children: 'It still needs your answer about children.',
    monogamy_stance: 'It still needs your answer on one person or open.',
    smoking: 'It still needs your answer about smoking.',
    drinking: 'It still needs your answer about drinking.',
    diet: 'It still needs your answer about food.',
  };
  return missing.map((m) => words[m] ?? `It still needs your ${m.replace(/_/g, ' ')}.`);
}
