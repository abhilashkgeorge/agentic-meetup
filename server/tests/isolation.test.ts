/**
 * The contract test. Ship this before anything else, re-run it on every dependency
 * bump, and treat a failure as a stop-the-line event.
 *
 * Every engine surveyed for this project fails this test at its defaults:
 * Graphiti's group_ids=None searches every tenant and validate_group_ids(None)
 * returns true; Memobase with an unset ACCESS_TOKEN treats every bearer as root;
 * Agno unscoped falls back to a client-supplied user_id; Hermes derives a session id
 * from a hash of the first message, so two users who both say "hi" share a transcript.
 *
 * The failure mode is always silent. That is why this is a test and not a review item.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, tenantSession } from '../src/db/client.js';
import { env } from '../src/env.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

let A = { tenantId: '', userId: '' };
let B = { tenantId: '', userId: '' };

async function seed(name: string): Promise<{ tenantId: string; userId: string }> {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id',
    [name],
  );
  const tenantId = t.rows[0]!.id;
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1, $2) RETURNING id',
    [tenantId, `${name}@example.test`],
  );
  return { tenantId, userId: u.rows[0]!.id };
}

beforeAll(async () => {
  A = await seed(`iso-a-${Date.now()}`);
  B = await seed(`iso-b-${Date.now()}`);
  for (const [i, ctx] of [A, B].entries()) {
    await tenantSession(ctx, (c) =>
      c.query(
        `INSERT INTO episodes (tenant_id, user_id, session_id, turn_id, turn_index,
                               role, source, raw_text, occurred_at)
         VALUES ($1,$2,gen_random_uuid(),gen_random_uuid(),0,'user','text',$3,now())`,
        [ctx.tenantId, ctx.userId, `secret belonging to user ${i}`],
      ),
    );
  }
});

afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [[A.tenantId, B.tenantId]]);
  await owner.end();
  await pool.end();
});

describe('tenant isolation', () => {
  it('the app role cannot bypass RLS', async () => {
    // If this fails, every other assertion in this file is vacuous: a BYPASSRLS or
    // superuser role makes the policies decorative.
    const { rows } = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  it('a query with no tenant context returns nothing', async () => {
    // current_setting(..., true) is NULL when unset, so the policy fails CLOSED.
    const { rows } = await pool.query('SELECT * FROM episodes');
    expect(rows).toHaveLength(0);
  });

  it('user A sees only user A rows', async () => {
    const rows = await tenantSession(A, async (c) =>
      (await c.query<{ raw_text: string }>('SELECT raw_text FROM episodes')).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.raw_text).toContain('user 0');
  });

  it('user A cannot read user B rows even by naming B explicitly', async () => {
    const rows = await tenantSession(A, async (c) =>
      (await c.query('SELECT raw_text FROM episodes WHERE user_id = $1', [B.userId])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it('user A cannot forge a row owned by user B', async () => {
    await expect(
      tenantSession(A, (c) =>
        c.query(
          `INSERT INTO episodes (tenant_id, user_id, session_id, turn_id, turn_index,
                                 role, source, raw_text, occurred_at)
           VALUES ($1,$2,gen_random_uuid(),gen_random_uuid(),1,'user','text','forged',now())`,
          [B.tenantId, B.userId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('auth can resolve a user before any tenant context exists', async () => {
    // Regression: this was impossible until migration 0004. app_users is under RLS
    // keyed on tenant_id, and authentication is what ESTABLISHES tenant context, so
    // it necessarily runs with none set. Every request 401'd.
    const { authLookup } = await import('../src/db/client.js');
    const row = await authLookup(A.userId, async (c) =>
      (await c.query('SELECT id, tenant_id FROM app_users WHERE id = $1', [A.userId])).rows[0],
    );
    expect(row).toBeDefined();
    expect((row as { tenant_id: string }).tenant_id).toBe(A.tenantId);
  });

  it('the auth lookup cannot enumerate — it only ever matches the row it names', async () => {
    const { authLookup } = await import('../src/db/client.js');
    // Naming A must not expose B, and an unfiltered select must return only A.
    const rows = await authLookup(A.userId, async (c) =>
      (await c.query('SELECT id FROM app_users')).rows,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { id: string }).id).toBe(A.userId);
  });

  it('every partition is locked, not just the parent table', async () => {
    // THE BUG THIS EXISTS FOR. `facts` and `episodes` are hash-partitioned 32 ways.
    // Migrations 0001 and 0002 enabled RLS and wrote the isolation policy on the
    // PARENT and stopped there -- and a parent's policies apply only to rows reached
    // THROUGH the parent. Naming a partition directly reached every tenant's rows:
    //
    //     as clone_app, correct context set:
    //       SELECT count(*) FROM facts     -->   1
    //       SELECT count(*) FROM facts_p4  --> 115
    //
    // Every assertion above this one is about the parent, so none of them saw it.
    // Fixed in 0035; this is here so it cannot come back the next time somebody adds
    // a partitioned table or restores from a dump that carries the old grants.
    const { rows: parts } = await owner.query<{ part: string }>(
      `SELECT c.relname AS part
         FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent IN ('facts'::regclass, 'episodes'::regclass)
        ORDER BY c.relname`,
    );
    expect(parts.length).toBe(64);

    const reachable: string[] = [];
    for (const { part } of parts) {
      // A partition must be unreachable by name: either the privilege is gone or the
      // policy filters it to nothing. Both are acceptable answers; a row is not.
      try {
        const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${part}`);
        const n = (rows[0] as { n: number }).n;
        if (n > 0) reachable.push(`${part} returned ${n} rows`);
      } catch (err) {
        const message = (err as { message?: string }).message ?? '';
        if (!/permission denied/i.test(message)) throw err;
      }
    }

    expect(
      reachable,
      `these partitions leak across tenants when named directly:\n${reachable.join('\n')}`,
    ).toEqual([]);
  });

  it('a partition still carries its own policy, not only a revoked grant', async () => {
    // Belt and braces, tested separately because they fail independently. If a future
    // migration restores the grant -- a GRANT ALL, a dump/restore -- the policy has to
    // be what stops the read. Checked in the catalogue because the grant is currently
    // gone, so a query cannot tell the two mechanisms apart.
    const { rows } = await owner.query<{ part: string; rls: boolean; policies: number }>(
      `SELECT c.relname AS part, c.relrowsecurity AS rls,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent IN ('facts'::regclass, 'episodes'::regclass)`,
    );
    const bad = rows
      .filter((r) => !r.rls || r.policies === 0)
      .map((r) => `${r.part}: rls=${r.rls} policies=${r.policies}`);
    expect(bad, `partitions with no second lock:\n${bad.join('\n')}`).toEqual([]);
  });

  it('tenant context does not leak to the next user of a pooled connection', async () => {
    // The exact bug this whole discipline exists to prevent: a plain `SET` would
    // persist for the life of the pooled backend and the next borrower would inherit
    // it. set_config(..., true) is transaction-local, so it cannot.
    await tenantSession(A, async (c) => {
      await c.query('SELECT 1 FROM episodes');
    });
    const { rows } = await pool.query('SELECT * FROM episodes');
    expect(rows).toHaveLength(0);
  });
});
