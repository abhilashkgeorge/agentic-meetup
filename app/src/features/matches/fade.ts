/**
 * How a card fades toward the end of its three days (server 0069, the founder's item
 * 9). Plain, so it can be tested without a phone.
 *
 * Full on the first day; paler on the second, saying "Fades tomorrow"; paler still on
 * the last, saying "Fades today". Words, not a countdown: a clock on a card makes the
 * card about the clock. After the deadline the server no longer sends it.
 */
const DAY = 24 * 60 * 60 * 1000;

export function fade(fadesAt: string | null | undefined, now = Date.now()): { opacity: number; line: string | null } {
  if (!fadesAt) return { opacity: 1, line: null };
  const left = new Date(fadesAt).getTime() - now;
  if (Number.isNaN(left) || left > 2 * DAY) return { opacity: 1, line: null };
  if (left > DAY) return { opacity: 0.8, line: "Fades tomorrow if you don't answer." };
  return { opacity: 0.55, line: "Fades today if you don't answer." };
}
