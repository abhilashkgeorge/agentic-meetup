/**
 * Replays each case through EVERY arm. Identical input, identical questions; the only
 * variable is how the arm decides what is currently true.
 *
 * Every case gets its own scratch tenant, so arms and cases cannot contaminate each
 * other and a crashed run leaves nothing a later run would read.
 */
import { Pool } from 'pg';
import { adminSession, tenantSession, type TenantCtx } from '../src/db/client.js';
import { env } from '../src/env.js';
import { history } from '../src/memory/facts.js';
import type { Arm } from './arms/types.js';
import type { EvalCase, Expectation, Probe } from './types.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

export interface ArmResult {
  arm: string;
  pass: boolean;
  failures: string[];
  probe?: 'correct' | 'drift' | 'other' | 'skipped';
  /** Sessions between the change being stated and the arm reporting it. null = never. */
  supersessionLatency: number | null;
  costUsd: number;
  turns: number;
}

export interface CaseResult {
  id: string;
  axis: string;
  arms: ArmResult[];
}

async function scratchTenant(id: string): Promise<TenantCtx> {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`eval-${id}-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `eval-${id}-${Date.now()}@eval.test`]);
  const ctx = { tenantId, userId: u.rows[0]!.id };
  await owner.query(
    `INSERT INTO tenant_budget (tenant_id, user_id, day, turn_cap, daily_cost_cap)
     VALUES ($1,$2,CURRENT_DATE,100000,1000)
     ON CONFLICT (tenant_id, user_id, day) DO UPDATE SET turn_cap = 100000, daily_cost_cap = 1000`,
    [tenantId, ctx.userId],
  );
  return ctx;
}

/**
 * Score one expectation against one arm.
 *
 * `superseded`, `staged`, `count-active` and `conflict-raised` are structural concepts
 * only the fact store has. For other arms they are mapped to the observable
 * equivalent, or skipped -- scoring an arm on a mechanism it does not claim to have
 * would inflate our own margin, which is the one direction we cannot afford.
 */
async function score(
  arm: Arm,
  ctx: TenantCtx,
  e: Expectation,
): Promise<{ failure: string | null; costUsd: number }> {
  const like = (a: string | null, b: string) =>
    !!a && (a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase()));

  if (arm.name === 'factstore') {
    if (e.kind === 'conflict-raised') {
      const { rows } = await tenantSession(ctx, (c) =>
        c.query(
          `SELECT 1 FROM fact_conflicts fc JOIN facts f ON f.id = fc.fact_a_id
            WHERE fc.user_id = $1 AND f.predicate = $2`,
          [ctx.userId, e.predicate],
        ),
      );
      return { failure: rows.length ? null : `no conflict raised on ${e.predicate}`, costUsd: 0 };
    }
    if (e.kind === 'count-active') {
      const all = await tenantSession(ctx, (c) => history(c, ctx.userId, e.predicate));
      const active = all.filter((f) => f.status === 'active' && f.validTo === null);
      return {
        failure: active.length === e.n
          ? null : `expected ${e.n} active ${e.predicate}, got ${active.length}`,
        costUsd: 0,
      };
    }
    if (e.kind === 'superseded' || e.kind === 'staged') {
      const all = await tenantSession(ctx, (c) => history(c, ctx.userId, e.predicate));
      const want = e.kind === 'superseded' ? 'superseded' : 'staged';
      return {
        failure: all.some((f) => like(f.objectText, e.objectText) && f.status === want)
          ? null : `expected '${e.objectText}' ${want} for ${e.predicate}`,
        costUsd: 0,
      };
    }
  } else {
    // Concepts the other arms do not model. Skipped, not failed.
    if (e.kind === 'conflict-raised' || e.kind === 'count-active' || e.kind === 'staged') {
      return { failure: null, costUsd: 0 };
    }
    // "superseded" for a flat memory means: it is no longer the current value.
    if (e.kind === 'superseded') {
      const cur = await arm.currentValue(ctx, e.predicate);
      return {
        failure: like(cur.value, e.objectText)
          ? `'${e.objectText}' is still current for ${e.predicate}` : null,
        costUsd: cur.costUsd,
      };
    }
  }

  const cur = await arm.currentValue(ctx, e.predicate);
  if (e.kind === 'active') {
    return {
      failure: like(cur.value, e.objectText)
        ? null : `expected '${e.objectText}', got '${cur.value ?? 'nothing'}'`,
      costUsd: cur.costUsd,
    };
  }
  return {
    failure: like(cur.value, e.objectText) ? `'${e.objectText}' must NOT be current, but is` : null,
    costUsd: cur.costUsd,
  };
}

function classify(answer: string, probe: Probe): 'correct' | 'drift' | 'other' {
  const a = answer.toLowerCase();
  const hasCorrect = a.includes(probe.correct.toLowerCase());
  const hasDrift = a.includes(probe.drift.toLowerCase());
  if (hasCorrect && !hasDrift) return 'correct';
  if (hasDrift && !hasCorrect) return 'drift';
  return 'other';
}

async function runArm(
  arm: Arm,
  c: EvalCase,
  ctx: TenantCtx,
  opts: { probes: boolean },
): Promise<ArmResult> {
  await arm.reset(ctx);
  let costUsd = 0;
  let turns = 0;

  // The value the case says should end up current -- used to time supersession.
  const target = c.expect.find((e) => e.kind === 'active');
  let latency: number | null = null;
  let changeAt: number | null = null;

  for (let s = 0; s < c.sessions.length; s++) {
    for (const inj of c.injections ?? []) {
      if (inj.afterSession === s) costUsd += await arm.ingestInjection(ctx, inj);
    }
    const sessionId = await adminSession(async (db) =>
      (await db.query<{ id: string }>('SELECT gen_random_uuid() AS id')).rows[0]!.id,
    );
    const sessionTurns = c.sessions[s] ?? [];
    costUsd += await arm.ingestSession(ctx, sessionId, sessionTurns);
    turns += sessionTurns.length;

    if (target) {
      // The session that first states the target value is where the clock starts.
      if (changeAt === null && sessionTurns.some((t) =>
        t.toLowerCase().includes(target.objectText.toLowerCase()))) changeAt = s;
      if (latency === null && changeAt !== null) {
        const cur = await arm.currentValue(ctx, target.predicate);
        costUsd += cur.costUsd;
        if (cur.value && cur.value.toLowerCase().includes(target.objectText.toLowerCase())) {
          latency = s - changeAt;
        }
      }
    }
  }
  for (const inj of c.injections ?? []) {
    if (inj.afterSession >= c.sessions.length) costUsd += await arm.ingestInjection(ctx, inj);
  }

  const failures: string[] = [];
  for (const e of c.expect) {
    const r = await score(arm, ctx, e);
    costUsd += r.costUsd;
    if (r.failure) failures.push(r.failure);
  }

  let probe: ArmResult['probe'] = 'skipped';
  if (opts.probes && c.probe) {
    const a = await arm.answer(ctx, c.probe.question);
    costUsd += a.costUsd;
    probe = classify(a.text, c.probe);
  }

  return {
    arm: arm.name, pass: failures.length === 0, failures, probe,
    supersessionLatency: latency, costUsd, turns,
  };
}

export async function runCase(
  c: EvalCase,
  arms: Arm[],
  opts: { probes: boolean },
): Promise<CaseResult> {
  const ctx = await scratchTenant(c.id);
  try {
    const results: ArmResult[] = [];
    // Sequential: arms share the scratch tenant's episode tables, and running them
    // concurrently would let one arm read another's writes.
    for (const arm of arms) results.push(await runArm(arm, c, ctx, opts));
    return { id: c.id, axis: c.axis, arms: results };
  } finally {
    await owner.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
  }
}

export async function closeRunner(): Promise<void> {
  await owner.end();
}
