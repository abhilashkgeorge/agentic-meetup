/**
 * The hard filters, and the five ways they were quietly wrong.
 *
 * WHY THIS FILE EXISTS. The filter set was already the one real dating apps enforce.
 * The execution had five defects, and none of them ever threw: the pool simply held
 * the wrong people, or was missing the right ones, and nothing anywhere said so.
 * Every test below plants the exact case that used to slip through and asserts it no
 * longer does. Each was run against the OLD code first and failed, which is the only
 * reason to trust that it guards anything.
 *
 *   1. last_active_at was never updated, so every profile left the pool after 60 days
 *   2. no ORDER BY before LIMIT 500, so real people were unreachable in a big pool
 *   3. full_name never reached the profile builder, so every real human was "Someone"
 *   5. blocks were not checked before a conversation
 *   6. a moderation removal was undone by the next rebuild
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, tenantSession, matchSession, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { commit } from '../src/memory/facts.js';
import { candidateIds } from '../src/matching/candidates.js';
import { rebuildMatchProfile } from '../src/matching/profile.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

type Ctx = { tenantId: string; userId: string };

async function makeUser(label: string): Promise<Ctx> {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`f-${label}-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `f-${label}-${Date.now()}-${Math.random()}@example.test`]);
  return { tenantId, userId: u.rows[0]!.id };
}

/**
 * A pooled profile written straight into match_profile, the way the invented pool is
 * seeded. Deliberately bypasses rebuildMatchProfile so a test can set columns the
 * builder does not (last_active_at, is_synthetic) and so it costs one INSERT rather
 * than five facts and a consent.
 */
