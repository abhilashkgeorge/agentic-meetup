/**
 * Points: earned for answering, spent on the character. Owner-only, append-only.
 *
 * Everything here runs on the caller's own tenant session. `award` is idempotent by
 * construction -- the ledger's UNIQUE (user_id, reason, ref) means the second award
 * for the same thing inserts nothing and returns 0 -- so callers never have to ask
 * "did I already pay for this?". `buy` takes a per-person advisory lock inside the
 * session's transaction so two taps cannot both spend the same balance.
 */
import type { PoolClient } from 'pg';
import { currentItem, type LookItem } from '@clone/shared';

export const POINTS = { checkin: 50, met: 10, look: 20, photos_checked: 30 } as const;
export type PointReason = keyof typeof POINTS;

interface Who { tenantId: string; userId: string }

/** Points actually added: the fixed amount, or 0 when this was already paid. */
export async function award(db: PoolClient, who: Who, reason: PointReason, ref: string): Promise<number> {
  const { rows } = await db.query<{ amount: number }>(
    `INSERT INTO points_ledger (tenant_id, user_id, reason, ref, amount)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, reason, ref) DO NOTHING
     RETURNING amount`,
    [who.tenantId, who.userId, reason, ref, POINTS[reason]],
  );
  return rows[0]?.amount ?? 0;
}

export async function balance(db: PoolClient, userId: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    'SELECT coalesce(sum(amount), 0)::int AS n FROM points_ledger WHERE user_id = $1', [userId]);
  return Number(rows[0]?.n ?? 0);
}

export async function owned(db: PoolClient, userId: string): Promise<string[]> {
  const { rows } = await db.query<{ item: string }>('SELECT item FROM look_items WHERE user_id = $1', [userId]);
  // By what each thing is called now: a cap bought as "accessory:2" before the one
  // extra became five places to wear things is "hat:1" today (shared/look.ts).
  return [...new Set(rows.map((r) => currentItem(r.item)))];
}

/**
 * Buy one item. `owned` costs nothing (a second tap is not a second purchase);
 * `short` changes nothing. Otherwise the item is theirs and the ledger shows the
 * spend as a negative row keyed to the item.
 */
export async function buy(
  db: PoolClient, who: Who, item: LookItem,
): Promise<{ status: 'ok' | 'owned' | 'short'; balance: number }> {
  // One buyer per person at a time, for the length of this transaction.
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [who.userId]);
  const have = await owned(db, who.userId);
  if (have.includes(item.id)) return { status: 'owned', balance: await balance(db, who.userId) };
  const bal = await balance(db, who.userId);
  if (bal < item.cost) return { status: 'short', balance: bal };
  await db.query(
    'INSERT INTO look_items (user_id, tenant_id, item) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [who.userId, who.tenantId, item.id]);
  await db.query(
    `INSERT INTO points_ledger (tenant_id, user_id, reason, ref, amount) VALUES ($1, $2, 'buy', $3, $4)`,
    [who.tenantId, who.userId, item.id, -item.cost]);
  return { status: 'ok', balance: bal - item.cost };
}
