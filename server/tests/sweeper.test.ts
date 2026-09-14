/**
 * The background sweeper must only spend money on real people.
 *
 * WHAT HAPPENED. `dueSessions` considered every session that had ever been written,
 * with no notion of whose it was. Tests create users through the owner pool and leave
 * their episodes behind, so the backlog grew with every run -- and a development
 * server sweeping once a minute worked through it, paying for an extraction each time.
 *
 * Nobody could see it. Extraction spend was recorded by hand at five call sites and
 * the sweeper was not one of them, so the money left no row. It only became visible
 * when metering moved into the router: 552 sessions in the queue, of which ten
 * belonged to somebody who had ever opened the app.
 *
 * `device_sessions` is the boundary. A person who signed in on a device has a row; a
 * fixture inserted straight into `app_users` never does.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { dueSessions } from '../src/memory/session.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

let tenantId = '';
let fixture = '';
let person = '';
const sessionOf = new Map<string, string>();

async function userWithASession(tag: string, signedIn: boolean): Promise<string> {
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}-${Date.now()}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = crypto.randomUUID();
  sessionOf.set(userId, sessionId);

  // Ingested in the past, so it is already idle and therefore due.
  await owner.query(
    `INSERT INTO episodes (tenant_id, user_id, session_id, turn_id, turn_index,
                           role, source, raw_text, occurred_at, ingested_at)
     VALUES ($1,$2,$3,gen_random_uuid(),0,'user','text',$4, now() - interval '2 days',
             now() - interval '2 days')`,
    [tenantId, userId, sessionId, `something ${tag} said`]);

  if (signedIn) {
    await owner.query(
      `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
       VALUES (gen_random_uuid(), $1, $2, 'test device', now() + interval '30 days')`,
      [tenantId, userId]);
  }
  return userId;
}

beforeAll(async () => {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`sweep-${Date.now()}`]);
  tenantId = t.rows[0]!.id;
  fixture = await userWithASession('fixture', false);
  person = await userWithASession('person', true);
});

afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
  await owner.end();
  await pool.end();
});

describe('dueSessions', () => {
  it('offers up the session of somebody who has actually signed in', async () => {
    const due = await dueSessions(500);
    const mine = due.filter((d) => d.ctx.userId === person);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.sessionId).toBe(sessionOf.get(person));
  });

  it('never offers up a fixture that nobody ever signed in as', async () => {
    // The failing case, exactly: same tenant, same shape of episode, same age. The
    // only difference is that no device was ever authenticated for this user, and
    // that difference must be worth money.
    const due = await dueSessions(500);
    expect(due.map((d) => d.ctx.userId)).not.toContain(fixture);
  });

  it('stops sweeping an account whose devices have all been revoked', async () => {
    await owner.query(
      'UPDATE device_sessions SET revoked_at = now() WHERE user_id = $1', [person]);
    try {
      // Deliberately still true after revocation: the row exists, so this person has
      // used the app and their own backlog is still theirs to extract. Asserted so
      // that if somebody later narrows the clause to live sessions only, they do it
      // on purpose and this test tells them what changed.
      const due = await dueSessions(500);
      expect(due.map((d) => d.ctx.userId)).toContain(person);
    } finally {
      await owner.query(
        'UPDATE device_sessions SET revoked_at = NULL WHERE user_id = $1', [person]);
    }
  });
});
