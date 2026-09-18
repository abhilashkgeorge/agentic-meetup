/**
 * What the other phone hears when you decide.
 *
 * Three answers, three different silences. The first mover's yes tells the second
 * mover it is their turn -- the one moment a yes is visible, and their reveal opens
 * on it anyway. Both yeses tell both. A NO TELLS NOBODY: the reveal promises "they
 * are never told what you chose", and the negative control here is the whole point of
 * the file -- the other person's frame list stays empty.
 *
 * The socket is stood in for by a fake with `readyState: 1` and a `send` that keeps
 * the frames; hub.join takes it like any other. No model, no network.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { decide } from '../src/matching/orchestrator.js';
import { agentRef } from '../src/matching/world.js';
import * as hub from '../src/messaging/hub.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string }
async function person(label: string): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`de-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `de-${label}-${Date.now()}-${Math.random()}@example.test`]);
  return { tenantId, userId: u.rows[0]!.id };
}
async function seat(a: P, b: P, firstMover: P): Promise<string> {
  const [lo, hi] = a.userId < b.userId ? [a, b] : [b, a];
  const r = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover)
     VALUES ($1,$2,$3,$4,5,'decided',$5) RETURNING id`, [lo.userId, hi.userId, lo.tenantId, hi.tenantId, firstMover.userId]);
  for (const who of [a, b]) {
    await owner.query(`INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, concern) VALUES ($1,$2,'h','c')`, [r.rows[0]!.id, who.userId]);
  }
  return r.rows[0]!.id;
}
/** A socket that remembers. */
function listen(userId: string): { frames: Array<Record<string, unknown>> } {
  const frames: Array<Record<string, unknown>> = [];
  hub.join(userId, { readyState: 1, send: (t: string) => { frames.push(JSON.parse(t)); } } as never);
  return { frames };
}

// A pair meets ONCE, ever (rendezvous_pair is unique), so each scene gets its own two people.
const pair = async () => ({ A: await person('a'), B: await person('b') });

describe('when the first mover says yes', () => {
  it('the second mover is told it is their turn, by ref', async () => {
    const { A, B } = await pair();
    const rz = await seat(A, B, A);
    const b = listen(B.userId);
    await decide(A.userId, rz, true);
    expect(b.frames).toEqual([{ type: 'match.turn', rendezvousId: rz, agent: agentRef(B.userId, A.userId) }]);
    expect(JSON.stringify(b.frames)).not.toContain(A.userId);   // a ref, never the id
  });
});

describe('when somebody says no', () => {
  it('NOBODY is told anything', async () => {
    const { A, B } = await pair();
    const rz = await seat(A, B, A);
    const a = listen(A.userId); const b = listen(B.userId);
    await decide(A.userId, rz, false);
    expect(a.frames).toEqual([]);
    expect(b.frames).toEqual([]);
    // and the row lapsed, as before
    const { rows } = await owner.query<{ status: string }>('SELECT status FROM rendezvous WHERE id = $1', [rz]);
    expect(rows[0]!.status).toBe('lapsed');
  });
});

describe('when both say yes', () => {
  it('both are told they are introduced, each with their own ref for the other', async () => {
    const { A, B } = await pair();
    const rz = await seat(A, B, A);
    const a = listen(A.userId); const b = listen(B.userId);
    await decide(A.userId, rz, true);
    await decide(B.userId, rz, true);
    expect(a.frames.at(-1)).toEqual({ type: 'match.introduced', rendezvousId: rz, agent: agentRef(A.userId, B.userId) });
    expect(b.frames.at(-1)).toEqual({ type: 'match.introduced', rendezvousId: rz, agent: agentRef(B.userId, A.userId) });
    // and B also heard it was their turn, earlier
    expect(b.frames[0]).toEqual({ type: 'match.turn', rendezvousId: rz, agent: agentRef(B.userId, A.userId) });
  });
});
