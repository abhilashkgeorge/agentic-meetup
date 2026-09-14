/**
 * Nobody under eighteen.
 *
 * WHY THIS FILE EXISTS. There was no age check anywhere in this project: not in the
 * app, not in the API, not in the schema. Age was this year minus a stated birth year,
 * and pool entry asked only whether five fields were filled. The single occurrence of
 * "18" in the codebase constrained the age range somebody *sought*.
 *
 * Three locks, tested separately because they fail separately: the store refuses the
 * fact, the pool refuses the person, and the database refuses the row. Any one of them
 * can be broken by a plausible future edit without the other two noticing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { MIN_AGE, isAdult } from '@clone/shared';
import { pool, tenantSession } from '../src/db/client.js';
import { env } from '../src/env.js';
import { commit } from '../src/memory/facts.js';
import { rebuildMatchProfile } from '../src/matching/profile.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const YEAR = new Date().getUTCFullYear();

let ctx = { tenantId: '', userId: '' };

beforeAll(async () => {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`age-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `age-${Date.now()}@example.test`]);
  ctx = { tenantId, userId: u.rows[0]!.id };
});

afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
  await owner.end();
  await pool.end();
});

const birthYear = (year: number) => ({
  predicate: 'birth_date',
  objectText: String(year),
  objectValue: { year, month: null },
  stance: 'asserted' as const,
  originClass: 'owner' as const,
  sourceQuote: String(year),
  sourceEpisodeIds: [] as string[],
  extractorModel: 'test',
  extractorVersion: '1',
  promptVersion: 'test.1',
});

describe('the shared rule', () => {
  it('resolves an unknown month against the person, not for them', () => {
    // Exactly at the limit with no month: not yet. Refusing an eighteen-year-old for a
    // few months is recoverable; admitting a seventeen-year-old is not.
    expect(isAdult({ year: YEAR - MIN_AGE, month: null })).toBe(false);
    expect(isAdult({ year: YEAR - MIN_AGE - 1, month: null })).toBe(true);
    expect(isAdult({ year: YEAR - MIN_AGE + 1, month: null })).toBe(false);
  });

  it('is exact when the month is known', () => {
    const now = new Date(Date.UTC(YEAR, 5, 15)); // June
    expect(isAdult({ year: YEAR - MIN_AGE, month: 3 }, now)).toBe(true);
    expect(isAdult({ year: YEAR - MIN_AGE, month: 11 }, now)).toBe(false);
  });

  it('refuses a missing or malformed year rather than guessing', () => {
    expect(isAdult(null)).toBe(false);
    expect(isAdult(undefined)).toBe(false);
    expect(isAdult({ year: Number.NaN, month: null })).toBe(false);
  });
});

describe('the store', () => {
  it('refuses an under-age birth year whatever wrote it', async () => {
    const out = await tenantSession(ctx, (c) => commit(c, ctx, birthYear(YEAR - 15)));
    expect(out.outcome).toBe('rejected');
    expect(out.reason).toContain(String(MIN_AGE));
    expect(out.factId).toBeNull();
  });

  it('refuses it even when the value arrives only as text', async () => {
    // The extractor path: object_value is absent and the year is in the words.
    const { objectValue, ...textOnly } = birthYear(YEAR - 10);
    void objectValue;
    const out = await tenantSession(ctx, (c) => commit(c, ctx, textOnly));
    expect(out.outcome).toBe('rejected');
  });

  it('stores an adult year normally', async () => {
    const out = await tenantSession(ctx, (c) => commit(c, ctx, birthYear(YEAR - 30)));
    expect(out.outcome).not.toBe('rejected');
    expect(out.factId).not.toBeNull();
  });
});

describe('the pool', () => {
  it('will not admit an agent whose age is unknown', async () => {
    const fresh = await owner.query<{ id: string }>(
      'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
      [ctx.tenantId, `age-nobirth-${Date.now()}@example.test`]);
    const other = { tenantId: ctx.tenantId, userId: fresh.rows[0]!.id };
    const out = await tenantSession(other, (c) => rebuildMatchProfile(c, other));
    expect(out.inPool).toBe(false);
  });
});

describe('the database', () => {
  it('refuses an under-age row even when the application is bypassed entirely', async () => {
    // Written as the migration role, which is a superuser and ignores RLS. A CHECK is
    // the only lock that still holds here, which is exactly why it is worth having.
    await expect(
      owner.query(
        `INSERT INTO match_profile (user_id, tenant_id, age, in_pool)
         VALUES ($1, $2, 15, false)`,
        [ctx.userId, ctx.tenantId],
      ),
    ).rejects.toThrow(/match_profile_adults_only/);
  });
});
