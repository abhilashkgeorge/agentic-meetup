/**
 * The founder's funnel, in words (server 0070, item 10). Plain, so it can be tested
 * without a phone. Counts only, between real people only -- the server decides who is
 * real: not invented, signed in on a phone at least once, not a test fixture.
 *
 * Counts, not percentages: a handful of pairs makes every percentage a story, and
 * the founder can divide.
 */
export interface Funnel {
  people: number;
  steps: { step: 'matches' | 'both_yes' | 'first_message' | 'date_proposed' | 'met'; n: number }[];
  expired: number;
}

const LABEL: Record<Funnel['steps'][number]['step'], string> = {
  matches: 'Matches',
  both_yes: 'Both said yes',
  first_message: 'First message',
  date_proposed: 'Date proposed',
  met: 'Met',
};

/**
 * The wants no question fits, as rows: the most common topics first, then wants two or
 * more people share, word for word. Ten of each at most.
 */
export function gapRows(g: { wants: { want: string | null; people: number }[]; topics: { word: string; people: number }[] }): { title: string; value: string }[] {
  const n = (k: number) => `${k} ${k === 1 ? 'person' : 'people'}`;
  return [
    ...g.topics.slice(0, 10).map((t) => ({ title: t.word, value: n(t.people) })),
    ...g.wants.filter((w) => w.want !== null).slice(0, 10).map((w) => ({ title: `“${w.want}”`, value: n(w.people) })),
  ];
}

/** The steps in order, as the page lists them. Unknown steps are left out. */
export const funnelRows = (f: Funnel): { label: string; n: number }[] =>
  f.steps.filter((s) => s.step in LABEL).map((s) => ({ label: LABEL[s.step], n: s.n }));
