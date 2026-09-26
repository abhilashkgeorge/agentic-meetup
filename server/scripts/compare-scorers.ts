/**
 * Which scorer actually predicts what the humans said?
 *
 * Three numbers are recorded on every pair before either human sees a card:
 *
 *   rank_score      the hand-weighted profile score (score.ts rank), free
 *   llm_file_score  one model call reading both files, ~$0.001, no conversation
 *   jev_file_score  a System One model's probability from the same two files, output
 *                   free -- null on every pair run before DECIDE_MODEL was set, and
 *                   dropped from its own row rather than counted as a zero
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
import { auc, aucStandardError, pairOutcome, seeAgainOutcome, type SeeAgain } from '../src/matching/evaluate.js';
import { WANT_QUESTIONS } from '../src/matching/want-questions.js';

const includeSynthetic = process.argv.includes('--all');
const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

interface Row {
  id: string;
  rank_score: number | null;
  llm_file_score: number | null;
  jev_file_score: number | null;
  agreement: number | null;
  a_yes: boolean | null;
  b_yes: boolean | null;
  met: boolean | null;
  synthetic: boolean;
  introduced: boolean;
  /** 'expired' (0069): nobody answered in three days. Never a label -- see below. */
  status: string;
}

const { rows } = await owner.query<Row>(`
  SELECT r.id, r.rank_score, r.llm_file_score, r.jev_file_score, r.agreement,
         ba.human_says_yes AS a_yes, bb.human_says_yes AS b_yes,
         (coalesce(ba.met, false) OR coalesce(bb.met, false)) AS met,
         (pa.is_synthetic OR pb.is_synthetic) AS synthetic,
         (r.introduced_at IS NOT NULL) AS introduced,
         r.status
    FROM rendezvous r
    JOIN rendezvous_briefs ba ON ba.rendezvous_id = r.id AND ba.for_user = r.user_a
    JOIN rendezvous_briefs bb ON bb.rendezvous_id = r.id AND bb.for_user = r.user_b
    JOIN match_profile pa ON pa.user_id = r.user_a
    JOIN match_profile pb ON pb.user_id = r.user_b
   ORDER BY r.created_at`);

// The check-ins, for "would you see them again". Read raw, not through
// checkin_mutual_again: that helper counts no answer as no (see seeAgainOutcome).
const { rows: checkins } = await owner.query<{ rendezvous_id: string; met: boolean; see_again: boolean | null; answers: Record<string, string> | null }>(
  'SELECT rendezvous_id, met, see_again, answers FROM date_checkins');
await owner.end();

const pairs = rows.filter((r) => includeSynthetic || !r.synthetic);
// A pair is labelled once it is DECIDED: both answered, or either said no. A first-mover
// no lapses the pair and the second person is never asked; it used to fall out of the
// measurement here, dropping a whole class of negatives (pairOutcome).
const labelled = pairs.filter((r) => pairOutcome(r.a_yes, r.b_yes) !== null);

console.log(`pairs with briefs on both sides : ${pairs.length}${includeSynthetic ? ' (including invented)' : ' (real only)'}`);
console.log(`  decided (both answered, or a no): ${labelled.length}`);
console.log(`  both said yes                 : ${labelled.filter((r) => pairOutcome(r.a_yes, r.b_yes) === 'yes').length}`);
// Silence is not a no. An expired pair keeps its empty answers, so pairOutcome leaves
// it unlabelled; it is counted here so it is seen, and nowhere else.
console.log(`  expired, nobody answered      : ${pairs.filter((r) => r.status === 'expired').length} (left out: silence is not a no)`);
console.log(`  reported meeting              : ${labelled.filter((r) => r.met).length}`);
console.log();

if (labelled.length < 10) {
  console.log('Fewer than ten labelled pairs. Nothing below is a finding; it is a smoke test of the report.');
  console.log();
}

const scorers = ['rank_score', 'llm_file_score', 'jev_file_score', 'agreement'] as const;
const labels = [
  { name: 'both said yes', of: (r: Row) => pairOutcome(r.a_yes, r.b_yes) === 'yes' },
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

// ── would they see each other again, over EVERY introduced pair ─────────────────
//
// The outcome this product is judged on. Over all introduced pairs, not only the ones
// somebody reported on, with no response counted as itself -- silence is not a no.
const introduced = pairs.filter((r) => r.introduced);
const byPair = new Map<string, { met: boolean; seeAgain: boolean | null }[]>();
for (const c of checkins) {
  const list = byPair.get(c.rendezvous_id) ?? [];
  list.push({ met: c.met, seeAgain: c.see_again });
  byPair.set(c.rendezvous_id, list);
}
const tally: Record<SeeAgain, number> = { again: 0, not_again: 0, unsure: 0, no_response: 0 };
for (const r of introduced) tally[seeAgainOutcome(byPair.get(r.id) ?? [])]++;
const answered = introduced.length - tally.no_response;
console.log();
console.log(`introduced pairs                : ${introduced.length}`);
console.log(`  would see each other again    : ${tally.again}`);
console.log(`  at least one would not        : ${tally.not_again}`);
console.log(`  not sure, or did not meet     : ${tally.unsure}`);
console.log(`  no response yet               : ${tally.no_response}`);
if (introduced.length) {
  console.log(`  see-again rate, all introduced: ${(tally.again / introduced.length * 100).toFixed(0)}%`
    + `  (response rate ${(answered / introduced.length * 100).toFixed(0)}%)`);
}

// WHERE PEOPLE FUDGE (the founder, 2026-09-26): after a date, "You wanted <their own
// words>. Did they seem that way?" -- asked only about a want their card said matched.
// A "no" is somebody whose answer did not survive meeting them. By topic, counts only.
const about = new Map(WANT_QUESTIONS.map((w) => [`want:${w.questionId}`, w.about]));
const fudge = new Map<string, { asked: number; no: number }>();
for (const c of checkins) {
  for (const [k, v] of Object.entries(c.answers ?? {})) {
    const topic = about.get(k);
    if (!topic || v === 'unsure') continue;
    const t = fudge.get(topic) ?? { asked: 0, no: 0 };
    t.asked++;
    if (v === 'no') t.no++;
    fudge.set(topic, t);
  }
}
console.log();
console.log('after a date, "did they seem that way?" about a matched want:');
if (!fudge.size) console.log('  nothing answered yet');
for (const [topic, t] of fudge) console.log(`  ${topic.padEnd(14)}: ${t.no} of ${t.asked} said no`);
