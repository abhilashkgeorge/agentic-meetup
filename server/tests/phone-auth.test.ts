/**
 * The phone door.
 *
 * WHY EACH OF THESE IS HERE. Sign-in is the one surface where a bug is not a bug but
 * a breach, and every test below stands for a specific way this can be wrong in a way
 * nothing else would notice:
 *
 *   enumeration     a different answer for a known number turns this route into a
 *                   "is this person on a dating app" lookup for anybody with a
 *                   contact list. The response must be byte-identical either way.
 *   brute force     six digits is a million guesses, which is nothing. The attempt
 *                   counter has to hold under requests arriving together, not just
 *                   one after another.
 *   replay          a code seen once must not work twice, and a ticket must not
 *                   build two accounts -- that is the whole one-person-one-account
 *                   guarantee, and it is enforced by a conditional UPDATE that a
 *                   later refactor could quietly turn back into read-then-write.
 *   recovery        the point of the feature. A number that already has an account
 *                   must sign in to THAT account rather than make a new one.
 *
 * The code is never returned by the route, so tests write their own challenge rows
 * with a code they choose. Everything else about those rows is what the route writes.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { authRoutes } from '../src/api/auth.js';
import { pool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { codeHmac, phoneHmac } from '../src/phone.js';
import { resetLimits } from '../src/ratelimit.js';
import { mintInviteCode, mintToken, newSessionId } from '../src/tokens.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const tenants: string[] = [];
const phones: string[] = [];

let n = 0;
const freshPhone = (): string => `+91987${String(Date.now() % 10000000 + n++).padStart(7, '0')}`;

beforeEach(() => { resetLimits(); });

afterAll(async () => {
  if (tenants.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [tenants]);
  if (phones.length) {
    await owner.query('DELETE FROM phone_challenges WHERE phone_hmac = ANY($1)',
      [phones.map(phoneHmac)]);
  }
  await owner.end();
  await pool.end();
});

/** A live challenge for `phone` whose code is `code`. Exactly the row /start writes. */
async function challenge(phone: string, code: string, opts: {
  ageSec?: number; attempts?: number; verified?: boolean; consumed?: boolean;
} = {}): Promise<string> {
  phones.push(phone);
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO phone_challenges (phone_hmac, code_hmac, attempts, expires_at,
                                   verified_at, consumed_at)
     VALUES ($1,'pending',$2, now() + ($3::int * interval '1 second'),
             CASE WHEN $4 THEN now() END, CASE WHEN $5 THEN now() END)
     RETURNING id`,
    [phoneHmac(phone), opts.attempts ?? 0, opts.ageSec ?? 300,
     opts.verified ?? false, opts.consumed ?? false]);
  const id = rows[0]!.id;
  await owner.query('UPDATE phone_challenges SET code_hmac = $2 WHERE id = $1',
    [id, codeHmac(id, code)]);
  return id;
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  authRoutes.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers },
    body: JSON.stringify(body),
  });

/** An account with a live session, made the way the owner pool makes fixtures. */
async function account(phone?: string): Promise<{ userId: string; token: string }> {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`phone-${Date.now()}-${n++}`]);
  const tenantId = t.rows[0]!.id;
  tenants.push(tenantId);
  const u = await owner.query<{ id: string }>(
    `INSERT INTO app_users (tenant_id, email, phone_hmac, phone_verified_at)
     VALUES ($1,$2,$3, CASE WHEN $3::text IS NULL THEN NULL ELSE now() END) RETURNING id`,
    [tenantId, `p-${Date.now()}-${n++}@example.test`, phone ? phoneHmac(phone) : null]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'test', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { userId, token: mintToken(sessionId) };
}

describe('asking for a code', () => {
  it('refuses something that is not a phone number', async () => {
    const res = await post('/v1/auth/phone/start', { phone: 'hello', country: '+91' });
    expect(res.status).toBe(400);
  });

  it('NEVER says whether the number already has an account', async () => {
    // The enumeration test. Two numbers, one with an account and one without, and the
    // two responses must be indistinguishable apart from the challenge id itself.
    const known = freshPhone();
    await account(known);
    const unknown = freshPhone();

    const a = await post('/v1/auth/phone/start', { phone: known, country: '+91' });
    resetLimits();
    const b = await post('/v1/auth/phone/start', { phone: unknown, country: '+91' });

    expect(a.status).toBe(b.status);
    const [ja, jb] = [await a.json(), await b.json()] as Record<string, unknown>[];
    expect(Object.keys(ja!).sort()).toEqual(Object.keys(jb!).sort());
    expect(ja!.expiresInSec).toEqual(jb!.expiresInSec);
  });

  it('kills the previous code when a new one is sent', async () => {
    // Otherwise "resend" doubles the number of live codes instead of replacing one,
    // and every resend makes a brute force cheaper rather than more expensive.
    const phone = freshPhone();
    const first = await challenge(phone, '111111');
    await post('/v1/auth/phone/start', { phone, country: '+91' });

    const { rows } = await owner.query<{ consumed_at: string | null }>(
      'SELECT consumed_at FROM phone_challenges WHERE id = $1', [first]);
    expect(rows[0]!.consumed_at).not.toBeNull();
  });

  it('stops one number being texted over and over', async () => {
    const phone = freshPhone();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await post('/v1/auth/phone/start', { phone, country: '+91' })).status);
    }
    // The per-IP limit is looser than this, so a 429 here is the per-NUMBER one.
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
  });
});

describe('typing the code in', () => {
  it('refuses the wrong code and says how many tries are left', async () => {
    const id = await challenge(freshPhone(), '123456');
    const res = await post('/v1/auth/phone/verify', { challengeId: id, code: '000000' });
    expect(res.status).toBe(400);
    expect((await res.json() as { attemptsLeft: number }).attemptsLeft).toBe(4);
  });

  it('burns the code after five wrong guesses, even with the right one in hand',
    async () => {
      const id = await challenge(freshPhone(), '123456');
      for (let i = 0; i < 5; i++) {
        await post('/v1/auth/phone/verify', { challengeId: id, code: '000000' });
      }
      const res = await post('/v1/auth/phone/verify', { challengeId: id, code: '123456' });
      expect(res.status).toBe(400);
    });

  it('gives no more than five guesses even when they arrive together', async () => {
    // Ten wrong guesses fired at once, then the RIGHT one. The right one must still
    // be refused: the challenge is burned whether the wrong guesses queued or raced.
    const id = await challenge(freshPhone(), '123456');
    await Promise.all(Array.from({ length: 10 }, () =>
      post('/v1/auth/phone/verify', { challengeId: id, code: '000000' })));

    const res = await post('/v1/auth/phone/verify', { challengeId: id, code: '123456' });
    expect(res.status).toBe(400);
  });

  /**
   * AND THE STRUCTURAL ONE, because the behavioural test above cannot be trusted to
   * catch this on its own.
   *
   * I checked. Replacing the conditional UPDATE with a read, a compare and a separate
   * write -- the exact regression this is guarding against -- left every behavioural
   * test in this file green. The owner pool holds two connections, so ten "concurrent"
   * requests mostly queue, and a counter that is safe only because nothing actually
   * ran in parallel looks identical to one that is safe by construction.
   *
   * A test that passes against the broken version is not a test. So this asserts the
   * shape instead: the increment and the guard have to be the same statement, which is
   * the property that makes the race impossible rather than merely unlikely.
   */
  it('increments the attempt counter in the SAME statement that guards it', () => {
    const src = readFileSync(
      join(import.meta.dirname, '..', 'src', 'api', 'auth.ts'), 'utf8');
    const stmt = /UPDATE phone_challenges SET attempts = attempts \+ 1[\s\S]{0,300}?`/
      .exec(src);
    expect(stmt, 'the verify route no longer increments attempts inside an UPDATE')
      .not.toBeNull();
    // The guard clauses must live in that same statement's WHERE, not in JavaScript
    // around it, or two requests can both pass the check before either one writes.
    expect(stmt![0]).toContain('attempts < $2');
    expect(stmt![0]).toContain('consumed_at IS NULL');
    expect(stmt![0]).toContain('expires_at > now()');
    expect(stmt![0]).toContain('RETURNING');
  });

  it('refuses an expired code', async () => {
    const id = await challenge(freshPhone(), '123456', { ageSec: -10 });
    const res = await post('/v1/auth/phone/verify', { challengeId: id, code: '123456' });
    expect(res.status).toBe(400);
  });

  it('refuses a challenge that was already used', async () => {
    const id = await challenge(freshPhone(), '123456', { consumed: true });
    const res = await post('/v1/auth/phone/verify', { challengeId: id, code: '123456' });
    expect(res.status).toBe(400);
  });

  it('sends a brand-new number to the invite screen', async () => {
    const id = await challenge(freshPhone(), '123456');
    const res = await post('/v1/auth/phone/verify', { challengeId: id, code: '123456' });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; ticket: string };
    expect(body.status).toBe('needs_invite');
    expect(body.ticket).toBe(id);
  });

  it('signs a known number straight back into ITS OWN account', async () => {
    // The recovery path, and the reason the feature exists. A second handset must
    // land in the clone that already exists rather than start a new one.
    const phone = freshPhone();
    const { userId } = await account(phone);
    const id = await challenge(phone, '654321');

    const res = await post('/v1/auth/phone/verify', { challengeId: id, code: '654321' });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; token: string };
    expect(body.status).toBe('signed_in');

    const { resolveCtx } = await import('../src/auth.js');
    const ctx = await resolveCtx(`Bearer ${body.token}`);
    expect(ctx.userId).toBe(userId);
  });

  it('attaches the number to the account a signed-in caller already has', async () => {
    const { userId, token } = await account();
    const phone = freshPhone();
    const id = await challenge(phone, '222222');

    const res = await post('/v1/auth/phone/verify',
      { challengeId: id, code: '222222' }, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect((await res.json() as { status: string }).status).toBe('linked');

    const { rows } = await owner.query<{ phone_hmac: string }>(
      'SELECT phone_hmac FROM app_users WHERE id = $1', [userId]);
    expect(rows[0]!.phone_hmac).toBe(phoneHmac(phone));
  });

  it('refuses to attach a number that belongs to somebody else', async () => {
    const phone = freshPhone();
    await account(phone);                       // already theirs
    const { token } = await account();          // somebody else, signed in
    const id = await challenge(phone, '333333');

    const res = await post('/v1/auth/phone/verify',
      { challengeId: id, code: '333333' }, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(409);
  });
});

