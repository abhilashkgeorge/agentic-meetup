/**
 * THE TESTS' OWN DATABASE (the founder's item 13).
 *
 * WHAT WAS WRONG: the suite ran against the development database -- the one the dev
 * server works on. Its round worker drained rounds the tests had queued (a test's own
 * round, run by somebody else, found nobody and failed), its expiry timer would expire
 * the tests' cards, and every crashed run left fixtures behind among real data (3,700
 * orphan rows when 0063 was written).
 *
 * THE FIX: every *_DATABASE_URL the tests see is the development one with the database
 * name changed to `clone_test` (or TEST_DATABASE_NAME). Same server, same roles and
 * passwords -- roles belong to the server, not to a database -- a different database.
 * vitest.config.ts hands these to every test worker before anything reads the settings,
 * and a setting the environment already holds is never replaced by .env (env.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export const TEST_DB = process.env.TEST_DATABASE_NAME ?? 'clone_test';

const SERVER = join(import.meta.dirname, '..', '..');

/** The developer's settings, as server/.env has them. Empty when there is no file. */
export function devEnv(): Record<string, string> {
  try {
    return parseEnv(readFileSync(join(SERVER, '.env'), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Every database URL, pointed at the tests' database. Nothing else is changed. */
export function testDatabaseEnv(): Record<string, string> {
  const dev = { ...devEnv(), ...process.env } as Record<string, string | undefined>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dev)) {
    if (!/(^|_)DATABASE_URL$/.test(k) || !v) continue;
    const u = new URL(v);
    u.pathname = `/${TEST_DB}`;
    out[k] = u.toString();
  }
  return out;
}

/** A URL is the tests' only if its database is named for them. The one guard that matters. */
export const isTestDatabase = (url: string): boolean => /_test$/.test(new URL(url).pathname.slice(1));
