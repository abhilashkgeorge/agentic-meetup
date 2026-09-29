/**
 * "Felt unsafe" and "photos weren't them" outlive an account, tied to the phone (0083;
 * the founder, 2026-09-29).
 *
 * WHAT WAS WRONG: the after-date answers went with the pair when either account was
 * deleted, so deleting the account and signing up again with the same phone wiped the
 * answers the reviewer's flags turn on.
 *
 * WHAT IS PINNED, through the real erasure and the reviewer's real route:
 *   - deleting an account keeps every "felt unsafe" and "photos: no" answer about it, and
 *     the ones it gave about others (without its name) -- and nothing else;
 *   - back under the same phone, the kept answers count for the new account on the
 *     reviewer's flags; an answer given about somebody still here counts for them;
 *   - an answerer deleting their own account takes their name off, not the answer;
 *   - no application role can read the kept answers.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - erasure without keeping them            -> "keeps every ... answer" fails;
 *   - identity_flags without the kept answers -> "counted again" fails;
 *   - erasure without taking the name off     -> "takes their name off" fails (the
 *                                                erasure no longer proves itself).
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
const made: string[] = [];
interface P { tenantId: string; userId: string; token: string }
const stamp = `${Date.now()}-${Math.random()}`;
const RAVI_PHONE = `phone-ravi-${stamp}`;
const PRIYA_PHONE = `phone-priya-${stamp}`;

async function person(label: string, phone: string | null = null): Promise<P> {
  const tag = `kf-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email, phone_hmac) VALUES ($1,$2,$3) RETURNING id',
    [tenantId, `${tag}@example.test`, phone]);
  const userId = u.rows[0]!.id;
  await owner.query(`INSERT INTO match_profile (user_id, tenant_id, age, in_pool, is_synthetic) VALUES ($1,$2,30,false,false)`,
    [userId, tenantId]);
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
    VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}
/** `by` met `about` and answered the check-in about them. */
async function checkin(by: P, about: P, answers: Record<string, string>, feltSafe: boolean): Promise<void> {
  const [lo, hi] = by.userId < about.userId ? [by, about] : [about, by];
  const r = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status)
     VALUES ($1,$2,$3,$4,0,'introduced') RETURNING id`, [lo.userId, hi.userId, lo.tenantId, hi.tenantId]);
  await owner.query(`INSERT INTO date_checkins (rendezvous_id, for_user, about_user, met, answers, felt_safe, see_again)
    VALUES ($1,$2,$3,true,$4,$5,false)`, [r.rows[0]!.id, by.userId, about.userId, JSON.stringify(answers), feltSafe]);
}
const kept = async (phone: string) => (await owner.query<{ for_user: string | null; felt_unsafe: boolean; photos_not_them: boolean }>(
  'SELECT for_user, felt_unsafe, photos_not_them FROM kept_checkin_flags WHERE about_phone_hmac = $1 ORDER BY answered_at', [phone])).rows;
const flags = async () => (await (await adminRoutes.request('/v1/admin/flags', {
  headers: { Authorization: `Bearer ${reviewer.token}` },
})).json() as { flags: { aboutId: string; noPhotos: number; unsafe: number }[] }).flags;

let reviewer: P, ravi: P, asha: P, meena: P, lata: P, priya: P;
beforeAll(async () => {
  reviewer = await person('reviewer');
  env.ADMIN_USER_IDS = reviewer.userId;
  ravi = await person('ravi', RAVI_PHONE);
  [asha, meena, lata] = await Promise.all(['asha', 'meena', 'lata'].map((l) => person(l)));
  priya = await person('priya', PRIYA_PHONE);
  await checkin(asha!, ravi, { photos: 'yes', age: 'yes' }, false);   // felt unsafe
  await checkin(meena!, ravi, { photos: 'no', age: 'yes' }, true);    // photos weren't him
  await checkin(lata!, ravi, { photos: 'yes', age: 'unsure' }, true); // nothing to keep
  await checkin(ravi, priya, { photos: 'yes' }, false);                 // he felt unsafe with her
});
afterAll(async () => {
  await owner.query('DELETE FROM kept_checkin_flags WHERE about_phone_hmac = ANY($1)', [[RAVI_PHONE, PRIYA_PHONE]]);
  await removeTenants(owner, made);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('the after-date safety answers, when an account is deleted', () => {
  it('keeps every "felt unsafe" and "photos: no" answer about it, and those it gave -- and nothing else', async () => {
    expect((await eraseUser({ tenantId: ravi.tenantId, userId: ravi.userId })).verified).toBe(true);
    expect(await kept(RAVI_PHONE), 'the answers about him went with his account').toEqual([
      { for_user: asha.userId, felt_unsafe: true, photos_not_them: false },
      { for_user: meena.userId, felt_unsafe: false, photos_not_them: true },
    ]);
    expect(await kept(PRIYA_PHONE), 'the answer he gave went with his account').toEqual([
      { for_user: null, felt_unsafe: true, photos_not_them: false },
    ]);
  });

  it('counts them again for whoever comes back under the phone, and for somebody still here', async () => {
    const back = await person('ravi-again', RAVI_PHONE);
    const all = await flags();
    expect(all.find((f) => f.aboutId === back.userId), 'his new account came back clean')
      .toMatchObject({ unsafe: 1, noPhotos: 1 });
    expect(all.find((f) => f.aboutId === priya.userId)).toMatchObject({ unsafe: 1 });
  });

  it('takes an answerer\'s name off when they delete their own account, not the answer', async () => {
    expect((await eraseUser({ tenantId: asha.tenantId, userId: asha.userId })).verified).toBe(true);
    expect((await kept(RAVI_PHONE))[0]).toEqual({ for_user: null, felt_unsafe: true, photos_not_them: false });
  });

  it('cannot be read by any application role', async () => {
    for (const role of ['clone_app', 'clone_match', 'clone_matchmaker', 'clone_door', 'clone_discovery']) {
      const { rows } = await owner.query<{ ok: boolean }>(
        "SELECT has_table_privilege($1, 'kept_checkin_flags', 'SELECT') AS ok", [role]);
      expect(rows[0]!.ok, role).toBe(false);
    }
  });
});
