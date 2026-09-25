/**
 * Session-end orchestration for P1.
 *
 * A session ends when the client says so, or after inactivity. The sweeper is the
 * one that actually fires most of the time -- people put the phone down, they do
 * not tap "end conversation".
 */
import type { PoolClient } from 'pg';
import { adminSession, discoverySession, tenantSession, type TenantCtx } from '../db/client.js';
import { CORE_PREDICATE_NAMES } from '@clone/shared';
import { log } from '../log.js';
import { metered } from '../metering.js';
import { commit, currentState } from './facts.js';
import { extractSessionFacts } from './extract.js';
import { multiValuedExisting, resolveConflicts } from './resolve.js';
import { rebuildCoreProfile } from './profile.js';
import { ensureSheet } from '../matching/answer-sheet.js';

/**
 * Sessions idle this long are considered over and get extracted.
 *
 * 1 minute by default so dogfooding feels alive -- you say something, wait a moment,
 * and the You tab has changed. Raise it in production: every extra minute here is
 * fewer, longer sessions, and extraction is billed per session.
 */
// Five minutes. One minute was a dogfooding shortcut so extraction felt instant, and
// it charges for an extraction pass every time someone puts the phone down mid-thought.
export const SESSION_IDLE_MS = Number(process.env.SESSION_IDLE_MS ?? 300_000);

export interface ExtractionSummary {
  sessionId: string;
  turns: number;
  staged: number;
  asserted: number;
  superseded: number;
  conflicts: number;
  /** Multi-valued facts retired by P2. Single-valued ones never reach it. */
  resolvedContradictions: number;
  profileRebuilt: boolean;
  costUsd: number;
}

/**
 * Extract one session. Idempotent on (user, session, last_turn_index): re-running
 * after no new turns is a no-op, so the sweeper can be as dumb as it likes.
 */
export async function extractSession(
  ctx: TenantCtx,
  sessionId: string,
): Promise<ExtractionSummary | null> {
  // Metered around the whole thing rather than around each phase: extraction,
  // conflict resolution and the profile rebuild are three model calls belonging to
  // one operation, and the budget question is whether this session is affordable, not
  // whether its third call is. The meter takes its own connection, since the phases
  // deliberately open and close their own.
  const out = await metered(ctx, 'extract', () => extractSessionInner(ctx, sessionId));
  // THE ANSWER SHEET, when something new was learned: after -- and outside -- the
  // extraction's own meter, since it keeps its own. At most one small call, none when
  // no sentence it could point at changed, and it never throws (answer-sheet.ts).
  if (out && out.asserted + out.superseded > 0) await ensureSheet(ctx);
  return out;
}

