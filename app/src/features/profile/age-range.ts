/**
 * The ages you would meet: a pre-filled pair of numbers, and the rules for them.
 *
 * WHAT WAS WRONG. `age_range_sought` has been a fact predicate from the start, the match
 * profile reads it into age_min / age_max, and the candidate query tests it both ways
 * -- your age against their range, and theirs against yours. Nothing in the app ever
 * wrote it for a real person. So the age filter ran one way only: the practice profiles
 * carried a range and real people did not, which meant a real person was checked
 * against everybody else's idea of a good age and nobody was checked against theirs.
 *
 * THE PRE-FILL IS YOUR OWN AGE, FIVE EITHER SIDE, clamped to 18..99, and it is shown as
 * two numbers the person can change before anything is sent. Never silently applied:
 * a range nobody saw is a rule nobody chose. Five is a starting point to edit, not a
 * claim about what anybody wants.
 *
 * Age is year minus year, the same arithmetic as `ageFromYear` in shared and as the
 * match profile, so the range lines up with the age the filter actually compares.
 */
import { MIN_AGE, ageFromYear } from '@clone/shared';

export interface AgeRange { min: number; max: number }

/** The youngest age a range may name: the product's own floor, nobody under it. */
export const AGE_FLOOR = MIN_AGE;
/** The oldest. Two digits on a number pad, and nobody is excluded by it. */
export const AGE_CEIL = 99;
/** Either side of your own age, for the pre-fill. */
export const AGE_SPREAD = 5;

const clamp = (n: number): number => Math.min(AGE_CEIL, Math.max(AGE_FLOOR, n));

/**
 * The pre-fill: own age ±5, clamped to 18..99.
 *
 * Null when the birth year is not known -- the fields are then left blank for the
 * person to type rather than filled with a guess. The wizard asks the birth year
 * first, so in practice this only happens on a server that lost it.
 */
export function ageRangeDefault(birthYear: number | null | undefined, now: Date = new Date()): AgeRange | null {
  if (!birthYear || !Number.isFinite(birthYear)) return null;
  const age = ageFromYear(birthYear, now);
  return { min: clamp(age - AGE_SPREAD), max: clamp(age + AGE_SPREAD) };
}

/**
 * Two typed boxes -> a range the server will accept, or null.
 *
 * Whole numbers only, both inside 18..99, and the first no higher than the second.
 * Null is what keeps the Next button dead, so a half-typed "2" never goes out as a
 * rule that excludes everybody over two.
 */
export function parseAgeRange(min: string, max: string): AgeRange | null {
  if (!/^\d{1,3}$/.test(min.trim()) || !/^\d{1,3}$/.test(max.trim())) return null;
  const lo = Number(min.trim());
  const hi = Number(max.trim());
  if (lo < AGE_FLOOR || hi > AGE_CEIL || lo > hi) return null;
  return { min: lo, max: hi };
}

/**
 * A stored range, from the text "What it knows" carries for it.
 *
 * The server's wording for it is its own business ("26-36", "26 to 36", a JSON
 * object), so this reads the first two numbers and checks them, rather than depending
 * on one format. Null when there are not two sensible numbers in it.
 */
export function rangeFromText(text: string | null | undefined): AgeRange | null {
  const nums = String(text ?? '').match(/\d{1,3}/g);
  if (!nums || nums.length < 2) return null;
  return parseAgeRange(nums[0]!, nums[1]!);
}

/** "26 to 36", for a profile row. */
export const rangeLabel = (r: AgeRange | null): string => (r ? `${r.min} to ${r.max}` : 'Not set');