describe('spending the ticket', () => {
  async function freshCode(): Promise<string> {
    const code = mintInviteCode();
    await owner.query(
      `INSERT INTO invites (code, note, expires_at) VALUES ($1,'t', now() + interval '1 day')`,
      [code]);
    return code;
  }

  it('will not make an account without one', async () => {
    const res = await post('/v1/auth/redeem', { code: await freshCode(), label: 'd' });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('phone_required');
  });

  it('leaves the invite UNSPENT when the ticket is no good', async () => {
    // An invite is a scarce thing somebody handed out personally. Burning one on a
    // request that was always going to fail is an unfairness nobody gets told about.
    const code = await freshCode();
    const id = await challenge(freshPhone(), '444444', { verified: true, consumed: true });
    await post('/v1/auth/redeem', { code, label: 'd', ticket: id });

    const { rows } = await owner.query<{ reserved_for: string | null }>(
      'SELECT reserved_for FROM invites WHERE code = $1', [code]);
    expect(rows[0]!.reserved_for).toBeNull();
  });

  it('cannot be spent twice, so one number cannot become two accounts', async () => {
    const phone = freshPhone();
    const id = await challenge(phone, '555555', { verified: true });
    const [a, b] = [await freshCode(), await freshCode()];

    const first = await post('/v1/auth/redeem', { code: a, label: 'd', ticket: id });
    expect(first.status).toBe(200);
    tenants.push(...(await owner.query<{ id: string }>(
      `SELECT t.id FROM tenants t JOIN app_users u ON u.tenant_id = t.id
        WHERE u.phone_hmac = $1`, [phoneHmac(phone)])).rows.map((r) => r.id));

    const second = await post('/v1/auth/redeem', { code: b, label: 'd', ticket: id });
    expect(second.status).toBe(400);
  });

  // The founder, 2026-09-29 (docs 15.3 item 15): a mistyped invite code spent the
  // verified number, and the retry said "That took too long. Ask for a new code."
  // Negative control, run by hand and recorded in the commit: the redeem route without
  // returnTicket -> this fails on the second try.
  it('lets a mistyped code be typed again: the number is not spent, and it says so plainly', async () => {
    const phone = freshPhone();
    const id = await challenge(phone, '777777', { verified: true });
    const typo = await post('/v1/auth/redeem', { code: 'WRNG-CDEF', label: 'd', ticket: id });
    expect(typo.status).toBe(400);
    expect((await typo.json() as { message: string }).message).toBe("That code didn't work, try again.");

    const right = await post('/v1/auth/redeem', { code: await freshCode(), label: 'd', ticket: id });
    expect(right.status, 'the mistyped code spent the verified number').toBe(200);
    tenants.push(...(await owner.query<{ id: string }>(
      `SELECT t.id FROM tenants t JOIN app_users u ON u.tenant_id = t.id
        WHERE u.phone_hmac = $1`, [phoneHmac(phone)])).rows.map((r) => r.id));
    // And, once it has made the account, it is spent for good.
    const again = await post('/v1/auth/redeem', { code: await freshCode(), label: 'd', ticket: id });
    expect(again.status).toBe(400);
  });

  it('writes the number onto the account it creates', async () => {
    const phone = freshPhone();
    const id = await challenge(phone, '666666', { verified: true });
    const res = await post('/v1/auth/redeem', { code: await freshCode(), label: 'd', ticket: id });
    expect(res.status).toBe(200);

    const { rows } = await owner.query<{ id: string; tenant_id: string }>(
      'SELECT id, tenant_id FROM app_users WHERE phone_hmac = $1', [phoneHmac(phone)]);
    expect(rows).toHaveLength(1);
    tenants.push(rows[0]!.tenant_id);
  });
});

