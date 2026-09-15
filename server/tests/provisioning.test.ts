/**
 * Creating an account must work as the role the server actually connects as.
 *
 * WHAT HAPPENED. A migration revoked `tenants` from `clone_app` on the stated grounds
 * that nothing in src/ touched it. The grep behind that looked for reads and updates
 * and missed one insert -- the one that creates the tenant for a new account. Nothing
 * failed until somebody redeemed an invite on a new phone and got:
 *
 *     error: permission denied for table tenants
 *
 * Every test in the suite passed throughout, because they all create their fixtures
 * through the OWNER connection. The one path that runs as the application was the one
 * path nothing exercised.
 *
 * So this walks the real redemption, as the real role, and asserts the account it
 * produces can actually be used.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { authRoutes } from '../src/api/auth.js';
import { pool, tenantSession } from '../src/db/client.js';
import { env } from '../src/env.js';
import { resetLimits } from '../src/ratelimit.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

beforeEach(() => { resetLimits(); });

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await pool.end();
});

/** A real, unused code, minted the way the app mints them. */
async function freshCode(): Promise<string> {
  const { mintInviteCode } = await import('../src/tokens.js');
  const code = mintInviteCode();
  await owner.query(
    `INSERT INTO invites (code, note, expires_at) VALUES ($1,'test', now() + interval '1 day')`,
    [code]);
  return code;
}

const redeem = (code: string, ip = '198.51.100.1') =>
  authRoutes.request('/v1/auth/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ code, label: 'test device' }),
  });

describe('redeeming an invite', () => {
  it('creates a usable account as clone_app, not as the owner', async () => {
    const res = await redeem(await freshCode());
    expect(res.status, await res.clone().text()).toBe(200);

    const { token } = await res.json() as { token: string };
    expect(token).toMatch(/^[0-9a-f-]{36}\./);

    // The credential has to resolve, and the account behind it has to be able to do
    // the first thing every account does: read its own (empty) facts.
    const { resolveCtx } = await import('../src/auth.js');
    const ctx = await resolveCtx(`Bearer ${token}`);
    made.push(ctx.tenantId);

    const rows = await tenantSession(ctx, async (c) =>
      (await c.query('SELECT 1 FROM facts')).rows);
    expect(rows).toEqual([]);
  });

  it('gives each account its own tenant', async () => {
    const a = await (await redeem(await freshCode())).json() as { token: string };
    const b = await (await redeem(await freshCode())).json() as { token: string };
    const { resolveCtx } = await import('../src/auth.js');
    const ca = await resolveCtx(`Bearer ${a.token}`);
    const cb = await resolveCtx(`Bearer ${b.token}`);
    made.push(ca.tenantId, cb.tenantId);
    // One tenant per person is what makes every RLS policy in the system do real work.
    expect(ca.tenantId).not.toBe(cb.tenantId);
  });

  it('will not spend a code twice', async () => {
    const code = await freshCode();
    const first = await redeem(code);
    expect(first.status).toBe(200);
    const { resolveCtx } = await import('../src/auth.js');
    made.push((await resolveCtx(`Bearer ${((await first.json()) as { token: string }).token}`)).tenantId);

    expect((await redeem(code)).status).not.toBe(200);
  });

  it('refuses a code nobody issued', async () => {
    expect((await redeem('ZZZZ-ZZZZ')).status).not.toBe(200);
  });
});
