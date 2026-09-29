/**
 * "Really want" and "Nice to have" move people up the list a round takes (candidates.ts
 * FITS_MY_WANTS; the founder, 2026-09-29: "Make 'Really want' and 'Nice to have' actually
 * move real people up the list").
 *
 * WHAT WAS WRONG: the rules screen said soft rules "move people up the list", and nothing
 * read them but the recorded score. A round took real people first, then the most
 * recently active -- whatever anybody really wanted (docs 15.3 item 12).
 *
 * WHAT IS PINNED, on the real candidate query as the round runs it: among real people,
 * those who fit more of the looker's "Really want" (3) and "Nice to have" (1) come first;
 * an answer that does not fit, or no answer, counts nothing, and recency breaks the tie;
 * a retired rule counts nothing; real people still come before invented ones whatever
 * the invented ones fit.
 *
 * Negative control, run by hand and recorded in the commit: the ORDER BY without
 * FITS_MY_WANTS -> "come first" fails.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';

const { pool, matchmakerSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { candidateIds } = await import('../src/matching/candidates.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
const tag = `wf-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
interface P { tenantId: string; userId: string }

async function person(label: string, over: Record<string, unknown>): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`${tag}-${label}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}-${label}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, in_pool: true, is_synthetic: false, sees_synthetic: false,
    display_name: label, traits: {}, attribute_tags: [], intent: [tag], ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map((k) => (k === 'traits' ? JSON.stringify(cols[k]) : cols[k])));
  return { tenantId, userId };
}
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
async function rule(who: P, predicate: string, value: string[], strength: string, retired = false) {
  await owner.query(
    `INSERT INTO preferences (tenant_id, user_id, predicate, operator, value, strength, source_quote, retired_at)
     VALUES ($1,$2,$3,'in',$4,$5,'said so',$6)`,
    [who.tenantId, who.userId, predicate, JSON.stringify(value), strength, retired ? new Date() : null]);
}

afterAll(async () => {
  await owner.query('DELETE FROM preferences WHERE tenant_id = ANY($1)', [made]);
  await removeTenants(owner, made);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('the order a round takes people in', () => {
  it('puts real people who fit more of "Really want" and "Nice to have" first, and real before invented', async () => {
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], sees_synthetic: true });
    await rule(me, 'exercise_habit', ['often'], 'strong');
    await rule(me, 'sleep_pattern', ['early'], 'mild');
    await rule(me, 'sleep_pattern', ['late'], 'strong', true);   // retired: counts nothing

    // Most recent first, so recency alone gives the opposite of what they asked for.
    const none = await person('none', { last_active_at: ago(0) });
    const wrong = await person('wrong', { last_active_at: ago(30), traits: { exercise_habit: 'never', sleep_pattern: 'late' } });
    const mild = await person('mild', { last_active_at: ago(60), traits: { sleep_pattern: 'early' } });
    const strong = await person('strong', { last_active_at: ago(120), traits: { exercise_habit: 'often' } });
    const both = await person('both', { last_active_at: ago(180), traits: { exercise_habit: 'often', sleep_pattern: 'early' } });
    const invented = await person('invented', { is_synthetic: true, last_active_at: ago(0),
      traits: { exercise_habit: 'often', sleep_pattern: 'early' } });

    const order = (await matchmakerSession((c) => candidateIds(c, me.userId, 500)))
      .filter((id) => [none, wrong, mild, strong, both, invented].some((p) => p.userId === id));
    const name = new Map([[none, 'none'], [wrong, 'wrong'], [mild, 'mild'], [strong, 'strong'], [both, 'both'], [invented, 'invented']]
      .map(([p, n]) => [(p as P).userId, n as string]));
    expect(order.map((id) => name.get(id)), 'a round still took people by recency alone').toEqual(
      ['both', 'strong', 'mild', 'none', 'wrong', 'invented']);
  });
});
