/**
 * A pool flag written before the five core cards existed must not send anybody out.
 *
 * WHAT WAS WRONG. The cards became a pool condition inside rebuildMatchProfile, and
 * `in_pool` is a stored flag. Everybody who set up before the cards kept
 * `in_pool = true` with no card on file -- measured 2026-09-23, read-only: all six
 * real users -- and two paths trusted that stored flag instead of rebuilding:
 *
 *   GET /v1/world         rebuilt only when the flag said no, so the Home showed a
 *                         working "send my agent out" button;
 *   POST /v1/matches/run  queued the round, and the worker read the same flag.
 *
 * So the contract's "a person missing a card is not sent out and is nobody's
 * candidate" held only for people who happened to open Matches, Profile or Chats,
 * the screens that rebuild. core-cards.test.ts (i) could not see it: its person
 * starts out of the pool and is rebuilt on every answer.
 *
 * THE FIX, pinned here: poolNow trusts a stored yes only while the five cards are on
 * file, both routes go through it, the tap answers 409 not_ready before any row, and
 * holdUntilCardsDone (scripts/hold-until-cards.ts) takes absent people out now.
 *
 * The planted person is the real users' exact shape: basics, consent, a stored
 * in_pool = true, and no question_answers for any card. Fixtures through the owner
 * pool; routes and role sessions are the real ones. No model is called anywhere on
 * these paths, and the stub throws if one is.
 *
 * Negative controls, run by hand 2026-09-23: world.ts back to trusting a stored yes
 * -> "the Home" fails (inPool true); dating.ts without the poolNow check -> "the tap"
 * fails (202 and a queued round); holdUntilCardsDone's card count removed -> "the
 * script" fails (it held the person with five cards too).
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  const no = async () => { throw new Error('no model on this path'); };
  return { ...real, decideModel: () => null, llm: { ...real.llm, complete: no, decide: no } };
});

const { pool, tenantSession, matchSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const { rebuildMatchProfile, holdUntilCardsDone } = await import('../src/matching/profile.js');
const { isCandidate } = await import('../src/matching/candidates.js');
const { worldRoutes } = await import('../src/api/world.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');
const { CORE, CORE_PREDICATES } = await import('../src/onboarding/questions.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

type Person = { tenantId: string; userId: string; token: string };

async function person(label: string): Promise<Person> {
  const tag = `sp-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

const fact = (p: Person, predicate: string, objectText: string, objectValue?: unknown) =>
  tenantSession(p, (c) =>
    commit(c, p, {
      predicate, objectText, ...(objectValue !== undefined ? { objectValue } : {}),
      stance: 'asserted', originClass: 'owner', sourceQuote: objectText, sourceEpisodeIds: [],
      extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }),
  );

/** Basics and consent, among real people only. Cards only when asked for. */
async function setUp(p: Person, o: { gender: string; seeking: string; cards: boolean }) {
  await owner.query(
    `INSERT INTO match_profile (user_id, tenant_id, in_pool, sees_synthetic) VALUES ($1,$2,false,false)`,
    [p.userId, p.tenantId]);
  const { REQUIRED } = await import('../src/api/consent.js');
  for (const r of REQUIRED) {
    await owner.query(
      `INSERT INTO consents (tenant_id, user_id, document, version) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [p.tenantId, p.userId, r.document, r.version]);
  }
  if (o.cards) {
    for (const id of CORE) {
      await owner.query(
        `INSERT INTO question_answers (tenant_id, user_id, question_id, answer, skipped)
         VALUES ($1,$2,$3,'{"values":[],"whoFine":{"anyone":true}}'::jsonb, true)`,
        [p.tenantId, p.userId, id]);
    }
  }
  await fact(p, 'gender', o.gender);
  await fact(p, 'seeking_gender', o.seeking);
  await fact(p, 'relationship_intent', 'long term');
  await fact(p, 'birth_date', '1995', { year: 1995, month: null });
  await fact(p, 'lives_in', 'Bangalore', { city: 'bangalore', lat: 12.97, lon: 77.59, precision_km: 20 });
  const r = await tenantSession(p, (c) => rebuildMatchProfile(c, p));
  expect(r.inPool, JSON.stringify(r.missing)).toBe(o.cards);
}

/**
 * The flag as it stood for the six real users: yes, written before the cards were a
 * condition. A rebuild of this person today would say no; the stored row says yes.
 */
const stale = (p: Person) =>
  owner.query('UPDATE match_profile SET in_pool = true WHERE user_id = $1', [p.userId]);

const storedInPool = async (p: Person) =>
  (await owner.query<{ in_pool: boolean }>('SELECT in_pool FROM match_profile WHERE user_id = $1', [p.userId]))
    .rows[0]!.in_pool;

const auth = (p: Person) => ({
  Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.51',
});

describe('a pool flag from before the cards', () => {
  it('the Home: shows the person out of the pool, with the cards to do', async () => {
    const me = await person('home');
    await setUp(me, { gender: 'man', seeking: 'woman', cards: false });
    await stale(me);

    const res = await worldRoutes.request('/v1/world', { headers: auth(me) });
    expect(res.status).toBe(200);
    const w = await res.json() as { me: { inPool: boolean; need: string[] }; pool: { total: number | null } };
    expect(w.me.inPool, 'the Home trusted a stored yes with no card on file').toBe(false);
    for (const p of CORE_PREDICATES) expect(w.me.need).toContain(p);
    // "Under 20", which an empty pool is (shownCount): never an exact small count.
    expect(w.pool.total).toBeNull();
    // And the stored flag is corrected, so everybody else's candidate query agrees.
    expect(await storedInPool(me)).toBe(false);
  });

  it('the Home: does not rebuild a person whose yes is current', async () => {
    // The Home is polled every eight seconds during a round. A yes with the five
    // cards on file is trusted as it was, not rebuilt on every poll.
    const me = await person('current');
    await setUp(me, { gender: 'woman', seeking: 'man', cards: true });
    await owner.query(`UPDATE match_profile SET rebuilt_at = '2020-01-01' WHERE user_id = $1`, [me.userId]);

    const res = await worldRoutes.request('/v1/world', { headers: auth(me) });
    const w = await res.json() as { me: { inPool: boolean } };
    expect(w.me.inPool).toBe(true);
    const { rows } = await owner.query<{ y: number }>(
      'SELECT extract(year FROM rebuilt_at)::int AS y FROM match_profile WHERE user_id = $1', [me.userId]);
    expect(rows[0]!.y, 'rebuilt on a read').toBe(2020);
  });

  it('the tap: refuses to send the agent out, before any round exists', async () => {
    const me = await person('tap');
    await setUp(me, { gender: 'man', seeking: 'woman', cards: false });
    await stale(me);

    const res = await datingRoutes.request('/v1/matches/run', {
      method: 'POST', headers: auth(me), body: JSON.stringify({}),
    });
    expect(res.status, 'a round was queued for a person with no card on file').toBe(409);
    const body = await res.json() as { error: string; need: string[]; missing: string[] };
    expect(body.error).toBe('not_ready');
    expect(body.need).toEqual([...CORE_PREDICATES]);
    // Words for the screen, never column names.
    for (const m of body.missing) expect(m).not.toMatch(/_/);

    const { rows } = await owner.query('SELECT 1 FROM rounds WHERE user_id = $1', [me.userId]);
    expect(rows, 'a refused tap still wrote a round').toHaveLength(0);
  });

  it('the script: takes an absent person out of other people\'s lists, and nobody else', async () => {
    const absent = await person('absent');
    await setUp(absent, { gender: 'man', seeking: 'woman', cards: false });
    await stale(absent);
    const seeker = await person('seeker');
    await setUp(seeker, { gender: 'woman', seeking: 'man', cards: true });

    const meets = (a: Person, b: Person) => matchSession((c) => isCandidate(c, a.userId, b.userId));
    // The hole: nobody opened anything, so the stale yes still stands.
    expect(await meets(seeker, absent)).toBe(true);
    const { rows: before } = await owner.query<{ t: string }>(
      'SELECT last_active_at::text AS t FROM match_profile WHERE user_id = $1', [absent.userId]);

    const c = await owner.connect();
    let held: string[];
    try {
      // Scoped to this test's people. Unscoped, it would reach the real users who
      // share this database, and a test must never write to them.
      const dry = await holdUntilCardsDone(c, { only: [absent.userId, seeker.userId], dry: true });
      expect(dry).toEqual([absent.userId]);
      expect(await storedInPool(absent), '--dry wrote').toBe(true);
      held = await holdUntilCardsDone(c, { only: [absent.userId, seeker.userId] });
    } finally {
      c.release();
    }

    expect(held).toEqual([absent.userId]);
    expect(await meets(seeker, absent), 'still a candidate with no card on file').toBe(false);
    expect(await storedInPool(seeker), 'held a person whose cards are done').toBe(true);
    // Not a heartbeat: a script run is not the person being here.
    const { rows: after } = await owner.query<{ t: string }>(
      'SELECT last_active_at::text AS t FROM match_profile WHERE user_id = $1', [absent.userId]);
    expect(after[0]!.t).toBe(before[0]!.t);
  });
});
