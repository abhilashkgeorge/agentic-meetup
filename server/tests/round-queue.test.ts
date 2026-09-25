/**
 * A round meets several people, briefs every one of them, and the person sees them
 * one at a time.
 *
 * WHAT THIS REPLACES. One tap used to meet exactly one person -- the top of a ranking
 * nobody could see -- and if fewer than three of five conversations ended in a mutual
 * yes the pair was 'lapsed' and the person saw nothing. Five of the seven real rounds
 * ever run ended that way. The nineteen other people the ranker had scored were thrown
 * away each time. And the whole thing ran inside the HTTP request, so a phone that gave
 * up waiting was shown a rejection.
 *
 * The model is stubbed. Nothing here costs money. Since 2026-09-23 a default round
 * holds no conversation at all (rendezvous.ts RUNS), so the scripted verdicts below
 * are never consumed; they stay so that a round which started talking again would
 * be answered, and seen.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({
  /** One entry per assessor call, cycled. */
  verdicts: [] as { verdict: string; learned: string[]; concern: string }[],
  at: 0,
  calls: 0,
}));

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'google:gemini-3.5-flash-lite',
  // Off, as it is by default. Without it every round's jevFileScore threw vitest's
  // "no decideModel export" and the orchestrator's catch swallowed it, so a zero call
  // count here passed partly through an error. brief-code-only.test.ts guards the
  // real default.
  decideModel: () => null,
  llm: {
    complete: async (req: { outputSchema?: unknown; outputSchemaName?: string }) => {
      stub.calls++;
      const usage = {
        inputTokens: 500, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 60,
        reasoningTokens: 0, provider: 'google', modelId: 'flash-lite',
        costUsd: 0.0001, latencyMs: 100,
      };
      if (!req.outputSchema) return { text: 'a message', parsed: null, usage };
      if (req.outputSchemaName === 'brief') {
        return { text: '', parsed: { headline: 'Two people', pairs: [], questions: [] }, usage };
      }
      const v = stub.verdicts[stub.at % stub.verdicts.length] ?? {
        verdict: 'no', learned: ['a', 'b', 'c'], concern: 'x',
      };
      stub.at++;
      return { text: '', parsed: v, usage };
    },
  },
}));

const { pool, tenantSession, matchmakerSession, closeMatchPool } =
  await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { runRound, decide, CANDIDATES_PER_ROUND } = await import('../src/matching/orchestrator.js');
const { enqueueRound, runOneQueuedRound, latestRound, DailyRoundsExceeded } = await import('../src/matching/rounds.js');
const { ROUNDS_PER_DAY } = await import('../src/matching/world.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');
const { CORE } = await import('../src/onboarding/questions.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

// A round with conversations is real time even with the model stubbed: converse()
// sleeps 1.5s between runs to stay under the free tier's rate limit. The default
// round holds none, but the headroom stays for a file that switches them back on.
vi.setConfig({ testTimeout: 180_000 });

beforeEach(() => { stub.verdicts = []; stub.at = 0; stub.calls = 0; });

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

type Ctx = { tenantId: string; userId: string };

async function person(label: string, over: Record<string, unknown> = {}): Promise<Ctx> {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`rq-${label}-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `rq-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: ['long_term'],
    in_pool: true, is_synthetic: false, sees_synthetic: false, display_name: label,
    ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(
    `INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map((k) => cols[k]));
  // The five core cards, done. A real person in the pool has answered them, and the
  // Home and the tap re-check that (poolNow) instead of trusting a planted in_pool.
  if (!cols.is_synthetic) {
    for (const id of CORE) {
      await owner.query(
        `INSERT INTO question_answers (tenant_id, user_id, question_id, answer, skipped)
         VALUES ($1,$2,$3,'{"values":[],"whoFine":{"anyone":true}}'::jsonb, true)`,
        [tenantId, userId, id]);
    }
  }
  return { tenantId, userId };
}

/**
 * A seeker and enough candidates for a full round plus one spare.
 *
 * ISOLATED BY INTENT. Every scene's people share one made-up intent that no other
 * scene uses, so the intent filter keeps them from meeting fixtures left by the other
 * tests in this file. Without this the "does not meet the same person twice" test
 * found three fresh strangers from earlier scenes and passed for the wrong reason.
 */
async function scene() {
  const tag = `scene-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
  const them: Ctx[] = [];
  for (let i = 0; i < CANDIDATES_PER_ROUND + 1; i++) {
    them.push(await person(`c${i}`, { intent: [tag] }));
  }
  return { me, them };
}

/** A signed-in phone for this person, so a test reads what the app reads. */
async function tokenFor(who: Ctx): Promise<string> {
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, who.tenantId, who.userId]);
  return mintToken(sessionId);
}

