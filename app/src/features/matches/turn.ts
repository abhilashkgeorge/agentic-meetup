/**
 * Whose move it is on a card, and every word the card and the reveal say about it.
 *
 * CONSENT FIRST (the founder, 2026-09-28): nobody's photos or name reach anyone until
 * THAT person has said yes to them.
 *   1. The first mover sees the words card and the other's character -- no photos, no
 *      name -- and taps "Yes, share my profile with them". That yes is the permission.
 *   2. The second person then sees the first mover's photos and card, and taps "Yes,
 *      share mine back" or "Not for me".
 *   3. Only after that second yes does the first mover see the second person's photos.
 *      Then the chat opens.
 * The server enforces the same order (api/dating.ts decide, migration 0073).
 *
 * Kept here, out of the screens, so one test can hold every sentence to the rule: no
 * line may promise something the rule does not do.
 */
import type { MatchCard } from '../../lib/api';

export type Turn =
  /** Your move, and nothing is shared with you yet: decide on the words card. */
  | 'share-first'
  /** Your move, and they have shared their profile with you: see it, then answer. */
  | 'share-back'
  /** You shared yours; their move. */
  | 'you-shared'
  /** They decide first; nothing to do yet. */
  | 'they-first';

export function turnOf(m: Pick<MatchCard, 'waitingOnYou' | 'sharedWithYou' | 'youShared'>): Turn {
  if (m.waitingOnYou) return m.sharedWithYou ? 'share-back' : 'share-first';
  return m.youShared ? 'you-shared' : 'they-first';
}

export const WORDS = {
  shareFirst: 'Yes, share my profile with them',
  shareFirstPractice: 'I would share my profile',
  shareFirstNote: 'This shows them your photos and first name. Nothing is shared until you tap it.',
  seeThem: 'See who it is',
  seeThemPractice: 'See the practice profile',
  notThisOne: 'Not this one',
  youShared: 'You shared your profile. If they share theirs back, you can talk.',
  youSharedPractice: 'Noted. This one is practice, so nobody will answer.',
  theyFirst: 'They decide first. If they share their profile, you will see it here.',
  shareBack: 'Yes, share mine back',
  shareBackPractice: 'I would share mine back',
  notForMe: 'Not for me',
  shareBackNote: 'Yes shows them your photos and first name, and opens a chat. If you say no, they are not told.',
  practiceNote: 'Nothing happens either way. This one is practice.',
  failed: 'That did not go through. Try again.',
} as const;
