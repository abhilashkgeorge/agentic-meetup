/**
 * "People here" on /stats counts people: not the practice pool, and not the accounts the
 * eval tools keep.
 *
 * WHAT WAS WRONG (2026-09-28). The eval tools keep one account each (`__eval_wants__`,
 * `__eval_clone_brain__`) so their model spend stays on the ledger -- deleting a tenant
 * takes its llm_calls rows with it. The page counted every tenant but `__synthetic__`,
 * so the clone-brain baseline run added one "person" to the one page whose whole purpose
 * is honesty about how small this is. Found when the run's account was created.
 *
 * HOW IT IS TESTED WITHOUT A GLOBAL COUNT. Test files share one database and run at
 * once, so "the page says N" proves nothing. The rule is one SQL condition, and the
 * route uses exactly it; this runs that condition, as the page's own role, over rows
 * planted here and nowhere else.
 *
 * Negative control, run by hand (2026-09-28): PERSON_TENANT back to
 * `t.name <> '__synthetic__'` -> "an eval account is not a person" fails.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { close, closeMatchPool, discoverySession } from '../src/db/client.js';
import { env } from '../src/env.js';
import { PERSON_TENANT } from '../src/api/stats.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await close();
});

/** One account in its own tenant; the tenant's id, because that is what the page's role may read. */
async function account(tenantName: string): Promise<string> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tenantName]);
  made.push(t.rows[0]!.id);
  await owner.query('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2)',
    [t.rows[0]!.id, `stats-${Math.random()}@example.test`]);
  return t.rows[0]!.id;
}

describe('who "People here" counts', () => {
  it('counts a person, and not an eval account', async () => {
    const tag = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const real = await account(`stats-person-${tag}`);
    const evalAccount = await account(`__eval_stats_${tag}__`);
    // A name that only LOOKS like one: the underscores in the pattern are literal.
    const lookalike = await account(`xxevalx-${tag}`);
    // As the page's own role (clone_discovery), which may read a user's tenant_id and a
    // tenant's name and nothing else (0066).
    const counted = await discoverySession(async (db) => (await db.query<{ tenant_id: string }>(
      `SELECT u.tenant_id FROM app_users u JOIN tenants t ON t.id = u.tenant_id
        WHERE u.tenant_id = ANY($1::uuid[]) AND ${PERSON_TENANT}`, [[real, evalAccount, lookalike]])).rows.map((r) => r.tenant_id));
    expect(counted.sort()).toEqual([real, lookalike].sort());
    expect(counted, 'an eval account is not a person').not.toContain(evalAccount);
  });

  it('is the condition the page itself counts with', () => {
    // Source shape, because the page's number is global and cannot be asserted from a
    // test sharing the database: the people count must be the condition tested above.
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'api', 'stats.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
    expect(src).toMatch(/FROM app_users u JOIN tenants t ON t\.id = u\.tenant_id\s+WHERE \$\{PERSON_TENANT\}\)\s+AS people/);
  });
});
