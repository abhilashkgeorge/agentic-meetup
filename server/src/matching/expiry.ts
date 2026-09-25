/**
 * A card nobody answers expires (0069, the founder's item 9).
 *
 * Three days for whoever's turn it is: from when the cards are issued for the first
 * mover, and again from the first mover's yes for the other person. `answer_by` holds
 * the deadline; this moves an overdue card to 'expired' -- its own status, never a
 * 'lapsed' no, and with both answers left empty, so the measurement leaves it out
 * instead of counting silence as a rejection (scripts/compare-scorers.ts).
 *
 * Run as the matchmaker, the one role that writes rendezvous across people: on a timer
 * (index.ts), and at the top of every read and answer of a card, so nobody sees or
 * answers a card whose time is up just because the timer has not come round.
 */
import type { PoolClient } from 'pg';
import { matchmakerSession } from '../db/client.js';
import { log } from '../log.js';

export const ANSWER_DAYS = 3;

/** The SQL for "a new three days from now", used wherever a turn starts. */
export const ANSWER_BY = `now() + interval '${ANSWER_DAYS} days'`;

/** Expire every overdue card, on a matchmaker connection already open. */
export async function expireDue(c: PoolClient): Promise<number> {
  const { rowCount } = await c.query(
    `UPDATE rendezvous SET status = 'expired', expired_at = now()
      WHERE status = 'decided' AND answer_by < now()`);
  return rowCount ?? 0;
}

/** The same, on its own connection: the timer's entry point. */
export async function expireMatches(): Promise<number> {
  const n = await matchmakerSession(expireDue);
  if (n) log.info({ expired: n }, 'matches expired: no answer in three days');
  return n;
}
