/**
 * "Find someone to talk to" in the park, over the socket, against the real database:
 * the best free person is asked (most in common first), told only what both made
 * public, answers; a pair takes a bench and talks privately; one leaving ends it.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - rank by distance only (skip `rank`) -> "asks the person with most in common" fails;
 *   - take the shared word from attribute_tags instead of publicTags -> "never names a
 *     word only matching may use" fails;
 *   - skip `unpair` on leaving -> "ends the pair when one leaves" fails;
 *   - pay nobody (pay() returning at once) -> "pays each of them" and "pays both for
 *     sitting and talking" fail.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { parkDay, type ServerEvent } from '@clone/shared';

const { pool, closeMatchPool, tenantSession } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const hub = await import('../src/messaging/hub.js');
const { agentRef } = await import('../src/matching/world.js');
const { handleParkFrame, pairs, park, socketClosed } = await import('../src/park/socket.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

interface P { tenantId: string; userId: string; frames: ServerEvent[]; ws: never }
async function person(label: string, tags: string[]): Promise<P> {
  const tag = `pp-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  // Out of the pool, with an intent of its own; in it only for the one ranking that
  // needs it (the matching role sees nobody outside the pool).
  await owner.query(`INSERT INTO match_profile (user_id, tenant_id, in_pool, intent, age, traits, attribute_tags)
                     VALUES ($1,$2,false,$3,29,'{}',$4)`, [userId, tenantId, [tag], tags]);
  const frames: ServerEvent[] = [];
  const ws = { readyState: 1, OPEN: 1, send: (s: string) => { frames.push(JSON.parse(s) as ServerEvent); } } as never;
  hub.join(userId, ws);
  return { tenantId, userId, frames, ws };
}
const interest = (who: P, word: string, disclosure: 'public' | 'matchable_only') => tenantSession(who, (c) => commit(c, who, {
  predicate: 'interest', objectText: word, objectValue: word, stance: 'asserted', originClass: 'owner',
  sourceQuote: word, sourceEpisodeIds: [], disclosure,
  extractorModel: 'gemini-3.5-flash-lite', extractorVersion: '1', promptVersion: 't',
}));
const frame = (p: P, msg: object) => handleParkFrame(p.ws, { tenantId: p.tenantId, userId: p.userId }, JSON.stringify(msg));
const last = <T extends ServerEvent['type']>(p: P, type: T) =>
  [...p.frames].reverse().find((f) => f.type === type) as Extract<ServerEvent, { type: T }> | undefined;

let seeker: P, climber: P, stranger: P, far: P;
beforeAll(async () => {
  // The seeker climbs (public) and pots (learned in chat: matching may use it, nobody hears it).
  // Pottery FIRST in their tags, so a shared word taken from the tags rather than from
  // what they made public would be pottery.
  seeker = await person('seeker', ['interest:pottery', 'interest:climbing']);
  await interest(seeker, 'climbing', 'public');
  await interest(seeker, 'pottery', 'matchable_only');
  // The climber shares both -- climbing in public, pottery also only matchable.
  climber = await person('climber', ['interest:pottery', 'interest:climbing']);
  await interest(climber, 'climbing', 'public');
  await interest(climber, 'pottery', 'matchable_only');
  // The stranger shares nothing, and stands nearest.
  stranger = await person('stranger', ['interest:chess']);
  far = await person('far', []);
  for (const p of [seeker, climber, stranger, far]) await frame(p, { type: 'park.enter' });
  await frame(seeker, { type: 'park.move', x: 0, z: 0, facing: 0, moving: false });
  await frame(stranger, { type: 'park.move', x: 0.5, z: 0, facing: 0, moving: false });
  await frame(climber, { type: 'park.move', x: 30, z: 5, facing: 0, moving: false });
  await frame(far, { type: 'park.move', x: 40, z: 0, facing: 0, moving: false });
});

afterAll(async () => {
  for (const p of [seeker, climber, stranger, far]) { hub.leave(p.userId, p.ws); socketClosed(p.userId); }
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('finding someone to talk to in the park', () => {
  it('asks the person with most in common, not the nearest', async () => {
    // In the pool for this one ranking only: somebody in another test file with an
    // EMPTY intent matches anybody, and a round of theirs met one of these people and
    // then lost the pair to this file's cleanup (real-first.test.ts, 2026-09-29).
    const ids = [seeker, climber, stranger, far].map((p) => p.userId);
    await owner.query('UPDATE match_profile SET in_pool = true WHERE user_id = ANY($1::uuid[])', [ids]);
    try {
      await frame(seeker, { type: 'park.find' });
    } finally {
      await owner.query('UPDATE match_profile SET in_pool = false WHERE user_id = ANY($1::uuid[])', [ids]);
    }
    expect(last(seeker, 'park.finding')).toMatchObject({ status: 'asking', ref: agentRef(seeker.userId, climber.userId) });
    expect(last(climber, 'park.asked')).toMatchObject({ ref: agentRef(climber.userId, seeker.userId) });
    expect(last(stranger, 'park.asked')).toBeUndefined();
  });

  it('never names a word only matching may use: what they share, from what both made public', () => {
    expect(last(climber, 'park.asked')!.why).toBe('climbing');
    expect(last(seeker, 'park.finding')!.why).toBe('climbing');
    const all = JSON.stringify([...seeker.frames, ...climber.frames]);
    expect(all, 'a match-only interest was said aloud').not.toContain('pottery');
  });

  it('asks nobody who is busy, and says so', async () => {
    await frame(stranger, { type: 'park.find' });
    // The seeker is asking and the climber is being asked: only the far one is free.
    expect(last(stranger, 'park.finding')).toMatchObject({ status: 'asking', ref: agentRef(stranger.userId, far.userId) });
    await frame(far, { type: 'park.answer', yes: false });
    expect(last(stranger, 'park.finding')).toMatchObject({ status: 'declined' });
    await frame(seeker, { type: 'park.find' });
    expect(last(seeker, 'park.finding')).toMatchObject({ status: 'busy' });
  });

  it('pairs them on a yes, each told where the other is, the asker to ride over', async () => {
    await frame(climber, { type: 'park.answer', yes: true });
    expect(last(seeker, 'park.paired')).toMatchObject({ ref: agentRef(seeker.userId, climber.userId), x: 30, z: 5, asked: false });
    expect(last(climber, 'park.paired')).toMatchObject({ ref: agentRef(climber.userId, seeker.userId), x: 0, z: 0, asked: true });
    expect(pairs.partnerOf(seeker.userId)).toBe(climber.userId);
  });

  it('pays each of them for meeting somebody, into their own ledger, and says so', async () => {
    const day = parkDay(Date.now());
    const { rows } = await owner.query<{ user_id: string; amount: number }>(
      `SELECT user_id, amount FROM points_ledger WHERE reason = 'park_hello' AND ref = $1 AND user_id = ANY($2::uuid[])`,
      [day, [seeker.userId, climber.userId]]);
    expect(rows.map((r) => r.user_id).sort()).toEqual([seeker.userId, climber.userId].sort());
    expect(rows.every((r) => r.amount === 10)).toBe(true);
    // Walking in, each was told their points: nothing yet.
    expect(seeker.frames.find((f) => f.type === 'park.quests')).toMatchObject({ balance: 0 });
    const told = seeker.frames.filter((f) => f.type === 'park.quests' && f.just?.quest === 'hello');
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ day, just: { quest: 'hello', points: 10, balance: 10 } });
    expect(last(climber, 'park.quests')!.done).toContain('hello');
  });

  it('gives them a bench, and what they say there reaches only each other', async () => {
    // The seeker has ridden over: now beside the climber, with the stranger in earshot.
    await frame(seeker, { type: 'park.move', x: 30.5, z: 5, facing: 0, moving: false });
    await frame(stranger, { type: 'park.move', x: 31, z: 5, facing: 0, moving: false });
    await frame(seeker, { type: 'park.sit', bench: 12 });
    expect(last(seeker, 'park.sat')).toMatchObject({ bench: 12 });
    expect(last(climber, 'park.sat')).toMatchObject({ bench: 12 });
    stranger.frames.length = 0;
    await frame(seeker, { type: 'park.say', text: 'Just us here.' });
    expect(last(climber, 'park.said')).toMatchObject({ text: 'Just us here.', private: true });
    expect(last(stranger, 'park.said'), 'somebody close heard a bench').toBeUndefined();
    await frame(stranger, { type: 'park.say', text: 'Hello?' });
    expect(climber.frames.some((f) => f.type === 'park.said' && f.text === 'Hello?'), 'the bench heard the park').toBe(false);
    // Nobody else takes it.
    await frame(stranger, { type: 'park.sit', bench: 12 });
    expect(last(stranger, 'park.bench_taken')).toMatchObject({ bench: 12 });
  });

  it('pays both for sitting and talking once each has said three things there -- counted, not read', async () => {
    // The seeker has said one ("Just us here.") and the stranger's line was not theirs.
    await frame(seeker, { type: 'park.say', text: 'Nice evening.' });
    await frame(seeker, { type: 'park.say', text: 'Do you come here often?' });
    await frame(climber, { type: 'park.say', text: 'Most Sundays.' });
    await frame(climber, { type: 'park.say', text: 'The rock is my favourite.' });
    expect(last(climber, 'park.quests')!.just?.quest, 'paid before both had said three').not.toBe('talk');
    await frame(climber, { type: 'park.say', text: 'Shall we walk there?' });
    for (const p of [seeker, climber]) expect(last(p, 'park.quests')).toMatchObject({ just: { quest: 'talk', points: 20 } });
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM points_ledger WHERE reason = 'park_talk' AND user_id = ANY($1::uuid[])`, [[seeker.userId, climber.userId]]);
    expect(Number(rows[0]!.n)).toBe(2);
  });

  it('ends the pair when one leaves, and frees the bench', () => {
    hub.leave(climber.userId, climber.ws);
    socketClosed(climber.userId);
    expect(last(seeker, 'park.parted')).toBeDefined();
    expect(pairs.partnerOf(seeker.userId)).toBeNull();
    expect(pairs.isBenchTaken(12)).toBe(false);
    expect(park.members.has(climber.userId)).toBe(false);
  });
});
