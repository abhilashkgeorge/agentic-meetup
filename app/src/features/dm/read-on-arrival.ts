/**
 * A MESSAGE THAT ARRIVES WHILE THE CONVERSATION IS OPEN IS READ.
 *
 * Only opening the conversation used to count as reading it, so a message that came in
 * while it was open stayed "Delivered" on the other phone, though it had been read the
 * moment it arrived (the two-phone test, 2026-10-02). Open means on screen with the app
 * in front: a phone locked on the conversation, or one with another screen over it,
 * reads nothing.
 */
export interface Looking {
  /** This conversation is the screen on top. */
  focused: boolean;
  /** The app is in front (AppState 'active'). */
  front: boolean;
  /** The thread has loaded. */
  ready: boolean;
}

/** The newest message from the other person: the one reading the conversation covers. */
export function newestTheirs(messages: readonly { id: string; mine: boolean }[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) if (!messages[i]!.mine) return messages[i]!.id;
  return null;
}

/** Whether to say the conversation is read now: something of theirs is here, and it is being looked at. */
export const readNow = (theirs: string | null, l: Looking): boolean =>
  theirs !== null && l.focused && l.front && l.ready;