/** GET /v1/matches, as the app asks it: the ids of the cards on the screen. */
async function cardsOf(token: string): Promise<string[]> {
  const res = await datingRoutes.request('/v1/matches', {
    headers: { Authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.31' },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { matches: { id: string }[] }).matches.map((m) => m.id);
}

/** Run the worker until this person's round is finished, or give up. */
async function drainFor(me: Ctx, ticks = 10) {
  for (let i = 0; i < ticks; i++) {
    const r = await tenantSession(me, (c) => latestRound(c, me.userId));
    if (r && (r.status === 'done' || r.status === 'failed')) return r;
    if (!(await runOneQueuedRound())) break;
  }
  return tenantSession(me, (c) => latestRound(c, me.userId));
}

describe('a round', () => {
  it('meets several people, not one', async () => {
    const { me } = await scene();
    const r = await runRound(me.userId);
    expect(r.skipped).toBeUndefined();
    expect(r.metAll.length).toBe(CANDIDATES_PER_ROUND);
    expect(r.met).toBe(r.metAll[0]);
  });

  it('writes a brief for every pair, with no verdict behind it', async () => {
    // The case that used to vanish was a pair the agents did not like: it got no card.
    // Now no agent judges anybody. Every pair must get a rendezvous row, a brief on
    // each side with no concern on it, an agreement of NULL -- not 0, which reads as
    // "they said no" and which `Number(null)` also produces, so this is checked as
    // null -- and NOT the 'lapsed' status.
    const { me } = await scene();
    stub.verdicts = [{ verdict: 'no', learned: ['a', 'b', 'c'], concern: 'too quiet' }];
    const r = await runRound(me.userId);
    expect(r.passed).toBe(false);
    expect(stub.calls).toBe(0);

    const { rows } = await owner.query<{ status: string; agreement: number | null; briefs: string; concerns: string[] }>(
      `SELECT r.status, r.agreement,
              (SELECT count(*) FROM rendezvous_briefs b WHERE b.rendezvous_id = r.id) AS briefs,
              (SELECT array_agg(b.concern) FROM rendezvous_briefs b WHERE b.rendezvous_id = r.id) AS concerns
         FROM rendezvous r WHERE r.user_a = $1 OR r.user_b = $1`, [me.userId]);
    expect(rows.length).toBe(CANDIDATES_PER_ROUND);
    for (const row of rows) {
      expect(row.status).toBe('decided');
      expect(row.agreement).toBeNull();
      expect(Number(row.briefs)).toBe(2);
      expect(row.concerns).toEqual(['', '']);
    }
  });

  it('records what the ranker thought, and no agreement it did not measure', async () => {
    const { me } = await scene();
    stub.verdicts = [{ verdict: 'yes', learned: ['a', 'b', 'c'], concern: 'none really' }];
    await runRound(me.userId);
    const { rows } = await owner.query<{ rank_score: number | null; agreement: number | null }>(
      'SELECT rank_score, agreement FROM rendezvous WHERE user_a = $1 OR user_b = $1', [me.userId]);
    expect(rows.length).toBe(CANDIDATES_PER_ROUND);
    for (const row of rows) {
      expect(row.rank_score).not.toBeNull();
      expect(row.agreement).toBeNull();
    }
  });

  it('does not meet the same person twice', async () => {
    const { me, them } = await scene();
    const first = await runRound(me.userId);
    const second = await runRound(me.userId);
    // The spare candidate is all that is left the second time.
    expect(second.metAll.length).toBe(them.length - first.metAll.length);
    expect(new Set(second.metAll).size).toBe(second.metAll.length);
    for (const id of second.metAll) expect(first.metAll).not.toContain(id);
  });
});

describe('the list the person sees', () => {
  // Its ORDER is no longer tested here. It used to be "by how the agents got on", read
  // through a copy of the endpoint's SQL; it is now newest round first and then a hash
  // of the id, tested through the endpoint itself in match-order.test.ts.
  it('loses a card the person says no to, and keeps the rest -- on both phones', async () => {
    // Read through the endpoint, not a copy of its WHERE clause: a copy keeps passing
    // when the endpoint stops hiding a lapsed row, which is the thing being tested.
    const { me } = await scene();
    const r = await runRound(me.userId);
    expect(r.metAll.length).toBe(3);
    const mine = await tokenFor(me);

    const before = await cardsOf(mine);
    expect(before).toHaveLength(3);
    // The person on the other side of the first card, and their phone.
    const { rows } = await owner.query<{ other: string; tenant: string }>(
      `SELECT CASE WHEN user_a = $2 THEN user_b ELSE user_a END AS other,
              CASE WHEN user_a = $2 THEN tenant_b ELSE tenant_a END AS tenant
         FROM rendezvous WHERE id = $1`, [before[0], me.userId]);
    const theirs = await tokenFor({ userId: rows[0]!.other, tenantId: rows[0]!.tenant });
    expect(await cardsOf(theirs)).toContain(before[0]);

    // Not for me on one. It lapses; the other two are still there.
    await decide(me.userId, before[0]!, false);
    const after = await cardsOf(mine);
    expect(after).toHaveLength(2);
    expect(after).not.toContain(before[0]);
    // And it is gone from the other phone too, silently: nobody is told they were
    // passed on, and the card they had not answered yet simply is not there.
    expect(await cardsOf(theirs)).not.toContain(before[0]);
  });
});

describe('the queue', () => {
  it('returns at once, and a second tap is the same round', async () => {
    const { me } = await scene();
    const a = await enqueueRound(me);
    const b = await enqueueRound(me);
    expect(a.status).toBe('queued');
    expect(b.id).toBe(a.id);
    // Drain it, so the next test's worker tick is not spent on this round.
    await drainFor(me);
  });

  it('is drained by the worker, which writes the result back', async () => {
    const { me } = await scene();
    const q = await enqueueRound(me);
    const done = await drainFor(me);
    expect(done?.id).toBe(q.id);
    expect(done?.status).toBe('done');
    expect(done?.error).toBeNull();
    expect(done?.result?.metAll.length).toBe(CANDIDATES_PER_ROUND);
    // And with nothing queued the worker says so, rather than spinning.
    expect(await runOneQueuedRound()).toBe(false);
  });

  /**
   * THE DAY'S OPEN ROUNDS. What used to stop a second "send my agent out" was the
   * model budget, which a round spent; it spends none now, so nothing did, and one
   * person could put themselves in front of three new people every few seconds. The
   * limit is back as a count of rounds that met somebody (world.ts ROUNDS_PER_DAY).
   *
   * Negative control, run by hand: drop the open-round count in enqueueRound -> the
   * second tap is accepted (202) and this fails.
   */
  it(`refuses open round ${ROUNDS_PER_DAY + 1} in a day once they have met people, and spends nothing`, async () => {
    const { me } = await scene();
    // The first through the worker, so the count reads the result the worker really
    // writes; any others the setting allows, planted in the same shape.
    const first = await enqueueRound(me);
    const done = await drainFor(me);
    expect(done?.id).toBe(first.id);
    expect(done?.result?.metAll.length).toBe(CANDIDATES_PER_ROUND);
    for (let i = 1; i < ROUNDS_PER_DAY; i++) {
      await owner.query(
        `INSERT INTO rounds (user_id, tenant_id, status, finished_at, result)
         VALUES ($1,$2,'done', now(), $3)`, [me.userId, me.tenantId, JSON.stringify(done?.result)]);
    }

    const calls = stub.calls;
    const res = await datingRoutes.request('/v1/matches/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await tokenFor(me)}`, 'Content-Type': 'application/json',
                 'x-forwarded-for': '203.0.113.32' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'daily_rounds', limit: ROUNDS_PER_DAY });
    await expect(enqueueRound(me)).rejects.toBeInstanceOf(DailyRoundsExceeded);
    const { rows } = await owner.query<{ n: string }>('SELECT count(*) AS n FROM rounds WHERE user_id = $1', [me.userId]);
    expect(rows[0]!.n, 'no row for the refused tap').toBe(String(ROUNDS_PER_DAY));
    expect(stub.calls).toBe(calls);
  });

  it('lets a person ask again when the last round met nobody', async () => {
    // An empty square put nobody in front of anybody, so it is not the day's round.
    // (A round that FAILED is the same; round-release.test.ts asks again after one.)
    const tag = `empty-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const me = await person('alone', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const first = await enqueueRound(me);
    const done = await drainFor(me);
    expect(done?.id).toBe(first.id);
    expect(done?.status).toBe('done');
    expect(done?.result?.metAll).toEqual([]);
    const second = await enqueueRound(me);
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('queued');
    await drainFor(me);
  });

  it('only shows a person their own rounds', async () => {
    const { me } = await scene();
    const other = await person('other', { gender: 'man', seeking_gender: ['woman'] });
    await enqueueRound(me);
    const seen = await tenantSession(other, (c) => latestRound(c, other.userId));
    expect(seen).toBeNull();
    const { rows } = await tenantSession(other, (c) => c.query('SELECT count(*) AS n FROM rounds'));
    expect(Number((rows[0] as { n: string }).n)).toBe(0);
  });
});

describe('erasure', () => {
  it('takes the rounds with the person', async () => {
    const { me } = await scene();
    await enqueueRound(me);
    const { eraseUser } = await import('../src/memory/erasure.js');
    const r = await eraseUser(me);
    expect(r.verified).toBe(true);
    expect(r.deleted['rounds']).toBe(1);
  });
});

// Keep the matchmaker session import used: the worker's claim path runs through it.
void matchmakerSession;
