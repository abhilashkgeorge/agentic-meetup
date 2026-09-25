/**
 * Before any test runs: the tests' database exists and is migrated (tests/support/test-db.ts).
 *
 * Created once, on the same server as the development database, then brought up to
 * date by the same migrations the app uses -- so a migration that fails on a fresh
 * database fails here first. Kept between runs: tests clean up what they make, and a
 * crashed run's leftovers now land here instead of among real data.
 *
 * REFUSES to go on if any URL the tests would use names a database not ending in
 * `_test`. That is the whole point, and the one mistake worth stopping the run for.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import pg from 'pg';
import { devEnv, isTestDatabase, TEST_DB, testDatabaseEnv } from './test-db.js';

export default async function setup(): Promise<void> {
  const env = testDatabaseEnv();
  if (!env.DATABASE_URL) throw new Error('No DATABASE_URL: the tests have no database to use.');
  for (const [k, v] of Object.entries(env)) {
    if (!isTestDatabase(v)) throw new Error(`${k} does not point at a *_test database. Refusing to run the tests there.`);
  }

  // Created by the owner, from the development database's own connection.
  const owner = devEnv().MIGRATION_DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL;
  if (!owner) throw new Error('MIGRATION_DATABASE_URL is needed to create the tests\' database.');
  const c = new pg.Client({ connectionString: owner });
  await c.connect();
  try {
    const { rowCount } = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
    if (!rowCount) await c.query(`CREATE DATABASE "${TEST_DB.replace(/"/g, '')}"`);
  } finally {
    await c.end();
  }

  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/migrate.ts'], {
    cwd: join(import.meta.dirname, '..', '..'),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`Migrating the tests' database failed:\n${r.stdout}\n${r.stderr}`);
}
