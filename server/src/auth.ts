/**
 * Every request resolves to a concrete (tenantId, userId) before it touches data,
 * and there is no default identity. The single failure that disqualified Hermes
 * Agent as our engine was a default session id -- two users whose first message is
 * "hi" sharing a transcript. There is no fallback here and there never will be.
 *
 * The token is signed, so a forged one is rejected without a query. It is then
 * looked up anyway, so a revoked device or a deleted user stops working at once
 * rather than at expiry. Signature first, database second: the cheap check guards
 * the expensive one.
 */
import { authLookup } from './db/client.js';
import type { TenantCtx } from './db/client.js';
import { env } from './env.js';
import { verifyToken } from './tokens.js';

export class Unauthorized extends Error {
  constructor(msg = 'unauthorized') {
    super(msg);
    this.name = 'Unauthorized';
  }
}

const bare = (bearer: string) => bearer.replace(/^Bearer\s+/i, '').trim();

/** Session lookup. Sees exactly one row, named by id, under an RLS policy. */
async function fromSession(sessionId: string): Promise<TenantCtx | null> {
  const row = await authLookup(sessionId, async (c) => {
    const { rows } = await c.query<{ user_id: string; tenant_id: string }>(
      // A BANNED PERSON IS SIGNED OUT, whatever their sessions say (0064). ban_user
      // revokes the sessions too; this is the check that holds if one is ever missed.
      `SELECT user_id, tenant_id FROM device_sessions
        WHERE id = $1 AND revoked_at IS NULL AND expires_at > now() AND NOT is_banned(user_id)`,
      [sessionId],
    );
    return rows[0];
  });
  if (!row) return null;

  // Fire-and-forget: a failed heartbeat must never fail the request it rode in on.
  void authLookup(sessionId, (c) =>
    c.query(`UPDATE device_sessions SET last_seen_at = now() WHERE id = $1`, [sessionId]),
  ).catch(() => {});

  return { tenantId: row.tenant_id, userId: row.user_id };
}

/** The pre-invite credential: the bearer token WAS the user id. Time-limited. */
async function fromLegacy(userId: string): Promise<TenantCtx | null> {
  if (!env.ALLOW_LEGACY_TOKENS) return null;
  const row = await authLookup(userId, async (c) => {
    const { rows } = await c.query<{ id: string; tenant_id: string }>(
      'SELECT id, tenant_id FROM app_users WHERE id = $1',
      [userId],
    );
    return rows[0];
  });
  return row ? { tenantId: row.tenant_id, userId: row.id } : null;
}

export async function resolveCtx(bearer: string | undefined): Promise<TenantCtx> {
  if (!bearer) throw new Unauthorized('missing bearer token');
  const token = bare(bearer);

  const sessionId = verifyToken(token);
  if (sessionId) {
    const ctx = await fromSession(sessionId);
    if (!ctx) throw new Unauthorized('session revoked or expired');
    return ctx;
  }

  if (/^[0-9a-f-]{36}$/i.test(token)) {
    const ctx = await fromLegacy(token);
    if (ctx) return ctx;
  }

  throw new Unauthorized('bad token');
}

/** True when the caller is still on the old credential and should upgrade. */
export function isLegacyToken(bearer: string | undefined): boolean {
  if (!bearer) return false;
  const token = bare(bearer);
  return verifyToken(token) === null && /^[0-9a-f-]{36}$/i.test(token);
}
