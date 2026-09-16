/**
 * Ranking the people who survived the filter.
 *
 * The whole hard/soft distinction lives here. A want that matters enormously is a
 * `strong` preference in this file, not a clause in the filter. The founder's own
 * list was the worked example: "works in AI" AND "from another country" AND "gym
 * regular" AND "eats beef, in India" as hard rules matches nobody. As points, it ranks
 * exactly the person he described first, and still shows him a Bangalore native who
 * gets everything else right.
 *
 * NO MODEL CALLS. This runs over every survivor for every user on every cycle; a model
 * here would cost more than the conversation it is supposed to be choosing.
 *
 * THE WEIGHTS ARE HAND-SET AND STAY HAND-SET. Joel, Eastwick & Finkel (2017) ran
 * random forests over 100+ pre-date self-report measures and could not predict
 * relationship variance at all. Fitting weights to n=1 would be fitting noise with
 * extra steps.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { llm, modelFor } from '../llm/index.js';

/** How much a stated preference counts when it is met. */
const STRENGTH_WEIGHT: Record<string, number> = {
  dealbreaker: 0, // already enforced by the filter; counting it again double-dips
  strong: 3,
  mild: 1,
};

export interface Scored {
  userId: string;
  /** 0..1. Never shown to a user -- see `brief`. Internal ranking only. */
  score: number;
  /** Which of their stated wants this person actually meets. */
  met: string[];
  missed: string[];
  /** Fields BOTH sides have filled. A high score on three fields is noise. */
  common: number;
}

interface Row {
  user_id: string;
  traits: Record<string, unknown>;
  attribute_tags: string[];
}

/**
 * Ochiai overlap, not cosine.
 *
 * Cosine on interest tags gives two people who share exactly one thing a perfect 1.0,
 * and rewards a long list of duplicates. Ochiai divides by the geometric mean of both
 * set sizes, so "we both like exactly one identical thing" scores low and "we overlap
 * on six out of ten each" scores high.
 */
function ochiai(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const shared = a.filter((t) => setB.has(t)).length;
  return shared / Math.sqrt(a.length * b.length);
}

/**
 * Score one direction: how well does `them` satisfy `me`'s stated preferences?
 *
 * Preferences the other person has no answer for are SKIPPED, not failed. They neither
 * help nor hurt, and they are counted out of `common` so a profile that answered three
 * questions cannot outrank one that answered thirty.
 */
/** One person's live, non-dealbreaker rules. Loaded once, applied to many. */
export async function loadPreferences(
  c: PoolClient,
  userId: string,
): Promise<{ predicate: string; operator: string; value: unknown; strength: string }[]> {
  const { rows } = await c.query<{
    predicate: string; operator: string; value: unknown; strength: string;
  }>(
    // `retired_at IS NULL` is spelled out even though clone_match's policy already
    // hides retired rows, because clone_matchmaker's does not (0028) and the two
    // roles must compute the same score. 0052 makes the column readable to both.
    `SELECT predicate, operator, value, strength FROM preferences
      WHERE user_id = $1 AND strength <> 'dealbreaker' AND retired_at IS NULL`,
    [userId],
  );
  return rows;
}

export async function scoreOneWay(
  c: PoolClient,
  prefs: { predicate: string; operator: string; value: unknown; strength: string }[],
  them: Row,
): Promise<{ score: number; met: string[]; missed: string[]; common: number }> {
  // Unknown is not a miss. It is a question worth asking, later.
  const testable = prefs.filter((p) => {
    const actual = them.traits[p.predicate];
    return actual !== undefined && actual !== null;
  });
  if (!testable.length) return { score: 0, met: [], missed: [], common: 0 };

  // ONE QUERY FOR ALL OF THEM. This used to be one round trip per preference per
  // candidate per direction -- up to 2 × 500 × prefs statements inside a single read
  // transaction, which is the difference between a round that starts in a second
  // and one that holds a pooled connection for the length of a coffee.
  const { rows } = await c.query<{ i: number; ok: boolean }>(
    `SELECT i, match_pref_satisfied(op, wanted, actual) AS ok
       FROM unnest($1::int[], $2::text[], $3::jsonb[], $4::jsonb[]) AS t(i, op, wanted, actual)`,
    [
      testable.map((_, i) => i),
      testable.map((p) => p.operator),
      testable.map((p) => JSON.stringify(p.value)),
      testable.map((p) => JSON.stringify(them.traits[p.predicate])),
    ],
  );
  const okAt = new Map(rows.map((r) => [r.i, r.ok]));

  let earned = 0;
  let available = 0;
  const met: string[] = [];
  const missed: string[] = [];
  testable.forEach((p, i) => {
    const weight = STRENGTH_WEIGHT[p.strength] ?? 1;
    available += weight;
    if (okAt.get(i)) { earned += weight; met.push(p.predicate); }
    else missed.push(p.predicate);
  });

  const preferenceScore = available > 0 ? earned / available : 0;
  return { score: preferenceScore, met, missed, common: met.length + missed.length };
}

