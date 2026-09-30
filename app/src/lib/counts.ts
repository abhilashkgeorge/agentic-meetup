/**
 * A pool count as the server sends it: rounded to ten, or null for "under 20".
 *
 * Why the server will not send an exact small number: with the five core cards every
 * real person has a value on smoking, drinking, kids, monogamy and food, and an exact
 * count -- taken before and after flipping one rule -- is how many people hold the
 * value that rule excludes. Taken a day apart, it is one new person's answer. So every
 * count is rounded (server/src/matching/candidates.ts shownCount), and below twenty
 * there is no number at all. This is the one place the app turns that into words.
 */
export function countLabel(n: number | null | undefined): string {
  return n === null || n === undefined ? 'Under 20' : n.toLocaleString();
}

/**
 * What one rule costs, as the funnel shows it: "\u22122,600", set like the counts around it.
 * It was "\u22122600" under "5,010" (Matches and Looking for, on the Pixel, 2026-09-30).
 */
export function costLabel(n: number): string {
  return `\u2212${n.toLocaleString()}`;
}

/** True when the server said "under 20": a small pool, which may be none at all. */
export const isUnder20 = (n: number | null | undefined): boolean => n === null || n === undefined;
