/**
 * Auth. The property is not "a good token works" -- it is that everything else fails.
 *
 * The pre-invite build had one: the bearer token WAS the user id, unsigned and
 * unrevocable, and open self-signup meant anyone reachable could mint a tenant.
 * Both are closed here, and these tests are what keeps them closed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { resolveCtx, Unauthorized, isLegacyToken } from '../src/auth.js';
import { mintToken, verifyToken, mintInviteCode, normaliseInviteCode, newSessionId } from '../src/tokens.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
let ctx = { tenantId: '', userId: '' };
let sessionId = '';

beforeAll(async () => {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`auth-${Date.now()}`]);
  ctx.tenantId = t.rows[0]!.id;
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [ctx.tenantId, `auth-${Date.now()}@example.test`]);
  ctx.userId = u.rows[0]!.id;
  sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'test', now() + interval '30 days')`,
    [sessionId, ctx.tenantId, ctx.userId]);
});

afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
  await owner.end();
  await pool.end();
});

describe('token signing', () => {
  it('round-trips a session id', () => {
    const id = newSessionId();
    expect(verifyToken(mintToken(id))).toBe(id);
  });

  it('rejects a tampered signature, a swapped id, and every kind of junk', () => {
    const id = newSessionId();
    const token = mintToken(id);
    const other = newSessionId();
    expect(verifyToken(token.slice(0, -1) + 'x')).toBeNull();
    // The signature covers the id, so pairing a real signature with a different id
    // must fail -- otherwise anyone with one token could mint tokens for any session.
    expect(verifyToken(`${other}.${token.split('.')[1]}`)).toBeNull();
    for (const junk of ['', '.', 'nodot', `${id}.`, `${id}.short`, 'a'.repeat(500)]) {
      expect(verifyToken(junk)).toBeNull();
    }
  });
});

describe('resolveCtx', () => {
  it('accepts a live session and returns its owner', async () => {
    const got = await resolveCtx(`Bearer ${mintToken(sessionId)}`);
    expect(got).toEqual({ tenantId: ctx.tenantId, userId: ctx.userId });
  });

  it('refuses a revoked session immediately, not at expiry', async () => {
    const dead = newSessionId();
    await owner.query(
      `INSERT INTO device_sessions (id, tenant_id, user_id, expires_at, revoked_at)
       VALUES ($1,$2,$3, now() + interval '30 days', now())`,
      [dead, ctx.tenantId, ctx.userId]);
    // The whole reason the database is consulted on every request despite the
    // signature being valid.
    await expect(resolveCtx(`Bearer ${mintToken(dead)}`)).rejects.toThrow(Unauthorized);
  });

  it('refuses an expired session', async () => {
    const old = newSessionId();
    await owner.query(
      `INSERT INTO device_sessions (id, tenant_id, user_id, expires_at)
       VALUES ($1,$2,$3, now() - interval '1 day')`,
      [old, ctx.tenantId, ctx.userId]);
    await expect(resolveCtx(`Bearer ${mintToken(old)}`)).rejects.toThrow(Unauthorized);
  });

  it('refuses a signed token for a session that does not exist', async () => {
    await expect(resolveCtx(`Bearer ${mintToken(newSessionId())}`)).rejects.toThrow(Unauthorized);
  });

  it('never resolves without a token', async () => {
    await expect(resolveCtx(undefined)).rejects.toThrow(Unauthorized);
    await expect(resolveCtx('Bearer ')).rejects.toThrow(Unauthorized);
    await expect(resolveCtx('Bearer not-a-token')).rejects.toThrow(Unauthorized);
  });
});

describe('legacy tokens', () => {
  it('are recognised as legacy so the client knows to upgrade', () => {
    expect(isLegacyToken(`Bearer ${ctx.userId}`)).toBe(true);
    expect(isLegacyToken(`Bearer ${mintToken(sessionId)}`)).toBe(false);
    expect(isLegacyToken(undefined)).toBe(false);
  });

  it('still resolve while the flag is on, so no device is stranded', async () => {
    // ALLOW_LEGACY_TOKENS defaults true and is meant to be turned off once every
    // device has traded up. This test documents that it is a hole with an end date.
    if (!env.ALLOW_LEGACY_TOKENS) return;
    const got = await resolveCtx(`Bearer ${ctx.userId}`);
    expect(got.userId).toBe(ctx.userId);
  });
});

describe('invite codes', () => {
  it('avoid every character pair that is misread when typed or read aloud', () => {
    for (let i = 0; i < 200; i++) {
      expect(mintInviteCode()).toMatch(/^[ACDEFGHJKMNPQRTUVWXY34679]{4}-[ACDEFGHJKMNPQRTUVWXY34679]{4}$/);
    }
  });

  it('normalises what a person actually types', () => {
    const code = mintInviteCode();
    const bare = code.replace('-', '');
    expect(normaliseInviteCode(bare.toLowerCase())).toBe(code);
    expect(normaliseInviteCode(` ${bare.slice(0, 4)} ${bare.slice(4)} `)).toBe(code);
    expect(normaliseInviteCode(code)).toBe(code);
  });
});

/**
 * The invite lifecycle, which took three attempts to get right and is worth pinning.
 *
 * A code must be claimable exactly once, atomically, BEFORE the account it will belong
 * to exists. That last clause is the whole difficulty: `used_by` references
 * `app_users`, so it cannot be written at claim time, and writing only `used_at`
 * leaves a row claimed by nobody. Reservation and attribution are separate columns
 * for that reason.
 */
