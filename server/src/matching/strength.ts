/**
 * How much a stated preference counts when it is met: the recorded score (score.ts) and
 * the order a round meets people in (candidates.ts) read the same numbers, so "Really
 * want" can never mean one thing to one and another to the other.
 */
export const STRENGTH_WEIGHT = {
  dealbreaker: 0, // already enforced by the filter; counting it again double-dips
  strong: 3,
  mild: 1,
} as const satisfies Record<string, number>;
