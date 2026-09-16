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
 * The model is stubbed. Nothing here costs money, and the verdicts are scripted so a
 * test can assert what happens to a pair the agents did NOT like -- which is the case
 * that used to vanish.
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
const { enqueueRound, runOneQueuedRound, latestRound } = await import('../src/matching/rounds.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

// A round is real time even with the model stubbed: converse() sleeps 1.5s between
// its five runs to stay under the free tier's rate limit, and a round is three of
// them. Vitest's five-second default is not a test failure, it is a stopwatch.
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

  it('writes a brief for a pair the agents did NOT like', async () => {
    // The case that used to vanish. Every assessor says no; the pair must still get a
    // rendezvous row, an agreement of 0, a brief, and NOT the 'lapsed' status.
    const { me } = await scene();
    stub.verdicts = [{ verdict: 'no', learned: ['a', 'b', 'c'], concern: 'too quiet' }];
    const r = await runRound(me.userId);
    expect(r.passed).toBe(false);

    const { rows } = await owner.query<{ status: string; agreement: number; briefs: string }>(
      `SELECT r.status, r.agreement,
              (SELECT count(*) FROM rendezvous_briefs b WHERE b.rendezvous_id = r.id) AS briefs
         FROM rendezvous r WHERE r.user_a = $1 OR r.user_b = $1`, [me.userId]);
    expect(rows.length).toBe(CANDIDATES_PER_ROUND);
    for (const row of rows) {
      expect(row.status).not.toBe('lapsed');
      expect(Number(row.agreement)).toBe(0);
      expect(Number(row.briefs)).toBe(2);
    }
  });

  it('records what the ranker thought as well as what the conversation thought', async () => {
    const { me } = await scene();
    stub.verdicts = [{ verdict: 'yes', learned: ['a', 'b', 'c'], concern: 'none really' }];
    await runRound(me.userId);
    const { rows } = await owner.query<{ rank_score: number | null; agreement: number | null }>(
      'SELECT rank_score, agreement FROM rendezvous WHERE user_a = $1 OR user_b = $1', [me.userId]);
    for (const row of rows) {
      expect(row.rank_score).not.toBeNull();
      expect(Number(row.agreement)).toBe(1);
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
  it('is ordered by how the agents got on, and a no brings up the next', async () => {
    const { me } = await scene();
    // Scripted so the three pairs get different agreement rates. Verdicts are
    // consumed two per run (one assessor each side), five runs per pair, in order:
    // pair 1 all yes, pair 2 mixed, pair 3 all no.
    const yes = { verdict: 'yes', learned: ['a', 'b', 'c'], concern: 'x' };
    const no = { verdict: 'no', learned: ['a', 'b', 'c'], concern: 'x' };
    stub.verdicts = [
      ...Array(10).fill(yes),                                  // pair 1: 5/5
      yes, yes, yes, yes, no, no, no, no, no, no,              // pair 2: 2/5
      ...Array(10).fill(no),                                   // pair 3: 0/5
    ];
    const r = await runRound(me.userId);
    expect(r.metAll.length).toBe(3);

    const list = async () => (await tenantSession(me, (c) => c.query<{ id: string; agreement: number; other: string }>(
      `SELECT r.id, r.agreement,
              CASE WHEN r.user_a = $1 THEN r.user_b ELSE r.user_a END AS other
         FROM rendezvous r
         JOIN rendezvous_briefs b ON b.rendezvous_id = r.id AND b.for_user = $1
        WHERE (r.user_a = $1 OR r.user_b = $1) AND r.status <> 'lapsed'
        ORDER BY r.agreement DESC NULLS LAST, r.rank_score DESC NULLS LAST`, [me.userId]))).rows;

    const before = await list();
    expect(before.map((x) => Number(x.agreement))).toEqual([1, 0.4, 0]);
    expect(before[0]!.other).toBe(r.metAll[0]);

    // Not for me on the head. It lapses, and the next is the head.
    await decide(me.userId, before[0]!.id, false);
    const after = await list();
    expect(after.map((x) => Number(x.agreement))).toEqual([0.4, 0]);
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

  it('lets a person ask again once the previous round is finished', async () => {
    const { me } = await scene();
    const first = await enqueueRound(me);
    await drainFor(me);
    const second = await enqueueRound(me);
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('queued');
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
