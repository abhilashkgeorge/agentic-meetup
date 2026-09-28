/**
 * The town's view of other people, and what it is allowed to say about them.
 *
 * The 3D Home shows a small square with two dozen agents walking around. Almost all
 * of them are strangers, and a stranger in the square is exactly as anonymous as a
 * stranger in a real one: the character they built (a catalog of small integers, shared/look.ts), whether they are a practice profile.
 * Not a name, not an age, not a tag, not an id, not where they are.
 *
 * REFS, NOT IDS. Each agent is addressed by a per-viewer HMAC of the viewer and the
 * other person, so two accounts looking at the same person hold two different
 * handles that cannot be joined, nobody can enumerate the pool by walking ids, and
 * rotating AUTH_SECRET simply re-keys the town. A ref resolves back to a person only
 * among those who could stand in a square (resolveAgentRef), and only a round -- which
 * checks every rule, both ways -- ever meets them.
 */
import { createHmac } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ServerEvent } from '@clone/shared';
import { env } from '../env.js';
import { pushTo } from '../messaging/hub.js';

/**
 * Targeted rounds allowed per person per rolling day, counted in the database. It was
 * a spend control while each visit held a conversation (~$0.02); a visit costs no
 * model call now, and the cap stays as the bound on how often one person can put
 * themselves in front of another.
 */
export const TARGETED_PER_DAY = Number(process.env.TARGETED_ROUNDS_PER_DAY ?? 5);

/**
 * Open rounds ("send my agent out", no target) allowed per person per rolling day,
 * counting only the ones that met somebody. Counted in the database, like the above.
 *
 * WHY IT EXISTS NOW. Nothing limited an open round except the day's model budget,
 * because a round spent it: the Seeker test account's second round of the day was a
 * budget_exceeded, which is the founder's recorded one-round-a-day rule. Since
 * 2026-09-23 a round makes no model call, so that cap no longer bites and one person
 * could tap every few seconds -- three new people a tap, a card and three town events
 * on each real person's phone -- and in a small real pool put themselves in front of
 * everybody eligible within minutes. This puts the day's limit back as a limit on
 * EXPOSURE rather than spend. A round that failed, or found nobody, put nobody in
 * front of anybody and does not count.
 */
export const ROUNDS_PER_DAY = Number(process.env.ROUNDS_PER_DAY ?? 1);

/** How many strangers the square holds. Bounded, so the roster is a sample, never a list. */
// 40, up from 24, once the square became a city of thirty tiles: the sample is the
// forty nearest plus the twenty-four most recent, ranked, and the canvas draws the
// first sixty-four agents (met seats come first).
export const STRANGERS_IN_SQUARE = 40;

export function agentRef(viewerId: string, otherId: string): string {
  return createHmac('sha256', env.AUTH_SECRET)
    .update(`world:${viewerId}:${otherId}`)
    .digest('hex')
    .slice(0, 32);
}

export const isAgentRef = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{32}$/.test(s);

/**
 * The person behind a ref, or null.
 *
 * FOUND WITHOUT YOUR RULES (2026-09-28). This used to scan the viewer's candidate list
 * -- every rule, both ways -- so a ref for somebody who failed them answered "not here"
 * at once and for free, while one who passed became a visit that counted. Change your
 * own must-have and tap again, and the difference said which card answer somebody
 * gave: a probe on a person you could recognise in the square by their character. Now a
 * ref resolves among everybody who could stand in anybody's square -- in the pool,
 * visible to you (practice profiles only while you see them), not blocked, not
 * somebody you have already met (`met`, from your own rows: a pair meets once) -- and
 * the rules are the round's to check (orchestrator.ts isCandidate), after the visit is
 * counted. Whatever a card says, a tap costs one of the day's five.
 *
 * Runs under the matching role, which reads profiles across tenants and nothing else.
 */
export async function resolveAgentRef(
  c: PoolClient,
  viewerId: string,
  ref: string,
  met: ReadonlySet<string> = new Set(),
): Promise<string | null> {
  if (!isAgentRef(ref)) return null;
  const { rows } = await c.query<{ user_id: string }>(
    `SELECT b.user_id FROM match_profile a, match_profile b
      WHERE a.user_id = $1 AND b.user_id <> a.user_id AND a.in_pool AND b.in_pool
        AND (a.is_synthetic = b.is_synthetic OR (a.sees_synthetic AND b.is_synthetic))
        AND NOT block_exists(a.user_id, b.user_id)`,
    [viewerId],
  );
  for (const { user_id: id } of rows) {
    if (!met.has(id) && agentRef(viewerId, id) === ref) return id;
  }
  return null;
}

/**
 * Tell one person's open devices something happened. Typed against the shared event
 * union, so a payload the app cannot parse fails to compile here rather than being
 * dropped silently by the client's schema check.
 */
export function notify(userId: string, event: ServerEvent): boolean {
  return pushTo(userId, event);
}

/** Whether a seat in the square is talking, waiting, and so on. See api/world.ts. */
export type SeatState = 'talking' | 'briefed' | 'shared' | 'waiting' | 'introduced' | 'passed';

/**
 * A met agent's state, from the viewer's own row and the two one-bit functions.
 *
 * `passed` is ONLY the viewer's own no. `shared` is the viewer's own yes: they shared
 * their profile, and the next move is the other person's. `waiting` is "not your turn
 * yet": the other person decides first. The other person's no also lapses the row and
 * must never read as a no here; the status alone cannot be trusted for this, the
 * viewer's own answer can.
 */
export function seatState(seat: {
  status: string;
  humanSaysYes: boolean | null;
  firstMover: string | null;
  otherSaidYes: boolean | null;
}, viewerId: string): SeatState {
  if (seat.humanSaysYes === false) return 'passed';
  if (seat.status === 'introduced') return 'introduced';
  if (seat.status === 'running') return 'talking';
  if (seat.humanSaysYes === true) return 'shared';
  const myTurn = seat.firstMover === viewerId || seat.otherSaidYes === true;
  return myTurn ? 'briefed' : 'waiting';
}
