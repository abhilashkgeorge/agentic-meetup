/**
 * A ban holds against the phone number and the phone, not only the account.
 *
 * WHAT THE FOUNDER ASKED FOR (build list item 4): "Bans that stick (phone number +
 * device); a new SIM on the same phone can't get back in."
 *
 * WHAT WAS WRONG: 0064's ban named an account, and none of the doors that make one
 * (invite redeem, phone verify, the dev device signup, the legacy upgrade) asked about
 * bans at all. A new SIM and a fresh invite was a fresh start; so was the same number
 * once the account had been erased, because erasure takes the ban's user away.
 *
 * WHAT IS PINNED HERE, every door exercised through the real routes:
 *   - the handset is recorded by the door the person signed in through, and the ban
 *     holds against it: a new number in the same phone is turned away;
 *   - the banned number is turned away on a new phone;
 *   - a new number on a new phone is somebody else, and is let in (not over-blocking);
 *   - the reviewer's own phone is never marked, even when the banned account was used
 *     on it (the founder testing a ban on his own handset must not lock himself out);
 *   - the invite is not spent on a banned person;
 *   - the ban outlives the real erasure of the account;
 *   - in production a door with no handset id is refused; in development it is not;
 *   - a legacy token of a banned person stops working (it skipped is_banned).
 *
 * Negative controls, run 2026-09-25, each restored byte-identical:
 *   - atTheDoor() answering "not banned" always     -> new SIM, reviewer, invite and
 *                                                      erasure tests fail (4)
 *   - ban_user without the device marks (function   -> "new SIM in the same phone" and
 *     replaced on the dev database, restored)         the invite test fail
 *   - ban_user without the reviewer exclusion        -> "never marks the reviewer's
 *     (same way)                                       phone" fails
 *   - verify's session insert without device_hmac    -> "new SIM in the same phone" and
 *                                                      "record the phone" fail
 *   - fromLegacy without is_banned                   -> "legacy token" fails
 *   - the production rule switched off               -> "in production refuse" fails
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real,
    decideModel: () => null,
    llm: {
      ...real.llm,
      complete: async () => { throw new Error('no model in this test'); },
      decide: async () => { throw new Error('no model in this test'); },
    },
  };
});

const { pool, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { authRoutes } = await import('../src/api/auth.js');
const { adminRoutes } = await import('../src/api/admin.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { codeHmac, deviceMark, phoneHmac } = await import('../src/phone.js');
const { resetLimits } = await import('../src/ratelimit.js');
const { mintInviteCode, mintToken, newSessionId } = await import('../src/tokens.js');
const { eraseUser } = await import('../src/memory/erasure.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const tenants: string[] = [];
const phones: string[] = [];
const bans: string[] = [];
const codes: string[] = [];

beforeEach(() => { resetLimits(); });

afterAll(async () => {
  // Bans are kept by design, so a test's own are removed by hand: they would otherwise
  // hold against the made-up numbers and handsets below for ever.
  if (bans.length) await owner.query('DELETE FROM bans WHERE id = ANY($1)', [bans]);
  if (codes.length) await owner.query('DELETE FROM invites WHERE code = ANY($1)', [codes]);
  if (tenants.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [tenants]);
  if (phones.length) {
    await owner.query('DELETE FROM phone_challenges WHERE phone_hmac = ANY($1)', [phones.map(phoneHmac)]);
  }
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

let n = 0;
const run = `${Date.now() % 1e9}`;
/** Numbers in the range set aside for fiction; never anybody's. */
const freshPhone = (): string => `+1555${String(Date.now() % 1000000 + n++).padStart(7, '0')}`;
/** A handset id shaped like ANDROID_ID, unique to this run. */
const handset = (label: string): string => `${label}${run}${n++}`.replace(/[^a-z0-9]/gi, '').padEnd(16, '0').slice(0, 32);

type Person = { tenantId: string; userId: string; token: string; phone: string };

