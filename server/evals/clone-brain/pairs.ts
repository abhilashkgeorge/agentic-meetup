/**
 * Suggest likely shared pairs by meaning, before the model reads anything, and let the
 * model confirm them. The second cheap fix tried for shared things (the founder,
 * 2026-09-28): the baseline found 61% of the real pairs, and missed most of all the ones
 * said in other words ("squats and deadlifts" and lifting).
 *
 * HOW. Every public note becomes one or more units -- a list note ("into: poetry,
 * painting, climbing") one unit per item, so a sentence about watercolours meets
 * "painting" and not a blur of eight hobbies. Units and their sentences are embedded
 * with the app's own embedding call (src/llm/embeddings.ts); for each of their
 * sentences the two nearest notes are suggested. Fixed in advance, not tuned on this
 * set: a threshold fitted to the test would be a score, not a fix.
 *
 * Not the app. If it earns its place it moves into talk.ts, behind the same guards.
 */
import type { Person } from './people.js';
import type { Suggested } from './contract.js';

/** Suggestions per sentence of theirs. */
export const PER_SENTENCE = 2;

/** Never suggested: the card line says nothing two people could share. */
const SKIP = new Set(['age', 'here']);

export interface Unit { note: number; text: string }

/** A person's public notes as the texts to compare, each pointing back at its note. Pure. */
export function unitsOf(p: Person): Unit[] {
  const out: Unit[] = [];
  for (const n of p.notes) {
    if (n.privacy !== 'public' || SKIP.has(n.key)) continue;
    const list = /^(?:into|also into|watches and reads): (.+)$/.exec(n.text);
    if (list) for (const item of list[1]!.split(', ')) out.push({ note: n.n, text: item });
    else out.push({ note: n.n, text: n.text.replace(/^said: "(.*)"$/, '$1').replace(/^[a-z ]+: /, '') });
  }
  return out;
}

const cosine = (a: readonly number[], b: readonly number[]): number => {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/** The nearest notes for each of their sentences. Pure, given the vectors. */
export function nearest(units: readonly Unit[], unitVecs: readonly number[][], theirVecs: readonly number[][]): Suggested[] {
  const out: Suggested[] = [];
  theirVecs.forEach((tv, j) => {
    const best = new Map<number, { sim: number; via: string }>();
    units.forEach((u, i) => {
      const sim = cosine(tv, unitVecs[i]!);
      const had = best.get(u.note);
      if (!had || sim > had.sim) best.set(u.note, { sim, via: u.text });
    });
    [...best.entries()].sort((a, b) => b[1].sim - a[1].sim).slice(0, PER_SENTENCE)
      .forEach(([note, x]) => out.push({ theirs: j + 1, mine: note, via: x.via.length > 60 ? `${x.via.slice(0, 57)}...` : x.via }));
  });
  return out;
}

/**
 * Suggestions for one situation, embedding what is not already in `cache`. The embed
 * call is the app's own and, like every embedding in the app, goes through no meter;
 * its cost is counted by `chars` for the report.
 */
export async function suggest(
  p: Person, theirs: readonly string[], cache: Map<string, number[]>,
  embed: (texts: readonly string[]) => Promise<number[][]>,
): Promise<{ suggested: Suggested[]; chars: number }> {
  const units = unitsOf(p);
  const texts = [...new Set([...units.map((u) => u.text), ...theirs])].filter((t) => !cache.has(t));
  let chars = 0;
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const vecs = await embed(batch);
    batch.forEach((t, k) => cache.set(t, vecs[k]!));
    chars += batch.reduce((n, t) => n + t.length, 0);
  }
  return {
    suggested: nearest(units, units.map((u) => cache.get(u.text)!), theirs.map((t) => cache.get(t)!)),
    chars,
  };
}