describe('invite lifecycle', () => {
  const freshCode = async (note = '') => {
    const code = mintInviteCode();
    await owner.query(
      `INSERT INTO invites (code, note, expires_at) VALUES ($1,$2, now() + interval '7 days')`,
      [code, note]);
    return code;
  };

  const reserve = (code: string, userId: string) =>
    owner.query(
      `UPDATE invites SET reserved_for = $2, reserved_at = now()
        WHERE code = $1 AND reserved_for IS NULL AND expires_at > now()
      RETURNING note`,
      [code, userId]);

  it('can be reserved for an account that does not exist yet', async () => {
    const code = await freshCode('Nikhil sent you this.');
    const ghost = crypto.randomUUID();
    const r = await reserve(code, ghost);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0]!.note).toBe('Nikhil sent you this.');
  });

  it('cannot be reserved twice, so a race has exactly one winner', async () => {
    const code = await freshCode();
    expect((await reserve(code, crypto.randomUUID())).rowCount).toBe(1);
    expect((await reserve(code, crypto.randomUUID())).rowCount).toBe(0);
  });

  it('cannot be reserved after it expires', async () => {
    const code = mintInviteCode();
    await owner.query(
      `INSERT INTO invites (code, expires_at) VALUES ($1, now() - interval '1 day')`, [code]);
    expect((await reserve(code, crypto.randomUUID())).rowCount).toBe(0);
  });

  it('refuses to record a use that was never reserved', async () => {
    const code = await freshCode();
    // The ordering bug, made impossible. Attribution without a reservation means a
    // code was consumed by a path that skipped the race check.
    await expect(
      owner.query(`UPDATE invites SET used_by = $2, used_at = now() WHERE code = $1`,
        [code, ctx.userId]),
    ).rejects.toThrow(/invites_used_implies_reserved/);
  });

  it('survives the erasure of whoever used it, and stays spent', async () => {
    // A user who has ever redeemed a code must still be erasable. The row keeps
    // "used on this date, by nobody we can name" -- which is what erasure means --
    // and `reserved_for` has no foreign key, so the code is not handed back out.
    const t = await owner.query<{ id: string }>(
      'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`gone-${Date.now()}`]);
    const u = await owner.query<{ id: string }>(
      'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
      [t.rows[0]!.id, `gone-${Date.now()}@example.test`]);

    const code = await freshCode();
    await reserve(code, u.rows[0]!.id);
    await owner.query(`UPDATE invites SET used_by = $2, used_at = now() WHERE code = $1`,
      [code, u.rows[0]!.id]);

    await expect(
      owner.query('DELETE FROM tenants WHERE id = $1', [t.rows[0]!.id]),
    ).resolves.toBeTruthy();

    const { rows } = await owner.query<{ used_by: string | null; used_at: Date | null; reserved_for: string }>(
      `SELECT used_by, used_at, reserved_for FROM invites WHERE code = $1`, [code]);
    expect(rows[0]!.used_by).toBeNull();
    expect(rows[0]!.used_at).not.toBeNull();
    expect((await reserve(code, crypto.randomUUID())).rowCount).toBe(0);
  });

  it('records the real account once it exists, and releasing clears the reservation', async () => {
    const code = await freshCode();
    await reserve(code, ctx.userId);
    await owner.query(`UPDATE invites SET used_by = $2, used_at = now() WHERE code = $1`,
      [code, ctx.userId]);

    const { rows } = await owner.query<{ used_by: string; reserved_for: string }>(
      `SELECT used_by, reserved_for FROM invites WHERE code = $1`, [code]);
    expect(rows[0]!.used_by).toBe(ctx.userId);
    expect(rows[0]!.reserved_for).toBe(ctx.userId);

    // A failed provision releases the reservation so the code is not silently eaten.
    const other = await freshCode();
    await reserve(other, crypto.randomUUID());
    await owner.query(
      `UPDATE invites SET reserved_for = NULL, reserved_at = NULL
        WHERE code = $1 AND used_by IS NULL`, [other]);
    expect((await reserve(other, crypto.randomUUID())).rowCount).toBe(1);
  });
});
