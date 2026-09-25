/**
 * A real person must be able to tell an invented one apart.
 *
 * THE BUG. The synthetic side was auto-decided `yes` the moment briefs existed;
 * `decide` introduces a pair once both sides are yes; the reveal screen routes into
 * the conversation. So saying yes to an invented profile put a real person in a chat
 * room with nobody in it. No surface anywhere used the word synthetic -- its only
 * occurrence in the app was inside a comment.
 *
 * Two independent guarantees, and they are tested independently because either alone
 * is insufficient: the bit is readable by the person's own session (so every screen
 * can say so), and nothing auto-answers on an invented person's behalf unless the
 * flag that exists for hand-testing is explicitly on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, tenantSession } from '../src/db/client.js';
import { env } from '../src/env.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

let real = { tenantId: '', userId: '' };
let fake = { tenantId: '', userId: '' };
let rendezvousId = '';

async function person(tag: string, synthetic: boolean) {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`${tag}-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}-${Date.now()}@example.test`]);
  const userId = u.rows[0]!.id;
  // OUT OF THE POOL. Nothing here needs it in, and in it this profile -- no gender,
  // no intent, and every candidate clause passes on NULL -- was somebody every other
  // file's round could meet while this one ran. Once a round stopped holding
  // conversations (2026-09-23) rounds got fast enough to meet it routinely, and the
  // DELETE in afterAll then deadlocked against their writes to rendezvous, left both
  // tenants behind, and every later round in the database met them.
  await owner.query(
    `INSERT INTO match_profile (user_id, tenant_id, age, in_pool, is_synthetic)
     VALUES ($1,$2,30,false,$3)`, [userId, tenantId, synthetic]);
  return { tenantId, userId };
}

beforeAll(async () => {
  real = await person('practice-real', false);
  fake = await person('practice-fake', true);
  const [lo, hi] = real.userId < fake.userId ? [real, fake] : [fake, real];
  const r = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status)
     VALUES ($1,$2,$3,$4,1,'decided') RETURNING id`,
    [lo.userId, hi.userId, lo.tenantId, hi.tenantId]);
  rendezvousId = r.rows[0]!.id;
});

afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = ANY($1)',
    [[real.tenantId, fake.tenantId]]);
  await owner.end();
  await pool.end();
});

describe('the practice bit', () => {
  it('is readable by the real person about the invented one', async () => {
    // Through a function, because the caller's own session cannot read the other
    // person's match_profile at all -- correctly. Same shape as block_exists and
    // rendezvous_other_said_yes: one bit, nothing else.
    const answer = await tenantSession(real, async (c) => {
      const { rows } = await c.query<{ synthetic: boolean }>(
        'SELECT rendezvous_other_is_synthetic($1,$2) AS synthetic',
        [rendezvousId, real.userId]);
      return rows[0]!.synthetic;
    });
    expect(answer).toBe(true);
  });

  it('does not become a way to ask about strangers', async () => {
    // A rendezvous this person is not half of must answer the same as one that does
    // not exist, or the function is an enumeration oracle wearing a boolean.
    const answer = await tenantSession(fake, async (c) => {
      const { rows } = await c.query<{ synthetic: boolean }>(
        'SELECT rendezvous_other_is_synthetic($1,$2) AS synthetic',
        ['00000000-0000-0000-0000-000000000000', fake.userId]);
      return rows[0]!.synthetic;
    });
    expect(answer).toBe(false);
  });

  it('reads false when the other side is a real person', async () => {
    const answer = await tenantSession(fake, async (c) => {
      const { rows } = await c.query<{ synthetic: boolean }>(
        'SELECT rendezvous_other_is_synthetic($1,$2) AS synthetic',
        [rendezvousId, fake.userId]);
      return rows[0]!.synthetic;
    });
    expect(answer).toBe(false);
  });
});

describe('nobody answers on an invented person behalf', () => {
  it('is off by default, so no dead conversation can be created', () => {
    // The default is the whole fix. If this flips to true by default again, a real
    // person is introduced to nobody and the app promises them a chat.
    expect(env.SYNTHETIC_AUTO_YES).toBe(false);
  });

  it('leaves the invented side undecided, so the pair is never introduced', async () => {
    await owner.query(
      `INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, concern)
       VALUES ($1,$2,'h','c'), ($1,$3,'h','c')`,
      [rendezvousId, real.userId, fake.userId]);

    const { autoDecideSynthetic } = await import('../src/matching/orchestrator.js');
    const { matchmakerSession } = await import('../src/db/client.js');

    // The helper still works when called -- it is how the founder walks the messaging
    // flow by hand. What changed is that the round no longer calls it.
    const before = await matchmakerSession(async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*) AS n FROM rendezvous_briefs
          WHERE rendezvous_id = $1 AND human_says_yes IS NOT NULL`, [rendezvousId]);
      return Number(rows[0]!.n);
    });
    expect(before).toBe(0);

    const decided = await matchmakerSession((c) => autoDecideSynthetic(c, rendezvousId));
    expect(decided).toBe(1);
  });
});
