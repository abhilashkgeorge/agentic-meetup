/**
 * Gaps: questions the clone is holding rather than answers it invented.
 *
 * A gap row in `fact_conflicts` has no fact attached (see migration 0009) because the
 * whole point is that nothing was written. Showing these to the person is the
 * cheapest honest thing this product does, and it is the half no rival can render --
 * a store that fills unknowns by inference has no list to show.
 */
import type { PoolClient } from 'pg';

export interface Gap {
  id: string;
  question: string;
  askedAt: Date | null;
}

export async function openGaps(c: PoolClient, userId: string, limit = 20): Promise<Gap[]> {
  const { rows } = await c.query<{ id: string; clarifying_question: string; asked_at: Date | null }>(
    `SELECT id, clarifying_question, asked_at FROM fact_conflicts
      WHERE user_id = $1 AND kind = 'gap' AND status IN ('open', 'asked')
      ORDER BY detected_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({ id: r.id, question: r.clarifying_question, askedAt: r.asked_at }));
}

/** The single gap the clone is least sure about — what a weekly round asks. */
export async function nextGap(c: PoolClient, userId: string): Promise<Gap | null> {
  const { rows } = await c.query<{ id: string; clarifying_question: string; asked_at: Date | null }>(
    `SELECT id, clarifying_question, asked_at FROM fact_conflicts
      WHERE user_id = $1 AND status = 'open'
      ORDER BY asked_at NULLS FIRST, detected_at
      LIMIT 1`,
    [userId],
  );
  const r = rows[0];
  return r ? { id: r.id, question: r.clarifying_question, askedAt: r.asked_at } : null;
}
