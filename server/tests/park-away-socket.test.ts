/**
 * Away from the park, and the connection drops (the founder's Seeker, 2026-10-03).
 *
 * WHAT WAS WRONG. The ten-second grace (room.ts AWAY_MS) held somebody whose phone left
 * the park's screen -- but a phone in the background loses its connection within seconds
 * (the Seeker's went 5.7 s after the park left its screen), and a closed connection was a
 * walk out at once: the partner saw them vanish, the bench ended, and coming back they
 * were alone.
 *
 * WHAT IS GUARDED, through the real handler and room over fake sockets (as
 * park-socket.test.ts does):
 *   - away, the connection gone: still in the park, still together, still on the bench;
 *   - back on a new connection within the grace: told who they are with (`again`: no
 *     flight over), which side of the bench is theirs, and the bench;
 *   - never back: gone when the grace is, and the partner told;
 *   - not away, a connection gone is a walk out at once, as before.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - socketClosed leaving whoever it is -> "still in the park, still together" fails;
 *   - park.enter without restorePair -> "told who they are with" fails.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import type { ServerEvent } from '@clone/shared';
import { pool, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import * as hub from '../src/messaging/hub.js';
import { agentRef } from '../src/matching/world.js';
import { handleParkFrame, park, socketClosed, tick } from '../src/park/socket.js';
import { AWAY_MS } from '../src/park/room.js';
import { mintToken, newSessionId } from '../src/tokens.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

interface P { tenantId: string; userId: string; frames: ServerEvent[]; ws: never }
function socket(frames: ServerEvent[]): never {
  return { readyState: 1, OPEN: 1, send: (t: string) => { frames.push(JSON.parse(t) as ServerEvent); } } as never;
}
async function person(label: string): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`park-away-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `park-away-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
    VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  mintToken(sessionId);
  const frames: ServerEvent[] = [];
  const ws = socket(frames);
  hub.join(userId, ws);
  return { tenantId, userId, frames, ws };
}
const frame = (p: P, msg: object) => handleParkFrame(p.ws, { tenantId: p.tenantId, userId: p.userId }, JSON.stringify(msg));
const seen = (p: P, type: ServerEvent['type']) => p.frames.some((f) => f.type === type);

/** Two people, paired (`asker` asked `asked`) and on `bench`. */
async function couple(bench: number): Promise<{ asker: P; asked: P }> {
  const asker = await person('asker');
  const asked = await person('asked');
  for (const p of [asker, asked]) await frame(p, { type: 'park.enter' });
  await frame(asker, { type: 'park.move', x: 20, z: 20, facing: 0, moving: false });
  await frame(asked, { type: 'park.move', x: 20.5, z: 20, facing: 0, moving: false });
  await frame(asker, { type: 'park.find' });
  await vi.waitFor(() => expect(seen(asked, 'park.asked')).toBe(true));
  await frame(asked, { type: 'park.answer', yes: true });
  await vi.waitFor(() => expect(seen(asker, 'park.paired')).toBe(true));
  await frame(asker, { type: 'park.sit', bench });
  expect(asked.frames.find((f) => f.type === 'park.sat')).toMatchObject({ bench });
  return { asker, asked };
}
function drop(p: P): void {
  hub.leave(p.userId, p.ws);
  socketClosed(p.userId);
}

afterAll(async () => {
  for (const id of [...park.members.keys()]) { socketClosed(id); }
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('away, and the connection drops', () => {
  let one: { asker: P; asked: P };
  beforeAll(async () => { one = await couple(7); });

  it('is still in the park, still together, still on the bench', async () => {
    await frame(one.asked, { type: 'park.away' });
    drop(one.asked);
    expect(park.members.has(one.asked.userId), 'walked out when the connection went').toBe(true);
    expect(seen(one.asker, 'park.parted'), 'the partner was told they had gone').toBe(false);
  });

  it('back on a new connection: told who they are with, no flight, and the bench', async () => {
    const frames: ServerEvent[] = [];
    one.asked.ws = socket(frames);
    one.asked.frames = frames;
    hub.join(one.asked.userId, one.asked.ws);
    await frame(one.asked, { type: 'park.enter', at: { x: 20.5, z: 20 } });
    const paired = frames.find((f) => f.type === 'park.paired') as Extract<ServerEvent, { type: 'park.paired' }> | undefined;
    expect(paired, 'not told who they are with').toBeDefined();
    expect(paired).toMatchObject({ ref: agentRef(one.asked.userId, one.asker.userId), asked: true, again: true });
    expect(frames.find((f) => f.type === 'park.sat')).toMatchObject({ bench: 7 });
    expect(frames.findIndex((f) => f.type === 'park.arrived')).toBeLessThan(frames.findIndex((f) => f.type === 'park.paired'));
    expect(seen(one.asker, 'park.parted')).toBe(false);
  });
});

describe('away, the connection gone, and never back', () => {
  it('is gone when the grace is, and the partner is told', async () => {
    const { asker, asked } = await couple(8);
    await frame(asked, { type: 'park.away' });
    drop(asked);
    expect(park.members.has(asked.userId)).toBe(true);
    // The room keeps the real clock (socket.ts hands it Date.now itself), so the grace is
    // run out by moving its end to just now -- exactly what AWAY_MS of waiting would do.
    const m = park.members.get(asked.userId)!;
    expect(m.awayUntil! - Date.now()).toBeGreaterThan(AWAY_MS - 2_000);
    m.awayUntil = Date.now() - 1;
    tick();
    expect(park.members.has(asked.userId), 'held past the grace').toBe(false);
    expect(seen(asker, 'park.parted'), 'the partner was not told').toBe(true);
    // Out of the way: free again, they would be the next one "Find someone" picks.
    drop(asker);
  });
});

describe('not away, the connection gone', () => {
  it('is a walk out at once, as before', async () => {
    const { asker, asked } = await couple(9);
    drop(asked);
    expect(park.members.has(asked.userId)).toBe(false);
    expect(seen(asker, 'park.parted')).toBe(true);
  });
});
