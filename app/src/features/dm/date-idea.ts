/**
 * What the top of a chat shows: the agents' date idea with "Propose this date", or the
 * one gentle nudge when the chat has been quiet -- or nothing. Plain, so it can be
 * tested without a phone.
 *
 * THE IDEA (item 7) shows while there is one and nobody has proposed it. The button
 * sends a message from the person; the agent never schedules (server api/date-idea.ts).
 *
 * THE NUDGE (item 8) shows once per match, two days after it, if nobody has written
 * for two days (server 0068). It mentions the date idea when there is one, and keeps
 * the button while the idea is unproposed. The chat tells the server it was seen, and
 * it never comes back for that match.
 */
export type DateIdeaState = { idea: string | null; proposed: boolean; quiet?: boolean } | null;

/** The Chats list line while the nudge is due. */
export const QUIET_LINE = 'Quiet for two days. Say hello?';

export interface ChatCard {
  title: string;
  line: string;
  /** Whether "Propose this date" is on the card. */
  propose: boolean;
  /** A nudge: the chat reports it seen as soon as it is shown. */
  nudge: boolean;
}

export function chatCard(s: DateIdeaState): ChatCard | null {
  if (!s) return null;
  const canPropose = s.idea !== null && !s.proposed;
  if (s.quiet) {
    return {
      title: 'IT HAS BEEN QUIET FOR TWO DAYS',
      line: canPropose ? `Your agents had an idea: ${s.idea}` : 'Say hello? You both said yes.',
      propose: canPropose,
      nudge: true,
    };
  }
  if (canPropose) return { title: "YOUR AGENTS' DATE IDEA", line: s.idea!, propose: true, nudge: false };
  return null;
}

/** Kept for the propose test: the idea shows while nobody has proposed it. */
export const showDateIdea = (s: DateIdeaState): boolean => chatCard(s)?.propose === true;
