/**
 * What was typed in the park is kept ten minutes, for a report and nothing else
 * (park/lines.ts, 0084; the founder, 2026-09-29: "keep park typed messages for 10 minutes,
 * used only for reports").
 *
 * WHAT WAS WRONG: park lines were relayed and kept nowhere, so a report about something
 * typed in the park carried no words but the reporter's own note.
 *
 * WHAT IS PINNED:
 *   - the server holds what two people said to each other, both ways, and forgets each
 *     line ten minutes after it was said;
 *   - a park report carries the lines between the two -- not a third person's -- to the
 *     reviewer, marked as typed in the park;
 *   - nobody can attach lines to a report they did not make;
 *   - nothing but the report route reads the lines, and nothing but the park's say writes
 *     them (source shape, comments stripped: a second reader is not observable).
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - the park's say not holding lines          -> "carries the lines" fails;
 *   - the report route not attaching them       -> "carries the lines" fails;
 *   - lines never forgotten                     -> "forgets each line" fails;
 *   - keep_park_lines without the reporter check -> "nobody can attach" fails.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';

process.env.LIVEKIT_URL = 'ws://127.0.0.1:9';
process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret-that-is-long-enough-for-hs256';

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const hub = await import('../src/messaging/hub.js');
const { handleParkFrame, socketClosed } = await import('../src/park/socket.js');
const { ParkLines, LINES_KEEP_MS } = await import('../src/park/lines.js');
const { parkRoutes } = await import('../src/api/park.js');
const { adminRoutes } = await import('../src/api/admin.js');
const { agentRef } = await import('../src/matching/world.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
interface P { tenantId: string; userId: string; token: string; ws: never }
const everyone: P[] = [];

async function person(label: string, x?: number): Promise<P> {
  const tag = `pl-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
    VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  const ws = { readyState: 1, OPEN: 1, send: () => {} } as never;
  hub.join(userId, ws);
  const p = { tenantId, userId, token: mintToken(sessionId), ws };
  everyone.push(p);
  if (x !== undefined) {
    await frame(p, { type: 'park.enter' });
    await frame(p, { type: 'park.move', x, z: -80, facing: 0, moving: false });
  }
  return p;
}
const frame = (p: P, msg: object) => handleParkFrame(p.ws, { tenantId: p.tenantId, userId: p.userId }, JSON.stringify(msg));

afterAll(async () => {
  for (const p of everyone) { hub.leave(p.userId, p.ws); socketClosed(p.userId); }
  await removeTenants(owner, made);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('the park\'s typed lines, in memory', () => {
  it('holds what two people said to each other, both ways, and nobody else\'s', () => {
    const l = new ParkLines(() => 0);
    l.said('b', ['a', 'b'], 'come with me');
    l.said('a', ['b'], 'leave me alone');
    l.said('c', ['a', 'b'], 'nice evening');
    l.said('b', ['d'], 'not to her');
    expect(l.between('a', 'b').map((x) => x.text)).toEqual(['come with me', 'leave me alone']);
  });

  it('forgets each line ten minutes after it was said', () => {
    let now = 0;
    const l = new ParkLines(() => now);
    l.said('b', ['a'], 'old');
    now = LINES_KEEP_MS - 1;
    l.said('b', ['a'], 'recent');
    now = LINES_KEEP_MS + 1;
    expect(l.between('a', 'b').map((x) => x.text)).toEqual(['recent']);
    now = 3 * LINES_KEEP_MS;
    l.forgetOld();
    expect(l.size).toBe(0);
  });
});

describe('a park report', () => {
  let reportId = '';
  let a: P, c: P;

  it('carries the lines between the two, and not a third person\'s, to the reviewer', async () => {
    const reviewer = await person('reviewer');
    env.ADMIN_USER_IDS = reviewer.userId;
    a = await person('a', 70);
    const b = await person('b', 70.3);
    c = await person('c', 70.6);
    await frame(b, { type: 'park.say', text: 'come with me, nobody will know' });
    await frame(a, { type: 'park.say', text: 'leave me alone' });
    await frame(c, { type: 'park.say', text: 'nice evening for it' });

    const res = await parkRoutes.request('/v1/park/report', {
      method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: agentRef(a.userId, b.userId), reason: 'harassment', voice: false }),
    });
    expect(res.status).toBe(200);
    const { rows } = await owner.query<{ id: string }>('SELECT id FROM reports WHERE reporter_id = $1', [a.userId]);
    reportId = rows[0]!.id;

    const chat = await adminRoutes.request(`/v1/admin/reports/${reportId}/chat`, { headers: { Authorization: `Bearer ${reviewer.token}` } });
    const { lines } = await chat.json() as { lines: { from: string; text: string; park: boolean }[] };
    expect(lines.map((l) => [l.from, l.text, l.park]), 'the park report carried none of what was typed').toEqual([
      ['them', 'come with me, nobody will know', true],
      ['reporter', 'leave me alone', true],
    ]);
  });

  it('lets nobody attach lines to a report they did not make, and its maker only once', async () => {
    // A second report of hers, about somebody who typed nothing: no lines went with it.
    const d = await person('d', 70.2);
    const res = await parkRoutes.request('/v1/park/report', {
      method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: agentRef(a.userId, d.userId), reason: 'spam', voice: false }),
    });
    expect(res.status).toBe(200);
    const fresh = (await owner.query<{ id: string }>('SELECT id FROM reports WHERE reporter_id = $1 AND id <> $2', [a.userId, reportId])).rows[0]!.id;
    const attach = (who: P) => tenantSession(who, async (db) => (await db.query<{ n: number }>(
      'SELECT keep_park_lines($1, $2::jsonb) AS n', [fresh, JSON.stringify([{ fromReported: true, text: 'made up', at: Date.now() }])])).rows[0]!.n);
    expect(await attach(c), 'somebody attached lines to a report that is not theirs').toBe(0);
    expect(await attach(a)).toBe(1);
    expect(await attach(a), 'lines attached twice').toBe(0);
    const { rows } = await owner.query('SELECT 1 FROM report_messages WHERE report_id = $1', [fresh]);
    expect(rows).toHaveLength(1);
  });

  it('is read by the report route and written by the park\'s say, and nothing else', () => {
    const SRC = join(import.meta.dirname, '..', 'src');
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
    });
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const using = (re: RegExp) => files(SRC).filter((f) => re.test(strip(readFileSync(f, 'utf8'))))
      .map((f) => f.slice(SRC.length + 1));
    expect(using(/\blines\.between\(/)).toEqual(['api/park.ts']);
    expect(using(/\blines\.said\(/)).toEqual(['park/socket.ts']);
  });
});
