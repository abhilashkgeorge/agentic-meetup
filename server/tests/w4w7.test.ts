/**
 * W4 (profile gates, P2 contract), W6 (erasure, export), W7 (consolidation).
 * Model stubbed — runs with no key and no cost.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
// Type-only, so it is erased and does not defeat the vi.mock hoisting below.
import type { PoolClient } from 'pg';
import type { FactCandidate } from '../src/memory/facts.js';

const stub = vi.hoisted(() => ({
  parsed: {} as unknown,
  text: 'IDENTITY\n---\nSITUATION\n---\nPREFERENCES\n---\nOPEN_THREADS',
}));

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'anthropic:claude-sonnet-5',
  llm: {
    complete: async () => ({
      text: stub.text, parsed: stub.parsed,
      usage: {
        inputTokens: 500, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100,
        reasoningTokens: 0, provider: 'anthropic', modelId: 'claude-sonnet-5',
        costUsd: 0.002, latencyMs: 800,
      },
    }),
  },
}));

const { pool, tenantSession, adminSession, eraseSession, closeMatchPool } =
  await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const { promotableFacts, rebuildCoreProfile, coreProfileText } = await import('../src/memory/profile.js');
const { resolveConflicts } = await import('../src/memory/resolve.js');
const { eraseUser, exportUser } = await import('../src/memory/erasure.js');
const { consolidate } = await import('../src/memory/consolidate.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
let ctx = { tenantId: '', userId: '' };

const add = (predicate: string, objectText: string, over: Partial<FactCandidate> = {}) =>
  tenantSession(ctx, (c) =>
    commit(c, ctx, {
      predicate, objectText, stance: 'asserted', sourceQuote: 'test', sourceEpisodeIds: [],
      originClass: 'owner', extractorModel: 'test', extractorVersion: '0',
      promptVersion: '0', ...over,
    } as FactCandidate),
  );

async function freshUser() {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`w4-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id;
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `w4-${Date.now()}-${Math.random()}@example.test`]);
  return { tenantId, userId: u.rows[0]!.id };
}

beforeAll(async () => { ctx = await freshUser(); });
beforeEach(async () => {
  for (const t of ['facts', 'core_profile', 'memory_audit', 'fact_conflicts', 'directives']) {
    await owner.query(`DELETE FROM ${t} WHERE user_id = $1`, [ctx.userId]);
  }
});
afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

const forceUntrusted = (status: string) =>
  owner.query(
    `INSERT INTO facts (tenant_id, user_id, subject_entity_id, predicate, is_single_valued,
                        object_text, status, origin_class, stance, source_quote,
                        source_episode_ids, extractor_model, extractor_version, prompt_version)
     VALUES ($1,$2,$2,'works_at',true,'EvilCorp',$3,'untrusted','asserted','x','{}','t','0','0')`,
    [ctx.tenantId, ctx.userId, status],
  );

describe('W4 · gate G3 — untrusted content is excluded structurally', () => {
  // Two layers, tested separately, because either one alone has been enough to fail
  // in some published system. A passive "unverified" tag was measured leaking at
  // 0.52-0.77; structural exclusion leaked at 0.00.

  it('the database refuses to hold an untrusted fact in an active state at all', async () => {
    // Migration 0010. Not reachable through commit() either, but caller discipline is
    // not a defence -- the dating design adds two new untrusted writers, a friend
    // correcting your clone and a stranger's agent describing you.
    await expect(forceUntrusted('active')).rejects.toThrow(/facts_untrusted_never_active/);
  });

  it('an untrusted fact never reaches the profile, whatever state it is in', async () => {
    await add('lives_in', 'Berlin');
    await forceUntrusted('staged');
    const promotable = await tenantSession(ctx, (c) => promotableFacts(c, ctx.userId));
    expect(promotable.map((f) => f.objectText)).toContain('Berlin');
    expect(promotable.map((f) => f.objectText)).not.toContain('EvilCorp');
  });
});

describe('W4 · gate G2 — corroboration', () => {
  it('a soft fact seen once is active but not promoted; a hard fact is', async () => {
    await add('interest', 'bouldering');      // soft, corroboration 1
    await add('allergy', 'shellfish');        // hard, corroboration 1
    const p = await tenantSession(ctx, (c) => promotableFacts(c, ctx.userId));
    expect(p.map((f) => f.objectText)).toContain('shellfish');
    expect(p.map((f) => f.objectText)).not.toContain('bouldering');
  });

  it('a soft fact repeated independently becomes promotable', async () => {
    await add('interest', 'bouldering');
    await add('interest', 'bouldering'); // corroborates rather than duplicating
    const p = await tenantSession(ctx, (c) => promotableFacts(c, ctx.userId));
    expect(p.map((f) => f.objectText)).toContain('bouldering');
  });
});

describe('W4 · gate G5 — the loss rail', () => {
  it('rejects a rebuild that would drop more than a quarter of prior entries', async () => {
    for (const v of ['shellfish', 'penicillin', 'peanuts', 'latex']) await add('allergy', v);
    const first = await tenantSession(ctx, (c) => rebuildCoreProfile(c, ctx));
    expect(first.rebuilt).toBe(true);

    // Something upstream goes wrong and retracts most of them.
    await owner.query(
      `UPDATE facts SET status='retracted' WHERE user_id=$1 AND object_text <> 'latex'`,
      [ctx.userId],
    );
    const second = await tenantSession(ctx, (c) => rebuildCoreProfile(c, ctx));
    expect(second.rebuilt).toBe(false);
    expect(second.reason).toMatch(/G5/);

    // And the profile we already had survives untouched.
    expect(await tenantSession(ctx, (c) => coreProfileText(c, ctx.userId))).toContain('IDENTITY');
  });
});

describe('W4 · P2 — the model can never author a fact', () => {
  it('out-of-range indices are dropped, not clamped', async () => {
    stub.parsed = { duplicate_ids: [], contradicted_ids: [0, 99, -1], uncertain_ids: [] };
    const r = await resolveConflicts({
      tenantId: ctx.tenantId, userId: ctx.userId,
      existing: [{ id: 'aaaaaaaa-0000-0000-0000-000000000001', predicate: 'interest', objectText: 'chess' }],
      candidates: [{ predicate: 'interest', objectText: 'go' } as FactCandidate],
    });
    expect(r.contradictedIds).toEqual(['aaaaaaaa-0000-0000-0000-000000000001']);
  });

  it('a malformed response changes nothing', async () => {
    stub.parsed = { nonsense: true };
    const r = await resolveConflicts({
      tenantId: ctx.tenantId, userId: ctx.userId,
      existing: [{ id: 'aaaaaaaa-0000-0000-0000-000000000001', predicate: 'interest', objectText: 'chess' }],
      candidates: [{ predicate: 'interest', objectText: 'go' } as FactCandidate],
    });
    expect(r.contradictedIds).toEqual([]);
    expect(r.uncertainIds).toEqual([]);
  });
});

describe('W7 · consolidation never deletes', () => {
  it('merges duplicates by superseding, keeping the earliest', async () => {
    await add('interest', 'chess');
    await owner.query(
      `INSERT INTO facts (tenant_id, user_id, subject_entity_id, predicate, is_single_valued,
                          object_text, status, origin_class, stance, source_quote,
                          source_episode_ids, extractor_model, extractor_version, prompt_version)
       VALUES ($1,$2,$2,'interest',false,'  Chess  ','active','owner','asserted','x','{}','t','0','0')`,
      [ctx.tenantId, ctx.userId],
    );
    const r = await consolidate(ctx);
    expect(r.merged).toBe(1);

    const { rows } = await owner.query<{ status: string }>(
      'SELECT status FROM facts WHERE user_id = $1 AND predicate = $2', [ctx.userId, 'interest']);
    expect(rows).toHaveLength(2);                                   // nothing deleted
    expect(rows.filter((x) => x.status === 'active')).toHaveLength(1);
  });
});

describe('W6 · erasure', () => {
  it('removes every user row and verifies it, without tenant context', async () => {
    const victim = await freshUser();
    await tenantSession(victim, (c) =>
      commit(c, victim, {
        predicate: 'lives_in', objectText: 'Berlin', stance: 'asserted', sourceQuote: 'x',
        sourceEpisodeIds: [], originClass: 'owner', extractorModel: 't',
        extractorVersion: '0', promptVersion: '0',
      }),
    );
    await tenantSession(victim, (c) =>
      c.query(
        `INSERT INTO episodes (tenant_id, user_id, session_id, turn_id, turn_index, role,
                               source, raw_text, occurred_at)
         VALUES ($1,$2,gen_random_uuid(),gen_random_uuid(),0,'user','text','secret',now())`,
        [victim.tenantId, victim.userId],
      ),
    );

    const r = await eraseUser(victim);
    expect(r.verified).toBe(true);
    expect(r.remaining).toEqual([]);
    expect(r.deleted.facts).toBeGreaterThan(0);

    // Checked on the OWNER connection, which sees every row in the database. This
    // assertion used to run through `adminSession`, and passed for a reason that had
    // nothing to do with erasure: the app role with no tenant context matches no
    // policy, so it counts zero rows in every table whether or not anything was
    // deleted. Both the test and the verification it was checking were blind.
    const left = await owner.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM episodes WHERE user_id = $1', [victim.userId]);
    expect(left.rows[0]!.n).toBe(0);

    // The receipt survives the erasure — it is the evidence, and holds counts only.
    const receipt = await owner.query<{ verified: boolean }>(
      'SELECT verified FROM erasure_log WHERE user_id = $1', [victim.userId]);
    expect(receipt.rows[0]?.verified).toBe(true);
    await owner.query('DELETE FROM tenants WHERE id = $1', [victim.tenantId]);
  });

  it('verifies on a connection that can actually see rows', async () => {
    // The negative control for the test above. `verified: true` is only worth
    // something if `verified: false` was reachable, and for weeks it was not: the
    // verifier ran as the app role with no tenant context, every count came back zero,
    // and the result was a constant. This pins the difference between the two
    // connections so the blind one cannot quietly come back.
    const present = await freshUser();
    await tenantSession(present, (c) =>
      commit(c, present, {
        predicate: 'lives_in', objectText: 'Lisbon', stance: 'asserted', sourceQuote: 'x',
        sourceEpisodeIds: [], originClass: 'owner', extractorModel: 't',
        extractorVersion: '0', promptVersion: '0',
      }),
    );

    const count = async (run: <T>(fn: (c: PoolClient) => Promise<T>) => Promise<T>) => {
      const { rows } = await run((c) =>
        c.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM facts WHERE user_id = $1', [present.userId]));
      return rows[0]!.n;
    };

    // The row is there, and the old verifier could not see it.
    expect(await count(adminSession)).toBe(0);
    expect(await count(eraseSession)).toBeGreaterThan(0);

    await owner.query('DELETE FROM tenants WHERE id = $1', [present.tenantId]);
  });
});

describe('W6 · export', () => {
  it('includes supersession lineage, not just current beliefs', async () => {
    await add('lives_in', 'London');
    await add('lives_in', 'Berlin');
    const data = await tenantSession(ctx, (c) => exportUser(c, ctx.userId)) as
      { facts: { object_text: string; status: string; superseded_by_id: string | null }[] };
    expect(data.facts).toHaveLength(2);
    // What the system used to think is as much their data as what it thinks now.
    const old = data.facts.find((f) => f.object_text === 'London');
    expect(old?.status).toBe('superseded');
    expect(old?.superseded_by_id).not.toBeNull();
  });
});
