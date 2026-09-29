/**
 * Voice in the park: the passes the app server hands out for the voice server, who is
 * given whose voice, and who loses their mic.
 *
 * WHAT THE FOUNDER ASKED (2026-09-29): voice chat as the primary way to talk in the
 * park, text kept; mute somebody near you who is a nuisance, and report them -- the way
 * games like PUBG do it (server park/voice.ts says how that maps).
 *
 * WHAT IS PINNED:
 *   - a pass is for one room, as the visit's voice id -- never the user id -- lets its
 *     holder listen, never send data, and speak only if not banned;
 *   - a bench's room is the same for both of the two, different for any other two, and
 *     names neither of them;
 *   - the park sends a person's voice id only to people within earshot of them, and
 *     never to or from anybody on a bench (the bench talks in its own room); between
 *     strangers only when BOTH turned "Talk with people nearby" on -- off unless they
 *     did -- and between the two who said yes to talking either way;
 *   - over the socket, against the real database: walking in brings a pass to the park's
 *     room; sitting brings both a pass to the same bench room; getting up, the park's
 *     again; a phone that lost the voice server gets a fresh pass for the same room, as
 *     the same voice, when it asks -- and a few a minute at most;
 *   - VOICE_BAN.reporters different people reporting somebody's voice within the hours
 *     takes their mic until the latest report is that old; fewer, older, not about voice,
 *     or one person three times, does not.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - voice ids sent at any distance            -> "only to people within earshot" fails
 *   - a sitter's voice id sent to the park       -> "never to or from a bench" fails
 *   - the ban counting reports, not reporters    -> "one person three times" fails
 *   - the pass granting speech whatever the ban  -> "takes their mic" fails
 *   - park.voice_again not answered              -> "hands a fresh pass" fails
 *   - voice ids when only one stranger opted in  -> "only when both turned it on" fails
 *   - the partner exception taken out            -> "between the two who said yes" fails
 *   - enter() ignoring what the phone said       -> "keeps Talk with people nearby" fails
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { TokenVerifier } from 'livekit-server-sdk';
import { PARK_EARSHOT, STARTER, type ServerEvent } from '@clone/shared';

// The tests' own voice server settings, whatever server/.env says: nothing here needs a
// voice server running, and one that is not (port 9) makes silence() fail at once, as
// it must be able to.
process.env.LIVEKIT_URL = 'ws://127.0.0.1:9';
process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret-that-is-long-enough-for-hs256';

const { pool, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const hub = await import('../src/messaging/hub.js');
const { VOICE_AGAIN_LIMIT, handleParkFrame, pairs, park, socketClosed } = await import('../src/park/socket.js');
const { ParkRoom } = await import('../src/park/room.js');
const { ParkPairs } = await import('../src/park/pairs.js');
const { PARK_ROOM, VOICE_BAN, VOICE_REPORT, benchRoom, voiceBannedUntil, voicePass } = await import('../src/park/voice.js');
const { parkRoutes } = await import('../src/api/park.js');
const { agentRef } = await import('../src/matching/world.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
const verify = (token: string) => new TokenVerifier(env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!).verify(token);

async function user(label: string): Promise<{ tenantId: string; userId: string; token: string }> {
  const tag = `pv-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
    VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}
const report = (reporter: string, reported: string, detail: string, hoursAgo = 0) => owner.query(
  `INSERT INTO reports (reporter_id, reported_id, reason, detail, created_at) VALUES ($1,$2,'harassment',$3, now() - make_interval(hours => $4))`,
  [reporter, reported, detail, hoursAgo]);

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('a voice pass', () => {
  it('is for one room, as the visit\'s voice id, to listen always, to speak only if allowed, never to send data', async () => {
    const pass = await voicePass('v0ice1d', PARK_ROOM, true);
    const claims = await verify(pass.token);
    expect(claims.sub).toBe('v0ice1d');
    expect(claims.video).toMatchObject({ roomJoin: true, room: PARK_ROOM, canPublish: true, canSubscribe: true, canPublishData: false });
    expect(pass.url).toBe(env.LIVEKIT_URL);
    const quiet = await voicePass('v0ice1d', PARK_ROOM, false, new Date(Date.now() + 3_600_000));
    expect((await verify(quiet.token)).video).toMatchObject({ canPublish: false, canSubscribe: true });
    expect(quiet.until).toBeDefined();
  });

  it('names a bench\'s room the same for both, apart from any other two, and after neither', () => {
    const [a, b, c] = ['11111111-aaaa-4aaa-8aaa-111111111111', '22222222-bbbb-4bbb-8bbb-222222222222', '33333333-cccc-4ccc-8ccc-333333333333'];
    expect(benchRoom(a, b)).toBe(benchRoom(b, a));
    expect(benchRoom(a, c)).not.toBe(benchRoom(a, b));
    for (const id of [a, b]) expect(benchRoom(a, b)).not.toContain(id.slice(0, 8));
  });
});

describe('who is given whose voice', () => {
  const ref = (v: string, o: string) => `${v}>${o}`.padEnd(32, '0').slice(0, 32);
  const room = (who: readonly (readonly [string, number, boolean])[]) => {
    const seats = new ParkPairs();
    const r = new ParkRoom(ref, Date.now, seats);
    for (const [u, x, open] of who) {
      r.enter(u, STARTER, [], undefined, `voice-${u}`, open);
      r.move(u, x, 0, 0, false);
    }
    const heard = (viewer: string) => Object.fromEntries(r.snapshot(viewer).map((p) => [p.ref.slice(0, 3), p.voice ?? null]));
    return { r, seats, heard };
  };

  it('between strangers, only when both turned "Talk with people nearby" on -- off unless they did', () => {
    const { heard } = room([['a', 0, true], ['b', 1, true], ['c', 1.2, false], ['d', 1.4, true]]);
    expect(heard('a')).toMatchObject({ 'a>b': 'voice-b', 'a>d': 'voice-d', 'a>c': null });
    expect(heard('c'), 'somebody who never turned it on is given voices').toMatchObject({ 'c>a': null, 'c>b': null });
    // Entering without saying is off.
    const quiet = new ParkRoom(ref, Date.now, new ParkPairs());
    quiet.enter('x', STARTER, [], undefined, 'voice-x');
    expect(quiet.members.get('x')!.voiceOpen).toBe(false);
  });

  it('between the two who said yes to talking, either way -- and nobody else through them', () => {
    const { seats, heard } = room([['a', 0, false], ['b', 1, false], ['c', 1.2, true]]);
    seats.ask('a', 'b'); seats.answer('b', true);
    expect(heard('a'), 'the one you are talking with is not heard').toMatchObject({ 'a>b': 'voice-b', 'a>c': null });
    expect(heard('c')).toMatchObject({ 'c>a': null, 'c>b': null });
  });

  it('only to people within earshot, and never to or from a bench', () => {
    const { seats, heard } = room([['a', 0, true], ['b', 1, true], ['c', PARK_EARSHOT + 2, true], ['d', 1.5, true]]);
    expect(heard('a')).toMatchObject({ 'a>b': 'voice-b', 'a>d': 'voice-d', 'a>c': null });
    // b and d sit together: nobody hears them in the park, and they hear nobody there.
    seats.ask('b', 'd'); seats.answer('d', true); seats.sit('b', 7);
    expect(heard('a')).toMatchObject({ 'a>b': null, 'a>d': null });
    expect(heard('b')).toMatchObject({ 'b>a': null });
  });
});

describe('voice over the socket', () => {
  interface P { tenantId: string; userId: string; token: string; frames: ServerEvent[]; ws: never }
  let one: P, two: P;
  const inPark: P[] = [];
  const frame = (p: P, msg: object) => handleParkFrame(p.ws, { tenantId: p.tenantId, userId: p.userId }, JSON.stringify(msg));
  const lastVoice = (p: P) => [...p.frames].reverse().find((f) => f.type === 'park.voice') as Extract<ServerEvent, { type: 'park.voice' }> | undefined;
  const mk = async (label: string): Promise<P> => {
    const u = await user(label);
    const frames: ServerEvent[] = [];
    const ws = { readyState: 1, OPEN: 1, send: (s: string) => { frames.push(JSON.parse(s) as ServerEvent); } } as never;
    hub.join(u.userId, ws);
    const p = { ...u, frames, ws };
    inPark.push(p);
    return p;
  };
  beforeAll(async () => { one = await mk('one'); two = await mk('two'); });
  afterAll(() => { for (const p of inPark) { hub.leave(p.userId, p.ws); socketClosed(p.userId); } });

  it('keeps "Talk with people nearby" as the phone says on walking in, and as it changes', async () => {
    const p = await mk('open');
    await frame(p, { type: 'park.enter', voiceOpen: true });
    expect(park.members.get(p.userId)?.voiceOpen, 'walked in with it on, taken as off').toBe(true);
    await frame(p, { type: 'park.voice_open', open: false });
    expect(park.members.get(p.userId)?.voiceOpen).toBe(false);
    await frame(p, { type: 'park.enter' });
    expect(park.members.get(p.userId)?.voiceOpen, 'walking in without saying left it on').toBe(false);
  });

  it('hands a pass to the park\'s room on walking in, a bench\'s on sitting, the park\'s again on getting up', async () => {
    await frame(one, { type: 'park.enter' });
    await frame(two, { type: 'park.enter' });
    const first = lastVoice(one)!;
    expect(first).toMatchObject({ room: PARK_ROOM, bench: false, canTalk: true });
    expect(first.identity).not.toContain(one.userId.slice(0, 8));
    // Paired and sat: both to the same bench room, which is not the park's.
    pairs.ask(one.userId, two.userId);
    await frame(two, { type: 'park.answer', yes: true });
    await frame(one, { type: 'park.sit', bench: 3 });
    const [a, b] = [lastVoice(one)!, lastVoice(two)!];
    expect(a.room).toBe(b.room);
    expect(a.room).not.toBe(PARK_ROOM);
    expect([a.bench, b.bench]).toEqual([true, true]);
    expect(a.identity).toBe(first.identity);
    await frame(two, { type: 'park.stand' });
    expect(lastVoice(one)!.room).toBe(PARK_ROOM);
    expect(lastVoice(two)!.room).toBe(PARK_ROOM);
  });

  it('hands a fresh pass to a phone that lost the voice server, for the same room as the same voice, a few a minute at most', async () => {
    const was = lastVoice(two)!;
    two.frames.length = 0;
    await frame(two, { type: 'park.voice_again' });
    const again = lastVoice(two)!;
    expect(again, 'no fresh pass').toBeDefined();
    expect(again).toMatchObject({ room: was.room, identity: was.identity, canTalk: true });
    // A phone stuck retrying is slowed down, not answered for ever.
    two.frames.length = 0;
    for (let i = 0; i < VOICE_AGAIN_LIMIT.max + 5; i++) await frame(two, { type: 'park.voice_again' });
    expect(two.frames.filter((f) => f.type === 'park.voice').length).toBeLessThanOrEqual(VOICE_AGAIN_LIMIT.max);
  });

  it('takes the mic of somebody the moment enough people near them report their voice, and says until when', async () => {
    await frame(one, { type: 'park.move', x: 40, z: 40, facing: 0, moving: false });
    const reporters: P[] = [];
    for (let i = 0; i < VOICE_BAN.reporters; i++) {
      const r = await mk(`rep${i}`);
      await frame(r, { type: 'park.enter' });
      await frame(r, { type: 'park.move', x: 40 + (i + 1) * 0.2, z: 40, facing: 0, moving: false });
      reporters.push(r);
    }
    const byVoice = (r: P, voice: boolean) => parkRoutes.request('/v1/park/report', {
      method: 'POST',
      headers: { Authorization: `Bearer ${r.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: agentRef(r.userId, one.userId), reason: 'harassment', detail: 'shouting', voice }),
    });
    // One fewer than it takes, and a report about what they typed: their mic stays.
    for (const r of reporters.slice(0, -1)) expect((await byVoice(r, true)).status).toBe(200);
    const typed = await mk('typed');
    await frame(typed, { type: 'park.enter' });
    await frame(typed, { type: 'park.move', x: 40, z: 40.2, facing: 0, moving: false });
    expect((await byVoice(typed, false)).status).toBe(200);
    one.frames.length = 0;
    expect(await voiceBannedUntil(one.userId)).toBeNull();
    expect(lastVoice(one), 'a pass sent before anybody was banned').toBeUndefined();
    // The last one: a fresh pass at once, without the mic, saying until when.
    expect((await byVoice(reporters.at(-1)!, true)).status).toBe(200);
    const pass = lastVoice(one)!;
    expect(pass).toMatchObject({ canTalk: false });
    expect(new Date(pass.until!).getTime()).toBeGreaterThan(Date.now() + (VOICE_BAN.hours - 1) * 3_600_000);
    expect((await verify(pass.token)).video?.canPublish).toBe(false);
    const { rows } = await owner.query<{ detail: string }>('SELECT detail FROM reports WHERE reported_id = $1 ORDER BY created_at', [one.userId]);
    expect(rows.filter((r) => r.detail.startsWith(VOICE_REPORT))).toHaveLength(VOICE_BAN.reporters);
    expect(rows.filter((r) => r.detail.startsWith('In the park. '))).toHaveLength(1);
  });
});

describe('a voice ban', () => {
  it('needs VOICE_BAN.reporters different people, about voice, within the hours', async () => {
    const who = await user('banned');
    const rs = await Promise.all(Array.from({ length: VOICE_BAN.reporters + 1 }, (_, i) => user(`r${i}`)));
    // Not enough: one fewer, plus a text report and an old one.
    for (const r of rs.slice(0, VOICE_BAN.reporters - 1)) await report(r.userId, who.userId, `${VOICE_REPORT} shouting`);
    await report(rs[VOICE_BAN.reporters - 1]!.userId, who.userId, 'In the park. rude message');
    await report(rs[VOICE_BAN.reporters]!.userId, who.userId, `${VOICE_REPORT} shouting`, VOICE_BAN.hours + 1);
    expect(await voiceBannedUntil(who.userId), 'banned on too few voice reports').toBeNull();
    // One person three times is still one person.
    await report(rs[0]!.userId, who.userId, `${VOICE_REPORT} again`);
    await report(rs[0]!.userId, who.userId, `${VOICE_REPORT} again`);
    expect(await voiceBannedUntil(who.userId), 'one person three times banned somebody').toBeNull();
    // The last one, in time: banned, for the hours from it.
    await report(rs[VOICE_BAN.reporters - 1]!.userId, who.userId, `${VOICE_REPORT} abusive`);
    const until = await voiceBannedUntil(who.userId);
    expect(until).not.toBeNull();
    expect(until!.getTime()).toBeGreaterThan(Date.now() + (VOICE_BAN.hours - 1) * 3_600_000);
  });
});
