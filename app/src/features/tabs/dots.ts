/**
 * A DOT ON MATCHES AND ON CHATS when something waits for you there.
 *
 * On the two phones (2026-10-04) Kavya was the one whose agent was met: a card came for
 * her, Arjun said yes, his first message came -- and nothing outside those two tabs said
 * so. Push, which would, is not set up yet (docs/end-to-end 13), and the town says "Your
 * agent met one person" only to whoever sent theirs out. A dot, not a number: the inbox
 * carries unread "by weight rather than by a badge shouting a number"
 * (conversations-screen.tsx), and the tab bar does too. Plain, no React.
 */

/** Chats: a conversation with something you have not read. */
export const chatsWaiting = (conversations: readonly { unread: number }[]): boolean =>
  conversations.some((c) => c.unread > 0);

/** Matches: a card that waits on your answer. */
export const matchesWaiting = (matches: readonly { waitingOnYou: boolean }[]): boolean =>
  matches.some((m) => m.waitingOnYou);

/** What a screen reader hears for a tab with its dot: the tab, then why. */
export const withDot = (label: string, dot: boolean, why: string): string => (dot ? `${label}, ${why}` : label);
