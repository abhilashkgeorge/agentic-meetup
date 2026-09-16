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
  value_sim: number | null;
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
export async function scoreOneWay(
  c: PoolClient,
  meUserId: string,
  them: Row,
): Promise<{ score: number; met: string[]; missed: string[]; common: number }> {
  const { rows: prefs } = await c.query<{
    predicate: string; operator: string; value: unknown; strength: string;
  }>(
    // `retired_at` is deliberately not readable by the matching role; the policy on
    // the table already filters retired rows, so the query must not name the column.
    `SELECT predicate, operator, value, strength FROM preferences
      WHERE user_id = $1 AND strength <> 'dealbreaker'`,
    [meUserId],
  );

  let earned = 0;
  let available = 0;
  const met: string[] = [];
  const missed: string[] = [];

  for (const p of prefs) {
    const actual = them.traits[p.predicate];
    // Unknown is not a miss. It is a question worth asking, later.
    if (actual === undefined || actual === null) continue;

    const weight = STRENGTH_WEIGHT[p.strength] ?? 1;
    available += weight;

    const { rows } = await c.query<{ ok: boolean }>(
      `SELECT match_pref_satisfied($1, $2::jsonb, $3::jsonb) AS ok`,
      [p.operator, JSON.stringify(p.value), JSON.stringify(actual)],
    );
    if (rows[0]?.ok) {
      earned += weight;
      met.push(p.predicate);
    } else {
      missed.push(p.predicate);
    }
  }

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
    `SELECT user_id, traits, attribute_tags, NULL::float AS value_sim
       FROM match_profile WHERE user_id = $1`, [userId],
  );
  const me = mine[0];
  if (!me) return [];

  // One query for everybody, including the value-vector similarity, which pgvector
  // computes far faster than anything this process could.
  const { rows: others } = await c.query<Row>(
    `SELECT b.user_id, b.traits, b.attribute_tags,
            CASE WHEN a.value_vec IS NULL OR b.value_vec IS NULL THEN NULL
                 ELSE 1 - (a.value_vec <=> b.value_vec) END AS value_sim
       FROM match_profile b
       LEFT JOIN match_profile a ON a.user_id = $1
      WHERE b.user_id = ANY($2::uuid[])`,
    [userId, candidateIds],
  );

  const out: Scored[] = [];
  for (const them of others) {
    const forward = await scoreOneWay(c, userId, them);
    const backward = await scoreOneWay(c, them.user_id, {
      user_id: userId, traits: me.traits, attribute_tags: me.attribute_tags, value_sim: null,
    });

    // What they have in common, independent of what either asked for. This is what
    // catches the pair who never thought to state a preference for the thing they
    // actually share.
    const overlap = ochiai(me.attribute_tags, them.attribute_tags);
    const values = them.value_sim ?? 0;

    const forwardTotal = 0.55 * forward.score + 0.25 * overlap + 0.20 * values;
    const backwardTotal = 0.55 * backward.score + 0.25 * overlap + 0.20 * values;

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
