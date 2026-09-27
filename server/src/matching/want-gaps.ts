/**
 * The wants no question fits, sorted by how often they come up (0072). For the founder:
 * which situation questions to add to the bank next.
 *
 * A want matched by a question is checked against the other person's tap; one matched by
 * none stays a sentence (want-questions.ts). These are the second kind, counted by how
 * many DIFFERENT people have them. A private topic is left out (it is checked on its
 * card, never as a question), and so is every want a question already covers.
 *
 * NEVER ONE PERSON'S SENTENCE. A want only one person has is shown as its topic words
 * ("theatre, plays"); a want two or more people share is shown whole. The topics list
 * counts words across every unmatched want, so the same wish in different words still
 * adds up. Nothing names anybody.
 */
import { namesCoreValue } from './brief.js';
import { questionForWant } from './want-questions.js';
import { splitWants } from './wants.js';

const STOP = new Set(`i im i'd id want wants wanted would like likes love loves loving someone somebody who whos
  a an the and or but to of in on at for with from into onto is are be being been was were am it its it's this that
  these those my me mine you your yours their they them he she his her we our not no must should could can need
  needs have has had just very really also good great nice person partner guy girl man woman people one
  enjoys enjoy enjoying doing does do don't dont kind sort bit lot lots always never ever more most much`.split(/\s+/));

/** A want in its plainest words, so two ways of saying it count as one. */
export function normalizeWant(text: string): string {
  return text.toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' -]+/g, ' ')
    .replace(/^\s*(i'd like|i want|i'd love|looking for|must be|must have|must|should be|should|someone who is|someone who's|someone who|someone|somebody who|a person who|a partner who)\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The content words of a want: what it is about. */
export const topicWords = (text: string): string[] =>
  [...new Set(normalizeWant(text).split(' ').map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)))];

export interface WantGap { want: string | null; topic: string[]; people: number }

/**
 * From the raw rows (one person's want sentence each), the unmatched wants and the
 * topics, most people first. Pure.
 */
export function wantGaps(rows: readonly { user_id: string; text: string }[]): { wants: WantGap[]; topics: { word: string; people: number }[] } {
  const byWant = new Map<string, Set<string>>();
  const byWord = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const w of splitWants(r.text)) {
      if (namesCoreValue(w) || questionForWant(w)) continue;
      const key = normalizeWant(w);
      if (!key) continue;
      (byWant.get(key) ?? byWant.set(key, new Set()).get(key)!).add(r.user_id);
      for (const t of topicWords(w)) (byWord.get(t) ?? byWord.set(t, new Set()).get(t)!).add(r.user_id);
    }
  }
  const wants = [...byWant].map(([key, who]) => ({
    // Whole only when two or more people share it: one person's words stay theirs.
    want: who.size >= 2 ? key : null, topic: topicWords(key), people: who.size,
  })).sort((a, b) => b.people - a.people || (a.want ?? a.topic.join(' ')).localeCompare(b.want ?? b.topic.join(' ')));
  const topics = [...byWord].map(([word, who]) => ({ word, people: who.size }))
    .sort((a, b) => b.people - a.people || a.word.localeCompare(b.word));
  return { wants, topics };
}