/**
 * The full ranking, both directions.
 *
 * GEOMETRIC MEAN, not average. Two people who each satisfy the other 95% are a better
 * match than a pair at 100% and 90% — an arithmetic mean cannot tell those apart, and
 * the second pair contains somebody who is settling. OkCupid published this reasoning
 * and it has held up.
 *
 * SHRINKAGE on thin data. A profile with three answered fields can trivially score
 * 100%, so a score has to be discounted by how little it rests on. The first version
 * subtracted 1/common, which at two shared fields subtracts 0.5 -- more than most
 * real scores -- so everybody thin collapsed to exactly zero and the ranking below the
 * top few was arbitrary ties.
 *
 * Multiplying instead: common/(common+3). Two shared fields keeps 40% of the score,
 * ten keeps 77%, and nothing is ever driven to zero by thinness alone. Same intent,
 * and it degrades instead of falling off a cliff.
 */
export async function rank(
  c: PoolClient,
  userId: string,
  candidateIds: readonly string[],
  limit = 20,
): Promise<Scored[]> {
  if (!candidateIds.length) return [];

  const { rows: mine } = await c.query<Row>(
    `SELECT user_id, traits, attribute_tags FROM match_profile WHERE user_id = $1`, [userId],
  );
  const me = mine[0];
  if (!me) return [];
  const myPrefs = await loadPreferences(c, userId);

  // NO VALUE-VECTOR TERM. The column it read, match_profile.value_vec, was never
  // written by anything -- not the profile builder, not the synthetic seeder -- so
  // the term was a constant zero that quietly took a fifth of every score. The two
  // remaining weights are the old ones renormalised (0.55 and 0.25 over 0.80), so
  // the ordering among candidates is exactly what it was, and the number is honest.
  // Embedding the public facts is a later experiment with its own measurement.
  const { rows: others } = await c.query<Row>(
    `SELECT user_id, traits, attribute_tags FROM match_profile WHERE user_id = ANY($1::uuid[])`,
    [candidateIds],
  );

  const out: Scored[] = [];
  for (const them of others) {
    const forward = await scoreOneWay(c, myPrefs, them);
    const theirPrefs = await loadPreferences(c, them.user_id);
    const backward = await scoreOneWay(c, theirPrefs, {
      user_id: userId, traits: me.traits, attribute_tags: me.attribute_tags,
    });

    // What they have in common, independent of what either asked for. This is what
    // catches the pair who never thought to state a preference for the thing they
    // actually share.
    const overlap = ochiai(me.attribute_tags, them.attribute_tags);

    const forwardTotal = 0.6875 * forward.score + 0.3125 * overlap;
    const backwardTotal = 0.6875 * backward.score + 0.3125 * overlap;

    const common = Math.min(forward.common, backward.common);
    const mutual = Math.sqrt(Math.max(forwardTotal, 0) * Math.max(backwardTotal, 0));
    const CONFIDENCE_K = 3;
    const shrunk = mutual * (common / (common + CONFIDENCE_K));

    out.push({
      userId: them.user_id,
      score: Math.max(0, shrunk),
      met: forward.met,
      missed: forward.missed,
      common,
    });
  }

  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}

/**
 * The founder's proposal, in its strongest form: one model reads both files and says
 * how likely a second evening is. No conversation. About a tenth of a cent.
 *
 * WHY IT IS HERE AT ALL. The literature predicts this cannot see pair chemistry --
 * nothing measured before two people interact does -- but it may well match the
 * hand-weighted score above on everything else, at a fraction of the cost of five
 * simulated conversations. That is an empirical question, and the only way to
 * answer it is to record this number on every pair alongside the other two and
 * compare all three against what the humans then said. See scripts/compare-scorers.ts.
 *
 * NEVER SHOWN TO A PERSON. It is stored for measurement. Showing it would turn a
 * guess into a self-fulfilling one: OkCupid measured that people told they were a
 * good match behaved as if they were, whatever the number had been.
 *
 * Concern before score, for the same reason the assessor writes its concern before
 * its verdict: written first, it is an input to the number rather than a
 * justification of it.
 */
export const FileVerdict = z.object({
  concern: z.string(),
  /** 0 = would not want a second evening; 1 = certainly would. */
  score: z.number().min(0).max(1),
});

export async function llmFileScore(
  a: { userId: string; tenantId: string; dossier: string },
  b: { dossier: string },
): Promise<{ score: number | null; concern: string; costUsd: number }> {
  if (!a.dossier.trim() && !b.dossier.trim()) return { score: null, concern: '', costUsd: 0 };
  const res = await llm.complete(
    {
      task: 'resolve',
      instructions: FILE_SCORER,
      messages: [
        { role: 'user', content: `Person A:\n${a.dossier || '(nothing known)'}` },
        { role: 'user', content: `Person B:\n${b.dossier || '(nothing known)'}` },
      ],
      tenantId: a.tenantId,
      userId: a.userId,
      outputSchema: FileVerdict,
      outputSchemaName: 'file_verdict',
      maxOutputTokens: 300,
      thinking: false,
    },
    modelFor('resolve'),
  );
  const parsed = FileVerdict.safeParse(res.parsed);
  return parsed.success
    ? { score: parsed.data.score, concern: parsed.data.concern, costUsd: res.usage.costUsd }
    : { score: null, concern: '', costUsd: res.usage.costUsd };
}

const FILE_SCORER = `You are given what two people have each said about themselves. You have not
seen them talk. Judge, from the files alone, how likely it is that after one evening
together each would want a second.

FIRST write one genuine concern -- the thing most likely to make one of them not want
a second evening. A sentence you would say to a friend, not a topic label.

THEN give a number from 0 to 1. 0 means you would bet against a second evening; 1
means you would bet on it. Use the whole range. Do not be kind: a file that lists
many interests is not evidence of anything except a long file.`;
