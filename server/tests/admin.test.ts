/**
 * Somebody has to be able to read a report.
 *
 * `reports` has existed since migration 0024 and nothing in this codebase ever read
 * it -- no endpoint, no script, no query. A person could report somebody, the row was
 * written, and that was the end of it. A report button whose rows nobody reads is
 * worse than no report button: it tells the person something is being done.
 *
 * Photographs had the same shape of gap. Uploads are re-encoded, EXIF-stripped and
 * bomb-guarded, which covers the accidental cases and none of the deliberate ones,
 * and there was no way to take one down short of deleting the account.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { adminRoutes } from '../src/api/admin.js';
import { pool, tenantSession } from '../src/db/client.js';
import { env } from '../src/env.js';
import { hide, unhide } from '../src/photos/store.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

let tenantId = '';
let reviewerId = '';
let reporterId = '';
let reportedId = '';
let reportId = '';
let token = '';

async function person(tag: string): Promise<string> {
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}-${Date.now()}-${Math.round(performance.now())}@example.test`]);
  const id = u.rows[0]!.id;
  await owner.query(
    `INSERT INTO match_profile (user_id, tenant_id, age, in_pool) VALUES ($1,$2,30,true)`,
    [id, tenantId]);
  return id;
}

/** A real signed credential, so the routes run their actual auth path. */
async function credential(userId: string): Promise<string> {
  const { mintToken } = await import('../src/tokens.js');
  const s = await owner.query<{ id: string }>(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES (gen_random_uuid(), $1, $2, 'test', now() + interval '1 day') RETURNING id`,
    [tenantId, userId]);
  return mintToken(s.rows[0]!.id);
}

beforeAll(async () => {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`admin-${Date.now()}`]);
  tenantId = t.rows[0]!.id;
  reviewerId = await person('reviewer');
  reporterId = await person('reporter');
  reportedId = await person('reported');

  // Two photographs to take down.
  for (const slot of [0, 1]) {
    await owner.query(
      `INSERT INTO photos (tenant_id, user_id, position, width, height, bytes, sha256)
       VALUES ($1,$2,$3,800,1000,1234,$4)`,
      [tenantId, reportedId, slot, `sha-${slot}-${Date.now()}`]);
  }

  const r = await owner.query<{ id: string }>(
    `INSERT INTO reports (reporter_id, reported_id, reason, detail)
     VALUES ($1,$2,'harassment','said something vile') RETURNING id`,
    [reporterId, reportedId]);
  reportId = r.rows[0]!.id;

  env.ADMIN_USER_IDS = reviewerId;
  token = await credential(reviewerId);
});

afterEach(async () => {
  await owner.query('UPDATE photos SET hidden_at = NULL WHERE user_id = $1', [reportedId]);
  await owner.query(
    `UPDATE reports SET reviewed_at = NULL, outcome = NULL, review_note = '',
                        reviewed_by = NULL WHERE id = $1`, [reportId]);
  await owner.query('UPDATE match_profile SET in_pool = true WHERE user_id = $1', [reportedId]);
});

afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
  await owner.end();
  await pool.end();
});

/** How many of this person's photographs the product would actually serve. */
const seenBy = (viewer: string): Promise<number> =>
  tenantSession({ tenantId, userId: viewer }, async (c) => {
    const { rows } = await c.query('SELECT * FROM visible_photos($1,$1)', [reportedId]);
    return rows.length;
  });

const get = (path: string, bearer = token) =>
  adminRoutes.request(path, { headers: { Authorization: `Bearer ${bearer}` } });
const post = (path: string, body: unknown, bearer = token) =>
  adminRoutes.request(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('who may look', () => {
  it('shows the queue to a configured reviewer', async () => {
    const res = await get('/v1/admin/reports');
    expect(res.status).toBe(200);
    const body = await res.json() as { open: number; reports: { id: string }[] };
    expect(body.reports.some((r) => r.id === reportId)).toBe(true);
  });

  it('is invisible to an ordinary signed-in user — 404, not 403', async () => {
    // "There is no admin here" and "you are not it" must look identical from outside,
    // or the 403 itself tells an attacker the route is worth attacking.
    const res = await get('/v1/admin/reports', await credential(reporterId));
    expect(res.status).toBe(404);
  });

  it('is invisible with no credential at all', async () => {
    const res = await adminRoutes.request('/v1/admin/reports');
    expect(res.status).toBe(404);
  });

  it('is invisible when nobody is configured to review', async () => {
    const saved = env.ADMIN_USER_IDS;
    env.ADMIN_USER_IDS = '';
    try {
      expect((await get('/v1/admin/reports')).status).toBe(404);
    } finally {
      env.ADMIN_USER_IDS = saved;
    }
  });
});

describe('the queue', () => {
  it('carries the context a decision needs', async () => {
    const body = await (await get('/v1/admin/reports')).json() as {
      reports: { id: string; context: Record<string, number>; reporterKnown: boolean }[];
    };
    const mine = body.reports.find((r) => r.id === reportId)!;
    expect(mine.context.photos).toBe(2);
    expect(mine.context.photosHidden).toBe(0);
    expect(mine.context.distinctReporters).toBe(1);
    expect(mine.reporterKnown).toBe(true);
  });

  it('never hands the reviewer the reporter identity', async () => {
    // Anonymity for the reporter is the thing that makes reporting safe. The reviewer
    // needs to know a human sent it, not which human.
    const text = await (await get('/v1/admin/reports')).text();
    expect(text).not.toContain(reporterId);
  });
});

describe('acting on a report', () => {
  it('hides the photographs and closes the report in one call', async () => {
    const res = await post(`/v1/admin/reports/${reportId}`,
      { outcome: 'photos_hidden', note: 'clearly not their own face' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, photosHidden: 2 });

    const { rows } = await owner.query<{ n: string }>(
      'SELECT count(*) AS n FROM photos WHERE user_id = $1 AND hidden_at IS NOT NULL',
      [reportedId]);
    expect(Number(rows[0]!.n)).toBe(2);

    const after = await (await get('/v1/admin/reports?all=1')).json() as {
      reports: { id: string; outcome: string | null; note: string }[];
    };
    const mine = after.reports.find((r) => r.id === reportId)!;
    expect(mine.outcome).toBe('photos_hidden');
    expect(mine.note).toBe('clearly not their own face');
  });

  it('a hidden photograph stops being served to anybody', async () => {
    await hide(reportedId, 'test');
    // Asked the way the product asks: `visible_photos` is granted to the application
    // role and to nothing else, so the honest test is the owner's own session looking
    // at their own pictures -- which is the most permissive view there is.
    expect(await seenBy(reportedId)).toBe(0);
  });

  it('can be undone, because a decision nobody dares make is not made quickly', async () => {
    await hide(reportedId, 'test');
    expect(await unhide(reportedId)).toBe(2);
    expect(await seenBy(reportedId)).toBe(2);
  });

  it('blocking takes them out of the pool but never deletes them', async () => {
    await post(`/v1/admin/reports/${reportId}`, { outcome: 'account_blocked', note: 'repeat' });
    const { rows } = await owner.query<{ in_pool: boolean }>(
      'SELECT in_pool FROM match_profile WHERE user_id = $1', [reportedId]);
    expect(rows[0]!.in_pool).toBe(false);
    // The account survives: erasure is the person's own right, and deleting the
    // subject of a report destroys the evidence the report is about.
    const still = await owner.query('SELECT 1 FROM app_users WHERE id = $1', [reportedId]);
    expect(still.rowCount).toBe(1);
  });

  it('refuses an outcome the database would not accept', async () => {
    const res = await post(`/v1/admin/reports/${reportId}`, { outcome: 'deleted' });
    expect(res.status).toBe(400);
  });

  it('404s on a report that does not exist', async () => {
    const res = await post('/v1/admin/reports/00000000-0000-0000-0000-000000000000',
      { outcome: 'no_action' });
    expect(res.status).toBe(404);
  });
});
