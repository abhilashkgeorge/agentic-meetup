/**
 * Which scorer actually predicts what the humans said?
 *
 * Three numbers are recorded on every pair before either human sees a card:
 *
 *   rank_score      the hand-weighted profile score (score.ts rank), free
 *   llm_file_score  one model call reading both files, ~$0.001, no conversation
 *   agreement       five simulated conversations, ~$0.03
 *
 * and two labels arrive afterwards: both humans said yes on the card, and either
 * later reported that they met. This prints, for each scorer, how well it ORDERS the
 * labelled pairs (AUC), with a standard error so a number on twelve pairs is not read
 * as a finding. Nothing here calls a model.
 *
 *   npx tsx scripts/compare-scorers.ts            real pairs only
 *   npx tsx scripts/compare-scorers.ts --all      include pairs with an invented side
 *
 * The literature predicts the two file scorers will match each other and none of the
 * three will see pair chemistry. The conversation is the only candidate to beat that,
 * which is the reason it is measured rather than assumed. Decide by this table:
 *   file ≈ conversation   -> drop the conversation; sixty calls for the same signal
 *   conversation > file   -> it is earning its cost; keep it as the re-ranker
 *   nothing beats 0.5     -> the filters and the human's eyes are doing the work
 */
import { Pool } from 'pg';
import { env } from '../src/env.js';
import { auc, aucStandardError } from '../src/matching/evaluate.js';

const includeSynthetic = process.argv.includes('--all');
const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

interface Row {
  id: string;
  rank_score: number | null;
  llm_file_score: number | null;
  agreement: number | null;
  a_yes: boolean | null;
  b_yes: boolean | null;
  met: boolean | null;
  synthetic: boolean;
}

const { rows } = await owner.query<Row>(`
  SELECT r.id, r.rank_score, r.llm_file_score, r.agreement,
         ba.human_says_yes AS a_yes, bb.human_says_yes AS b_yes,
         (coalesce(ba.met, false) OR coalesce(bb.met, false)) AS met,
         (pa.is_synthetic OR pb.is_synthetic) AS synthetic
    FROM rendezvous r
    JOIN rendezvous_briefs ba ON ba.rendezvous_id = r.id AND ba.for_user = r.user_a
    JOIN rendezvous_briefs bb ON bb.rendezvous_id = r.id AND bb.for_user = r.user_b
    JOIN match_profile pa ON pa.user_id = r.user_a
    JOIN match_profile pb ON pb.user_id = r.user_b
   ORDER BY r.created_at`);
await owner.end();

const pairs = rows.filter((r) => includeSynthetic || !r.synthetic);
// A pair is labelled once BOTH humans have answered. One answer is not an outcome.
const labelled = pairs.filter((r) => r.a_yes !== null && r.b_yes !== null);

console.log(`pairs with briefs on both sides : ${pairs.length}${includeSynthetic ? ' (including invented)' : ' (real only)'}`);
console.log(`  both humans have answered     : ${labelled.length}`);
console.log(`  both said yes                 : ${labelled.filter((r) => r.a_yes && r.b_yes).length}`);
console.log(`  reported meeting              : ${labelled.filter((r) => r.met).length}`);
console.log();

if (labelled.length < 10) {
  console.log('Fewer than ten labelled pairs. Nothing below is a finding; it is a smoke test of the report.');
  console.log();
}

const scorers = ['rank_score', 'llm_file_score', 'agreement'] as const;
const labels = [
  { name: 'both said yes', of: (r: Row) => Boolean(r.a_yes && r.b_yes) },
  { name: 'reported meeting', of: (r: Row) => Boolean(r.met) },
] as const;

const pad = (s: string, n: number) => s.padEnd(n);
console.log(pad('scorer', 16), pad('label', 18), pad('n', 6), pad('pos', 5), pad('AUC', 8), '± se');
for (const scorer of scorers) {
  for (const label of labels) {
    const usable = labelled
      .filter((r) => r[scorer] !== null)
      .map((r) => ({ score: Number(r[scorer]), positive: label.of(r) }));
    const positives = usable.filter((u) => u.positive).length;
    const a = auc(usable);
    const se = aucStandardError(positives, usable.length - positives, a ?? 0.5);
    console.log(
      pad(scorer, 16), pad(label.name, 18), pad(String(usable.length), 6),
      pad(String(positives), 5),
      pad(a === null ? 'n/a' : a.toFixed(3), 8),
      Number.isFinite(se) ? se.toFixed(3) : '—',
    );
  }
}

console.log();
console.log('Reading it: 0.5 is a coin. A difference smaller than about two standard errors is noise.');
