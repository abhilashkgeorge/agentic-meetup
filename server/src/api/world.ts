/**
 * The roster for the town: who is in the square and what may be said about them.
 *
 * Read three ways, on purpose, each under the narrowest role that can answer:
 *
 *   tenantSession      the caller's own state -- setup, the latest round, their own
 *                      seats (the same rows the matches list reads) and their city.
 *   matchSession       a bounded sample of strangers, from the very query a round
 *                      would run, ranked, real before invented. Ids and tags never
 *                      leave the server; each becomes a per-viewer ref and a seed.
 *   matchmakerSession  a first name, and only for a met seat the reveal rule already
 *                      entitles the caller to (first mover, or the other side said
 *                      yes). Exactly the check GET /v1/matches/:id makes.
 *
 * Nothing here calls a model. Nothing here returns a coordinate, an age, a tag, an id,
 * or a word anybody wrote. A stranger in the square is a shape and a colour and the
 * one bit the practice label requires -- strictly less than a round result reveals.
 *
 * Since 0056 the shape and colours are the character the person built (or the one
 * their seed gives them), the same to every viewer -- a character that changes per
 * viewer is not a character. That is the one deliberate cross-viewer constant here:
 * eight small integers from a public catalog (shared/look.ts), plus the practice bit.
 * Refs stay per-viewer; a look cannot be joined to a person by anybody who does not
 * already know them.
 *
 * Since the map, one more deliberate constant: `area`, the neighbourhood tile each
 * agent stands in -- an id from the public list of thirty in shared/areas.ts, worked
 * out on the server from the person's point (nearestArea) and never the point
 * itself. A neighbourhood is hundreds of thousands of people and is what people put
 * in a bio; somebody the map does not cover, or who never said, stands in the
 * central tile. The sample of strangers is the forty nearest plus the twenty-four
 * most recent, so a tile has its neighbours in it.
 */
import { Hono } from 'hono';
import { CENTRAL_AREA, agreementWords, nearestArea, type AgreementWords } from '@clone/shared';
import { resolveCtx, Unauthorized } from '../auth.js';
import { matchSession, matchmakerSession, tenantSession } from '../db/client.js';
import { currentState } from '../memory/facts.js';
import { candidateCount, candidateIds, candidateIdsNear } from '../matching/candidates.js';
import { rebuildMatchProfile, shouldAskArea, touchActive } from '../matching/profile.js';
import { rank } from '../matching/score.js';
import { latestRound } from '../matching/rounds.js';
import { looksFor } from '../looks/store.js';
import type { Look } from '@clone/shared';
import {
  STRANGERS_IN_SQUARE, TARGETED_PER_DAY, agentRef, seatState, type SeatState,
} from '../matching/world.js';

async function ctxOr401(c: { req: { header: (k: string) => string | undefined } }) {
  try {
    return { ctx: await resolveCtx(c.req.header('authorization')), res: null };
  } catch (err) {
    if (err instanceof Unauthorized) return { ctx: null, res: 'unauthorized' as const };
    throw err;
  }
}

export interface WorldAgent {
  ref: string;
  kind: 'stranger' | 'practice' | 'met';
  practice: boolean;
  /** The character they built, or the one their seed gives them. The same to every viewer. */
  look: Look;
  /** For the renderer: gait and bob phase. Derived from the ref, never from the person. */
  seed: number;
  state: 'idle' | SeatState;
  /** The neighbourhood tile they stand in. Always present; the central tile when nobody knows. */
  area: string;
  rendezvousId?: string;
  name?: string;
  agreement?: AgreementWords;
  yourTurn?: boolean;
}

const seedOf = (ref: string): number => parseInt(ref.slice(0, 8), 16);
/** The tile a point stands in: the nearest of the thirty, or the central one. */
const areaOf = (lat: number | null, lon: number | null): string =>
  (lat !== null && lon !== null ? nearestArea(lat, lon)?.id : undefined) ?? CENTRAL_AREA;

/**
 * The stranger sample, cached briefly per person.
 *
 * Ranking 64 candidates is ~150 small queries; the square is refetched every eight
 * seconds while a round runs. Thirty seconds is short enough that a newly met person
 * leaves the sample by the next round, and the round itself forgets the entry.
 */
const sample = new Map<string, { at: number; ids: string[] }>();
const SAMPLE_TTL_MS = 30_000;
export function forgetSample(userId: string): void { sample.delete(userId); }

