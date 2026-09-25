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
 * rotating AUTH_SECRET simply re-keys the town. A ref is resolved back to a person
 * only through the candidate query the round itself would run, so it can never name
 * somebody a round could not have met.
 */
import { createHmac } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ServerEvent } from '@clone/shared';
import { env } from '../env.js';
import { pushTo } from '../messaging/hub.js';
import { candidateIds } from './candidates.js';

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
 * Scans the viewer's own candidate list rather than the whole pool: a ref for
 * somebody the filters exclude resolves to nothing, which is the same answer as a
 * ref that was never issued. Runs under the matching role, like the list it scans.
 */
export async function resolveAgentRef(
  c: PoolClient,
  viewerId: string,
  ref: string,
): Promise<string | null> {
  if (!isAgentRef(ref)) return null;
  for (const id of await candidateIds(c, viewerId, 500)) {
    if (agentRef(viewerId, id) === ref) return id;
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
export type SeatState = 'talking' | 'briefed' | 'waiting' | 'introduced' | 'passed';

/**
 * A met agent's state, from the viewer's own row and the two one-bit functions.
 *
 * `passed` is ONLY the viewer's own no. The other person's no also lapses the row,
 * and it must read as `waiting` -- the same as "has not looked yet" -- because the
 * reveal promises "Either way, they are never told what you chose." The status
 * alone cannot be trusted for this; the viewer's own answer can.
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
  if (seat.humanSaysYes === true) return 'waiting';
  const myTurn = seat.firstMover === viewerId || seat.otherSaidYes === true;
  return myTurn ? 'briefed' : 'waiting';
}
