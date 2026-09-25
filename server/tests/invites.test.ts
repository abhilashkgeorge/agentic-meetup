/**
 * Invite-only: three people each, in all, and a record of who brought whom.
 *
 * WHAT THE FOUNDER ASKED FOR (build list item 5): "real invite codes, 3 per user,
 * record who invited whom."
 *
 * WHAT WAS WRONG: the limit was five OUT AT A TIME -- a used invite freed its slot, so
 * one person could bring in any number of people, five at a time. It was counted and
 * then inserted in two statements, so two taps together could make one more than the
 * limit. And the Settings count disagreed with the server: it counted invites that had
 * run out unused, which the server did not.
 *
 * WHAT IS PINNED HERE:
 *   - three each, in all: used invites count as well as open ones;
 *   - an invite that ran out unused comes back;
 *   - who invited whom: the code's row names the inviter and the account it made;
 *   - the reviewer has no limit (in production they are how the first people arrive);
 *   - two taps at once cannot make a fourth.
 *
 * Negative controls, run by hand:
 *   - SPENT_INVITES counting open invites only (the old rule) -> "used invites count"
 *     fails
 *   - without the per-person lock                            -> "takes the lock"
 *     fails every time; "two taps at once" failed two runs in three, which is why the
 *     source check exists
 *   - isReviewer ignored                                      -> "no limit" fails
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
const { authRoutes, inviteRoutes } = await import('../src/api/auth.js');
const { phoneHmac } = await import('../src/phone.js');
const { resetLimits } = await import('../src/ratelimit.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const tenants: string[] = [];
const phones: string[] = [];
const creators: string[] = [];

beforeEach(() => { resetLimits(); });

afterAll(async () => {
  if (creators.length) await owner.query('DELETE FROM invites WHERE created_by = ANY($1)', [creators]);
  if (tenants.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [tenants]);
  if (phones.length) await owner.query('DELETE FROM phone_challenges WHERE phone_hmac = ANY($1)', [phones.map(phoneHmac)]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

let n = 0;
const run = `${Date.now() % 1e9}`;
const freshPhone = (): string => `+1555${String(Date.now() % 1000000 + n++).padStart(7, '0')}`;

type Person = { userId: string; token: string };
async function person(): Promise<Person> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`inv-${run}-${n++}`]);
  const tenantId = t.rows[0]!.id;
  tenants.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `inv-${run}-${n++}@example.test`]);
  const userId = u.rows[0]!.id;
  creators.push(userId);
  const id = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [id, tenantId, userId]);
  return { userId, token: mintToken(id) };
}

const H = (p: Person) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' });
const make = async (p: Person) => {
  const res = await inviteRoutes.request('/v1/invites', { method: 'POST', headers: H(p), body: JSON.stringify({ note: 't' }) });
  return { status: res.status, code: ((await res.json()) as { code?: string }).code };
};
const left = async (p: Person) =>
  ((await (await inviteRoutes.request('/v1/invites', { headers: H(p) })).json()) as { remaining: number | null }).remaining;

/** Somebody new redeems `code` the real way: a verified number, then the invite. */
async function redeem(code: string): Promise<string> {
  const phone = freshPhone();
  phones.push(phone);
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO phone_challenges (phone_hmac, code_hmac, attempts, expires_at, verified_at)
     VALUES ($1,'x',0, now() + interval '5 minutes', now()) RETURNING id`, [phoneHmac(phone)]);
  const saved = env.ALLOW_UNVERIFIED_SIGNUP;
  env.ALLOW_UNVERIFIED_SIGNUP = false;
  try {
    const res = await authRoutes.request('/v1/auth/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': `inv${run}${n++}0000000` },
      body: JSON.stringify({ code, label: 't', ticket: rows[0]!.id }),
    });
    expect(res.status).toBe(200);
  } finally {
    env.ALLOW_UNVERIFIED_SIGNUP = saved;
  }
  const { rows: u } = await owner.query<{ id: string; tenant_id: string }>(
    'SELECT id, tenant_id FROM app_users WHERE phone_hmac = $1', [phoneHmac(phone)]);
  tenants.push(u[0]!.tenant_id);
  return u[0]!.id;
}

describe('three people each', () => {
  it('in all: used invites count as well as open ones, and who invited whom is kept', async () => {
    expect(env.INVITES_PER_USER).toBe(3);
    const me = await person();
    expect(await left(me)).toBe(3);
    const a = await make(me);
    expect(a.status).toBe(200);

    // Somebody comes in on it.
    const them = await redeem(a.code!);
    const { rows } = await owner.query<{ created_by: string; reserved_for: string; used_by: string }>(
      'SELECT created_by, reserved_for, used_by FROM invites WHERE code = $1', [a.code]);
    expect(rows[0], 'who invited whom was not kept').toEqual({ created_by: me.userId, reserved_for: them, used_by: them });

    // The used one still counts: two more, and then no more.
    expect(await left(me)).toBe(2);
    expect((await make(me)).status).toBe(200);
    expect((await make(me)).status).toBe(200);
    expect(await left(me)).toBe(0);
    expect((await make(me)).status, 'a fourth invite was made').toBe(429);
  });

  it('an invite that ran out unused comes back', async () => {
    const me = await person();
    const codes = [(await make(me)).code, (await make(me)).code, (await make(me)).code];
    expect((await make(me)).status).toBe(429);
    await owner.query(`UPDATE invites SET expires_at = now() - interval '1 day' WHERE code = $1`, [codes[0]]);
    expect(await left(me)).toBe(1);
    expect((await make(me)).status).toBe(200);
  });

  it('two taps at once cannot make a fourth', async () => {
    const me = await person();
    await make(me);
    await make(me);
    const at = await Promise.all(Array.from({ length: 10 }, () => make(me)));
    expect(at.filter((r) => r.status === 200), 'more than three invites were made').toHaveLength(1);
    const { rows } = await owner.query<{ n: number }>('SELECT count(*)::int AS n FROM invites WHERE created_by = $1', [me.userId]);
    expect(rows[0]!.n).toBe(3);
  });

  it('takes the per-person lock before it counts', () => {
    // WHY THE SOURCE AS WELL. The race above is real but timing-dependent: with the lock
    // removed it failed two runs in three (2026-09-25) -- a guard that passes by luck
    // the third time is decoration. The order of the three statements is what makes it
    // safe, and that can be checked every time.
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'api', 'auth.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const post = src.slice(src.indexOf(".post('/v1/invites'"));
    const lock = post.indexOf('pg_advisory_xact_lock');
    const count = post.indexOf('SPENT_INVITES');
    const insert = post.indexOf('INSERT INTO invites');
    expect(lock, 'no per-person lock in POST /v1/invites').toBeGreaterThan(-1);
    expect(lock).toBeLessThan(count);
    expect(count).toBeLessThan(insert);
  });

  it('the reviewer has no limit', async () => {
    const rev = await person();
    const saved = env.ADMIN_USER_IDS;
    env.ADMIN_USER_IDS = rev.userId;
    try {
      for (let i = 0; i < 5; i++) expect((await make(rev)).status).toBe(200);
      expect(await left(rev)).toBeNull();
    } finally {
      env.ADMIN_USER_IDS = saved;
    }
  });
});