async function extractSessionInner(
  ctx: TenantCtx,
  sessionId: string,
): Promise<ExtractionSummary | null> {
  // --- Read phase. Short transaction, closed before the model call. ---
  const prep = await tenantSession(ctx, async (c) => {
    const { rows: turns } = await c.query<{
      id: string; role: 'user' | 'assistant'; raw_text: string; turn_index: number;
    }>(
      `SELECT id, role, raw_text, turn_index FROM episodes
        WHERE user_id = $1 AND session_id = $2 ORDER BY turn_index`,
      [ctx.userId, sessionId],
    );
    if (!turns.length) return null;

    const lastIndex = turns[turns.length - 1]!.turn_index;
    const { rows: done } = await c.query<{ last_turn_index: number }>(
      `SELECT last_turn_index FROM session_extractions
        WHERE user_id = $1 AND session_id = $2`,
      [ctx.userId, sessionId],
    );
    if (done[0] && done[0].last_turn_index >= lastIndex) return null; // nothing new

    const facts = await currentState(c, ctx.userId, CORE_PREDICATE_NAMES);
    return { turns, lastIndex, facts };
  });

  if (!prep) return null;

  // --- Model phase. NO transaction open. ---
  const out = await extractSessionFacts(
    {
      transcript: prep.turns.map((t) => ({ role: t.role, content: t.raw_text })),
      currentFacts: prep.facts.map((f) => ({ predicate: f.predicate, objectText: f.objectText })),
      tenantId: ctx.tenantId,
      userId: ctx.userId,
    },
    prep.turns.map((t) => t.id),
  );

  // --- Write phase. New short transaction; all commits atomic together. ---
  return tenantSession(ctx, async (c) => {
    let staged = 0, asserted = 0, superseded = 0;
    for (const cand of out.candidates) {
      const r = await commit(c, ctx, cand);
      if (r.outcome === 'staged') staged++;
      else if (r.outcome === 'asserted') asserted++;
      else if (r.outcome === 'superseded') superseded++;
    }

    // P2 -- multi-valued conflicts only. Single-valued ones were already decided by
    // the unique index during commit, deterministically and for free.
    let resolvedContradictions = 0;
    let resolveCost = 0;
    const existing = await multiValuedExisting(c, ctx.userId, out.candidates);
    if (existing.length && out.candidates.length) {
      const r = await resolveConflicts({
        tenantId: ctx.tenantId, userId: ctx.userId, existing, candidates: out.candidates,
      });
      resolveCost = r.costUsd;

      for (const id of r.contradictedIds) {
        await c.query(
          `UPDATE facts SET valid_to = now(), invalidated_at = now(), status = 'superseded'
            WHERE id = $1 AND user_id = $2 AND status = 'active'`,
          [id, ctx.userId],
        );
        resolvedContradictions++;
      }

      // Uncertain never retracts. It becomes a question -- asking is cheap, and
      // removing something true is not.
      for (const id of r.uncertainIds) {
        const { rows } = await c.query<{ predicate: string; object_text: string }>(
          'SELECT predicate, object_text FROM facts WHERE id = $1 AND user_id = $2',
          [id, ctx.userId],
        );
        const f = rows[0];
        if (!f) continue;
        const dup = await c.query(
          `SELECT 1 FROM fact_conflicts WHERE user_id = $1 AND fact_a_id = $2
            AND status IN ('open','asked')`,
          [ctx.userId, id],
        );
        if (dup.rowCount) continue;
        await c.query(
          `INSERT INTO fact_conflicts (tenant_id, user_id, fact_a_id, kind, clarifying_question)
           VALUES ($1,$2,$3,'possibly_stale',$4)`,
          [ctx.tenantId, ctx.userId, id,
           `I have you down as ${f.predicate.replace(/_/g, ' ')}: "${f.object_text}". Is that still right?`],
        );
      }
    }

    const conflicts = await raiseConflicts(c, ctx, out.possiblyFalse);
    await recordIntents(c, ctx, sessionId, out.intents);

    // P4 on CADENCE, never per write. A clone that learns is a clone whose cached
    // prefix keeps changing; rebuilding on every fact would invalidate that user's
    // cache on every supersession. New facts ride in the (uncacheable anyway)
    // retrieved-facts tail until the next rebuild.
    let profileRebuilt = false;
    if (asserted + superseded + resolvedContradictions >= 3) {
      const rb = await rebuildCoreProfile(c, ctx);
      profileRebuilt = rb.rebuilt;
      resolveCost += rb.costUsd;
    }

    await c.query(
      `INSERT INTO session_extractions (tenant_id, user_id, session_id, last_turn_index, facts_staged)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, user_id, session_id) DO UPDATE
         SET last_turn_index = EXCLUDED.last_turn_index,
             extracted_at = now(),
             facts_staged = session_extractions.facts_staged + EXCLUDED.facts_staged`,
      [ctx.tenantId, ctx.userId, sessionId, prep.lastIndex, staged],
    );

    return {
      sessionId, turns: prep.turns.length, staged, asserted, superseded,
      conflicts, resolvedContradictions, profileRebuilt,
      costUsd: out.costUsd + resolveCost,
    };
  });
}

/**
 * A "possibly false" report does NOT retract anything. It raises a question.
 *
 * This is the primary user-facing quality mechanism in the whole design: a clone
 * that asks "you mentioned prawn curry -- should I update your shellfish note?" is
 * measurably better than one that silently guesses right about half the time, and it
 * is the only thing here that turns a wrong belief into a logged, resolvable event
 * rather than a silent error nobody ever sees.
 */