describe('signing out', () => {
  it('revokes the session on the server, not only on the device', async () => {
    const { token } = await account();
    const res = await authRoutes.request('/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.9' },
    });
    expect(res.status).toBe(200);

    // The token must now be dead. This is the whole point: before this route existed
    // it kept working for up to a hundred and eighty days.
    const { resolveCtx, Unauthorized } = await import('../src/auth.js');
    await expect(resolveCtx(`Bearer ${token}`)).rejects.toBeInstanceOf(Unauthorized);
  });

  it('leaves the other devices signed in', async () => {
    // Signing out a phone must not sign out the laptop. "Everywhere" is a different,
    // deliberate action that this route is not.
    const { userId, token } = await account();
    const other = newSessionId();
    const { rows } = await owner.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM app_users WHERE id = $1', [userId]);
    await owner.query(
      `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
       VALUES ($1,$2,$3,'laptop', now() + interval '30 days')`,
      [other, rows[0]!.tenant_id, userId]);

    await authRoutes.request('/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.9' },
    });

    const { resolveCtx } = await import('../src/auth.js');
    const ctx = await resolveCtx(`Bearer ${mintToken(other)}`);
    expect(ctx.userId).toBe(userId);
  });
});

describe('coming back on a second phone', () => {
  it('tells the new handset that setup is already done', async () => {
    // WHY THIS MATTERS MORE THAN IT LOOKS. "Setup finished" is a flag in the device's
    // own keychain, and a new phone has an empty one. Without the server answering
    // this, somebody signing in on their second handset is walked through setup again
    // on the next launch -- asked their birth year by an agent that has known it for
    // weeks, and given the chance to overwrite it with a typo.
    const phone = freshPhone();
    const { userId } = await account(phone);
    const { rows } = await owner.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM app_users WHERE id = $1', [userId]);
    await owner.query(
      `INSERT INTO predicate_status (tenant_id, user_id, predicate, state, updated_at)
       VALUES ($1,$2,'gender','known', now())`, [rows[0]!.tenant_id, userId]);

    const id = await challenge(phone, '777777');
    const res = await post('/v1/auth/phone/verify', { challengeId: id, code: '777777' });
    expect((await res.json() as { onboarded: boolean }).onboarded).toBe(true);
  });

  it('does NOT claim setup is done for an account that never finished it', async () => {
    const phone = freshPhone();
    await account(phone);
    const id = await challenge(phone, '888888');
    const res = await post('/v1/auth/phone/verify', { challengeId: id, code: '888888' });
    expect((await res.json() as { onboarded: boolean }).onboarded).toBe(false);
  });
});

describe('an account made before phone sign-in existed', () => {
  it('can be asked whether it is recoverable at all', async () => {
    // WHY THIS ROUTE EXISTS. Phone sign-in only ever appears to a device with NO
    // token, so every account that predates it could never attach a number -- and an
    // account with no number is reachable from exactly one handset, for ever. The
    // oldest accounts hold the most, so they were the ones left in the trap the
    // feature was built to remove.
    const { token } = await account();
    const res = await authRoutes.request('/v1/auth/phone', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json() as { linked: boolean }).linked).toBe(false);
  });

  it('reports itself recoverable once a number is attached', async () => {
    const phone = freshPhone();
    const { token } = await account();
    const id = await challenge(phone, '999999');
    await post('/v1/auth/phone/verify',
      { challengeId: id, code: '999999' }, { Authorization: `Bearer ${token}` });

    const res = await authRoutes.request('/v1/auth/phone', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await res.json() as { linked: boolean }).linked).toBe(true);
  });

  it('refuses to answer without a credential', async () => {
    const res = await authRoutes.request('/v1/auth/phone');
    expect(res.status).toBe(401);
  });
});
