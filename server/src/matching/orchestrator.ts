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
 * ONE PAIR AT A TIME, AND NOT MANY. Five simulated conversations cost real money and
 * a few minutes; running the top twenty candidates nightly for every user is how this
 * becomes unaffordable before it becomes useful. Ditto ships one match a week per
 * person and reports 20% of them turn into real dates -- scarcity is a feature here
 * before it is a cost control.
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
import { log } from '../log.js';
import { candidateIds } from './candidates.js';
import { rank } from './score.js';
import { buildDossier, converse, passes, recordRuns, RUNS } from './rendezvous.js';
import { composeBoth, loadQuotes, saveBriefs } from './brief.js';
import { voiceText } from '../memory/profile.js';

export interface RoundResult {
  userId: string;
  considered: number;
  met: string | null;
  bothYes: number;
  runs: number;
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
    userId, considered: 0, met: null, bothYes: 0, runs: 0, passed: false, costUsd: 0, skipped,
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
    const top = ranked[0];
    if (!top) return { stop: 'nobody to rank' } as const;

    const { rows: themRows } = await c.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM match_profile WHERE user_id = $1', [top.userId],
    );
    const them = themRows[0];
    if (!them) return { stop: 'candidate vanished' } as const;

    const a = { userId, tenantId: me.tenant_id };
    const b = { userId: top.userId, tenantId: them.tenant_id };
    // The pair key is ordered, because the unique index is. Whichever way the two ids
    // arrive, one row.
    const [lo, hi] = a.userId < b.userId ? [a, b] : [b, a];

    // Claimed HERE, inside the read transaction, so two rounds started at once cannot
    // both decide to run the same pair.
    const { rows: created } = await c.query<{ id: string }>(
      `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_a, user_b) DO NOTHING
       RETURNING id`,
      [lo.userId, hi.userId, lo.tenantId, hi.tenantId, RUNS],
    );
    if (!created[0]) return { stop: 'already met' } as const;

    // Sequential, NOT Promise.all. These share one pooled client, and node-postgres
    // warns that issuing a second query while the first is in flight is deprecated
    // and going away -- it currently serialises them for us, which is exactly the
    // kind of thing that works until it does not.
    const dossierA = await buildDossier(c, a.userId);
    const dossierB = await buildDossier(c, b.userId);
    const voiceA = await voiceText(c, a.userId);
    const voiceB = await voiceText(c, b.userId);
    const quotesA = await loadQuotes(c, a.userId);
    const quotesB = await loadQuotes(c, b.userId);

    return {
      stop: null,
      rendezvousId: created[0].id,
      considered: ranked.length,
      lo, hi,
      a: { ...a, dossier: dossierA, voice: voiceA, quotes: quotesA },
      b: { ...b, dossier: dossierB, voice: voiceB, quotes: quotesB },
    } as const;
  });

  if (plan.stop) return empty(plan.stop);

  // ── model. No transaction open. ─────────────────────────────────────────────
  const runs = await converse(plan.a, plan.b);
  const ok = passes(runs.bothYes, runs.counted);

  // The concern each agent recorded about the OTHER person, carried through verbatim
  // rather than rewritten. The last one, because it was formed with the most of the
  // conversation behind it.
  //
  // Keyed to the SIDES OF THIS CONVERSATION, which is what `runs.results` holds --
  // `recordRuns` normalises to the table's own order when it writes, and these never
  // go near the table.
  const last = runs.results[runs.results.length - 1];
  const concerns = { a: last?.aConcern ?? '', b: last?.bConcern ?? '' };

  // The dossiers go in too: a person who tapped through onboarding has no quotable
  // sentence anywhere, and a brief built only from quotes would be no brief at all.
  const briefs = ok
    ? await composeBoth(plan.a, plan.b)
    : { forA: null, forB: null, costUsd: 0 };

  // ── write ───────────────────────────────────────────────────────────────────
  await matchmakerSession(async (c) => {
    await recordRuns(c, plan.rendezvousId, runs, plan.a.userId);
    if (!ok) {
      // A no is SILENT and FINAL. Nobody is told they were passed on, and the pair is
      // never run again.
      await c.query(`UPDATE rendezvous SET status = 'lapsed' WHERE id = $1`, [plan.rendezvousId]);
      return;
    }
    await saveBriefs(c, plan.rendezvousId, plan.a, plan.b, briefs, concerns);
    // An invented person cannot open the app and tap yes -- and taking it as a yes
    // anyway is how a real person ended up introduced to nobody, in a conversation
    // that would never be answered. Off by default; on only when the founder is
    // walking the messaging flow by hand. See SYNTHETIC_AUTO_YES.
    if (env.SYNTHETIC_AUTO_YES) await autoDecideSynthetic(c, plan.rendezvousId);
  });

  const costUsd = runs.costUsd + briefs.costUsd;
  log.info(
    { userId, rendezvousId: plan.rendezvousId, runs: runs.counted, bothYes: runs.bothYes, passed: ok },
    'round complete',
  );
  return {
    userId, considered: plan.considered, met: plan.b.userId,
    bothYes: runs.bothYes, runs: runs.counted, passed: ok, costUsd,
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
      `UPDATE rendezvous r SET status = 'introduced'
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
