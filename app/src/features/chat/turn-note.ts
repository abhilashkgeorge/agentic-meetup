/**
 * What the chat says when a turn fails, instead of nothing (the founder, 2026-09-29:
 * "when chat hits the limit, say so clearly").
 *
 * It used to say nothing at all -- the socket logged the error and, worse, blanked the
 * clone's PREVIOUS reply (it "finished" the last completed turn with empty text). Now the
 * waiting turn ends, and a line in the chat says why: the day's limit in the server's own
 * words (server metering.ts budgetMessage), anything else as a plain retry.
 */
export const TURN_FAILED = "That didn't go through. Try again.";

/**
 * The same limit, met by sending the agent out. It said "Your agent has been out enough
 * for today" -- to somebody whose chat had used the day's turns and whose agent never went
 * out at all.
 */
export const SHARED_LIMIT = "That's all for today: chat, learning and your agent's rounds share one daily allowance, and today's is used up. Try again tomorrow.";

/** The line to show for a failed turn. */
export function noteFor(code: string, message: string): string {
  return code === 'budget_exceeded' && message ? message : TURN_FAILED;
}
