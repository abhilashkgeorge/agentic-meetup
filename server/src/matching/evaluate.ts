/**
 * Does a score actually rank the pairs humans said yes to?
 *
 * AUC, by rank sum. For a scorer and a set of labelled pairs, the area under the ROC
 * curve is the probability that a randomly chosen positive pair scores higher than a
 * randomly chosen negative one. 0.5 is a coin; 1.0 is perfect; below 0.5 means the
 * score is anti-correlated, which is worse than useless because it is confidently
 * wrong. It is used here because it does not care what scale each scorer uses -- a
 * 0..1 agreement rate, a hand-weighted profile score and a model's guess are all
 * compared on how they ORDER pairs, which is the only thing the product does with
 * them.
 *
 * Ties get half credit, so a scorer that returns the same number for everything lands
 * on exactly 0.5 rather than somewhere accidental.
 */
export function auc(rows: Array<{ score: number; positive: boolean }>): number | null {
  const pos = rows.filter((r) => r.positive);
  const neg = rows.filter((r) => !r.positive);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) {
    for (const n of neg) {
      if (p.score > n.score) wins += 1;
      else if (p.score === n.score) wins += 0.5;
    }
  }
  return wins / (pos.length * neg.length);
}

/**
 * How much to trust an AUC on this many rows.
 *
 * The standard error of a rank-sum AUC (Hanley & McNeil 1982) for the null case, so a
 * reader can tell 0.62 on 12 pairs from 0.62 on 200. Rough by design: it is here to
 * stop a number on a small sample being read as a finding, not to publish.
 */
export function aucStandardError(positives: number, negatives: number, a = 0.5): number {
  if (!positives || !negatives) return Infinity;
  const q1 = a / (2 - a);
  const q2 = (2 * a * a) / (1 + a);
  const v =
    (a * (1 - a) + (positives - 1) * (q1 - a * a) + (negatives - 1) * (q2 - a * a))
    / (positives * negatives);
  return Math.sqrt(Math.max(v, 0));
}
