/**
 * The square shows people, and says nothing about them it should not.
 *
 * WHAT IS BEING GUARDED. The town's roster is the first endpoint that lists people
 * this person has NOT been paired with. Everything the product promises about
 * strangers -- no name, no age, no tags, no id, no location, "only things marked
 * public ever leave your account" -- has to hold on a list, not only on a card. And a
 * met person's name may appear only where the reveal would already show it: to the
 * first mover, or once the other side has said yes.
 *
 * Fixtures go in through the owner connection; the endpoint is hit through its real
 * route with a real token, so every role and policy in its path is the one in
 * production. Each scene shares one made-up `intent` so the candidate query cannot
 * see another test's people.
 *
 * Negative controls, run by hand and recorded in the commit: return display_name
 * for every seat -> the two "no name" assertions fail; use the raw id as the ref ->
 * the three ref assertions fail.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { worldRoutes } from '../src/api/world.js';
import { mintToken, newSessionId } from '../src/tokens.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string; token: string }

async function person(label: string, over: Record<string, unknown> = {}): Promise<P> {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`wd-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `wd-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: ['long_term'],
    in_pool: true, is_synthetic: false, sees_synthetic: true, display_name: label,
    attribute_tags: ['interest:climbing'],
    ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(
    `INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map((k) => cols[k]));
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

/** A pair the agents have already met, with a brief on each side. */
async function seat(a: P, b: P, opts: { firstMover: P; aYes?: boolean | null; bYes?: boolean | null; status?: string }) {
  const [lo, hi] = a.userId < b.userId ? [a, b] : [b, a];
  const r = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover, agreement)
     VALUES ($1,$2,$3,$4,5,$5,$6,0.8) RETURNING id`,
    [lo.userId, hi.userId, lo.tenantId, hi.tenantId, opts.status ?? 'decided', opts.firstMover.userId]);
  const id = r.rows[0]!.id;
  for (const [who, yes] of [[a, opts.aYes ?? null], [b, opts.bYes ?? null]] as const) {
    await owner.query(
      `INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, concern, human_says_yes, decided_at)
       VALUES ($1,$2,'h','c',$3, CASE WHEN $3::boolean IS NULL THEN NULL ELSE now() END)`,
      [id, who.userId, yes]);
  }
  return id;
}

const fetchWorld = async (token: string) => {
  const res = await worldRoutes.request('/v1/world', {
    headers: { Authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.7' },
  });
  expect(res.status).toBe(200);
  return res.json() as Promise<{
    square: { city: string | null }; me: { inPool: boolean; knows: number };
    pool: { total: number }; targetsLeftToday: number;
    agents: { ref: string; kind: string; practice: boolean; seed: number; state: string;
              name?: string; rendezvousId?: string; agreement?: string; yourTurn?: boolean }[];
  }>;
};

// One scene, built once: the assertions read it from several angles.
const tag = `wd-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let me: P, other: P, stranger: P, practice: P, blocked: P, wrongGender: P;
let iMoveFirst: P, theyMoveFirstUndecided: P, theyMoveFirstSaidYes: P, iSaidNo: P, talkingNow: P;
let seatMine: string, seatTheirs: string, seatOpen: string, seatLive: string;

