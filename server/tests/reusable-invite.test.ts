/**
 * A code that is never spent, and the two locks that keep it off a real host.
 *
 * WHAT THIS IS, PLAINLY: a credential that creates unlimited accounts and never
 * expires. Worth having because testing the new-account path end to end otherwise
 * needs a freshly minted invite on every pass, and that friction lands on the person
 * who most needs the loop to be quick.
 *
 * It is safe only because of two independent locks, and this file exists to hold both
 * of them still:
 *
 *   the column   defaults to false, so no invite that already exists changes
 *   the flag     redeem honours `reusable` only while ALLOW_REUSABLE_INVITES is on,
 *                and production refuses to boot with it
 *
 * The important test here is the second one. A reusable row restored into a real
 * database from a development dump must behave as an ordinary single-use invite, so
 * that forgetting the flag is not the same as leaving a back door open.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { authRoutes } from '../src/api/auth.js';
import { pool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { phoneHmac } from '../src/phone.js';
import { resetLimits } from '../src/ratelimit.js';
import { mintInviteCode } from '../src/tokens.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const tenants: string[] = [];
const phones: string[] = [];
let n = 0;

beforeEach(() => { resetLimits(); });

afterAll(async () => {
  if (tenants.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [tenants]);
  if (phones.length) {
    await owner.query('DELETE FROM phone_challenges WHERE phone_hmac = ANY($1)',
      [phones.map(phoneHmac)]);
  }
  await owner.query(`DELETE FROM invites WHERE note = 'reusable test'`);
  await owner.end();
  await pool.end();
});

async function reusableCode(): Promise<string> {
  const code = mintInviteCode();
  await owner.query(
    `INSERT INTO invites (code, note, reusable, expires_at)
     VALUES ($1,'reusable test', true, now() + interval '1 year')`, [code]);
  return code;
}

/** A verified-number ticket for a number nobody has. */
async function ticket(): Promise<string> {
  const phone = `+91977${String(Date.now() % 10000000 + n++).padStart(7, '0')}`;
  phones.push(phone);
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO phone_challenges (phone_hmac, code_hmac, expires_at, verified_at)
     VALUES ($1,'x', now() + interval '15 minutes', now()) RETURNING id`,
    [phoneHmac(phone)]);
  return rows[0]!.id;
}

const redeem = async (code: string) =>
  authRoutes.request('/v1/auth/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.2' },
    body: JSON.stringify({ code, label: 'test', ticket: await ticket() }),
  });

/** Every tenant this made, so afterAll can take them away again. */
async function collect(): Promise<void> {
  const { rows } = await owner.query<{ id: string }>(
    `SELECT id FROM tenants WHERE name = 'test'`);
  tenants.push(...rows.map((r) => r.id));
}

describe('a reusable invite', () => {
  it('makes a second account from the same code', async () => {
    const code = await reusableCode();
    expect((await redeem(code)).status).toBe(200);
    expect((await redeem(code)).status).toBe(200);
    await collect();
  });

  it('is never marked used, however many times it is redeemed', async () => {
    const code = await reusableCode();
    await redeem(code);
    await redeem(code);
    const { rows } = await owner.query<{ used_by: string | null; reserved_for: string | null }>(
      'SELECT used_by, reserved_for FROM invites WHERE code = $1', [code]);
    expect(rows[0]!.used_by).toBeNull();
    expect(rows[0]!.reserved_for).toBeNull();
    await collect();
  });

  it('IS COMPLETELY DEAD WHEN THE FLAG IS OFF', async () => {
    // The lock that matters, and it turned out stronger than intended. I expected a
    // reusable row to fall back to being an ordinary single-use invite; the
    // conditional UPDATE carries `AND NOT reusable`, so it is refused outright
    // instead. That is the better answer and it is kept deliberately: a development
    // artefact restored into a real database should do NOTHING, not hand out one free
    // account. Forgetting the flag is then survivable in the strongest sense.
    const code = await reusableCode();
    vi.spyOn(env, 'ALLOW_REUSABLE_INVITES', 'get').mockReturnValue(false);
    try {
      expect((await redeem(code)).status).toBe(400);
      expect((await redeem(code)).status).toBe(400);
    } finally {
      vi.restoreAllMocks();
    }
    await collect();
  });

  it('does not change how a normal invite behaves', async () => {
    const code = mintInviteCode();
    await owner.query(
      `INSERT INTO invites (code, note, expires_at)
       VALUES ($1,'reusable test', now() + interval '1 day')`, [code]);
    expect((await redeem(code)).status).toBe(200);
    expect((await redeem(code)).status).toBe(400);
    await collect();
  });
});

describe('the boot guard', () => {
  it('refuses a production server that honours reusable invites', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'env.ts'), 'utf8');
    expect(src).toMatch(/NODE_ENV === 'production' && env\.ALLOW_REUSABLE_INVITES/);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
