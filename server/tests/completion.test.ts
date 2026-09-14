/**
 * The meter, and the three constraints it exists under.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, tenantSession } from '../src/db/client.js';
import { env } from '../src/env.js';
import { completion } from '../src/memory/completion.js';
import { commit, type FactCandidate } from '../src/memory/facts.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
let ctx = { tenantId: '', userId: '' };

const add = (predicate: string, objectText: string, over: Partial<FactCandidate> = {}) =>
  tenantSession(ctx, (c) =>
    commit(c, ctx, {
      predicate, objectText, stance: 'asserted', sourceQuote: 'test',
      sourceEpisodeIds: [], originClass: 'owner', extractorModel: 'test',
      extractorVersion: '0', promptVersion: '0', ...over,
    } as FactCandidate),
  );

beforeAll(async () => {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`comp-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `comp-${Date.now()}@example.test`]);
  ctx = { tenantId, userId: u.rows[0]!.id };
});

beforeEach(async () => {
  await owner.query('DELETE FROM facts WHERE user_id = $1', [ctx.userId]);
  await owner.query('DELETE FROM memory_audit WHERE user_id = $1', [ctx.userId]);
});

afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
  await owner.end();
  await pool.end();
});

describe('never zero-start', () => {
  it('a brand-new account is not 0%', async () => {
    // A 0% meter on the screen meant to make the product feel effortless is the
    // fastest way to lose someone.
    const c = await tenantSession(ctx, (db) => completion(db, ctx.userId));
    expect(c.score).toBeGreaterThan(0);
    expect(c.band).toBe('just met');
  });
});

describe('weighting: texture must not stand in for substance', () => {
  it('forty interests do not beat knowing where you live and work', async () => {
    for (let i = 0; i < 40; i++) await add('topic', `thing number ${i}`);
    const texture = await tenantSession(ctx, (db) => completion(db, ctx.userId));

    await owner.query('DELETE FROM facts WHERE user_id = $1', [ctx.userId]);
    for (const [p, v] of [
      ['lives_in', 'Berlin'], ['works_at', 'Acme'], ['job_title', 'engineer'],
      ['relationship_status', 'single'], ['full_name', 'A Person'],
    ]) await add(p!, v!);
    const substance = await tenantSession(ctx, (db) => completion(db, ctx.userId));

    // 200 topic facts must not max the meter while the agent still cannot say
    // where you live.
    expect(substance.score).toBeGreaterThan(texture.score);
  });

  it('score rises as durable coverage rises', async () => {
    const before = await tenantSession(ctx, (db) => completion(db, ctx.userId));
    await add('lives_in', 'Berlin');
    await add('works_at', 'Acme');
    const after = await tenantSession(ctx, (db) => completion(db, ctx.userId));
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.hardCovered).toBeGreaterThan(before.hardCovered);
  });
});

describe('one question, never a checklist', () => {
  it('asks for the most important missing thing', async () => {
    const c = await tenantSession(ctx, (db) => completion(db, ctx.userId));
    expect(c.nextQuestion?.predicate).toBe('preferred_name');
  });

  it('moves on once answered', async () => {
    await add('preferred_name', 'Knox');
    const c = await tenantSession(ctx, (db) => completion(db, ctx.userId));
    expect(c.nextQuestion?.predicate).toBe('lives_in');
  });

  it('stops asking when everything on the list is known', async () => {
    for (const [p, v] of [
      ['preferred_name', 'Knox'], ['lives_in', 'Berlin'], ['works_at', 'Acme'],
      ['job_title', 'engineer'], ['relationship_status', 'single'],
      ['allergy', 'shellfish'], ['dietary_restriction', 'none'], ['languages', 'English'],
      ['has_children', 'no'], ['grew_up_in', 'Kochi'], ['interest', 'bouldering'],
      ['value', 'honesty'], ['goal', 'ship it'], ['dealbreaker', 'dishonesty'],
    ]) await add(p!, v!);
    const c = await tenantSession(ctx, (db) => completion(db, ctx.userId));
    expect(c.nextQuestion).toBeNull();
  });
});

describe('staged imports are surfaced but not counted', () => {
  it('imported facts await confirmation and do not inflate the score', async () => {
    const before = await tenantSession(ctx, (db) => completion(db, ctx.userId));
    await add('lives_in', 'Berlin', { stance: 'reported', originClass: 'untrusted' });
    const after = await tenantSession(ctx, (db) => completion(db, ctx.userId));

    // An assistant's unverified claim is not knowledge of you.
    expect(after.score).toBe(before.score);
    expect(after.awaitingConfirmation).toBe(1);
  });
});
