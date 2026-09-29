/**
 * The town square cannot be used to test a stranger against your rules (api/world.ts).
 *
 * WHAT WAS WRONG (the founder's (c), 2026-09-29; docs/END-TO-END.md 15.2 item 5): the
 * square's strangers were picked again every thirty seconds by the round's candidate
 * query -- both people's rules. Flip one of your must-haves, reopen the town, and
 * whether a stranger you recognised by their character was still standing there told you
 * how they answered; changing your own answers did the same for their rules.
 *
 * WHAT IS PINNED, through the real route on the real query:
 *   - a rule flipped today does not change today's square, however long after;
 *   - safety is never frozen: somebody who blocks you leaves the square at once;
 *   - tomorrow's square is picked with the rules as they stand then.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - the sample picked again on every look       -> "a rule flipped today" fails;
 *   - the day's sample not re-checked for safety  -> "leaves at once" fails.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';
import { CORE } from '../src/onboarding/questions.js';

const { pool, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { worldRoutes } = await import('../src/api/world.js');
const { agentRef } = await import('../src/matching/world.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
const tag = `probe-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
interface P { tenantId: string; userId: string; token: string }

async function person(label: string, over: Record<string, unknown>): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`${tag}-${label}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}-${label}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: [tag], in_pool: true, is_synthetic: false,
    sees_synthetic: false, display_name: label, ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map((k) => cols[k]));
  for (const id of CORE) {
    await owner.query(`INSERT INTO question_answers (tenant_id, user_id, question_id, answer, skipped)
      VALUES ($1,$2,$3,'{"values":[],"whoFine":{"anyone":true}}'::jsonb, true)`, [tenantId, userId, id]);
  }
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
    VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}
/** The strangers in `viewer`'s square now, as the refs the viewer has for them. */
async function square(viewer: P): Promise<string[]> {
  const res = await worldRoutes.request('/v1/world', { headers: { Authorization: `Bearer ${viewer.token}`, 'x-forwarded-for': '203.0.113.9' } });
  expect(res.status).toBe(200);
  const body = await res.json() as { agents: { ref: string; kind: string }[] };
  return body.agents.filter((a) => a.kind !== 'met').map((a) => a.ref);
}

// A Bengaluru morning, so minutes later is still the same day.
const MORNING = new Date('2026-09-30T04:00:00Z').getTime();
let me: P, priya: P, nisha: P;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MORNING);
  me = await person('me', { gender: 'man', seeking_gender: ['woman'] });
  priya = await person('priya', {});
  nisha = await person('nisha', {});
});
afterAll(async () => {
  vi.useRealTimers();
  await owner.query('DELETE FROM blocks WHERE blocker_id = $1 OR blocked_id = $1', [me.userId]);
  await removeTenants(owner, made);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('the town square', () => {
  it('does not change for a rule flipped today, however long after', async () => {
    const before = await square(me);
    expect(before).toContain(agentRef(me.userId, priya.userId));
    // I stop seeking women: Priya no longer passes my rules.
    await owner.query("UPDATE match_profile SET seeking_gender = '{man}' WHERE user_id = $1", [me.userId]);
    vi.setSystemTime(MORNING + 5 * 60_000);
    expect(await square(me), 'flipping a rule showed whether she passes it').toContain(agentRef(me.userId, priya.userId));
  });

  it('lets safety through at once: somebody who blocks you leaves it now', async () => {
    await owner.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2)', [priya.userId, me.userId]);
    vi.setSystemTime(MORNING + 6 * 60_000);
    const now = await square(me);
    expect(now, 'a block waited for tomorrow').not.toContain(agentRef(me.userId, priya.userId));
    expect(now).toContain(agentRef(me.userId, nisha.userId));
  });

  it('is picked again tomorrow, with the rules as they stand then', async () => {
    vi.setSystemTime(MORNING + 24 * 3_600_000);
    expect(await square(me)).not.toContain(agentRef(me.userId, nisha.userId));
  });
});
