/**
 * The tests run on their own database, never the development one.
 *
 * WHAT THE FOUNDER ASKED FOR (build list item 13): "tests get their own database" --
 * so the dev server stops racing them. Its round worker used to drain rounds the tests
 * had queued; its expiry timer (0069) would expire their cards; crashed runs left
 * fixtures among real data.
 *
 * WHAT IS PINNED HERE: every database URL a test worker sees names a `*_test` database;
 * the pools the code under test uses really are connected to it; and the guard that
 * stops the run recognises the development URL for what it is.
 *
 * Negative control, run 2026-09-25: vitest.config.ts without `env: testDatabaseEnv()`
 * -> "every database URL" and "connected to it" fail (the workers read .env's URLs).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { devEnv, isTestDatabase, TEST_DB } from './support/test-db.js';

const { pool, matchmakerSession, closeMatchPool } = await import('../src/db/client.js');

afterAll(async () => { await closeMatchPool(); await pool.end(); });

describe('the tests’ database', () => {
  it('is the only one any database URL points at', () => {
    const urls = Object.entries(process.env).filter(([k, v]) => /(^|_)DATABASE_URL$/.test(k) && v);
    expect(urls.length).toBeGreaterThan(0);
    for (const [k, v] of urls) expect(isTestDatabase(v!), `${k} is not a *_test database`).toBe(true);
  });

  it('is what the code under test is connected to', async () => {
    const app = (await pool.query<{ db: string }>('SELECT current_database() AS db')).rows[0]!.db;
    const mm = await matchmakerSession(async (c) => (await c.query<{ db: string }>('SELECT current_database() AS db')).rows[0]!.db);
    expect(app).toBe(TEST_DB);
    expect(mm).toBe(TEST_DB);
  });

  it('is told apart from the development database by the guard', () => {
    const dev = devEnv().DATABASE_URL;
    if (dev) expect(isTestDatabase(dev)).toBe(false);
    expect(isTestDatabase('postgres://clone_app:x@localhost:5433/clone_test')).toBe(true);
    expect(isTestDatabase('postgres://clone_app:x@localhost:5433/clone')).toBe(false);
  });
});