/** An account with a number and a session made on `on` (or on no known handset). */
async function account(on?: string): Promise<Person> {
  const phone = freshPhone();
  phones.push(phone);
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`bs-${run}-${n++}`]);
  const tenantId = t.rows[0]!.id;
  tenants.push(tenantId);
  const u = await owner.query<{ id: string }>(
    `INSERT INTO app_users (tenant_id, email, phone_hmac, phone_verified_at) VALUES ($1,$2,$3, now()) RETURNING id`,
    [tenantId, `bs-${run}-${n++}@example.test`, phoneHmac(phone)]);
  const userId = u.rows[0]!.id;
  // OUT OF THE POOL, WITH ITS OWN INTENT TAG. These people only need a profile for the
  // ban to hide; in the pool with no intent they matched ANYBODY (an empty intent
  // overlaps every other, candidates.ts), so round tests running alongside met them.
  await owner.query(`INSERT INTO match_profile (user_id, tenant_id, age, in_pool, intent) VALUES ($1,$2,30,false,$3)`,
    [userId, tenantId, [`bs-${run}`]]);
  return { tenantId, userId, phone, token: await session({ tenantId, userId }, on) };
}
async function session(p: { tenantId: string; userId: string }, on?: string): Promise<string> {
  const id = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at, device_hmac)
     VALUES ($1,$2,$3,'t', now() + interval '30 days', $4)`,
    [id, p.tenantId, p.userId, on ? deviceMark(on) : null]);
  return mintToken(id);
}

/** A live challenge for `phone` with a code we chose -- the row /start writes. */
async function challenge(phone: string, opts: { verified?: boolean } = {}): Promise<string> {
  phones.push(phone);
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO phone_challenges (phone_hmac, code_hmac, attempts, expires_at, verified_at)
     VALUES ($1,'pending',0, now() + interval '5 minutes', CASE WHEN $2 THEN now() END) RETURNING id`,
    [phoneHmac(phone), opts.verified ?? false]);
  const id = rows[0]!.id;
  await owner.query('UPDATE phone_challenges SET code_hmac = $2 WHERE id = $1', [id, codeHmac(id, '424242')]);
  return id;
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  authRoutes.request(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });

/** "Here is the code", from a phone. What came back, in short. */
async function verify(phone: string, on: string | null) {
  const id = await challenge(phone);
  const res = await post('/v1/auth/phone/verify', { challengeId: id, code: '424242', label: 't' },
    on ? { 'X-Device-Id': on } : {});
  const body = await res.json() as { status?: string; error?: string };
  return { http: res.status, said: body.status ?? body.error };
}

