/**
 * The square shows people, and says nothing about them it should not.
 *
 * WHAT IS BEING GUARDED. The town's roster is the first endpoint that lists people
 * this person has NOT been paired with. Everything the product promises about
 * strangers -- no name, no age, no tags, no id, no location, "only things marked
 * public ever leave your account" -- has to hold on a list, not only on a card. And a
 * met person's name may appear only where the reveal would already show it: once THAT
 * person has said yes to this one (consent first, 2026-09-28). Being first mover opens
 * nothing.
 *
 * Fixtures go in through the owner connection; the endpoint is hit through its real
 * route with a real token, so every role and policy in its path is the one in
 * production. Each scene shares one made-up `intent` so the candidate query cannot
 * see another test's people.
 *
 * Negative controls, run by hand and recorded in the commit: return display_name
 * for every seat -> the two "no name" assertions fail; use the raw id as the ref ->
 * the three ref assertions fail. 2026-09-28, each restored byte-identical: every met
 * seat back on its owner's tile -> "where a met person stands" fails; the Home's need
 * without the first name -> "neighbourhoods in the square" fails.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, closeMatchPool, matchSession } from '../src/db/client.js';
import { candidateCount, shownCount } from '../src/matching/candidates.js';
import { env } from '../src/env.js';
import { worldRoutes } from '../src/api/world.js';
import { mintToken, newSessionId } from '../src/tokens.js';
import { AREAS, AREA_IDS, LOOK_PARTS, lookFor } from '@clone/shared';
import { lookSeed } from '../src/looks/store.js';
import { CORE } from '../src/onboarding/questions.js';

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
  // The five core cards, done. A real person in the pool has answered them, and the
  // Home and the tap re-check that (poolNow) instead of trusting a planted in_pool.
  if (!cols.is_synthetic) {
    for (const id of CORE) {
      await owner.query(
        `INSERT INTO question_answers (tenant_id, user_id, question_id, answer, skipped)
         VALUES ($1,$2,$3,'{"values":[],"whoFine":{"anyone":true}}'::jsonb, true)`,
        [tenantId, userId, id]);
    }
  }
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
    square: { city: string | null; area: string }; me: { inPool: boolean; knows: number; area: string | null; need: string[] };
    pool: { total: number | null }; targetsLeftToday: number;
    agents: { ref: string; kind: string; practice: boolean; seed: number; state: string;
              look: Record<string, number>; area: string;
              name?: string; rendezvousId?: string; agreement?: string; yourTurn?: boolean }[];
    me: { inPool: boolean; knows: number; look: Record<string, number> };
  }>;
};

// One scene, built once: the assertions read it from several angles.
const tag = `wd-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let me: P, other: P, stranger: P, practice: P, blocked: P, wrongGender: P;
let iMoveFirst: P, theyMoveFirstUndecided: P, theyMoveFirstSaidYes: P, iSaidNo: P, talkingNow: P, iShared: P;
let seatMine: string, seatTheirs: string, seatOpen: string, seatLive: string, seatShared: string;

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
  // Isha: I moved first and shared my profile; her turn now, and nothing of hers is mine.
  iShared = await person('Isha', { intent: [tag] });
  seatShared = await seat(me, iShared, { firstMover: me, aYes: true });
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
    expect(byId.get(seatMine)?.name, 'the first mover saw a name nobody had shared').toBeUndefined();
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
    expect(byId.get(seatShared)?.state, 'my own yes reads as shared, not as waiting').toBe('shared');
    expect(byId.get(seatShared)?.yourTurn).toBe(false);
    expect(byId.get(seatShared)?.name, 'sharing mine did not show me hers').toBeUndefined();
    // The seat's row says agreement 0.8. The roster used to turn that into "got_on"
    // and the square drew a tick over both heads; it says nothing about it now.
    expect(byId.get(seatMine)).not.toHaveProperty('agreement');
    expect(JSON.stringify(w.agents)).not.toMatch(/"agreement"|got_on|did_not_click|could_not_tell/);
    // Tara: I said no. She walks off. (Her own no, had it happened, would read as waiting.)
    const passed = w.agents.filter((a) => a.state === 'passed');
    expect(passed).toHaveLength(1);
    expect(passed[0]!.name, 'I moved first and said no: she never shared her name').toBeUndefined();
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
    expect(live).not.toHaveProperty('agreement');
    // And Kavya is not ALSO standing about as a stranger.
    expect(w.agents.filter((a) => a.ref === live!.ref)).toHaveLength(1);
  });
});

describe('characters in the square', () => {
  it('everybody has one, exactly eight numbers, and nothing else rides along', async () => {
    const w = await fetchWorld(me.token);
    expect(w.agents.length).toBeGreaterThan(0);
    for (const a of w.agents) {
      expect(Object.keys(a.look).sort()).toEqual([...LOOK_PARTS].sort());
      for (const v of Object.values(a.look)) expect(Number.isInteger(v)).toBe(true);
    }
    expect(Object.keys(w.me.look).sort()).toEqual([...LOOK_PARTS].sort());
    // The one thing a look may never carry: anything from the row it stands for.
    expect(JSON.stringify(w.agents)).not.toMatch(/display_name|user_id|attribute_tags|"age"/);
  });

  it('gives a practice profile the whole catalog from its seed, and never a stored row', async () => {
    const w = await fetchWorld(me.token);
    const ghost = w.agents.find((a) => a.kind === 'practice')!;
    expect(ghost.look).toEqual(lookFor(lookSeed(practice.userId)));
  });

  it('is the same character to two viewers whose refs for that person differ', async () => {
    const mine = await fetchWorld(me.token);
    const theirs = await fetchWorld(other.token);
    const a = mine.agents.find((x) => x.kind === 'practice')!;
    const b = theirs.agents.find((x) => x.kind === 'practice')!;
    expect(a.ref).not.toBe(b.ref);
    expect(a.look).toEqual(b.look);
  });
});

describe('the rest of the roster', () => {
  it('reports setup, the pool, and five targeted rounds a day to start', async () => {
    const w = await fetchWorld(me.token);
    expect(w.me.inPool).toBe(true);
    // The pool, as a person may see it (shownCount): rounded to ten, or "under 20" as
    // null. This scene's pool is small, so the exact count is checked server-side --
    // the wire cannot say "more than none" below twenty, by design.
    const exact = await matchSession((c) => candidateCount(c, me.userId));
    expect(exact, 'the scene has nobody in range, so this proves nothing').toBeGreaterThan(0);
    expect(w.pool.total).toEqual(shownCount(exact));
    expect(w.targetsLeftToday).toBe(5);
  });
});

describe('neighbourhoods in the square', () => {
  it('places everybody in one of the thirty tiles, and says nothing else about where', async () => {
    const w = await fetchWorld(me.token);
    for (const a of w.agents) expect(AREA_IDS, `${a.ref} in ${a.area}`).toContain(a.area);
    // The scene's people all sit on 12.97, 77.59: the central tile.
    const stranger = w.agents.find((a) => a.kind === 'stranger')!;
    expect(stranger.area).toBe('mg-road');
    // A stranger is exactly these seven things. A new key here is a new disclosure
    // and needs the header of api/world.ts amended first.
    expect(Object.keys(stranger).sort()).toEqual(['area', 'kind', 'look', 'practice', 'ref', 'seed', 'state']);
    // Me: no trait, so no area of my own, and the square centres on the central tile.
    expect(w.me.area).toBeNull();
    expect(w.square.area).toBe('mg-road');
    // ...and the question is still open, so the Home can ask it.
    expect(w.me.need).toContain('area');
    // So is the first name, typed on no screen yet: the Home's chip asks it (item 3,
    // 2026-09-28). A name is never taken from chat, so this is the only way it is set.
    expect(w.me.need).toContain('first_name');
  });

  it('fills the square with the viewer\'s neighbours before the recently active', async () => {
    // A second scene: me in Koramangala; six neighbours who were last here yesterday;
    // sixty people in Whitefield who were here a minute ago. Recency alone (the old
    // sample) would take the sixty and leave the six out.
    const t2 = `${tag}-near`;
    const kor = AREAS.find((a) => a.id === 'koramangala')!;
    const wf = AREAS.find((a) => a.id === 'whitefield')!;
    const viewer = await person('Near', { gender: 'man', seeking_gender: ['woman'], intent: [t2], lat: kor.lat, lon: kor.lon,
                                          traits: JSON.stringify({ area: 'koramangala' }) });
    const near: P[] = [];
    for (let i = 0; i < 6; i++) near.push(await person(`N${i}`, { intent: [t2], lat: kor.lat, lon: kor.lon, last_active_at: new Date(Date.now() - 86_400_000) }));
    for (let i = 0; i < 60; i++) await person(`F${i}`, { intent: [t2], lat: wf.lat, lon: wf.lon });
    const w = await fetchWorld(viewer.token);
    const { agentRef } = await import('../src/matching/world.js');
    const refs = new Set(w.agents.map((a) => a.ref));
    const found = near.filter((n) => refs.has(agentRef(viewer.userId, n.userId))).length;
    expect(found).toBeGreaterThanOrEqual(5);
    expect(w.agents.filter((a) => a.area === 'koramangala').length).toBe(found);
    expect(w.agents.some((a) => a.area === 'whitefield')).toBe(true);
    expect(w.me.area).toBe('koramangala');
    expect(w.square.area).toBe('koramangala');
    expect(w.me.need).not.toContain('area');
  });
});

describe('where a met person stands', () => {
  it('on their own tile only where the card names the place; otherwise on mine', async () => {
    // WHAT WAS WRONG (2026-09-28): every seat stood on its owner's tile, so the second
    // mover saw the first mover's neighbourhood before the first mover had shared
    // anything -- while that person's card is the plain one, with no place on it.
    const t3 = `${tag}-where`;
    const kor = AREAS.find((a) => a.id === 'koramangala')!;
    const wf = AREAS.find((a) => a.id === 'whitefield')!;
    const viewer = await person('Where', { gender: 'man', seeking_gender: ['woman'], intent: [t3], lat: kor.lat, lon: kor.lon,
                                           traits: JSON.stringify({ area: 'koramangala' }) });
    const away = { intent: [t3], lat: wf.lat, lon: wf.lon };
    const theyFirst = await person('W1', away);
    const theyShared = await person('W2', away);
    const meFirst = await person('W3', away);
    const hidden = await seat(viewer, theyFirst, { firstMover: theyFirst });
    const shared = await seat(viewer, theyShared, { firstMover: theyShared, bYes: true });
    const mine = await seat(viewer, meFirst, { firstMover: viewer });

    const w = await fetchWorld(viewer.token);
    const at = (id: string) => w.agents.find((a) => a.rendezvousId === id)?.area;
    expect(at(hidden), 'the town showed where the first mover lives before they shared').toBe('koramangala');
    expect(at(shared)).toBe('whitefield');
    expect(at(mine), 'the first mover\'s own card names the place').toBe('whitefield');
  });
});
