/**
 * The matcher, tested on the founder's own list — which is exactly why the schema
 * must not contain it.
 *
 * Everything he described is a row: "she should work on AI" is a preference with
 * strength 'strong', "must be fine with me eating beef" is one with strength
 * 'dealbreaker'. A user who wants the opposite of him is a different value in the same
 * column, not a different code path.
 *
 * The property under test is the one that decides whether the product works at all:
 * a long list of strong wants must RANK people, and a short list of dealbreakers must
 * be the only thing that EXCLUDES them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, tenantSession, matchSession, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { commit } from '../src/memory/facts.js';
import { rebuildMatchProfile, setPreference } from '../src/matching/profile.js';
import { candidateCount, candidateIds, poolBreakdown } from '../src/matching/candidates.js';
import { rank } from '../src/matching/score.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

async function makeUser(label: string) {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`m-${label}-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `m-${label}-${Date.now()}-${Math.random()}@example.test`]);
  return { tenantId, userId: u.rows[0]!.id };
}

const fact = (ctx: { tenantId: string; userId: string }, predicate: string, objectText: string) =>
  tenantSession(ctx, (c) =>
    commit(c, ctx, {
      predicate, objectText, stance: 'asserted', originClass: 'owner',
      sourceQuote: objectText, sourceEpisodeIds: [],
      extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }),
  );

/** Everything the five filters need, so somebody is actually in the pool. */
async function baseProfile(
  ctx: { tenantId: string; userId: string },
  o: { gender: string; seeking: string; birthYear: number; intent?: string },
) {
  await fact(ctx, 'gender', o.gender);
  await fact(ctx, 'seeking_gender', o.seeking);
  await fact(ctx, 'relationship_intent', o.intent ?? 'long term');
  await tenantSession(ctx, (c) =>
    commit(c, ctx, {
      predicate: 'birth_date', objectText: `${o.birthYear}`,
      objectValue: { year: o.birthYear, month: null },
      stance: 'asserted', originClass: 'owner', sourceQuote: 'born',
      sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }),
  );
  // Bangalore, with the vagueness a person actually gives.
  await tenantSession(ctx, (c) =>
    commit(c, ctx, {
      predicate: 'lives_in', objectText: 'Bangalore',
      objectValue: { city: 'bangalore', lat: 12.97, lon: 77.59, precision_km: 20 },
      stance: 'asserted', originClass: 'owner', sourceQuote: 'I live in Bangalore',
      sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }),
  );
  await tenantSession(ctx, (c) =>
    commit(c, ctx, {
      predicate: 'age_range_sought', objectText: '25 to 38',
      objectValue: { min: 25, max: 38 },
      stance: 'asserted', originClass: 'owner', sourceQuote: '25-38',
      sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }),
  );
  await tenantSession(ctx, (c) =>
    commit(c, ctx, {
      predicate: 'max_distance_km', objectText: '50km', objectValue: 50,
      stance: 'asserted', originClass: 'owner', sourceQuote: '50km',
      sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }),
  );
  await tenantSession(ctx, (c) => rebuildMatchProfile(c, ctx));
}

