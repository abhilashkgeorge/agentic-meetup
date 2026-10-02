/**
 * Where the interview goes when its questions run out (interview-screen.tsx).
 *
 * STRAIGHT ON TO THE ESSENTIALS while they are still to come. In setup they always are --
 * name, birth year, where you live and how far are asked after the cards -- so every new
 * person landed on "A few things missing" and a "Finish the basics" button, a screen that
 * read as if they had skipped something when they had not (the founder, 2026-10-02: "why
 * does it show a few things are missing even though you didn't skip anything ... can it
 * not be part of the onboarding flow?"). The essentials screen counts what is left itself.
 *
 * "That's enough to start" keeps its screen: an agent that can go out is worth stopping on.
 */
import type { InterviewState } from '../../lib/api';

/** No question left worth asking here. */
export function questionsOver(
  q: InterviewState['question'], stopped: boolean, fromFinish: boolean,
): boolean {
  return !q || stopped || (fromFinish && (q.tier === 'optional' || q.tier === 'free'));
}

/** Where to go without a screen of its own, or null when the end deserves one. */
export function straightOn(over: boolean, ready: boolean, fromFinish: boolean): string | null {
  if (!over || ready) return null;
  return fromFinish ? '/onboarding/essentials?finish=1' : '/onboarding/essentials';
}
