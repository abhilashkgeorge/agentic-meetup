/**
 * The System. What actually sends an agent out.
 *
 * Everything under src/matching existed and none of it was connected: candidates
 * ranked nobody, `meet()` was called only from tests with hand-written dossiers,
 * `rendezvous_briefs` was never written to, and no code anywhere set a rendezvous to
 * 'introduced' -- which is the precondition the messaging RLS requires, so the chat
 * built on top of it could not be reached at all. This file is the join.
 *
 * IT RUNS ON THE MATCHMAKER CONNECTION, which is the only session that can read two
 * people at once, and can read nothing about either of them beyond facts they marked
 * public (migration 0028). The agent going out cannot say more than that, because the
 * database will not show it more than that.
 *
 * A FEW AT A TIME, AND NOT MANY. It used to be exactly one: the top-ranked candidate,
 * then five conversations, then -- if fewer than three of five agreed -- nothing at
 * all. Five of the seven real rounds ever run ended in nothing, and the nineteen other
 * people the ranker had scored were thrown away each time. Now the top K are met, EVERY
 * one gets a brief, and the agreement rate orders the list the person sees rather than
 * gating it. K is small on purpose: running the top twenty nightly for every user is
 * how this becomes unaffordable before it becomes useful. Ditto ships one match a week
 * per person and reports 20% turn into dates -- scarcity is a feature before it is a
 * cost control, and three is the smallest number that gives a person a next one.
 *
 * THREE PHASES, AND NO TRANSACTION AROUND THE MIDDLE ONE. The first version wrapped
 * the whole round in one `matchmakerSession`, which meant a database transaction stayed
 * open for as long as the model took -- eighteen minutes, measured, `idle in
 * transaction`, holding a connection out of a pool of four and blocking every other
 * writer touching those rows. The rest of this codebase already knew better; session
 * extraction is written the same way for the same reason.
 *
 *   read    who to meet, and what each may say. Short transaction, then closed.
 *   model   five conversations and two briefs. NO transaction open.
 *   write   the runs, the verdict, the briefs. Short transaction.
 */
import type { PoolClient } from 'pg';
import { matchmakerSession } from '../db/client.js';
import { env } from '../env.js';
import { metered } from '../metering.js';
import { log } from '../log.js';
import { candidateIds } from './candidates.js';
import { llmFileScore, rank } from './score.js';
import { buildDossier, converse, passes, recordRuns, RUNS } from './rendezvous.js';
import { composeBoth, loadQuotes, saveBriefs, type Quote } from './brief.js';
import { voiceText } from '../memory/profile.js';

/** How many people one round meets. Each is five conversations, so keep this small. */
export const CANDIDATES_PER_ROUND = Number(process.env.ROUND_CANDIDATES ?? 3);

export interface RoundResult {
  userId: string;
  considered: number;
  /** The first person met, kept for callers that still think in ones. */
  met: string | null;
  /** Everyone met this round, in ranked order. Each now has a brief waiting. */
  metAll: string[];
  bothYes: number;
  runs: number;
  /** Whether ANY pair cleared the old bar. Informational: nothing gates on it now. */
  passed: boolean;
  costUsd: number;
  /** Why nothing happened, when nothing happened. */
  skipped?: string;
}

/**
 * Send one person's agent out once.
 *
 * Returns a result rather than throwing when there is nobody to meet: an empty pool is
 * an ordinary state, not an error, and the caller shows it to the person as one.
 */
