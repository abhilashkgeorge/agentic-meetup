/**
 * How often the want check agrees with a person's marks. Target: 90%.
 *
 *   npm run wants:score            says what a run would do and cost. Sends nothing.
 *   npm run wants:score -- --go    runs the real check on the marked pairs. Spends.
 *
 * THE FOUNDER'S RULE: no model credits on anything but the app, unless he says so. So
 * nothing here calls a model without `--go`, and even then only on pairs a person has
 * marked (`npm run wants:label`). The calls are metered like any other (eval:wants),
 * under one eval account that is kept, so the spend stays on the ledger.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVAL_PAIRS } from './pairs.js';
import { agreement, plan, readLabels, runChecks, TARGET } from './accuracy.js';

export async function main(
  args: readonly string[], out: (line: string) => void = console.log,
  /** The marks to use; the file's when not given. */
  given?: Record<string, import('./accuracy.js').Mark>,
): Promise<{ sent: boolean }> {
  const labels = given ?? readLabels();
  const p = plan(EVAL_PAIRS, labels);
  const { capabilities } = await import('../../src/llm/caps.js');
  const { computeCost } = await import('../../src/llm/port.js');
  const { modelFor } = await import('../../src/llm/index.js');
  const model = modelFor('extract');
  const estimate = computeCost(capabilities(model), {
    inputTokens: p.inputTokens, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: p.outputTokens,
  });

  out(`pairs            : ${p.pairs}`);
  out(`marked by a person: ${p.marked}   (not yet: ${p.unmarked})`);
  out(`a run would make : ${p.calls} model calls to ${model}, about $${estimate.toFixed(4)}`);
  if (!args.includes('--go')) {
    out('');
    out('Nothing was sent. To run it:  npm run wants:score -- --go');
    return { sent: false };
  }
  if (!p.marked) {
    out('');
    out('Nothing is marked yet, so there is nothing to score. Mark pairs first:  npm run wants:label');
    return { sent: false };
  }

  const { env } = await import('../../src/env.js');
  const { Pool } = await import('pg');
  const { metered } = await import('../../src/metering.js');
  const { checkWants } = await import('../../src/matching/wants.js');
  const { closeMatchPool, pool } = await import('../../src/db/client.js');
  const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
  try {
    // ONE EVAL ACCOUNT, KEPT: deleting it would take its spend off the ledger.
    const name = '__eval_wants__';
    let t = await owner.query<{ id: string }>('SELECT id FROM tenants WHERE name = $1', [name]);
    if (!t.rows[0]) t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [name]);
    const tenantId = t.rows[0]!.id;
    let u = await owner.query<{ id: string }>('SELECT id FROM app_users WHERE tenant_id = $1', [tenantId]);
    if (!u.rows[0]) u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, 'wants@eval.test']);
    const ctx = { tenantId, userId: u.rows[0]!.id };

    const run = await metered(ctx, 'eval:wants', () => runChecks(ctx, p.byWant, checkWants));
    const score = agreement(run.results, labels);
    out('');
    out(`checked          : ${score.n} pairs${run.failed.length ? `  (calls that failed: ${run.failed.join(', ')})` : ''}`);
    out(`agreed           : ${score.agree}   ${score.rate === null ? '' : `${(score.rate * 100).toFixed(1)}%`}   target ${TARGET * 100}%  ${score.meetsTarget ? 'MET' : 'NOT MET'}`);
    out(`spent            : $${run.costUsd.toFixed(4)}`);
    for (const m of score.misses.slice(0, 15)) out(`  ${m.id}: marked ${m.marked}, check said ${m.got}`);
    const dir = join(import.meta.dirname, 'results');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`);
    writeFileSync(file, `${JSON.stringify({ model, ...score, costUsd: run.costUsd, failed: run.failed }, null, 2)}\n`);
    out(`report           : ${file}`);
    return { sent: true };
  } finally {
    await owner.end();
    await closeMatchPool();
    await pool.end();
  }
}

// Run from the command line; imported by the test, it does nothing by itself.
if (process.argv[1] && process.argv[1].endsWith('score.ts')) {
  await main(process.argv.slice(2));
  process.exit(0);
}
