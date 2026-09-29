/**
 * A block or a report ends everything between two people in the park, at once
 * (park/socket.ts separate).
 *
 * WHAT WAS WRONG (found checking the voice build, 2026-09-29): a block or a report in the
 * park only kept the two apart -- they stopped seeing each other -- but did not end their
 * chat. Sitting on a bench, their private voice room and their typed lines went on, the
 * blocked person still talking into the blocker's ear. A block made from a card or a chat
 * did not reach the park at all while both were in it.
 *
 * WHAT IS PINNED, through the real routes and the real park, against the real database:
 *   - blocking or reporting your partner on a bench ends the chat and the bench for both
 *     ("park.parted"), sends both a pass back to the park's room -- never the bench's --
 *     and from then on neither is sent the other in the park;
 *   - the same from the app's own block route (a card, a chat) while both are in the park;
 *   - an invitation between them, either way, just goes: the invited is no longer asked,
 *     the one who asked hears "no answer" -- never that they were blocked;
 *   - nobody else's chat is touched.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - separate() without ending the pair      -> "ends the bench" fails;
 *   - separate() without the invitations      -> "an invitation just goes" fails;
 *   - the app's block route without separate() -> "from a card or a chat" fails.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';
import type { ServerEvent } from '@clone/shared';

process.env.LIVEKIT_URL = 'ws://127.0.0.1:9';
process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret-that-is-long-enough-for-hs256';

const { pool, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const hub = await import('../src/messaging/hub.js');
const { handleParkFrame, pairs, park, socketClosed, tick } = await import('../src/park/socket.js');
const { parkRoutes } = await import('../src/api/park.js');
const { messageRoutes } = await import('../src/api/messages.js');
const { agentRef } = await import('../src/matching/world.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');
const { PARK_ROOM } = await import('../src/park/voice.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
interface P { tenantId: string; userId: string; token: string; frames: ServerEvent[]; ws: never }
const everyone: P[] = [];

async function person(label: string, x: number): Promise<P> {
  const tag = `sep-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
    VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  const frames: ServerEvent[] = [];
  const ws = { readyState: 1, OPEN: 1, send: (s: string) => { frames.push(JSON.parse(s) as ServerEvent); } } as never;
  hub.join(userId, ws);
  const p = { tenantId, userId, token: mintToken(sessionId), frames, ws };
  everyone.push(p);
  await frame(p, { type: 'park.enter' });
  await frame(p, { type: 'park.move', x, z: 60, facing: 0, moving: false });
  return p;
}
const frame = (p: P, msg: object) => handleParkFrame(p.ws, { tenantId: p.tenantId, userId: p.userId }, JSON.stringify(msg));
const got = (p: P, type: ServerEvent['type']) => p.frames.some((f) => f.type === type);
const lastOf = <T extends ServerEvent['type']>(p: P, type: T) =>
  [...p.frames].reverse().find((f) => f.type === type) as Extract<ServerEvent, { type: T }> | undefined;
const post = (routes: typeof parkRoutes | typeof messageRoutes, path: string, p: P, body: object) => routes.request(path, {
  method: 'POST', headers: { Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
/** Whom `p` is sent in the park now. */
const sees = (p: P) => { p.frames.length = 0; tick(); return lastOf(p, 'park.people')?.people.map((x) => x.ref) ?? []; };
async function pairUp(a: P, b: P, bench?: number) {
  pairs.ask(a.userId, b.userId);
  await frame(b, { type: 'park.answer', yes: true });
  if (bench !== undefined) await frame(a, { type: 'park.sit', bench });
  expect(pairs.partnerOf(a.userId)).toBe(b.userId);
}

afterAll(async () => {
  for (const p of everyone) { hub.leave(p.userId, p.ws); socketClosed(p.userId); }
  await removeTenants(owner, made);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('blocking or reporting somebody in the park', () => {
  let x = 0;
  const spot = () => (x += 7);

  for (const how of ['block', 'report'] as const) {
    it(`ends the bench and the chat for both when you ${how} your partner, voice and all`, async () => {
      const at = spot();
      const a = await person(`${how}-a`, at);
      const b = await person(`${how}-b`, at + 0.3);
      await pairUp(a, b, 900 + at);
      expect(lastOf(a, 'park.voice')!.room).not.toBe(PARK_ROOM);
      for (const p of [a, b]) p.frames.length = 0;

      const res = how === 'block'
        ? await post(parkRoutes, '/v1/park/block', a, { ref: agentRef(a.userId, b.userId) })
        : await post(parkRoutes, '/v1/park/report', a, { ref: agentRef(a.userId, b.userId), reason: 'harassment', voice: true });
      expect(res.status).toBe(200);

      expect(pairs.partnerOf(a.userId), 'still talking after a block').toBeNull();
      expect(pairs.benchOf(b.userId), 'still on the bench after a block').toBeNull();
      for (const p of [a, b]) {
        expect(got(p, 'park.parted'), 'not told the chat ended').toBe(true);
        expect(lastOf(p, 'park.voice')?.room, 'kept a pass to the bench room').toBe(PARK_ROOM);
      }
      expect(sees(a)).not.toContain(agentRef(a.userId, b.userId));
      expect(sees(b)).not.toContain(agentRef(b.userId, a.userId));
    });
  }

  it('ends it too from a card or a chat, while both are in the park', async () => {
    const at = spot();
    const a = await person('card-a', at);
    const b = await person('card-b', at + 0.3);
    await pairUp(a, b);
    for (const p of [a, b]) p.frames.length = 0;
    const res = await post(messageRoutes, '/v1/block', b, { userId: a.userId });
    expect(res.status).toBe(200);
    expect(pairs.partnerOf(a.userId), 'a block from a card left the park chat going').toBeNull();
    expect(got(a, 'park.parted')).toBe(true);
    expect(sees(a)).not.toContain(agentRef(a.userId, b.userId));
  });

  it('lets an invitation between them just go, either way, without saying why', async () => {
    const at = spot();
    const a = await person('ask-a', at);
    const b = await person('ask-b', at + 0.3);
    pairs.ask(a.userId, b.userId);
    for (const p of [a, b]) p.frames.length = 0;
    // The invited blocks the one asking.
    expect((await post(parkRoutes, '/v1/park/block', b, { ref: agentRef(b.userId, a.userId) })).status).toBe(200);
    expect(pairs.asking(a.userId), 'still asking somebody who blocked them').toBeNull();
    expect(got(b, 'park.unasked'), 'still being asked by somebody blocked').toBe(true);
    expect(lastOf(a, 'park.finding')).toMatchObject({ status: 'no_answer' });
  });

  it('touches nobody else\'s chat', async () => {
    const at = spot();
    const a = await person('other-a', at);
    const b = await person('other-b', at + 0.3);
    const c = await person('other-c', at + 0.6);
    await pairUp(a, c);
    expect((await post(parkRoutes, '/v1/park/block', a, { ref: agentRef(a.userId, b.userId) })).status).toBe(200);
    expect(pairs.partnerOf(a.userId)).toBe(c.userId);
    expect(park.members.has(c.userId)).toBe(true);
  });
});