export async function runRound(userId: string): Promise<RoundResult> {
  const empty = (skipped: string): RoundResult => ({
    userId, considered: 0, met: null, metAll: [], bothYes: 0, runs: 0, passed: false,
    costUsd: 0, skipped,
  });

  // ── read ────────────────────────────────────────────────────────────────────
  const plan = await matchmakerSession(async (c) => {
    const { rows: meRows } = await c.query<{ tenant_id: string; in_pool: boolean }>(
      'SELECT tenant_id, in_pool FROM match_profile WHERE user_id = $1', [userId],
    );
    const me = meRows[0];
    if (!me) return { stop: 'no profile' } as const;
    if (!me.in_pool) return { stop: 'agent is not ready to go out yet' } as const;

    const ids = await candidateIds(c, userId, 500);
    if (!ids.length) return { stop: 'nobody fits what you have asked for' } as const;

    // A pair meets ONCE, ever. Running the same two people again next week turns a
    // match into a war of attrition, and the second run measures the same two
    // dossiers it measured the first time.
    const { rows: already } = await c.query<{ other: string }>(
      `SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS other
         FROM rendezvous WHERE user_a = $1 OR user_b = $1`,
      [userId],
    );
    const met = new Set(already.map((r) => r.other));
    const fresh = ids.filter((id) => !met.has(id));
    if (!fresh.length) return { stop: 'your agent has already met everyone who fits' } as const;

    const ranked = await rank(c, userId, fresh, 20);
    if (!ranked.length) return { stop: 'nobody to rank' } as const;

    const a = { userId, tenantId: me.tenant_id };
    // Loaded once. The same person's dossier goes into every conversation this round.
    const dossierA = await buildDossier(c, a.userId);
    const voiceA = await voiceText(c, a.userId);
    const quotesA = await loadQuotes(c, a.userId);

    // THE TOP K, EACH CLAIMED INSIDE THIS TRANSACTION, so two rounds started at once
    // cannot both decide to run the same pair. A candidate whose claim fails was
    // taken by a concurrent round and is simply skipped; the next in rank fills in.
    const pairs: Array<{
      rendezvousId: string;
      rankScore: number;
      b: { userId: string; tenantId: string; dossier: string; voice: string; quotes: Quote[] };
    }> = [];
    for (const cand of ranked) {
      if (pairs.length >= CANDIDATES_PER_ROUND) break;
      const { rows: themRows } = await c.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM match_profile WHERE user_id = $1', [cand.userId],
      );
      const them = themRows[0];
      if (!them) continue;
      const b = { userId: cand.userId, tenantId: them.tenant_id };
      // The pair key is ordered, because the unique index is.
      const [lo, hi] = a.userId < b.userId ? [a, b] : [b, a];
      const { rows: created } = await c.query<{ id: string }>(
        `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, rank_score)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_a, user_b) DO NOTHING
         RETURNING id`,
        [lo.userId, hi.userId, lo.tenantId, hi.tenantId, RUNS, cand.score],
      );
      if (!created[0]) continue;

      // Sequential, NOT Promise.all. These share one pooled client, and node-postgres
      // warns that issuing a second query while the first is in flight is deprecated
      // and going away -- it currently serialises them for us, which is exactly the
      // kind of thing that works until it does not.
      const dossierB = await buildDossier(c, b.userId);
      const voiceB = await voiceText(c, b.userId);
      const quotesB = await loadQuotes(c, b.userId);
      pairs.push({
        rendezvousId: created[0].id, rankScore: cand.score,
        b: { ...b, dossier: dossierB, voice: voiceB, quotes: quotesB },
      });
    }
    if (!pairs.length) return { stop: 'already met' } as const;

    return {
      stop: null,
      considered: ranked.length,
      a: { ...a, dossier: dossierA, voice: voiceA, quotes: quotesA },
      pairs,
    } as const;
  });

  if (plan.stop) return empty(plan.stop);

  // ── model. No transaction open, and metered. ───────────────────────────────
  //
  // ONE METER ROUND THE WHOLE ROUND. Fifteen simulated conversations plus six briefs
  // is the most expensive thing a tap can do in this product, and until now the only
  // path that recorded any of it was the HTTP endpoint -- so the seven real rounds,
  // which were all launched from scripts/round.ts, spent money the daily cap never
  // saw. Opening the meter here rather than at the endpoint means the script, the
  // endpoint and the worker are all counted by the same code.
  //
  // No `db` argument: this phase deliberately holds no transaction, which is the
  // entire reason the orchestrator is split into three phases.
  //
  // SEQUENTIAL, one pair after another. Parallel would be faster and would hit the
  // free tier's rate limit three times as hard; see the pauses in converse().
  const spender = { tenantId: plan.a.tenantId, userId: plan.a.userId };
  const outcomes = await metered(spender, 'rendezvous', async () => {
    const out: Array<{
      pair: (typeof plan.pairs)[number];
      runs: Awaited<ReturnType<typeof converse>>;
      ok: boolean;
      briefs: Awaited<ReturnType<typeof composeBoth>>;
      concerns: { a: string; b: string };
      fileScore: number | null;
      fileCost: number;
    }> = [];
    for (const pair of plan.pairs) {
      // THE THIRD SCORER, taken before the conversation so it cannot be influenced
      // by it. One call, both files, no talking. Recorded on the pair and never
      // shown; it exists to be compared against the other two once humans have
      // spoken. See score.ts llmFileScore and scripts/compare-scorers.ts.
      const file = await llmFileScore(plan.a, pair.b);
      const runs = await converse(plan.a, pair.b);
      const ok = passes(runs.bothYes, runs.counted, RUNS);

      // The concern each agent recorded about the OTHER person, carried through
      // verbatim rather than rewritten. The last one, because it was formed with the
      // most of the conversation behind it.
      //
      // Keyed to the SIDES OF THIS CONVERSATION, which is what `runs.results` holds --
      // `recordRuns` normalises to the table's own order when it writes, and these
      // never go near the table.
      const last = runs.results[runs.results.length - 1];
      const concerns = { a: last?.aConcern ?? '', b: last?.bConcern ?? '' };

      // A BRIEF FOR EVERY PAIR, whatever the verdict. The agreement rate now ORDERS
      // what the person sees; it used to gate it, and a pair the agents were unsure
      // about was thrown away with nothing shown. The person is the judge; the agents
      // write the brief and say how sure they were.
      const briefs = await composeBoth(plan.a, pair.b);
      out.push({ pair, runs, ok, briefs, concerns, fileScore: file.score, fileCost: file.costUsd });
    }
    return out;
  });

  // ── write ───────────────────────────────────────────────────────────────────
  await matchmakerSession(async (c) => {
    for (const o of outcomes) {
      await recordRuns(c, o.pair.rendezvousId, o.runs, plan.a.userId);
      // What the conversation thought. NULL when nothing was conclusive, so the list
      // orders it last rather than as a zero that reads as "they said no".
      const agreement = o.runs.counted > 0 ? o.runs.bothYes / o.runs.counted : null;
      await c.query('UPDATE rendezvous SET agreement = $2, llm_file_score = $3 WHERE id = $1',
        [o.pair.rendezvousId, agreement, o.fileScore]);
      await saveBriefs(c, o.pair.rendezvousId, plan.a, o.pair.b, o.briefs, o.concerns);
      // An invented person cannot open the app and tap yes -- and taking it as a yes
      // anyway is how a real person ended up introduced to nobody, in a conversation
      // that would never be answered. Off by default; on only when the founder is
      // walking the messaging flow by hand. See SYNTHETIC_AUTO_YES.
      if (env.SYNTHETIC_AUTO_YES) await autoDecideSynthetic(c, o.pair.rendezvousId);
    }
  });

  const costUsd = outcomes.reduce((n, o) => n + o.runs.costUsd + o.briefs.costUsd + o.fileCost, 0);
  const bothYes = outcomes.reduce((n, o) => n + o.runs.bothYes, 0);
  const runs = outcomes.reduce((n, o) => n + o.runs.counted, 0);
  const passed = outcomes.some((o) => o.ok);
  const metAll = outcomes.map((o) => o.pair.b.userId);
  log.info(
    { userId, met: metAll.length, runs, bothYes, passed, costUsd },
    'round complete',
  );
  return {
    userId, considered: plan.considered, met: metAll[0] ?? null, metAll,
    bothYes, runs, passed, costUsd,
  };
}

