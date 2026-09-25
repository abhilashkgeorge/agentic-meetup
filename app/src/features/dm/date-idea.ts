/**
 * Whether the chat shows the agents' date idea with its "Propose this date" button.
 *
 * Only while there is an idea and nobody has proposed it: after that the two of them
 * are talking about it, and the proposal is in the conversation as a message. The
 * agent never schedules -- the button sends a message from the person and that is all
 * (server api/date-idea.ts).
 */
export type DateIdeaState = { idea: string | null; proposed: boolean } | null;

export const showDateIdea = (s: DateIdeaState): s is { idea: string; proposed: false } =>
  s !== null && s.idea !== null && !s.proposed;