beforeAll(async () => {
  me = await person('Me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
  other = await person('Other', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
  stranger = await person('Priya', { intent: [tag] });
  practice = await person('Emma', { intent: [tag], is_synthetic: true });
  blocked = await person('Blocked', { intent: [tag] });
  wrongGender = await person('Rohan', { intent: [tag], gender: 'man', seeking_gender: ['woman'] });
  await owner.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2)', [me.userId, blocked.userId]);

  iMoveFirst = await person('Ananya', { intent: [tag] });
  theyMoveFirstUndecided = await person('Divya', { intent: [tag] });
  theyMoveFirstSaidYes = await person('Meera', { intent: [tag] });
  iSaidNo = await person('Tara', { intent: [tag] });
  seatMine = await seat(me, iMoveFirst, { firstMover: me });
  seatTheirs = await seat(me, theyMoveFirstUndecided, { firstMover: theyMoveFirstUndecided });
  seatOpen = await seat(me, theyMoveFirstSaidYes, { firstMover: theyMoveFirstSaidYes, bYes: true });
  await seat(me, iSaidNo, { firstMover: me, aYes: false, status: 'lapsed' });
  // Kavya: the agents are talking RIGHT NOW. A running row has no brief on either
  // side and no first mover yet -- exactly the shape the round leaves while it runs.
  talkingNow = await person('Kavya', { intent: [tag] });
  const [lo, hi] = me.userId < talkingNow.userId ? [me, talkingNow] : [talkingNow, me];
  seatLive = (await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status)
     VALUES ($1,$2,$3,$4,5,'running') RETURNING id`,
    [lo.userId, hi.userId, lo.tenantId, hi.tenantId])).rows[0]!.id;
});

describe('strangers in the square', () => {
  it('are shapes, not people: no name, and nothing the reveal would show', async () => {
    const w = await fetchWorld(me.token);
    const strangers = w.agents.filter((a) => a.kind !== 'met');
    expect(strangers.length).toBeGreaterThanOrEqual(2);
    expect(strangers.length).toBeLessThanOrEqual(24);
    for (const s of strangers) {
      expect(s.name, `stranger ${s.ref} carried a name`).toBeUndefined();
      expect(s.rendezvousId).toBeUndefined();
      expect(s.state).toBe('idle');
    }
    // The wire format, whole: not one of these words appears anywhere in the roster.
    const json = JSON.stringify(w.agents);
    for (const banned of ['"lat"', '"lon"', '"userId"', '"user_id"', '"age"', '"tags"', '"display_name"']) {
      expect(json, `roster leaked ${banned}`).not.toContain(banned);
    }
  });

  it('include the practice profile, labelled, and nobody the filters or a block exclude', async () => {
    const w = await fetchWorld(me.token);
    const kinds = w.agents.filter((a) => a.kind !== 'met').map((a) => a.kind);
    expect(kinds).toContain('practice');
    expect(kinds).toContain('stranger');
    // A blocked person and a person outside the gender filter are absent. Refs are the
    // only handle, so absence is tested by computing what their ref would be.
    const { agentRef } = await import('../src/matching/world.js');
    const refs = new Set(w.agents.map((a) => a.ref));
    expect(refs.has(agentRef(me.userId, blocked.userId))).toBe(false);
    expect(refs.has(agentRef(me.userId, wrongGender.userId))).toBe(false);
    expect(refs.has(agentRef(me.userId, stranger.userId))).toBe(true);
  });

  it('are addressed by per-viewer refs, never by an id', async () => {
    const [mine, theirs] = await Promise.all([fetchWorld(me.token), fetchWorld(other.token)]);
    for (const a of [...mine.agents, ...theirs.agents]) {
      expect(a.ref).toMatch(/^[0-9a-f]{32}$/);
      expect(a.ref).not.toBe(stranger.userId);
      expect(a.ref.replace(/-/g, '')).not.toBe(stranger.userId.replace(/-/g, ''));
    }
    // The same stranger, two viewers, two handles that cannot be joined.
    const { agentRef } = await import('../src/matching/world.js');
    expect(agentRef(me.userId, stranger.userId)).not.toBe(agentRef(other.userId, stranger.userId));
    expect(mine.agents.some((a) => a.ref === agentRef(me.userId, stranger.userId))).toBe(true);
    expect(theirs.agents.some((a) => a.ref === agentRef(other.userId, stranger.userId))).toBe(true);
  });
});

describe('people this person has met', () => {
  it('carry a name ONLY where the reveal would show it', async () => {
    const w = await fetchWorld(me.token);
    const byId = new Map(w.agents.filter((a) => a.kind === 'met').map((a) => [a.rendezvousId, a]));
    expect(byId.get(seatMine)?.name, 'first mover sees the name').toBe('Ananya');
    expect(byId.get(seatOpen)?.name, 'second mover sees it once the first said yes').toBe('Meera');
    expect(byId.get(seatTheirs)?.name, 'second mover sees NOTHING until then').toBeUndefined();
  });

  it('show the right state, and my own no as passed, never theirs', async () => {
    const w = await fetchWorld(me.token);
    const byId = new Map(w.agents.filter((a) => a.kind === 'met').map((a) => [a.rendezvousId, a]));
    expect(byId.get(seatMine)?.state).toBe('briefed');
    expect(byId.get(seatMine)?.yourTurn).toBe(true);
    expect(byId.get(seatTheirs)?.state).toBe('waiting');
    expect(byId.get(seatTheirs)?.yourTurn).toBe(false);
    expect(byId.get(seatOpen)?.state).toBe('briefed');
    expect(byId.get(seatMine)?.agreement).toBe('got_on');
    // Tara: I said no. She walks off. (Her own no, had it happened, would read as waiting.)
    const passed = w.agents.filter((a) => a.state === 'passed');
    expect(passed).toHaveLength(1);
    expect(passed[0]!.name).toBe('Tara');       // I moved first, so the name was already mine to see
  });

  it('do not also appear as strangers', async () => {
    const w = await fetchWorld(me.token);
    const refs = w.agents.map((a) => a.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  /**
   * The one the square exists to draw. A pair mid-conversation has no brief yet, so
   * the inner join the matches screen uses hides it -- and the town then showed "0
   * met so far" for a whole round while the agent stood at home. Negative control:
   * put the inner join back -> Kavya is missing and this fails on the first line.
   */
  it('include the pair whose agents are talking right now, with nothing decided', async () => {
    const w = await fetchWorld(me.token);
    const live = w.agents.find((a) => a.rendezvousId === seatLive);
    expect(live, 'a running pair is in the square').toBeDefined();
    expect(live!.kind).toBe('met');
    expect(live!.state).toBe('talking');
    expect(live!.name, 'nothing is revealed while they talk').toBeUndefined();
    expect(live!.yourTurn).toBe(false);
    expect(live!.agreement).toBe('could_not_tell');
    // And Kavya is not ALSO standing about as a stranger.
    expect(w.agents.filter((a) => a.ref === live!.ref)).toHaveLength(1);
  });
});

describe('the rest of the roster', () => {
  it('reports setup, the pool, and five targeted rounds a day to start', async () => {
    const w = await fetchWorld(me.token);
    expect(w.me.inPool).toBe(true);
    expect(w.pool.total).toBeGreaterThan(0);
    expect(w.targetsLeftToday).toBe(5);
  });
});
