/**
 * Sign-in and the background sweepers run as their own narrow roles, not the superuser.
 *
 * WHAT THE FOUNDER ASKED FOR (build list item 6, CLAUDE.md release blocker 3): move
 * phoneSession and discoverySession off the superuser.
 *
 * WHAT WAS WRONG: both connected as the owner, `clone`, a superuser -- which ignores
 * every grant and every row-level policy. The phone door runs before anybody has
 * signed in; the only thing keeping it from everybody's messages was that nobody had
 * written that query.
 *
 * WHAT IS PINNED HERE:
 *   - phoneSession is clone_door and discoverySession is clone_discovery, neither a
 *     superuser nor able to bypass row-level security;
 *   - the door can read an account's id and tenant by number, and is refused messages,
 *     facts, and an account's other columns;
 *   - discovery can read episodes' ids and times, and is refused their text, facts,
 *     messages and a self-test's answers -- "metadata only" as the database's rule;
 *   - the real work still runs through them: dueSessions, activeUsers, /stats (the
 *     phone door end to end is phone-auth.test.ts, which now runs as clone_door).
 *
 * Negative controls, run by hand:
 *   - phoneSession back on MIGRATION_DATABASE_URL      -> "is clone_door" fails
 *   - discoverySession back on MIGRATION_DATABASE_URL  -> "is clone_discovery" fails
 *   - GRANT SELECT (raw_text) ON episodes TO clone_discovery (then revoked) ->
 *     "refused content" fails
 */
import { afterAll, describe, expect, it } from 'vitest';

const { pool, close, discoverySession, phoneSession } = await import('../src/db/client.js');
const { dueSessions } = await import('../src/memory/session.js');
const { activeUsers } = await import('../src/memory/consolidate.js');
const { statsRoutes } = await import('../src/api/stats.js');

afterAll(async () => { await close(); });
void pool;

type Who = { current_user: string; rolsuper: boolean; rolbypassrls: boolean };
const WHO = `SELECT current_user::text, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`;

/** Whether a statement is refused for lack of a privilege (42501), inside a savepoint. */
async function refused(run: typeof phoneSession, sql: string): Promise<boolean> {
  return run(async (db) => {
    try {
      await db.query('SAVEPOINT probe');
      await db.query(sql);
      await db.query('RELEASE SAVEPOINT probe');
      return false;
    } catch (err) {
      await db.query('ROLLBACK TO SAVEPOINT probe').catch(() => {});
      if ((err as { code?: string }).code === '42501') return true;
      throw err;
    }
  });
}
/** discoverySession opens no transaction, so a savepoint needs one around it. */
const inTx: typeof discoverySession = (fn) => discoverySession(async (db) => {
  await db.query('BEGIN');
  try { return await fn(db); } finally { await db.query('ROLLBACK'); }
});

describe('the phone door', () => {
  it('is clone_door: no superuser, no way round row-level security', async () => {
    const who = await phoneSession(async (db) => (await db.query<Who>(WHO)).rows[0]);
    expect(who).toEqual({ current_user: 'clone_door', rolsuper: false, rolbypassrls: false });
  });

  it('may look an account up by its number, and nothing else', async () => {
    expect(await refused(phoneSession, 'SELECT id, tenant_id FROM app_users WHERE phone_hmac = \'x\'')).toBe(false);
    expect(await refused(phoneSession, 'SELECT count(*) FROM phone_challenges')).toBe(false);
    for (const sql of [
      'SELECT email FROM app_users LIMIT 1',
      'SELECT count(*) FROM messages',
      'SELECT count(*) FROM facts',
      'SELECT count(*) FROM episodes',
      'SELECT count(*) FROM device_sessions',
      'SELECT count(*) FROM bans',
    ]) expect(await refused(phoneSession, sql), sql).toBe(true);
  });
});

describe('discovery', () => {
  it('is clone_discovery: no superuser, no way round row-level security', async () => {
    const who = await discoverySession(async (db) => (await db.query<Who>(WHO)).rows[0]);
    expect(who).toEqual({ current_user: 'clone_discovery', rolsuper: false, rolbypassrls: false });
  });

  it('reads ids, counts and times, and is refused content', async () => {
    expect(await refused(inTx, 'SELECT user_id, session_id, ingested_at FROM episodes LIMIT 1')).toBe(false);
    for (const sql of [
      'SELECT raw_text FROM episodes LIMIT 1',
      'SELECT object_text FROM facts LIMIT 1',
      'SELECT count(*) FROM messages',
      'SELECT answer FROM self_tests LIMIT 1',
      'SELECT phone_hmac FROM app_users LIMIT 1',
      'SELECT count(*) FROM phone_challenges',
    ]) expect(await refused(inTx, sql), sql).toBe(true);
  });

  it('still does its work: the sweeper, the consolidator and /stats', async () => {
    expect(Array.isArray(await dueSessions(5))).toBe(true);
    expect(Array.isArray(await activeUsers(1))).toBe(true);
    const res = await statsRoutes.request('/stats');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('People here');
  });
});