afterAll(async () => {
  for (const t of made) await owner.query('DELETE FROM tenants WHERE id = $1', [t]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('a profile only enters the pool once it can answer the five questions', () => {
  it('stays out while anything structural is missing, and enters when it is not', async () => {
    const ctx = await makeUser('partial');
    await fact(ctx, 'gender', 'man');
    let r = await tenantSession(ctx, (c) => rebuildMatchProfile(c, ctx));
    expect(r.inPool).toBe(false);
    expect(r.missing).toContain('seeking_gender');

    await baseProfile(ctx, { gender: 'man', seeking: 'woman', birthYear: 1994 });
    r = await tenantSession(ctx, (c) => rebuildMatchProfile(c, ctx));
    expect(r.inPool).toBe(true);
    expect(r.missing).toEqual([]);
  });
});

describe("the founder's list ranks instead of excluding", () => {
  it('puts the person who meets every want first, and still returns the one who does not', async () => {
    const me = await makeUser('knox');
    await baseProfile(me, { gender: 'man', seeking: 'woman', birthYear: 1994 });
    await fact(me, 'diet', 'omnivore');
    await fact(me, 'works_in', 'AI');
    await tenantSession(me, (c) => rebuildMatchProfile(c, me));

    // Everything he described, as preferences. STRONG, not dealbreakers -- each of
    // these as a filter would multiply his pool toward zero.
    for (const p of [
      { predicate: 'works_in', operator: 'in', value: ['ai'], strength: 'strong' as const },
      { predicate: 'exercise_habit', operator: 'in', value: ['often', 'daily'], strength: 'strong' as const },
      { predicate: 'nationality_origin', operator: 'not_in', value: ['india'], strength: 'mild' as const },
      { predicate: 'media_taste', operator: 'in', value: ['foreign-film'], strength: 'mild' as const },
    ]) {
      await tenantSession(me, (c) => setPreference(c, me, p));
    }
    // The ONE dealbreaker: someone who would judge him for what he eats.
    await tenantSession(me, (c) =>
      setPreference(c, me, {
        predicate: 'diet', operator: 'in',
        value: ['omnivore', 'no_pork', 'no_beef', 'pescatarian'],
        strength: 'dealbreaker',
        sourceQuote: "shouldn't hate me because I eat beef",
      }),
    );

    // A: everything he asked for.
    const ideal = await makeUser('ideal');
    await baseProfile(ideal, { gender: 'woman', seeking: 'man', birthYear: 1996 });
    await fact(ideal, 'diet', 'omnivore');
    await fact(ideal, 'works_in', 'AI');
    await fact(ideal, 'exercise_habit', 'daily');
    await fact(ideal, 'nationality_origin', 'USA');
    await fact(ideal, 'media_taste', 'foreign film');
    await tenantSession(ideal, (c) => rebuildMatchProfile(c, ideal));

    // B: local, different field, but nothing he rules out.
    const local = await makeUser('local');
    await baseProfile(local, { gender: 'woman', seeking: 'man', birthYear: 1995 });
    await fact(local, 'diet', 'omnivore');
    await fact(local, 'works_in', 'design');
    await fact(local, 'exercise_habit', 'rarely');
    await fact(local, 'nationality_origin', 'India');
    await tenantSession(local, (c) => rebuildMatchProfile(c, local));

    const ids = await matchSession((c) => candidateIds(c, me.userId));
    // THE POINT: the local woman is not deleted for being local, or for not working
    // in AI, or for not going to the gym.
    expect(ids).toContain(ideal.userId);
    expect(ids).toContain(local.userId);

    const ranked = await matchSession((c) => rank(c, me.userId, ids));
    expect(ranked[0]!.userId).toBe(ideal.userId);
    expect(ranked.map((r) => r.userId)).toContain(local.userId);
  });

  it('a dealbreaker, and only a dealbreaker, removes somebody', async () => {
    const me = await makeUser('knox2');
    await baseProfile(me, { gender: 'man', seeking: 'woman', birthYear: 1994 });
    await tenantSession(me, (c) =>
      setPreference(c, me, {
        predicate: 'diet', operator: 'in',
        value: ['omnivore', 'no_pork', 'no_beef', 'pescatarian'],
        strength: 'dealbreaker',
      }),
    );

    const vegan = await makeUser('vegan');
    await baseProfile(vegan, { gender: 'woman', seeking: 'man', birthYear: 1995 });
    await fact(vegan, 'diet', 'vegan');
    await tenantSession(vegan, (c) => rebuildMatchProfile(c, vegan));

    const ids = await matchSession((c) => candidateIds(c, me.userId));
    expect(ids).not.toContain(vegan.userId);
  });

  it('an unanswered field never counts as a mismatch', async () => {
    // The line that stops the pool emptying on day one. Six of the filter fields come
    // back null from an AI memory export by vendor policy, not by choice.
    const me = await makeUser('knox3');
    await baseProfile(me, { gender: 'man', seeking: 'woman', birthYear: 1994 });
    await tenantSession(me, (c) =>
      setPreference(c, me, {
        predicate: 'diet', operator: 'in', value: ['omnivore'], strength: 'dealbreaker',
      }),
    );

    const quiet = await makeUser('quiet');
    await baseProfile(quiet, { gender: 'woman', seeking: 'man', birthYear: 1996 });
    // Says nothing at all about diet.
    const ids = await matchSession((c) => candidateIds(c, me.userId));
    expect(ids).toContain(quiet.userId);
  });
});

describe('the pool counter makes over-filtering visible', () => {
  it('reports what each rule costs, so a person can see the damage', async () => {
    const me = await makeUser('counter');
    await baseProfile(me, { gender: 'man', seeking: 'woman', birthYear: 1994 });

    const steps = await matchSession((c) => poolBreakdown(c, me.userId));
    expect(steps[0]!.step).toBe('everyone');
    // Monotonic: a filter can only ever remove people.
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.remaining).toBeLessThanOrEqual(steps[i - 1]!.remaining);
      expect(steps[i]!.cost).toBeGreaterThanOrEqual(0);
    }
    expect(await matchSession((c) => candidateCount(c, me.userId)))
      .toBe(steps[steps.length - 1]!.remaining);
  });
});
