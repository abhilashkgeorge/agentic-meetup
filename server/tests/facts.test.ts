/**
 * W2 gate. The claim under test: when a fact changes, the old one stops being
 * asserted -- and no model decided that.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, tenantSession } from '../src/db/client.js';
import { env } from '../src/env.js';
import { commit, currentState, history, type FactCandidate } from '../src/memory/facts.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
let ctx = { tenantId: '', userId: '' };

const base: Omit<FactCandidate, 'predicate' | 'objectText'> = {
  stance: 'asserted',
  sourceQuote: 'test',
  sourceEpisodeIds: [],
  originClass: 'owner',
  extractorModel: 'test',
  extractorVersion: '0',
  promptVersion: '0',
};
const cand = (predicate: string, objectText: string, over: Partial<FactCandidate> = {}) =>
  ({ ...base, predicate, objectText, ...over }) as FactCandidate;

beforeAll(async () => {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`facts-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `facts-${Date.now()}@example.test`]);
  ctx = { tenantId, userId: u.rows[0]!.id };
});

beforeEach(async () => {
  // memory_audit is append-only by design, so it must be cleared here too or rows
  // from earlier tests leak into the audit assertion.
  await owner.query('DELETE FROM facts WHERE user_id = $1', [ctx.userId]);
  await owner.query('DELETE FROM memory_audit WHERE user_id = $1', [ctx.userId]);
});

afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
  await owner.end();
  await pool.end();
});

describe('single-valued supersession (gate G1)', () => {
  it('THE W2 GATE: moving city leaves exactly one active row and one superseded row', async () => {
    await tenantSession(ctx, (c) => commit(c, ctx, cand('lives_in', 'London')));
    const r = await tenantSession(ctx, (c) => commit(c, ctx, cand('lives_in', 'Berlin')));

    expect(r.outcome).toBe('superseded');

    const active = await tenantSession(ctx, (c) => currentState(c, ctx.userId, ['lives_in']));
    expect(active).toHaveLength(1);
    expect(active[0]?.objectText).toBe('Berlin');

    const all = await tenantSession(ctx, (c) => history(c, ctx.userId, 'lives_in'));
    expect(all).toHaveLength(2);
    const old = all.find((f) => f.objectText === 'London');
    expect(old?.status).toBe('superseded');
    expect(old?.validTo).not.toBeNull();
    expect(old?.supersededById).toBe(active[0]?.id); // lineage is walkable both ways
  });

  it('the DATABASE enforces it, not our code', async () => {
    // The load-bearing assertion. If application logic were the only guard, a future
    // code path that forgot to retire the old row would silently create two live
    // values -- exactly the mem0 #4956 failure ("I work at A" / "I now work at B" /
    // both coexist). The partial unique index makes that unrepresentable.
    await tenantSession(ctx, (c) => commit(c, ctx, cand('works_at', 'Acme')));
    await expect(
      tenantSession(ctx, (c) =>
        c.query(
          `INSERT INTO facts (tenant_id, user_id, subject_entity_id, predicate,
             is_single_valued, object_text, status, origin_class, stance,
             source_quote, source_episode_ids, extractor_model, extractor_version,
             prompt_version)
           VALUES ($1,$2,$2,'works_at',true,'Globex','active','owner','asserted',
                   'forged','{}','x','0','0')`,
          [ctx.tenantId, ctx.userId],
        ),
      ),
    ).rejects.toThrow(/facts_single_valued_current|duplicate key/i);
  });

  it('multi-valued predicates coexist', async () => {
    await tenantSession(ctx, (c) => commit(c, ctx, cand('interest', 'bouldering')));
    await tenantSession(ctx, (c) => commit(c, ctx, cand('interest', 'film photography')));
    const active = await tenantSession(ctx, (c) => currentState(c, ctx.userId, ['interest']));
    expect(active).toHaveLength(2);
  });

  it('restating a fact corroborates instead of superseding itself', async () => {
    await tenantSession(ctx, (c) => commit(c, ctx, cand('lives_in', 'Berlin')));
    const r = await tenantSession(ctx, (c) => commit(c, ctx, cand('lives_in', 'berlin')));
    expect(r.outcome).toBe('corroborated');
    const all = await tenantSession(ctx, (c) => history(c, ctx.userId, 'lives_in'));
    expect(all).toHaveLength(1);
    expect(all[0]?.corroborationCount).toBe(2);
  });
});

describe('stance gate (G4)', () => {
  it.each([
    ['hypothetical', 'I might move to Berlin'],
    ['hedged', 'I think I might be moving'],
    ['reported', 'my sister says I should move'],
  ] as const)('a %s statement never becomes a standing fact', async (stance, quote) => {
    await tenantSession(ctx, (c) => commit(c, ctx, cand('lives_in', 'London')));
    const r = await tenantSession(ctx, (c) =>
      commit(c, ctx, cand('lives_in', 'Berlin', { stance, hedgeSpan: quote, sourceQuote: quote })),
    );

    expect(r.outcome).toBe('staged');
    // The anti-trap assertion: the ORIGINAL fact must survive untouched.
    const active = await tenantSession(ctx, (c) => currentState(c, ctx.userId, ['lives_in']));
    expect(active).toHaveLength(1);
    expect(active[0]?.objectText).toBe('London');
  });

  it('preserves the hedge verbatim', async () => {
    await tenantSession(ctx, (c) =>
      commit(c, ctx, cand('works_at', 'Globex', { stance: 'hypothetical', hedgeSpan: 'I might' })),
    );
    const { rows } = await owner.query<{ hedge_span: string; status: string }>(
      'SELECT hedge_span, status FROM facts WHERE user_id = $1', [ctx.userId]);
    expect(rows[0]?.hedge_span).toBe('I might');
    expect(rows[0]?.status).toBe('staged');
  });
});

describe('vocabulary', () => {
  it('rejects a predicate outside the vocabulary', async () => {
    const r = await tenantSession(ctx, (c) => commit(c, ctx, cand('favourite_sandwich', 'reuben')));
    expect(r.outcome).toBe('rejected');
  });

  it('accepts the open tier as the sanctioned escape hatch', async () => {
    const r = await tenantSession(ctx, (c) => commit(c, ctx, cand('topic', 'the Gamecube')));
    expect(r.outcome).toBe('asserted');
  });
});

describe('audit', () => {
  it('records every mutation, including the supersession', async () => {
    await tenantSession(ctx, (c) => commit(c, ctx, cand('lives_in', 'London')));
    await tenantSession(ctx, (c) => commit(c, ctx, cand('lives_in', 'Berlin')));
    const { rows } = await owner.query<{ op: string }>(
      'SELECT op FROM memory_audit WHERE user_id = $1 ORDER BY id', [ctx.userId]);
    expect(rows.map((r) => r.op)).toEqual(['assert', 'supersede', 'assert']);
  });
});