async function raiseConflicts(
  c: PoolClient,
  ctx: TenantCtx,
  reports: { predicate: string; current_value: string; why: string }[],
): Promise<number> {
  let n = 0;
  for (const r of reports) {
    const { rows } = await c.query<{ id: string }>(
      `SELECT id FROM facts
        WHERE user_id = $1 AND predicate = $2 AND status = 'active' AND valid_to IS NULL
        ORDER BY recorded_at DESC`,
      [ctx.userId, r.predicate],
    );
    const target = rows[0];
    if (!target) continue;

    // One open question per fact. Nagging is worse than not asking.
    const dup = await c.query(
      `SELECT 1 FROM fact_conflicts
        WHERE user_id = $1 AND fact_a_id = $2 AND status IN ('open','asked')`,
      [ctx.userId, target.id],
    );
    if (dup.rowCount) continue;

    await c.query(
      `INSERT INTO fact_conflicts (tenant_id, user_id, fact_a_id, kind, clarifying_question)
       VALUES ($1,$2,$3,'possibly_stale',$4)`,
      [ctx.tenantId, ctx.userId, target.id,
       `I have you down as ${r.predicate.replace(/_/g, ' ')}: "${r.current_value}". ${r.why} Is that still right?`],
    );
    n++;
  }
  return n;
}

/**
 * What the person seemed to want the clone for. Never shown to them, never acted on
 * for an individual -- the value is entirely in the aggregate, months from now, when
 * it answers which cluster to recruit for agent discovery.
 */
async function recordIntents(
  c: PoolClient,
  ctx: TenantCtx,
  sessionId: string,
  intents: { intent: string; confidence: number }[],
): Promise<void> {
  for (const i of intents) {
    await c.query(
      `INSERT INTO intent_signals (tenant_id, user_id, session_id, intent, confidence)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, session_id, intent) DO UPDATE
         SET confidence = GREATEST(intent_signals.confidence, EXCLUDED.confidence)`,
      [ctx.tenantId, ctx.userId, sessionId, i.intent, Math.max(0, Math.min(1, i.confidence))],
    );
  }
}

/** Sessions with no activity for SESSION_IDLE_MS that still have unextracted turns. */
export async function dueSessions(limit = 20): Promise<{ ctx: TenantCtx; sessionId: string }[]> {
  const { rows } = await discoverySession((c) =>
    c.query<{ tenant_id: string; user_id: string; session_id: string }>(
      // A REAL PERSON'S SESSION, and the EXISTS clause is the whole point.
      //
      // This query used to consider every session that had ever been written, which
      // meant every fixture any test had ever left behind. With the meter finally
      // recording extraction spend, the effect became visible: a development server
      // sweeping once a minute was paying Gemini to extract other people's test data,
      // 552 sessions of it, and nobody could see the bill because extraction spend
      // was not attributed to anything until now. Ten of those 552 sessions belonged
      // to somebody who has actually opened the app.
      //
      // `device_sessions` is the honest boundary: a row there means a person signed
      // in on a device. A fixture inserts into `app_users` through the owner pool and
      // never authenticates, so it has none -- and an account whose sessions were all
      // revoked stops being swept, which is correct.
      //
      // THE `revoked_at` FILTER WAS MISSING and the sentence above was therefore a
      // lie. It did not matter while nothing on earth ever wrote that column; the
      // logout route now does, so without this a signed-out account would keep being
      // swept and keep spending on extraction for a person who has left.
      `SELECT e.tenant_id, e.user_id, e.session_id
         FROM episodes e
         LEFT JOIN session_extractions x
           ON x.user_id = e.user_id AND x.session_id = e.session_id
        WHERE EXISTS (SELECT 1 FROM device_sessions d
                       WHERE d.user_id = e.user_id AND d.revoked_at IS NULL)
        GROUP BY e.tenant_id, e.user_id, e.session_id, x.last_turn_index
       HAVING MAX(e.ingested_at) < now() - ($1::int * interval '1 millisecond')
          AND (x.last_turn_index IS NULL OR MAX(e.turn_index) > x.last_turn_index)
        LIMIT $2`,
      [SESSION_IDLE_MS, limit],
    ),
  );
  return rows.map((r) => ({
    ctx: { tenantId: r.tenant_id, userId: r.user_id },
    sessionId: r.session_id,
  }));
}

export async function sweepOnce(): Promise<number> {
  const due = await dueSessions();
  let n = 0;
  for (const { ctx, sessionId } of due) {
    try {
      const s = await extractSession(ctx, sessionId);
      if (s) {
        n++;
        log.info({ ...s, userId: ctx.userId }, 'session extracted');
      }
    } catch (err) {
      // One bad session must not stop the sweeper. A memory side effect never
      // blocks anything the user can see.
      log.warn({ err, sessionId }, 'extraction failed; will retry next sweep');
    }
  }
  return n;
}
