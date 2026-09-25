/**
 * The last four filter defects. Like the first five, none of these ever threw.
 *
 *   4. a fifth of every ranking score was a constant zero, read from a column nothing wrote
 *   7. a dealbreaker on a predicate that never reaches traits excluded nobody, silently
 *   8. retired dealbreakers still excluded people under one role and not the other
 *   9. the ranker issued one query per preference per candidate per direction
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool, tenantSession, matchSession, matchmakerSession, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { candidateIds } from '../src/matching/candidates.js';
import { rank } from '../src/matching/score.js';
import { setPreference, PreferenceCannotFilter } from '../src/matching/profile.js';
import { canFilterOn } from '@clone/shared';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

type Ctx = { tenantId: string; userId: string };

async function person(label: string, over: Record<string, unknown> = {}): Promise<Ctx> {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`fr-${label}-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `fr-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: ['long_term'],
    in_pool: true, is_synthetic: false, sees_synthetic: false,
    traits: JSON.stringify({ smoking: 'never', diet: 'vegetarian' }),
    attribute_tags: ['interest:climbing'],
    ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(
    `INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map((k) => cols[k]));
  return { tenantId, userId };
}

/** Source with comments stripped, so a guard reads the code and not the explanation of it. */
const src = (f: string) =>
  readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('defect 4: the value term', () => {
  it('is gone, and the two that remain are the old weights renormalised', () => {
    const s = src('matching/score.ts');
    expect(s).not.toMatch(/value_sim/);
    expect(s).not.toMatch(/value_vec/);
    expect(s).toContain('0.6875 * forward.score + 0.3125 * overlap');
  });

  it('still scores a pair, in range, with nothing in the dropped column', async () => {
    const tag = `t-${Date.now()}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const them = await person('them', { intent: [tag] });
    const ranked = await matchSession((c) => rank(c, me.userId, [them.userId]));
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(0);
    expect(ranked[0]!.score).toBeLessThanOrEqual(1);
  });
});

describe('defect 7: dealbreakers that cannot filter', () => {
  it('knows which predicates reach the traits the filter tests', () => {
    expect(canFilterOn('smoking')).toBe(true);
    expect(canFilterOn('wants_children')).toBe(true);
    // Routed to their own columns, never in traits.
    expect(canFilterOn('lives_in')).toBe(false);
    expect(canFilterOn('birth_date')).toBe(false);
    expect(canFilterOn('age_range_sought')).toBe(false);
    expect(canFilterOn('max_distance_km')).toBe(false);
    // The faith card (2026-09-25) gave `religion` a value shape: its partner row is a
    // rule tested like any card's (core-cards.test.ts "the faith card").
    expect(canFilterOn('religion')).toBe(true);
    // Matchable, but no value shape, so never an object_value, so never in traits.
    expect(canFilterOn('industry')).toBe(false);
  });

  it('REFUSES to store a dealbreaker that would exclude nobody', async () => {
    const me = await person('refuse');
    await expect(tenantSession(me, (c) => setPreference(c, me, {
      predicate: 'lives_in', operator: 'equals', value: 'Bangalore', strength: 'dealbreaker',
    }))).rejects.toBeInstanceOf(PreferenceCannotFilter);
    // The same rule as a soft preference is fine: it only moves people up or down.
    await tenantSession(me, (c) => setPreference(c, me, {
      predicate: 'lives_in', operator: 'equals', value: 'Bangalore', strength: 'strong',
    }));
    // And a dealbreaker on something the filter CAN test is fine.
    await tenantSession(me, (c) => setPreference(c, me, {
      predicate: 'smoking', operator: 'in', value: ['never'], strength: 'dealbreaker',
    }));
  });
});

describe('defect 8: retired dealbreakers', () => {
  it('no longer exclude anybody under the role that actually sends the agent out', async () => {
    const tag = `t-${Date.now()}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const them = await person('smoker', { intent: [tag], traits: JSON.stringify({ smoking: 'daily' }) });

    // A live dealbreaker excludes them under BOTH roles.
    await tenantSession(me, (c) => setPreference(c, me, {
      predicate: 'smoking', operator: 'in', value: ['never'], strength: 'dealbreaker',
    }));
    expect(await matchSession((c) => candidateIds(c, me.userId))).not.toContain(them.userId);
    expect(await matchmakerSession((c) => candidateIds(c, me.userId))).not.toContain(them.userId);

    // Retire it. Before 0052 + the clause, the matcher role stopped excluding (its
    // policy hides retired rows) while the matchmaker role kept excluding (its policy
    // is USING true). The count said one thing and the round did another.
    await owner.query('UPDATE preferences SET retired_at = now() WHERE user_id = $1', [me.userId]);
    expect(await matchSession((c) => candidateIds(c, me.userId))).toContain(them.userId);
    expect(await matchmakerSession((c) => candidateIds(c, me.userId))).toContain(them.userId);
  });
});

describe('defect 9: one query per preference', () => {
  it('evaluates every preference for a candidate in ONE statement', () => {
    // A behavioural test cannot see query counts without instrumenting the pool, so
    // this asserts the shape: the predicate function is called through unnest over
    // arrays, not inside a loop.
    const s = src('matching/score.ts');
    expect(s).toMatch(/FROM unnest\(\$1::int\[\], \$2::text\[\], \$3::jsonb\[\], \$4::jsonb\[\]\)/);
    const loopCall = /for \(const p of prefs\) \{[\s\S]{0,400}?await c\.query/.exec(s);
    expect(loopCall, 'a query is being issued inside the per-preference loop again').toBeNull();
  });

  it('gets the same answer as before for a mixed set of preferences', async () => {
    const tag = `t-${Date.now()}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const them = await person('them', { intent: [tag], traits: JSON.stringify({ smoking: 'never', diet: 'omnivore', drinking: 'often' }) });
    await tenantSession(me, async (c) => {
      await setPreference(c, me, { predicate: 'smoking', operator: 'in', value: ['never'], strength: 'strong' });   // met, 3
      await setPreference(c, me, { predicate: 'diet', operator: 'in', value: ['vegetarian'], strength: 'mild' }); // missed, 1
      await setPreference(c, me, { predicate: 'drinking', operator: 'in', value: ['often'], strength: 'mild' });  // met, 1
      await setPreference(c, me, { predicate: 'drugs', operator: 'in', value: ['never'], strength: 'mild' });     // unknown, skipped
    });
    // The other direction too, or `common` -- the MIN across both -- is zero and the
    // shrinkage below wipes the score. My first version forgot this and blamed the
    // scorer for a 0 that was the test's own doing.
    await tenantSession(them, (c) =>
      setPreference(c, them, { predicate: 'smoking', operator: 'in', value: ['never'], strength: 'mild' }));
    const [r] = await matchSession((c) => rank(c, me.userId, [them.userId]));
    expect(r!.met.sort()).toEqual(['drinking', 'smoking']);
    expect(r!.missed).toEqual(['diet']);
    expect(r!.common).toBe(1);   // min(3 forward, 1 backward)
  });
});
