/**
 * The trust surface, and the signal behind it.
 *
 * Three mechanisms shipped weeks ago, were tested, and were reachable by nothing:
 * confirmStagedFact and rejectStagedFact had no route (the app's Yes/No buttons
 * called router.push('/')), and markRetrieved was never called at all, so P4's
 * promotion-by-recall was ordering on a column that never moved off zero.
 *
 * These tests are about reachability. The mechanisms themselves are tested elsewhere.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, tenantSession } from '../src/db/client.js';
import { env } from '../src/env.js';
import { commit } from '../src/memory/facts.js';
import { factsTouchedBy, markRetrieved } from '../src/memory/retrieval.js';
import { openGaps, nextGap } from '../src/memory/gaps.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
let ctx = { tenantId: '', userId: '' };

beforeAll(async () => {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`know-${Date.now()}`]);
  ctx.tenantId = t.rows[0]!.id;
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [ctx.tenantId, `know-${Date.now()}@example.test`]);
  ctx.userId = u.rows[0]!.id;
});

beforeEach(async () => {
  for (const t of ['facts', 'fact_conflicts']) {
    await owner.query(`DELETE FROM ${t} WHERE user_id = $1`, [ctx.userId]);
  }
});

afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
  await owner.end();
  await pool.end();
});

const add = (predicate: string, objectText: string) =>
  tenantSession(ctx, (c) =>
    commit(c, ctx, {
      predicate, objectText, stance: 'asserted', originClass: 'owner',
      sourceQuote: `they said ${objectText}`, sourceEpisodeIds: [],
      extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }),
  );

describe('promotion by recall is actually fed', () => {
  it('finds the facts a message is about, and not the ones it is not', async () => {
    await add('works_at', 'Wifidabba');
    await add('allergy', 'shellfish');

    const hits = await tenantSession(ctx, (c) =>
      factsTouchedBy(c, ctx.userId, 'how is work at Wifidabba going'),
    );
    const rows = await owner.query<{ predicate: string }>(
      `SELECT predicate FROM facts WHERE id = ANY($1)`, [hits]);
    expect(rows.rows.map((r) => r.predicate)).toContain('works_at');
    expect(rows.rows.map((r) => r.predicate)).not.toContain('allergy');
  });

  it('counts a retrieval, so the promotion ordering has something to order on', async () => {
    await add('works_at', 'Wifidabba');
    await tenantSession(ctx, async (c) => {
      const hits = await factsTouchedBy(c, ctx.userId, 'tell me about Wifidabba');
      await markRetrieved(c, ctx.userId, hits);
    });
    const { rows } = await owner.query<{ retrieval_count: number }>(
      `SELECT retrieval_count FROM facts WHERE user_id = $1 AND predicate = 'works_at'`,
      [ctx.userId]);
    expect(rows[0]!.retrieval_count).toBe(1);
  });

  it('is a no-op on a message with nothing to match, rather than matching everything', async () => {
    await add('works_at', 'Wifidabba');
    const hits = await tenantSession(ctx, (c) => factsTouchedBy(c, ctx.userId, 'ok'));
    expect(hits).toEqual([]);
  });
});

describe('gaps are readable', () => {
  const gap = (q: string) =>
    owner.query(
      `INSERT INTO fact_conflicts (tenant_id, user_id, fact_a_id, kind, clarifying_question)
       VALUES ($1,$2,NULL,'gap',$3)`,
      [ctx.tenantId, ctx.userId, q]);

  it('lists what it is holding rather than guessing', async () => {
    await gap('Are you married?');
    const gaps = await tenantSession(ctx, (c) => openGaps(c, ctx.userId));
    expect(gaps.map((g) => g.question)).toContain('Are you married?');
  });

  it('offers the least-asked one first, so a round never repeats itself', async () => {
    await gap('Asked already?');
    await owner.query(
      `UPDATE fact_conflicts SET status='asked', asked_at=now() WHERE user_id=$1`, [ctx.userId]);
    await gap('Never asked?');
    const next = await tenantSession(ctx, (c) => nextGap(c, ctx.userId));
    expect(next?.question).toBe('Never asked?');
  });
});
