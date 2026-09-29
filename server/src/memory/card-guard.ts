/**
 * "Yes, that's right" never wipes a card answer, or takes somebody out of the pool (the
 * founder, 2026-09-29; docs 15.3 item 16).
 *
 * A sentence the clone heard about a card field waits for the person's Yes
 * (TAPPED_PREDICATES), and the Yes re-commits the words -- over the card's own answer.
 * Words the card cannot read replaced the tapped answer with nothing: "socially" for how
 * often you drink left "unknown", so every rule anybody had on drinking passed them. A
 * place named without a map point replaced the point, and the person left the pool. Now
 * such words leave the card as it is. Words the card CAN read still change it: that is
 * what the Yes is for.
 */
import type { PoolClient } from 'pg';
import { deriveValue } from '@clone/shared';
import { TAPPED_PREDICATES } from '../onboarding/questions.js';

/** Whether a value can stand as this card's answer: readable, and for a place, a point. */
export function cardCanRead(predicate: string, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (predicate === 'lives_in') {
    const v = value as { lat?: unknown; lon?: unknown };
    return typeof v.lat === 'number' && typeof v.lon === 'number';
  }
  return true;
}

/**
 * The card answer that confirming these words would wipe, in its own words -- or null:
 * not a card field, words the card can read, or no answer there to lose.
 */
export async function cardItWouldWipe(
  c: PoolClient, userId: string, predicate: string, objectText: string,
): Promise<string | null> {
  if (!TAPPED_PREDICATES.has(predicate)) return null;
  if (cardCanRead(predicate, deriveValue(predicate, objectText))) return null;
  const { rows } = await c.query<{ object_text: string; object_value: unknown }>(
    `SELECT object_text, object_value FROM facts
      WHERE user_id = $1 AND predicate = $2 AND status = 'active' AND valid_to IS NULL
      ORDER BY recorded_at DESC`,
    [userId, predicate],
  );
  return rows.find((r) => cardCanRead(predicate, r.object_value))?.object_text ?? null;
}
