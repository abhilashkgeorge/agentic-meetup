/**
 * The recap after a round, as the Matches screen words it (server matching/recap.ts).
 *
 * The server sends only templates and the person's own shareable sentences; this adds
 * nothing but more templates to join them: no digit, no judgement, nothing invented.
 */
export interface Recap { went: string; said: string[]; topics: string[]; unsure: string[] }

/** "weekends", "weekends and food", "weekends, food and kids". */
const list = (xs: readonly string[]) => {
  const w = xs.map((x) => x.toLowerCase());
  return w.length <= 1 ? (w[0] ?? '') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
};

export function recapLines(r: Recap): { went: string; saidIntro: string | null; said: string[]; topics: string | null; unsure: string | null } {
  return {
    went: r.went,
    saidIntro: r.said.length ? 'It spoke for you in your own words:' : null,
    said: r.said,
    topics: r.topics.length ? `Your agents talked about ${list(r.topics)}.` : null,
    unsure: r.unsure.length
      ? `It had to say "I don't know" about ${list(r.unsure)}. Tell it, and it will know next time.`
      : null,
  };
}