/**
 * Synthetic people say yes, because there is nobody there to say anything.
 *
 * Marked `decided_at` like any other answer but with `human_says_yes = true` written
 * by the system, so a later audit can tell an invented yes from a real one. Without
 * this the founder's own account can never reach a conversation, and the messaging is
 * untestable outside the test suite.
 */
export async function autoDecideSynthetic(c: PoolClient, rendezvousId: string): Promise<number> {
  const { rows } = await c.query<{ user_id: string }>(
    `SELECT b.for_user AS user_id
       FROM rendezvous_briefs b
       JOIN match_profile p ON p.user_id = b.for_user
      WHERE b.rendezvous_id = $1 AND p.is_synthetic AND b.human_says_yes IS NULL`,
    [rendezvousId],
  );
  for (const r of rows) {
    await c.query(
      `UPDATE rendezvous_briefs SET human_says_yes = true, decided_at = now()
        WHERE rendezvous_id = $1 AND for_user = $2`,
      [rendezvousId, r.user_id],
    );
  }
  return rows.length;
}

/**
 * Record a human's answer, and introduce the pair if both have now said yes.
 *
 * A NO IS SILENT IN BOTH DIRECTIONS. The other person is never told; their card simply
 * never arrives. In a small pool where people compare notes, an emitted rejection is
 * unrecoverable.
 */
export async function decide(
  userId: string,
  rendezvousId: string,
  yes: boolean,
): Promise<{ introduced: boolean }> {
  return matchmakerSession(async (c) => {
    const { rowCount } = await c.query(
      `UPDATE rendezvous_briefs SET human_says_yes = $3, decided_at = now()
        WHERE rendezvous_id = $1 AND for_user = $2 AND human_says_yes IS NULL`,
      [rendezvousId, userId, yes],
    );
    if (!rowCount) return { introduced: false };

    if (!yes) {
      await c.query(
        `UPDATE rendezvous SET status = 'lapsed' WHERE id = $1 AND status <> 'introduced'`,
        [rendezvousId],
      );
      return { introduced: false };
    }

    // Both, and exactly both. The status flip is what the messaging policy checks, so
    // this single statement is the difference between two people who cannot write to
    // each other and two people who can.
    const { rows } = await c.query<{ id: string }>(
      `UPDATE rendezvous r SET status = 'introduced', introduced_at = now()
        WHERE r.id = $1
          AND r.status <> 'introduced'
          AND (SELECT count(*) FROM rendezvous_briefs b
                WHERE b.rendezvous_id = r.id AND b.human_says_yes) = 2
      RETURNING r.id`,
      [rendezvousId],
    );

    if (rows.length) log.info({ rendezvousId }, 'introduced');
    return { introduced: rows.length > 0 };
  });
}
