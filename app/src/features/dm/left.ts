/**
 * A chat whose other person deleted their account (server 0082, the founder 2026-09-29).
 *
 * It used to vanish from the list, which reads exactly like being blocked. Now it stays
 * as "They left" for the 30 days the chat is held hidden -- in case this person wants to
 * report something -- and then goes. The words are never shown: only the reviewer reads
 * them, and only after a report.
 */
import type { LeftChatRow } from '../../lib/api';

export const LEFT_LINE = 'They left';

/** What tapping it says, and whether a report can still be made. */
export function leftNotice(l: LeftChatRow): { title: string; body: string; canReport: boolean } {
  return l.reported
    ? { title: `${l.name} left`, body: 'They deleted their account. You reported them, and somebody will look at it.', canReport: false }
    : {
      title: `${l.name} left`,
      body: 'They deleted their account. Your chat is kept hidden for 30 days, only in case you want to report something. Then it is deleted.',
      canReport: true,
    };
}
