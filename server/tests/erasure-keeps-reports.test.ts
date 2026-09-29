/**
 * Reports against somebody outlive their account (0079; the founder, 2026-09-29:
 * "Deleting an account must keep the reports against that person").
 *
 * WHAT WAS WRONG: deleting the account took every report against it (0025's cascade,
 * and erasure deleted them too), so deleting your account wiped your record -- and
 * erasure frees your phone number, so you came back clean.
 *
 * WHAT IS PINNED, through the real erasure and the reviewer's real routes:
 *   - erased, the person's reports survive: reason and words intact, the account id off,
 *     their phone's key and handsets on, and when; the erasure still proves itself;
 *   - the reviewer sees them as "deleted", can close them, and cannot act on nobody;
 *   - back under the same phone, the kept reports point at the new account, count with
 *     its own, and a ban reaches it.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - the erasure deleting reports against the person again -> "survive" fails;
 *   - reported_now without the phone key                      -> "back under the same phone" fails;
 *   - the reviewer allowed to ban nobody                      -> "cannot act on nobody" fails.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';

const { pool, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { eraseUser } = await import('../src/memory/erasure.js');
const { adminRoutes } = await import('../src/api/admin.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
let tenantId = '';
const PHONE = `phone-key-${Date.now()}-${Math.random()}`;
const DEVICE = `device-key-${Date.now()}-${Math.random()}`.padEnd(24, 'x');
let reporter = '';
let reviewerToken = '';
let reportId = '';
let erasedId = '';

async function person(tag: string, phone: string | null = null): Promise<string> {
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email, phone_hmac) VALUES ($1,$2,$3) RETURNING id',
    [tenantId, `${tag}-${Date.now()}-${Math.random()}@example.test`, phone]);
  return u.rows[0]!.id;
}
async function session(userId: string, device: string | null = null): Promise<string> {
  const id = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at, device_hmac)
    VALUES ($1,$2,$3,'t', now() + interval '1 day', $4)`, [id, tenantId, userId, device]);
  return mintToken(id);
}
const queue = async () => (await (await adminRoutes.request('/v1/admin/reports?all=1', {
  headers: { Authorization: `Bearer ${reviewerToken}` },
})).json()) as { reports: { id: string; reportedId: string | null; reportedDeleted: boolean; cameBack: boolean; context: { reportsAgainstThem: number } }[] };
const decide = (outcome: string) => adminRoutes.request(`/v1/admin/reports/${reportId}`, {
  method: 'POST', headers: { Authorization: `Bearer ${reviewerToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ outcome }),
});

beforeAll(async () => {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`keep-reports-${Date.now()}`]);
  tenantId = t.rows[0]!.id;
  const reviewer = await person('reviewer');
  env.ADMIN_USER_IDS = reviewer;
  reviewerToken = await session(reviewer);
  reporter = await person('reporter');
  erasedId = await person('reported', PHONE);
  await session(erasedId, DEVICE);
  const r = await owner.query<{ id: string }>(
    `INSERT INTO reports (reporter_id, reported_id, reason, detail) VALUES ($1,$2,'harassment','threatened me') RETURNING id`,
    [reporter, erasedId]);
  reportId = r.rows[0]!.id;
});

afterAll(async () => {
  await owner.query('DELETE FROM bans WHERE report_id = $1', [reportId]);
  await owner.query('DELETE FROM reports WHERE id = $1', [reportId]);
  await removeTenants(owner, [tenantId]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('reports against somebody who deletes their account', () => {
  it('survive, with the account id off and the keys that know them again on', async () => {
    const r = await eraseUser({ tenantId, userId: erasedId });
    expect(r.verified, `erasure left rows in ${r.remaining.join(', ')}`).toBe(true);
    const { rows } = await owner.query<{
      reported_id: string | null; reason: string; detail: string; reporter_id: string | null;
      reported_phone_hmac: string | null; reported_device_hmacs: string[]; reported_deleted_at: Date | null;
    }>('SELECT * FROM reports WHERE id = $1', [reportId]);
    expect(rows, 'the report against them went with their account').toHaveLength(1);
    expect(rows[0]).toMatchObject({ reported_id: null, reason: 'harassment', detail: 'threatened me', reporter_id: reporter, reported_phone_hmac: PHONE });
    expect(rows[0]!.reported_device_hmacs).toContain(DEVICE);
    expect(rows[0]!.reported_deleted_at).not.toBeNull();
    const gone = await owner.query('SELECT 1 FROM app_users WHERE id = $1', [erasedId]);
    expect(gone.rows).toHaveLength(0);
  });

  it('shows the reviewer "deleted": it can be closed, and nobody can be acted on', async () => {
    const mine = (await queue()).reports.find((x) => x.id === reportId);
    expect(mine).toMatchObject({ reportedId: null, reportedDeleted: true, cameBack: false });
    expect(mine!.context.reportsAgainstThem).toBe(1);
    expect((await decide('banned')).status, 'a ban on nobody went through').toBe(409);
    expect((await decide('no_action')).status).toBe(200);
    await owner.query('UPDATE reports SET reviewed_at = NULL, outcome = NULL, reviewed_by = NULL WHERE id = $1', [reportId]);
  });

  it('points at them again when they come back under the same phone, and a ban reaches them', async () => {
    const back = await person('came-back', PHONE);
    const mine = (await queue()).reports.find((x) => x.id === reportId);
    expect(mine, 'lost the report').toBeDefined();
    expect(mine).toMatchObject({ reportedId: back, reportedDeleted: true, cameBack: true });
    expect(mine!.context.reportsAgainstThem).toBe(1);
    expect((await decide('banned')).status).toBe(200);
    const banned = await owner.query<{ b: boolean }>('SELECT is_banned($1) AS b', [back]);
    expect(banned.rows[0]!.b).toBe(true);
  });
});
