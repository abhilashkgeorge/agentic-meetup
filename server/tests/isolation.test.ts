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