export const worldRoutes = new Hono()
  .get('/v1/world', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const me = ctx.userId;

    const own = await tenantSession(ctx, async (db) => {
      await touchActive(db, me);
      // READ the pool flag; REBUILD only when it says no. This is the Home, polled
      // every eight seconds while a round runs, and rebuilding the profile from every
      // fact on each poll is a write on a read path. Every write path already rebuilds
      // (essentials, tell, import) and so does /v1/pool, so the flag is current; the
      // rebuild is kept for the out-of-pool case, which is the only time `missing`
      // has anything in it.
      const { rows: prof } = await db.query<{ in_pool: boolean; traits: Record<string, unknown> | null }>(
        'SELECT in_pool, traits FROM match_profile WHERE user_id = $1', [me]);
      const state: { inPool: boolean; missing: string[] } = prof[0]?.in_pool
        ? { inPool: true, missing: [] }
        : await rebuildMatchProfile(db, ctx);
      const myArea = typeof prof[0]?.traits?.area === 'string' ? (prof[0].traits.area as string) : null;
      const askArea = await shouldAskArea(db, me);
      const round = await latestRound(db, me);
      const knows = (await currentState(db, me)).length;
      const { rows: city } = await db.query<{ object_text: string }>(
        `SELECT object_text FROM facts
          WHERE user_id = $1 AND predicate = 'lives_in' AND status = 'active' AND valid_to IS NULL
          ORDER BY recorded_at DESC LIMIT 1`, [me]);
      const { rows: targeted } = await db.query<{ n: string }>(
        `SELECT count(*) AS n FROM rounds
          WHERE user_id = $1 AND target_user_id IS NOT NULL
            AND requested_at > now() - interval '24 hours'`, [me]);
      // Own seats: the matches query, plus rows this person lapsed in the last day so
      // the square can show them walking off once. The other person's row and the
      // other person's brief are never read; two one-bit functions stand in for them.
      //
      // A LEFT join on the brief, where the matches query has an inner one. A pair
      // whose agents are talking right now has no brief yet -- the brief is what the
      // conversation produces -- and with the inner join the square could not draw
      // the one thing it exists to draw: it said "0 met so far" for the whole round
      // and the agent never left home. The person may read their own rendezvous row
      // whatever its state (rendezvous_mine, 0022); running rows are bounded to the
      // half hour reapStale gives a round, so a row orphaned by a restart does not
      // stand there talking for ever.
      const { rows: seats } = await db.query<{
        id: string; other_id: string; status: string; first_mover: string | null;
        human_says_yes: boolean | null; agreement: number | null;
        other_said_yes: boolean | null; other_is_synthetic: boolean | null;
      }>(
        `SELECT r.id,
                CASE WHEN r.user_a = $1 THEN r.user_b ELSE r.user_a END AS other_id,
                r.status, r.first_mover, b.human_says_yes, r.agreement,
                rendezvous_other_said_yes(r.id, $1)     AS other_said_yes,
                rendezvous_other_is_synthetic(r.id, $1) AS other_is_synthetic
           FROM rendezvous r
           LEFT JOIN rendezvous_briefs b ON b.rendezvous_id = r.id AND b.for_user = $1
          WHERE (r.user_a = $1 OR r.user_b = $1)
            AND (r.status <> 'lapsed' OR b.decided_at > now() - interval '1 day')
            AND (r.status <> 'running' OR r.created_at > now() - interval '30 minutes')
          ORDER BY r.created_at DESC`, [me]);
      return { state, round, knows, city: city[0]?.object_text ?? null, myArea, askArea,
               targetedToday: Number(targeted[0]?.n ?? 0), seats };
    });

    const metIds = new Set(own.seats.map((s) => s.other_id));

    // Strangers: the round's own candidate query, so nobody the filters or a block
    // would exclude can ever stand in the square. Out of pool means an empty square
    // and a count of zero, the same as /v1/pool.
    const strangers = own.state.inPool
      ? await matchSession(async (db) => {
          const total = await candidateCount(db, me);
          const hit = sample.get(me);
          let ids = hit && Date.now() - hit.at < SAMPLE_TTL_MS ? hit.ids : null;
          if (!ids) {
            // The neighbours first, then the recently active, once each: sixty-four
            // at most, the same count the ranker was sized for.
            const near = await candidateIdsNear(db, me, 40);
            const recent = await candidateIds(db, me, 24);
            const fresh = [...new Set([...near, ...recent])].filter((id) => !metIds.has(id));
            ids = (await rank(db, me, fresh, STRANGERS_IN_SQUARE)).map((r) => r.userId);
            sample.set(me, { at: Date.now(), ids });
          }
          const synthetic = new Set<string>();
          const areas = new Map<string, string>();
          if (ids.length) {
            const { rows } = await db.query<{ user_id: string; is_synthetic: boolean; lat: number | null; lon: number | null }>(
              'SELECT user_id, is_synthetic, lat, lon FROM match_profile WHERE user_id = ANY($1::uuid[])', [ids]);
            for (const r of rows) {
              if (r.is_synthetic) synthetic.add(r.user_id);
              areas.set(r.user_id, areaOf(r.lat, r.lon));
            }
          }
          const shown = ids.filter((id) => !metIds.has(id));
          return { total, ids: shown, synthetic, areas, looks: await looksFor(db, shown, synthetic) };
        })
      : { total: 0, ids: [] as string[], synthetic: new Set<string>(), areas: new Map<string, string>(), looks: new Map<string, Look>() };

    // Names: only for seats the reveal rule already opens. Same test as
    // GET /v1/matches/:id -- first mover, or the other side has said yes. Never while
    // the agents are still talking: nothing has been decided, so nothing is revealed.
    const entitled = own.seats.filter((s) =>
      s.status !== 'running' && (s.first_mover === me || s.other_said_yes === true));
    const names = new Map<string, string>();
    const seatAreas = new Map<string, string>();
    // Characters and neighbourhoods for the people met and for me, in the same read
    // as the names. The name is taken only for an entitled seat; the neighbourhood
    // for every seat, as for any stranger.
    const seatLooks = await matchmakerSession(async (db) => {
      if (own.seats.length) {
        const entitledIds = new Set(entitled.map((s) => s.other_id));
        const { rows } = await db.query<{ user_id: string; display_name: string | null; lat: number | null; lon: number | null }>(
          'SELECT user_id, display_name, lat, lon FROM match_profile WHERE user_id = ANY($1::uuid[])',
          [own.seats.map((s) => s.other_id)]);
        for (const r of rows) {
          if (r.display_name && entitledIds.has(r.user_id)) names.set(r.user_id, r.display_name);
          seatAreas.set(r.user_id, areaOf(r.lat, r.lon));
        }
      }
      return looksFor(db, [me, ...own.seats.map((s) => s.other_id)],
        new Set(own.seats.filter((s) => s.other_is_synthetic === true).map((s) => s.other_id)));
    });

    const agents: WorldAgent[] = [];
    for (const s of own.seats) {
      const ref = agentRef(me, s.other_id);
      const state = seatState({
        status: s.status, humanSaysYes: s.human_says_yes,
        firstMover: s.first_mover, otherSaidYes: s.other_said_yes,
      }, me);
      const myTurn = s.status !== 'running' && (s.first_mover === me || s.other_said_yes === true);
      const name = names.get(s.other_id);
      agents.push({
        ref, kind: 'met', practice: s.other_is_synthetic === true, seed: seedOf(ref), state,
        look: seatLooks.get(s.other_id)!,
        area: seatAreas.get(s.other_id) ?? CENTRAL_AREA,
        rendezvousId: s.id,
        ...(name ? { name } : {}),
        agreement: agreementWords(s.agreement),
        yourTurn: s.human_says_yes === null && myTurn,
      });
    }
    for (const id of strangers.ids) {
      const ref = agentRef(me, id);
      const practice = strangers.synthetic.has(id);
      agents.push({ ref, kind: practice ? 'practice' : 'stranger', practice, seed: seedOf(ref), state: 'idle',
                    look: strangers.looks.get(id)!, area: strangers.areas.get(id) ?? CENTRAL_AREA });
    }

    return c.json({
      square: { city: own.city, area: own.myArea ?? CENTRAL_AREA },
      me: {
        inPool: own.state.inPool, knows: own.knows,
        missing: own.state.missing, need: [...own.state.missing, ...(own.askArea ? ['area'] : [])],
        look: seatLooks.get(me)!,
        area: own.myArea,
      },
      pool: { total: strangers.total },
      round: own.round ? {
        id: own.round.id, status: own.round.status,
        skipped: own.round.result?.skipped ?? null,
        met: own.round.result?.metAll.length ?? 0,
        error: own.round.error,
      } : null,
      targetsLeftToday: Math.max(0, TARGETED_PER_DAY - own.targetedToday),
      agents,
    });
  });