async function ban(reviewer: Person, who: Person): Promise<void> {
  const saved = env.ADMIN_USER_IDS;
  env.ADMIN_USER_IDS = reviewer.userId;
  try {
    const res = await adminRoutes.request(`/v1/admin/users/${who.userId}/ban`, {
      method: 'POST', headers: { Authorization: `Bearer ${reviewer.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'test ban' }),
    });
    expect(res.status).toBe(200);
  } finally {
    env.ADMIN_USER_IDS = saved;
  }
  const { rows } = await owner.query<{ id: string }>('SELECT id FROM bans WHERE user_id = $1', [who.userId]);
  bans.push(...rows.map((r) => r.id));
}

describe('a ban holds against the number and the phone', () => {
  it('turns away a new SIM in the same phone, and the same number on a new phone', async () => {
    const R = handset('reviewer');
    const H1 = handset('bad');
    const H2 = handset('other');
    const reviewer = await account(R);
    const bad = await account();

    // They sign in on H1 through the real door, which records the handset.
    expect(await verify(bad.phone, H1)).toEqual({ http: 200, said: 'signed_in' });
    await ban(reviewer, bad);

    expect(await verify(freshPhone(), H1), 'a new SIM in the banned phone got in')
      .toEqual({ http: 403, said: 'closed' });
    expect(await verify(bad.phone, H2), 'the banned number got in on a new phone')
      .toEqual({ http: 403, said: 'closed' });
    // Somebody else entirely: a new number on a new phone is let in.
    expect(await verify(freshPhone(), H2)).toEqual({ http: 200, said: 'needs_invite' });
  });

  it('never marks the reviewer\'s own phone, even if the banned account was used on it', async () => {
    const R = handset('founder');
    const reviewer = await account(R);
    const test = await account(R); // a test account made on the founder's own phone
    await ban(reviewer, test);
    expect(await verify(freshPhone(), R)).toEqual({ http: 200, said: 'needs_invite' });
    // And the ban still holds against the test account's number.
    expect(await verify(test.phone, handset('elsewhere'))).toEqual({ http: 403, said: 'closed' });
  });

  it('does not spend an invite on a banned person', async () => {
    const H1 = handset('redeem');
    const reviewer = await account(handset('rev'));
    const bad = await account(H1);
    await ban(reviewer, bad);

    const code = mintInviteCode();
    codes.push(code);
    await owner.query(`INSERT INTO invites (code, created_by, note, expires_at) VALUES ($1,$2,'t', now() + interval '1 day')`,
      [code, reviewer.userId]);
    const ticket = await challenge(freshPhone(), { verified: true });

    const saved = env.ALLOW_UNVERIFIED_SIGNUP;
    env.ALLOW_UNVERIFIED_SIGNUP = false;
    try {
      const res = await post('/v1/auth/redeem', { code, label: 't', ticket }, { 'X-Device-Id': H1 });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe('closed');
    } finally {
      env.ALLOW_UNVERIFIED_SIGNUP = saved;
    }
    const { rows } = await owner.query<{ reserved_for: string | null }>('SELECT reserved_for FROM invites WHERE code = $1', [code]);
    expect(rows[0]!.reserved_for, 'the invite was spent on a banned person').toBeNull();
  });

  it('outlives erasing the account', async () => {
    const reviewer = await account(handset('rev'));
    const bad = await account(handset('gone'));
    await ban(reviewer, bad);
    await eraseUser({ tenantId: bad.tenantId, userId: bad.userId });
    const { rows } = await owner.query('SELECT 1 FROM app_users WHERE id = $1', [bad.userId]);
    expect(rows).toHaveLength(0);
    expect(await verify(bad.phone, handset('fresh'))).toEqual({ http: 403, said: 'closed' });
  });
});

describe('the doors', () => {
  it('in production refuse an app that does not say which phone it is; in development let it in', async () => {
    const saved = env.NODE_ENV;
    try {
      env.NODE_ENV = 'production';
      expect(await verify(freshPhone(), null)).toEqual({ http: 400, said: 'update_app' });
      expect(await verify(freshPhone(), handset('prod'))).toEqual({ http: 200, said: 'needs_invite' });
    } finally {
      env.NODE_ENV = saved;
    }
    expect(await verify(freshPhone(), null)).toEqual({ http: 200, said: 'needs_invite' });
  });

  it('record the phone on the session they make', async () => {
    const me = await account();
    const H = handset('rec');
    expect(await verify(me.phone, H)).toEqual({ http: 200, said: 'signed_in' });
    const { rows } = await owner.query<{ device_hmac: string | null }>(
      `SELECT device_hmac FROM device_sessions WHERE user_id = $1 AND label = 't' AND device_hmac IS NOT NULL`, [me.userId]);
    expect(rows.map((r) => r.device_hmac)).toEqual([deviceMark(H)]);
    // The raw id is nowhere: only its keyed hash.
    const raw = await owner.query('SELECT 1 FROM device_sessions WHERE device_hmac = $1', [H.toLowerCase()]);
    expect(raw.rows).toHaveLength(0);
  });

  it('a legacy token of a banned person stops working', async () => {
    const reviewer = await account(handset('rev'));
    const bad = await account(handset('legacy'));
    const saved = env.ALLOW_LEGACY_TOKENS;
    env.ALLOW_LEGACY_TOKENS = true;
    try {
      // The pre-invite credential: the bearer token was the user id.
      const before = await datingRoutes.request('/v1/matches', { headers: { Authorization: `Bearer ${bad.userId}` } });
      expect(before.status).toBe(200);
      await ban(reviewer, bad);
      const after = await datingRoutes.request('/v1/matches', { headers: { Authorization: `Bearer ${bad.userId}` } });
      expect(after.status, 'a banned person got in on the old credential').toBe(401);
    } finally {
      env.ALLOW_LEGACY_TOKENS = saved;
    }
  });
});
