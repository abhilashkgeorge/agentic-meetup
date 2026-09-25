/**
 * The founder's funnel: each step counted once, between real people only.
 *
 * WHAT THE FOUNDER ASKED FOR (build list item 10): "simple stats page: matches -> both
 * yes -> first message -> date proposed -> met (check-in), real users only."
 *
 * WHAT IS PINNED HERE, as the change each scene makes to the counts (the dev database
 * holds real data too, so the test reads before and after rather than absolutes):
 *   - a pair whose cards went out is a match; both yes, a first message, a proposed
 *     date and a "we met" each move their own step and no other;
 *   - "met" counts from either check-in: the "did you meet" answer or the after-date
 *     check-in;
 *   - an invented person, a test fixture, or somebody who never signed in on a phone
 *     makes the pair not count at all;
 *   - only a reviewer sees it.
 *
 * Negative controls, run 2026-09-25 (the live function replaced, then restored
 * byte-identical):
 *   - founder_funnel without the synthetic filter    -> "real people only" fails
 *   - met without date_checkins                      -> "either check-in" fails
 *   - the route without the reviewer check           -> "only a reviewer" fails
 * Not a control: first_message without "introduced" still passes, because a message
 * cannot exist before both said yes (the messaging policy) -- the condition keeps the
 * funnel nested by construction and guards nothing a test could plant.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return { ...real, decideModel: () => null,
    llm: { ...real.llm, complete: async () => { throw new Error('no model'); }, decide: async () => { throw new Error('no model'); } } };
});

const { pool, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { adminRoutes } = await import('../src/api/admin.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

type P = { tenantId: string; userId: string; token: string };
/**
 * A person. `real` ones get the address a real door gives (tenant@device.local), a
 * session, and a profile out of the pool -- so no round anywhere can meet them.
 */
async function person(kind: 'real' | 'synthetic' | 'fixture' | 'never_signed_in'): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`fn-${kind}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const email = kind === 'fixture' ? `fn-${Math.random()}@example.test` : `${tenantId}@device.local`;
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, email]);
  const userId = u.rows[0]!.id;
  await owner.query(`INSERT INTO match_profile (user_id, tenant_id, in_pool, is_synthetic, intent) VALUES ($1,$2,false,$3,$4)`,
    [userId, tenantId, kind === 'synthetic', [`fn-${tenantId}`]]);
  const sessionId = newSessionId();
  if (kind !== 'never_signed_in') {
    await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                       VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  }
  return { tenantId, userId, token: mintToken(sessionId) };
}

/** A pair at a given stage. Everything written the way the app writes it. */
async function pair(a: P, b: P, stage: {
  introduced?: boolean; messages?: number; proposed?: boolean; met?: 'brief' | 'checkin'; status?: string;
} = {}): Promise<string> {
  const [lo, hi] = a.userId < b.userId ? [a, b] : [b, a];
  const status = stage.status ?? (stage.introduced ? 'introduced' : 'decided');
  const r = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover, introduced_at)
     VALUES ($1,$2,$3,$4,0,$5,$6, CASE WHEN $7 THEN now() END) RETURNING id`,
    [lo.userId, hi.userId, lo.tenantId, hi.tenantId, status, a.userId, Boolean(stage.introduced)]);
  const id = r.rows[0]!.id;
  for (const who of [a, b]) {
    await owner.query(
      `INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, overlap_quotes, concern, questions, met)
       VALUES ($1,$2,'x','{}','','[]',$3)`, [id, who.userId, stage.met === 'brief' && who === a ? true : null]);
  }
  for (let i = 0; i < (stage.messages ?? 0); i++) {
    await owner.query(`INSERT INTO messages (id, rendezvous_id, sender_id, body, seq) VALUES ($1,$2,$3,'hi', next_message_seq($2))`,
      [crypto.randomUUID(), id, a.userId]);
  }
  if (stage.proposed) {
    await owner.query(`INSERT INTO messages (id, rendezvous_id, sender_id, body, seq, kind)
                       VALUES ($1,$2,$3,'How about this: a walk?', next_message_seq($2), 'date_idea')`,
      [crypto.randomUUID(), id, b.userId]);
  }
  if (stage.met === 'checkin') {
    await owner.query(`INSERT INTO date_checkins (rendezvous_id, for_user, about_user, met) VALUES ($1,$2,$3,true)`,
      [id, b.userId, a.userId]);
  }
  return id;
}

type Funnel = { people: number; steps: { step: string; n: number }[]; expired: number };
async function funnel(reviewer: P): Promise<Record<string, number>> {
  const saved = env.ADMIN_USER_IDS;
  env.ADMIN_USER_IDS = reviewer.userId;
  try {
    const res = await adminRoutes.request('/v1/admin/funnel', { headers: { Authorization: `Bearer ${reviewer.token}` } });
    expect(res.status).toBe(200);
    const f = (await res.json()) as Funnel;
    return { people: f.people, expired: f.expired, ...Object.fromEntries(f.steps.map((s) => [s.step, s.n])) };
  } finally {
    env.ADMIN_USER_IDS = saved;
  }
}
const delta = (a: Record<string, number>, b: Record<string, number>) =>
  Object.fromEntries(Object.keys(b).map((k) => [k, b[k]! - a[k]!]));

describe('the funnel', () => {
  it('counts each step once, between real people only', async () => {
    const rev = await person('real');
    const before = await funnel(rev);

    const [a, b, c, d] = [await person('real'), await person('real'), await person('real'), await person('real')];
    await pair(a, b);                                                                   // cards out, unanswered
    await pair(a, c, { introduced: true });                                             // both yes, silent
    await pair(a, d, { introduced: true, messages: 2, proposed: true, met: 'brief' });  // all the way
    await pair(b, c, { introduced: true, messages: 1, met: 'checkin' });                // met, by the check-in
    await pair(b, d, { status: 'expired' });                                            // nobody answered
    // Pairs that must not count at all.
    await pair(a, await person('synthetic'), { introduced: true, messages: 1, proposed: true, met: 'brief' });
    await pair(a, await person('fixture'), { introduced: true, messages: 1, proposed: true, met: 'brief' });
    await pair(a, await person('never_signed_in'), { introduced: true, messages: 1 });

    const after = await funnel(rev);
    expect(delta(before, after)).toEqual({
      people: 4,            // a-d; never the invented, the fixture or the never-signed-in
      matches: 5, both_yes: 3, first_message: 2, date_proposed: 1, met: 2, expired: 1,
    });
  });

  it('only a reviewer sees it', async () => {
    const plain = await person('real');
    const res = await adminRoutes.request('/v1/admin/funnel', { headers: { Authorization: `Bearer ${plain.token}` } });
    expect(res.status).toBe(404);
  });
});
