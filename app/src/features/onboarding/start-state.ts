/**
 * What the first setup screen does after "Go" -- kept out of the component so a test can
 * hold it to one rule.
 *
 * THE RULE: anything heard moves the person on. A sentence about a field they will tap
 * anyway -- city, age, the cards, and since 2026-09-28 work, exercise, sleep and moving
 * cities -- is only HELD for a Yes, not learned. The screen used to advance only on a
 * learned fact, so a first sentence like "I work in AI and run most mornings" left a
 * brand-new person stuck on the very first screen, told "Got it" and going nowhere.
 *
 * Held-only skips the sample reply ("Now it's you"): the clone has nothing live to
 * answer from yet, and would be writing from nothing.
 */
import type { TellResult } from '../../lib/api';

export type AfterTell =
  | { next: 'retry'; note: string }
  | { next: 'sample' }
  | { next: 'questions' };

export function afterTell(r: TellResult | null): AfterTell {
  if (!r) return { next: 'retry', note: 'Could not reach the server.' };
  if (r.learned > 0) return { next: 'sample' };
  if ((r.toConfirm ?? 0) > 0) return { next: 'questions' };
  return { next: 'retry', note: r.message };
}
