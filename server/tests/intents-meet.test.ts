/**
 * Close "here for" answers meet (shared INTENTS_THAT_MEET; candidates.ts CLAUSES.intent;
 * the founder, 2026-10-01: "close ones meet").
 *
 * WHAT WAS WRONG: two people met only on the same answer. "What are you here for?" takes
 * one answer, so "Marriage" never met "Something long-term", and "Still working it out"
 * met only other people still working it out.
 *
 * WHAT IS PINNED, on the real candidate query as a round runs it: Marriage meets Marriage
 * and Long-term; Long-term meets Marriage and Still working it out; Still working it out
 * meets Long-term, Casual and Company; Casual and Company each meet Still working it out;
 * Marriage never meets Casual. Both ways, every pair. And a test's made-up intent tag still
 * meets only itself, which is how the rest of this suite keeps its scenes apart.
 *
 * Negative control, run by hand and recorded in the commit: the clause back to the overlap
 * alone (`a.intent && b.intent`) -> "who meets whom" fails.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';

const { pool, matchmakerSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { candidateIds } = await import('../src/matching/candidates.js');
const { intentsThatMeet, INTENTS_THAT_MEET } = await import('@clone/shared');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
const tag = `im-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Somebody in the pool with one intent, far out at sea so nobody else's scene is near. */
async function person(label: string, intent: string[]): Promise<string> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`${tag}-${label}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}-${label}@example.test`]);
  await owner.query(
    `INSERT INTO match_profile (user_id, tenant_id, age, gender, seeking_gender, lat, lon, max_distance_km,
                                in_pool, is_synthetic, sees_synthetic, display_name, traits, attribute_tags, intent)
     VALUES ($1,$2,30,'nonbinary',ARRAY['nonbinary'],-40.0,-30.0,25,true,false,false,$3,'{}'::jsonb,'{}',$4)`,
    [u.rows[0]!.id, tenantId, label, intent]);
  return u.rows[0]!.id;
}

afterAll(async () => {
  await removeTenants(owner, made);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('what you are here for', () => {
  it('is a symmetric rule in which Marriage never meets Casual', () => {
    for (const [a, b] of INTENTS_THAT_MEET) {
      expect(intentsThatMeet(a)).toContain(b);
      expect(intentsThatMeet(b)).toContain(a);
    }
    expect(intentsThatMeet('marriage')).toEqual(['marriage', 'long_term']);
    expect(intentsThatMeet('marriage')).not.toContain('casual');
  });

  it('decides who meets whom on the real candidate query, both ways', async () => {
    const ids = {
      marriage: await person('marriage', ['marriage']),
      marriage2: await person('marriage2', ['marriage']),
      long_term: await person('long_term', ['long_term']),
      undecided: await person('undecided', ['undecided']),
      casual: await person('casual', ['casual']),
      companionship: await person('companionship', ['companionship']),
      // A made-up tag, as the rest of the suite uses to keep scenes apart: meets nobody here.
      tagged: await person('tagged', [tag]),
    };
    const name = new Map(Object.entries(ids).map(([k, v]) => [v, k]));
    const meets = async (who: keyof typeof ids) =>
      (await matchmakerSession((c) => candidateIds(c, ids[who], 500)))
        .map((id) => name.get(id)).filter((n): n is string => Boolean(n)).sort();

    expect(await meets('marriage'), 'marriage').toEqual(['long_term', 'marriage2']);
    expect(await meets('long_term'), 'long-term').toEqual(['marriage', 'marriage2', 'undecided']);
    expect(await meets('undecided'), 'still working it out').toEqual(['casual', 'companionship', 'long_term']);
    expect(await meets('casual'), 'casual').toEqual(['undecided']);
    expect(await meets('companionship'), 'company').toEqual(['undecided']);
    expect(await meets('tagged'), 'a test tag').toEqual([]);
  });
});
