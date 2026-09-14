/** Applies migrations/*.sql in filename order, once each, inside a transaction. */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { env } from '../env.js';
import { seedPredicates } from './seedPredicates.js';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

// Migrations connect as the OWNER, not as the restricted app role -- clone_app is
// deliberately unable to create tables, and equally deliberately unable to bypass RLS.
const pool = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

async function adminSession<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function main(): Promise<void> {
  await adminSession(async (c) => {
    await c.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
  });

  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  for (const name of files) {
    const applied = await adminSession((c) =>
      c.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]),
    );
    if (applied.rowCount) {
      console.log(`skip  ${name}`);
      continue;
    }
    const sql = await readFile(join(MIGRATIONS, name), 'utf8');
    await adminSession(async (c) => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    });
    console.log(`apply ${name}`);
  }
  // Predicates are a vocabulary, not data: re-seeded from @clone/shared every run
  // so the DB, the extraction prompt and the app can never disagree.
  const n = await adminSession((c) => seedPredicates(c));
  console.log(`seed  ${n} predicates`);

  await pool.end();
}

await main();
