/**
 * A restatement that fills in a missing value.
 *
 * THE BUG, found by driving the app on a real phone. Onboarding's free-text step
 * ("I live in Bangalore and work at an ISP") runs the extractor, which commits
 * `lives_in = Bangalore` with NO structured value -- it does not geocode. The
 * essentials step then asks the city again, the server turns "Bangalore" into
 * coordinates, and commits `lives_in = Bangalore` a second time WITH them. commit()
 * saw the same word, called it corroboration, and dropped the coordinates on the
 * floor. The profile then showed "LIVES IN Bangalore" while the matcher said "it does
 * not know where you are", and the agent could never go out -- for anyone who typed a
 * city they had also mentioned in a sentence.
 *
 * The negative control is the whole point: revert the object_value line in commit()
 * and the first assertion fails with object_value still null.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, tenantSession, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { commit } from '../src/memory/facts.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

async function person(): Promise<{ tenantId: string; userId: string }> {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`enr-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `enr-${Date.now()}-${Math.random()}@example.test`]);
  return { tenantId, userId: u.rows[0]!.id };
}

const base = {
  stance: 'asserted' as const, originClass: 'owner' as const, sourceEpisodeIds: [],
  extractorModel: 't', extractorVersion: '0', promptVersion: '0',
};

describe('a value-less fact, restated with a value', () => {
  it('is filled in, not just corroborated', async () => {
    const ctx = await person();
    // 1. The extractor's version: the word, no coordinates.
    const first = await tenantSession(ctx, (c) => commit(c, ctx, {
      ...base, predicate: 'lives_in', objectText: 'Bangalore', sourceQuote: 'I live in Bangalore',
    }));
    expect(first.outcome).toBe('asserted');

    let { rows } = await owner.query<{ object_value: unknown; corroboration_count: number }>(
      'SELECT object_value, corroboration_count FROM facts WHERE id = $1', [first.factId]);
    expect(rows[0]!.object_value).toBeNull();

    // 2. The essentials version: same word, now with the coordinates the matcher needs.
    const second = await tenantSession(ctx, (c) => commit(c, ctx, {
      ...base, predicate: 'lives_in', objectText: 'Bangalore', sourceQuote: 'Bangalore',
      objectValue: { city: 'Bangalore', lat: 12.9716, lon: 77.5946, precision_km: 20 },
    }));
    expect(second.outcome).toBe('corroborated');
    expect(second.factId).toBe(first.factId);          // same row, not a new one

    ({ rows } = await owner.query(
      'SELECT object_value, corroboration_count FROM facts WHERE id = $1', [first.factId]));
    const v = rows[0]!.object_value as { lat?: number; lon?: number };
    expect(v?.lat).toBeCloseTo(12.9716, 4);            // THE FIX: coordinates landed
    expect(v?.lon).toBeCloseTo(77.5946, 4);
    expect(rows[0]!.corroboration_count).toBeGreaterThanOrEqual(1); // still corroboration
  });

  it('never lets a value-less restatement wipe a value already there', async () => {
    const ctx = await person();
    await tenantSession(ctx, (c) => commit(c, ctx, {
      ...base, predicate: 'lives_in', objectText: 'Mumbai', sourceQuote: 'Mumbai',
      objectValue: { city: 'Mumbai', lat: 19.076, lon: 72.8777, precision_km: 20 },
    }));
    // A later bare mention of the same city must not null the coordinates.
    await tenantSession(ctx, (c) => commit(c, ctx, {
      ...base, predicate: 'lives_in', objectText: 'Mumbai', sourceQuote: 'still in Mumbai',
    }));
    const { rows } = await owner.query<{ object_value: { lat?: number } }>(
      `SELECT object_value FROM facts WHERE user_id = $1 AND predicate = 'lives_in'
         AND status = 'active' AND valid_to IS NULL`, [ctx.userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.object_value?.lat).toBeCloseTo(19.076, 3);
  });
});
