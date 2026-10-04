/**
 * Reading characters.
 *
 * One row per person who has built one (0056). Everybody else -- a real person who
 * has not yet, a practice profile -- gets one from a seed, so the square is never
 * a row of identical capsules and the same person is always the same character.
 *
 * The seed is an HMAC of the user id under AUTH_SECRET, like `agentRef`, but NOT
 * per-viewer: a character that changes per viewer is not a character. Rotating the
 * secret re-rolls unsaved and practice looks; a saved look is a row and stays.
 */
import { createHmac } from 'node:crypto';
import type { PoolClient } from 'pg';
import { type Look, clampLook, figureForGender, lookFor, starterLookFor } from '@clone/shared';
import { env } from '../env.js';

export function lookSeed(userId: string): number {
  return parseInt(createHmac('sha256', env.AUTH_SECRET).update(`look:${userId}`).digest('hex').slice(0, 8), 16);
}

/**
 * Practice people wear the whole catalog; real people who have not built one, the free
 * set, on the figure for what they said they are (`gender`, when known).
 */
export const defaultLook = (userId: string, synthetic: boolean, gender?: string | null): Look =>
  synthetic ? lookFor(lookSeed(userId)) : starterLookFor(lookSeed(userId), figureForGender(gender));

/**
 * Looks for a batch of people, one query, a default for anybody without a row.
 * Works on any session that may read `looks`: the app's own, the match role for the
 * roster, the matchmaker for a reveal or an inbox.
 */
export async function looksFor(
  db: PoolClient,
  ids: readonly string[],
  synthetic: ReadonlySet<string> = new Set(),
): Promise<Map<string, Look>> {
  const out = new Map<string, Look>();
  if (!ids.length) return out;
  const { rows } = await db.query<{ user_id: string; look: unknown }>(
    'SELECT user_id, look FROM looks WHERE user_id = ANY($1::uuid[])', [ids],
  );
  for (const r of rows) out.set(r.user_id, clampLook(r.look));
  const unbuilt = ids.filter((id) => !out.has(id));
  if (unbuilt.length) {
    // THE FIGURE FOR WHAT THEY SAID THEY ARE: a woman who skipped the builder walked the
    // park as a man (2026-10-04). Every caller's session may read match_profile; one that
    // cannot see somebody's row (the match role, somebody out of the pool) gets no gender
    // back, and the figure is drawn, as before.
    const { rows: said } = await db.query<{ user_id: string; gender: string | null }>(
      'SELECT user_id, gender FROM match_profile WHERE user_id = ANY($1::uuid[])', [unbuilt],
    );
    const gender = new Map(said.map((r) => [r.user_id, r.gender]));
    for (const id of unbuilt) out.set(id, defaultLook(id, synthetic.has(id), gender.get(id)));
  }
  return out;
}

export async function lookOf(db: PoolClient, userId: string, synthetic = false): Promise<Look> {
  return (await looksFor(db, [userId], synthetic ? new Set([userId]) : undefined)).get(userId)!;
}