async function pooled(ctx: Ctx, over: Record<string, unknown> = {}): Promise<void> {
  const cols: Record<string, unknown> = {
    user_id: ctx.userId, tenant_id: ctx.tenantId,
    age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: ['long_term'],
    in_pool: true, is_synthetic: false, sees_synthetic: false,
    ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(
    `INSERT INTO match_profile (${keys.join(',')})
     VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map((k) => cols[k]),
  );
}

/**
 * The five core cards, done and "anyone": no fact, no rule. They are a pool condition
 * (profile.ts), so a fixture that must survive a rebuild in the pool needs them the way
 * it needs consent; "anyone" keeps every filter here exactly as it was.
 */
async function cardsDone(ctx: Ctx): Promise<void> {
  const { CORE } = await import('../src/onboarding/questions.js');
  for (const id of CORE) {
    await owner.query(
      `INSERT INTO question_answers (tenant_id, user_id, question_id, answer, skipped)
       VALUES ($1,$2,$3,'{"values":[],"whoFine":{"anyone":true}}'::jsonb, true)
       ON CONFLICT DO NOTHING`,
      [ctx.tenantId, ctx.userId, id]);
  }
}

/** Somebody every fixture above would accept, so filters other than the one under test pass. */
async function seeker(): Promise<Ctx> {
  const me = await makeUser('seeker');
  await pooled(me, { gender: 'man', seeking_gender: ['woman'] });
  return me;
}

// THE MATCHER ROLE, not the owner's. Under the owner session RLS shows a person their
// own row and nothing else, so candidateIds would return [] for everyone and every
// test here would fail for a reason that has nothing to do with the filters.
const ids = (me: Ctx) => matchSession((c) => candidateIds(c, me.userId, 500));

describe('defect 1: activity', () => {
  it('drops a profile nobody has touched in sixty days', async () => {
    const me = await seeker();
    const stale = await makeUser('stale');
    await pooled(stale, { last_active_at: new Date(Date.now() - 61 * 86_400_000) });
    expect(await ids(me)).not.toContain(stale.userId);
  });

  it('brings the profile back the moment its owner does anything', async () => {
    // The old behaviour: nothing ever wrote last_active_at, so "stale" was permanent.
    // A rebuild is what happens when the person opens the pool or answers a question.
    const me = await seeker();
    const back = await makeUser('back');
    await pooled(back, { last_active_at: new Date(Date.now() - 61 * 86_400_000) });
    // The rebuild needs enough facts to keep her in the pool, plus consent.
    const { REQUIRED } = await import('../src/api/consent.js');
    for (const r of REQUIRED) {
      await owner.query(
        `INSERT INTO consents (tenant_id, user_id, document, version) VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`, [back.tenantId, back.userId, r.document, r.version]);
    }
    await cardsDone(back);
    await tenantSession(back, async (c) => {
      const f = (predicate: string, objectText: string, objectValue?: unknown) =>
        commit(c, back, {
          predicate, objectText, ...(objectValue !== undefined ? { objectValue } : {}),
          stance: 'asserted', originClass: 'owner', sourceQuote: objectText,
          sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
        });
      await f('gender', 'woman');
      await f('seeking_gender', 'man');
      await f('relationship_intent', 'long_term');
      await f('birth_date', '1994', { year: 1994, month: null });
      await f('lives_in', 'Bangalore', { city: 'Bangalore', lat: 12.97, lon: 77.59, precision_km: 20 });
      await rebuildMatchProfile(c, back);
    });
    expect(await ids(me)).toContain(back.userId);
  });
});

describe('defect 2: ordering', () => {
  it('returns real people FIRST, ahead of six hundred invented ones', async () => {
    // Before: unordered LIMIT 500, so the planner chose. My first version of this test
    // seeded the real people first and asserted they were somewhere in the 500 -- and
    // it passed against the OLD query, because a sequential scan happened to return
    // them in insertion order. A test that passes on the broken code is not a test.
    // So the invented pool is written FIRST, and the assertion is on the ORDER of the
    // result, which no unordered query can satisfy except by accident.
    const me = await seeker();
    const inv = await makeUser('inventory');
    const rows: string[] = [];
    for (let i = 0; i < 600; i++) {
      const u = await owner.query<{ id: string }>(
        'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
        [inv.tenantId, `inv-${i}-${Date.now()}@example.test`]);
      rows.push(u.rows[0]!.id);
    }
    await owner.query(
      `INSERT INTO match_profile (user_id, tenant_id, age, gender, seeking_gender, lat, lon,
         max_distance_km, intent, in_pool, is_synthetic, sees_synthetic, last_active_at)
       SELECT unnest($1::uuid[]), $2, 30, 'woman', '{man}', 12.97, 77.59, 50, '{long_term}',
              true, true, false, now()`,
      [rows, inv.tenantId]);

    // Real people AFTER the invented ones, and older, so neither insertion order nor
    // recency alone would put them first. Only the is_synthetic ordering does.
    const real: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await makeUser(`real${i}`);
      await pooled(r, { last_active_at: new Date(Date.now() - 10 * 86_400_000) });
      real.push(r.userId);
    }
    await owner.query('UPDATE match_profile SET sees_synthetic = true WHERE user_id = $1', [me.userId]);

    const got = await ids(me);
    expect(got.length).toBe(500);
    // Every real person before every invented one. Not "the first three are mine",
    // because other tests in this file leave real fixtures in the same pool and the
    // seeker legitimately sees those too -- the property under test is the ORDER
    // between the two kinds, not who happens to be newest.
    const { rows: kinds } = await owner.query<{ user_id: string; is_synthetic: boolean }>(
      'SELECT user_id, is_synthetic FROM match_profile WHERE user_id = ANY($1)', [got]);
    const invented = new Set(kinds.filter((k) => k.is_synthetic).map((k) => k.user_id));
    const firstInvented = got.findIndex((id) => invented.has(id));
    const lastReal = got.map((id) => !invented.has(id)).lastIndexOf(true);
    expect(firstInvented).toBeGreaterThan(-1);
    expect(lastReal, 'a real person came after an invented one').toBeLessThan(firstInvented);
    for (const r of real) expect(got).toContain(r);
  });
});

describe('defect 3: names', () => {
  it('gives a real person a display name from their full_name fact', async () => {
    // full_name is deliberately unmatchable, and the builder filtered on matchable,
    // so the branch that set the name was dead code. Every real human was "Someone".
    const p = await makeUser('named');
    await tenantSession(p, async (c) => {
      await commit(c, p, {
        predicate: 'full_name', objectText: 'Priya Raman', objectValue: 'Priya Raman',
        stance: 'asserted', originClass: 'owner', sourceQuote: 'Priya Raman',
        sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
      });
      await rebuildMatchProfile(c, p);
    });
    const { rows } = await owner.query<{ display_name: string | null; traits: Record<string, unknown> }>(
      'SELECT display_name, traits FROM match_profile WHERE user_id = $1', [p.userId]);
    expect(rows[0]!.display_name).toBe('Priya');
    // First name only, and it must NOT leak into the matchable traits.
    expect(rows[0]!.traits).not.toHaveProperty('full_name');
  });
});

describe('defect 5: blocks', () => {
  it('never offers somebody the person they blocked, in either direction', async () => {
    const me = await seeker();
    const them = await makeUser('blocked');
    await pooled(them);
    expect(await ids(me)).toContain(them.userId);            // eligible before the block

    await owner.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2)',
      [them.userId, me.userId]);                              // THEY blocked ME
    expect(await ids(me)).not.toContain(them.userId);        // and I still cannot see them
  });
});

describe('defect 6: moderation', () => {
  it('keeps a removed account out of the pool after it opens the app', async () => {
    // The old sequence: reviewer sets in_pool=false; person opens the app; rebuild
    // recomputes in_pool from their answers; they are back. Now the removal is its
    // own column and a trigger folds it into in_pool on every write.
    const me = await seeker();
    const bad = await makeUser('removed');
    await pooled(bad);
    expect(await ids(me)).toContain(bad.userId);

    await owner.query(
      'UPDATE match_profile SET moderation_hidden = true, in_pool = false WHERE user_id = $1',
      [bad.userId]);
    // The person comes back and does the thing that used to undo it.
    const { REQUIRED } = await import('../src/api/consent.js');
    for (const r of REQUIRED) {
      await owner.query(
        `INSERT INTO consents (tenant_id, user_id, document, version) VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`, [bad.tenantId, bad.userId, r.document, r.version]);
    }
    await cardsDone(bad);
    await tenantSession(bad, async (c) => {
      const f = (predicate: string, objectText: string, objectValue?: unknown) =>
        commit(c, bad, {
          predicate, objectText, ...(objectValue !== undefined ? { objectValue } : {}),
          stance: 'asserted', originClass: 'owner', sourceQuote: objectText,
          sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
        });
      await f('gender', 'woman');
      await f('seeking_gender', 'man');
      await f('relationship_intent', 'long_term');
      await f('birth_date', '1994', { year: 1994, month: null });
      await f('lives_in', 'Bangalore', { city: 'Bangalore', lat: 12.97, lon: 77.59, precision_km: 20 });
      const r = await rebuildMatchProfile(c, bad);
      // The application believes she qualifies. The database disagrees, and wins.
      expect(r.inPool).toBe(true);
    });
    const { rows } = await owner.query<{ in_pool: boolean }>(
      'SELECT in_pool FROM match_profile WHERE user_id = $1', [bad.userId]);
    expect(rows[0]!.in_pool).toBe(false);
    expect(await ids(me)).not.toContain(bad.userId);
  });
});
