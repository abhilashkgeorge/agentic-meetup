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

/**
 * The whole app is small: fewer than twenty people your agent could consider before any
 * rule of yours applies (the funnel's first step, "everyone", comes back as "under 20").
 * Then a small pool is the app's size, not your rules, and saying "loosen something" is
 * wrong -- it told a brand-new tester, one of two people on the app, to give up her
 * must-haves (Matches and Looking for, the release app, 2026-09-30).
 */
export function fewOnTheApp(steps: readonly { step: string; remaining: number | null }[] | undefined): boolean {
  const everyone = steps?.find((s) => s.step === 'everyone');
  return everyone !== undefined && everyone.remaining === null;
}

// No claim about what was asked: on a near-empty app the asks may well be why nobody is
// left -- "That is not because of anything you asked for" sat under "Nobody fits what you
// asked for" on one screen (the Pixel, 2026-10-02).
export const FEW_ON_THE_APP = 'Very few people are on the app yet. As more join, your agent will have more people to meet.';

/**
 * Whether the pool card's sum -- everyone your agent could consider, what each rule takes,
 * what is left -- says anything: only when some rule takes somebody. Without one it only
 * repeated the big number, and on a small app said "Under 20" three times on one card
 * (Matches, the Pixel, 2026-10-02 and 2026-10-03).
 */
export const rulesTakeSomebody = (steps: readonly { cost?: number | null }[] | undefined): boolean =>
  (steps ?? []).some((s) => (s.cost ?? 0) > 0);

/** True when the server said "under 20": a small pool, which may be none at all. */
export const isUnder20 = (n: number | null | undefined): boolean => n === null || n === undefined;
