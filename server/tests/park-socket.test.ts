/**
 * The live park over the socket, against the real database: three people, their looks,
 * a block between two of them, what each is sent and what each hears.
 *
 * Sockets are stood in for by fakes that keep their frames (as decide-events.test.ts
 * does); the frames go through the real handler, the real room, the real match role
 * reading looks and `apart()`, and the real block route.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - enter without asking the database who is apart -> "never sends a blocked person" fails;
 *   - send every look on every frame -> "sends a look once" fails;
 *   - skip the park limit on saying -> "slows down somebody talking too fast" fails.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { STARTER, type Look, type ServerEvent } from '@clone/shared';
import { pool, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import * as hub from '../src/messaging/hub.js';
import { agentRef } from '../src/matching/world.js';
import { handleParkFrame, park, socketClosed, tick } from '../src/park/socket.js';
import { parkRoutes } from '../src/api/park.js';
import { mintToken, newSessionId } from '../src/tokens.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

interface P { tenantId: string; userId: string; token: string; frames: ServerEvent[]; ws: never }
async function person(label: string, look?: Look): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`park-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `park-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
    VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  if (look) await owner.query('INSERT INTO looks (user_id, tenant_id, look) VALUES ($1,$2,$3)', [userId, tenantId, look]);
  const frames: ServerEvent[] = [];
  const ws = { readyState: 1, OPEN: 1, send: (t: string) => { frames.push(JSON.parse(t) as ServerEvent); } } as never;
  hub.join(userId, ws);
  return { tenantId, userId, token: mintToken(sessionId), frames, ws };
}

const frame = (p: P, msg: object) => handleParkFrame(p.ws, { tenantId: p.tenantId, userId: p.userId }, JSON.stringify(msg));
const last = <T extends ServerEvent['type']>(p: P, type: T) =>
  [...p.frames].reverse().find((f) => f.type === type) as Extract<ServerEvent, { type: T }> | undefined;

let a: P, b: P, c: P;
const lookA: Look = { ...STARTER, hair: 7, hat: 2, outfitColor: 9 };

beforeAll(async () => {
  a = await person('a', lookA);
  b = await person('b');
  c = await person('c');
  // c blocked a, some time ago.
  await owner.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2)', [c.userId, a.userId]);
  for (const p of [a, b, c]) await frame(p, { type: 'park.enter' });
  await frame(a, { type: 'park.move', x: 10, z: 10, facing: 0, moving: false });
  await frame(b, { type: 'park.move', x: 11, z: 10, facing: 1, moving: true });
  await frame(c, { type: 'park.move', x: 10, z: 11, facing: 0, moving: false });
});

afterAll(async () => {
  for (const p of [a, b, c]) { hub.leave(p.userId, p.ws); socketClosed(p.userId); }
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('the park over the socket', () => {
  it('sends each person the people near them, with a look once', () => {
    // The first time b is sent a -- the snapshot b got on walking in -- carries a's look.
    const aRef = agentRef(b.userId, a.userId);
    const first = b.frames.find((f) => f.type === 'park.people' && f.people.some((x) => x.ref === aRef));
    expect(first, 'b was never sent a').toBeDefined();
    const aFirst = (first as Extract<ServerEvent, { type: 'park.people' }>).people.find((x) => x.ref === aRef)!;
    expect(aFirst.look, 'a\'s saved look did not reach b').toEqual(lookA);
    // ...and the frames after it carry where a is, and not the look again.
    tick();
    const now = last(b, 'park.people')!.people.find((x) => x.ref === aRef);
    expect(now, 'b does not see a').toBeDefined();
    expect(now).toMatchObject({ x: 10, z: 10 });
    expect(now!.look, 'a whole look again, four times a second').toBeUndefined();
  });

  it('never sends a blocked person, either way', () => {
    for (const p of [a, b, c]) p.frames.length = 0;
    tick();
    expect(last(a, 'park.people')!.people.map((x) => x.ref)).toEqual([agentRef(a.userId, b.userId)]);
    expect(last(c, 'park.people')!.people.map((x) => x.ref)).toEqual([agentRef(c.userId, b.userId)]);
  });

  it('delivers what is said to earshot only, never to somebody kept apart, and refuses contact details', async () => {
    for (const p of [a, b, c]) p.frames.length = 0;
    await frame(a, { type: 'park.say', text: 'Is the bandstand open?' });
    expect(last(a, 'park.said')).toMatchObject({ ref: 'you', text: 'Is the bandstand open?' });
    expect(last(b, 'park.said')).toMatchObject({ ref: agentRef(b.userId, a.userId), text: 'Is the bandstand open?' });
    expect(last(c, 'park.said'), 'c blocked a and heard them anyway').toBeUndefined();
    await frame(a, { type: 'park.say', text: 'text me 98450 12345' });
    expect(last(a, 'park.refused')).toMatchObject({ reason: 'contact' });
    expect(b.frames.filter((f) => f.type === 'park.said')).toHaveLength(1);
  });

  it('slows down somebody talking too fast', async () => {
    b.frames.length = 0;
    for (let i = 0; i < 9; i++) await frame(b, { type: 'park.say', text: `hello ${i}` });
    expect(b.frames.filter((f) => f.type === 'park.said').length).toBeLessThanOrEqual(8);
    expect(last(b, 'park.refused')).toMatchObject({ reason: 'too_fast' });
  });

  it('blocks by the ref the park gave, and from then on neither sees the other', async () => {
    const res = await parkRoutes.request('/v1/park/block', {
      method: 'POST',
      headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: agentRef(a.userId, b.userId) }),
    });
    expect(res.status).toBe(200);
    const { rows } = await owner.query('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [a.userId, b.userId]);
    expect(rows).toHaveLength(1);
    for (const p of [a, b]) p.frames.length = 0;
    tick();
    expect(last(a, 'park.people')!.people).toEqual([]);
    expect(last(b, 'park.people')!.people.map((x) => x.ref)).toEqual([agentRef(b.userId, c.userId)]);
    // A ref for somebody not visible is somebody not here.
    const again = await parkRoutes.request('/v1/park/block', {
      method: 'POST',
      headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: agentRef(a.userId, b.userId) }),
    });
    expect(again.status).toBe(404);
  });

  it('lets somebody go when their last socket closes', () => {
    hub.leave(c.userId, c.ws);
    socketClosed(c.userId);
    expect(park.members.has(c.userId)).toBe(false);
    b.frames.length = 0;
    tick();
    expect(last(b, 'park.people')!.people).toEqual([]);
  });
});
