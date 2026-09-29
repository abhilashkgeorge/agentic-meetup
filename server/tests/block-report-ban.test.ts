/**
 * Block, report and ban: kept apart everywhere, and for good.
 *
 * WHAT THE FOUNDER ASKED FOR (build list item 3): Block, and Report with a few fixed
 * reasons, on every card, profile and chat; blocking hides both people from each other
 * everywhere, forever; reports go to a queue he reviews, where he can ban someone.
 *
 * WHAT WAS WRONG: a block stopped new matches and hid the conversation list, and
 * nothing else -- a card made before the block stayed on both screens, the profile still
 * opened, and each still stood in the other's town. And the strongest review outcome
 * left the person signed in. Found reading every use of block_exists (0064's header).
 *
 * WHAT IS PINNED HERE:
 *   - a block from a card (by match -- a card carries nobody's id) hides both people from
 *     each other on the matches list, the profile, the yes/no, and the town, both ways;
 *   - only your own match can be blocked or reported through, and a report gives one of
 *     the fixed reasons and blocks too;
 *   - a ban signs the person out -- even a session that slips past the revoke -- takes
 *     them out of the pool, and hides them from everybody, not just the reporter;
 *   - only the reviewer sees the queue or can ban, and the queue names who was
 *     reported and whether a ban already stands (what the phone's queue reads).
 *
 * Negative controls, run by hand:
 *   - GET /v1/matches without apart()          -> "hides both people" fails
 *   - auth.ts without is_banned()              -> "signs them out" fails
 *   - ban_user without moderation_hidden (ALTER on the dev database, restored) ->
 *     "out of the pool" fails
 *   - the queue's `banned` column read as false, or its name as null
 *                                               -> "signs them out" fails (the queue
 *                                                  checks inside the same scene)
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real,
    decideModel: () => null,
    llm: {
      ...real.llm,
      complete: async () => { throw new Error('no model in this test'); },
      decide: async () => { throw new Error('no model in this test'); },
    },
  };
});

const { pool, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { messageRoutes } = await import('../src/api/messages.js');
const { adminRoutes } = await import('../src/api/admin.js');
const { worldRoutes } = await import('../src/api/world.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  await removeTenants(owner, made);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

type Person = { tenantId: string; userId: string; token: string };
async function session(p: { tenantId: string; userId: string }): Promise<string> {
  const id = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [id, p.tenantId, p.userId]);
  return mintToken(id);
}
async function person(label: string): Promise<Person> {
  const tag = `brb-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  await owner.query(`INSERT INTO match_profile (user_id, tenant_id, age, in_pool, intent) VALUES ($1,$2,30,true,$3)`,
    [userId, tenantId, [tag]]);
  return { tenantId, userId, token: await session({ tenantId, userId }) };
}
/** A match between two people, decided, with a card for each. `first` reads first. */
async function seat(a: Person, b: Person, first: Person): Promise<string> {
  const [lo, hi] = a.userId < b.userId ? [a, b] : [b, a];
  const r = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover)
     VALUES ($1,$2,$3,$4,0,'decided',$5) RETURNING id`, [lo.userId, hi.userId, lo.tenantId, hi.tenantId, first.userId]);
  for (const who of [a, b]) {
    await owner.query(
      `INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, overlap_quotes, concern, questions)
       VALUES ($1,$2,'Here for something long-term · 30',$3,'','[]')`,
      [r.rows[0]!.id, who.userId, JSON.stringify({ v: 2, shared: [], work: [], quotes: [] })]);
  }
  return r.rows[0]!.id;
}
const H = (p: Person) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' });
const cards = async (p: Person) => {
  const res = await datingRoutes.request('/v1/matches', { headers: H(p) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { matches: { id: string }[] }).matches.map((m) => m.id);
};
const reveal = async (p: Person, id: string) => (await datingRoutes.request(`/v1/matches/${id}`, { headers: H(p) })).status;
const decide = async (p: Person, id: string) =>
  (await datingRoutes.request(`/v1/matches/${id}/decide`, { method: 'POST', headers: H(p), body: JSON.stringify({ yes: true }) })).status;
const townSeats = async (p: Person) => {
  const res = await worldRoutes.request('/v1/world', { headers: H(p) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { agents: { rendezvousId?: string }[] }).agents.map((x) => x.rendezvousId).filter(Boolean);
};

describe('a block from a card', () => {
  it('hides both people from each other everywhere, both ways', async () => {
    const a = await person('a');
    const b = await person('b');
    const id = await seat(a, b, a);
    expect(await cards(a)).toContain(id);
    expect(await cards(b)).toContain(id);
    expect(await townSeats(a)).toContain(id);

    const res = await messageRoutes.request('/v1/block', { method: 'POST', headers: H(a), body: JSON.stringify({ rendezvousId: id }) });
    expect(res.status).toBe(200);

    for (const p of [a, b]) {
      expect(await cards(p), 'a card outlived the block').not.toContain(id);
      expect(await reveal(p, id), 'the profile still opened').toBe(404);
      expect(await decide(p, id)).toBe(404);
      expect(await townSeats(p), 'still in the town').not.toContain(id);
    }
  });

  it('only your own match, and a report gives a fixed reason and blocks too', async () => {
    const a = await person('ra');
    const b = await person('rb');
    const c = await person('rc');
    const id = await seat(a, b, a);
    const outsider = await messageRoutes.request('/v1/block', { method: 'POST', headers: H(c), body: JSON.stringify({ rendezvousId: id }) });
    expect(outsider.status).toBe(404);
    const bad = await messageRoutes.request('/v1/report',
      { method: 'POST', headers: H(b), body: JSON.stringify({ rendezvousId: id, reason: 'boring' }) });
    expect(bad.status).toBe(400);
    const ok = await messageRoutes.request('/v1/report',
      { method: 'POST', headers: H(b), body: JSON.stringify({ rendezvousId: id, reason: 'harassment', detail: 'kept messaging' }) });
    expect(ok.status).toBe(200);
    const { rows } = await owner.query<{ reported_id: string; reason: string }>(
      'SELECT reported_id, reason FROM reports WHERE reporter_id = $1', [b.userId]);
    expect(rows).toEqual([{ reported_id: a.userId, reason: 'harassment' }]);
    expect(await cards(b)).not.toContain(id);
  });
});

describe('a ban', () => {
  it('signs them out, takes them out of the pool, and hides them from everybody', async () => {
    const reviewer = await person('rev');
    const bad = await person('bad');
    const reporter = await person('rep');
    const third = await person('third');
    const reported = await seat(bad, reporter, reporter);
    const other = await seat(bad, third, third);
    await messageRoutes.request('/v1/report', { method: 'POST', headers: H(reporter), body: JSON.stringify({ rendezvousId: reported, reason: 'felt_unsafe' }) });
    const { rows: rep } = await owner.query<{ id: string }>('SELECT id FROM reports WHERE reporter_id = $1', [reporter.userId]);

    await owner.query(`UPDATE match_profile SET display_name = 'Bad Actor' WHERE user_id = $1`, [bad.userId]);
    type Queue = { reports: { id: string; reportedName: string | null; banned: boolean; outcome: string | null }[] };
    const queue = async (all: boolean) => {
      const res = await adminRoutes.request(`/v1/admin/reports${all ? '?all=1' : ''}`, { headers: H(reviewer) });
      expect(res.status).toBe(200);
      return ((await res.json()) as Queue).reports.find((r) => r.id === rep[0]!.id);
    };

    const saved = env.ADMIN_USER_IDS;
    env.ADMIN_USER_IDS = reviewer.userId;
    try {
      // The queue on the phone names who was reported, and whether a ban stands.
      expect(await queue(false)).toMatchObject({ reportedName: 'Bad Actor', banned: false, outcome: null });
      const res = await adminRoutes.request(`/v1/admin/reports/${rep[0]!.id}`, {
        method: 'POST', headers: H(reviewer), body: JSON.stringify({ outcome: 'banned', note: 'threats' }) });
      expect(res.status).toBe(200);
      expect(await queue(false), 'a decided report stayed in the open queue').toBeUndefined();
      expect(await queue(true)).toMatchObject({ reportedName: 'Bad Actor', banned: true, outcome: 'banned' });
    } finally {
      env.ADMIN_USER_IDS = saved;
    }

    // Signed out: the session they had, and one that slipped past the revoke.
    expect((await datingRoutes.request('/v1/matches', { headers: H(bad) })).status).toBe(401);
    const slipped = await session(bad);
    expect((await datingRoutes.request('/v1/matches', { headers: { Authorization: `Bearer ${slipped}` } })).status,
      'a fresh session for a banned person worked').toBe(401);
    // Out of the pool, for good.
    const { rows: mp } = await owner.query<{ in_pool: boolean; moderation_hidden: boolean }>(
      'SELECT in_pool, moderation_hidden FROM match_profile WHERE user_id = $1', [bad.userId]);
    expect(mp[0]).toEqual({ in_pool: false, moderation_hidden: true });
    // Hidden from everybody -- the person who never reported them too.
    expect(await cards(third)).not.toContain(other);
    expect(await reveal(third, other)).toBe(404);
  });

  it('only the reviewer sees the queue or can ban', async () => {
    const reviewer = await person('rev2');
    const plain = await person('plain');
    const saved = env.ADMIN_USER_IDS;
    env.ADMIN_USER_IDS = reviewer.userId;
    try {
      expect((await adminRoutes.request('/v1/admin/me', { headers: H(plain) })).status).toBe(404);
      expect(await (await adminRoutes.request('/v1/admin/me', { headers: H(reviewer) })).json()).toEqual({ admin: true });
      const ban = await adminRoutes.request(`/v1/admin/users/${reviewer.userId}/ban`,
        { method: 'POST', headers: H(plain), body: JSON.stringify({ reason: 'x' }) });
      expect(ban.status).toBe(404);
    } finally {
      env.ADMIN_USER_IDS = saved;
    }
  });
});
