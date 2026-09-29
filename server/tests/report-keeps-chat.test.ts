/**
 * The chat a report is about outlives both accounts (0080; the founder, 2026-09-29: "When
 * an account is deleted, keep any messages that are part of a report, so evidence
 * survives").
 *
 * WHAT WAS WRONG: a report kept only the chat's id. Deleting either account deletes the
 * pair and every message in it, both sides, so somebody reported for what they wrote
 * could delete their account and take their words with them. And no reviewer could read
 * a reported chat at all, accounts or not.
 *
 * WHAT IS PINNED, through the real report route, the real erasure and the reviewer's
 * real routes:
 *   - the chat is copied to the report when it is made, and survives the reported person
 *     deleting their account, then the reporter deleting theirs: every line in order,
 *     who of the two said it, words taken back kept and marked -- and no user id anywhere;
 *   - only the reviewer can read it, through a route that names neither person;
 *   - the copy is the two people's own chat, whatever chat id the phone sends;
 *   - the last 200 messages of a long chat;
 *   - the application cannot read or write the copy, and the eraser cannot delete it.
 *
 * Negative controls, run by hand on the tests' database and recorded in the commit:
 *   - the trigger disabled                              -> "survives both deletions" fails;
 *   - the trigger following the report's chat id         -> "whatever chat id" fails;
 *   - the trigger with no limit                          -> "the last 200" fails;
 *   - SELECT granted to clone_app                        -> "cannot read or write" fails;
 *   - the chat route open to any signed-in person        -> "only the reviewer" fails.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';

const { pool, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { eraseUser } = await import('../src/memory/erasure.js');
const { messageRoutes } = await import('../src/api/messages.js');
const { adminRoutes } = await import('../src/api/admin.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
const reportIds: string[] = [];
interface P { tenantId: string; userId: string; token: string }
interface Line { from: 'them' | 'reporter'; text: string; dateIdea: boolean; at: string; takenBack: boolean }

async function person(label: string): Promise<P> {
  const tag = `rkc-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
    VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}
/** Two people introduced, and what each said, in order; `true` = taken back afterwards. */
async function chat(a: P, b: P, lines: [P, string, boolean?][]): Promise<string> {
  const [lo, hi] = a.userId < b.userId ? [a, b] : [b, a];
  const r = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status)
     VALUES ($1,$2,$3,$4,0,'introduced') RETURNING id`, [lo.userId, hi.userId, lo.tenantId, hi.tenantId]);
  const id = r.rows[0]!.id;
  let seq = 0;
  for (const [from, body, takenBack] of lines) {
    await owner.query(`INSERT INTO messages (id, rendezvous_id, sender_id, body, seq, redacted_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`, [id, from.userId, body, ++seq, takenBack ? new Date() : null]);
  }
  return id;
}
/** `by` reports through the app's own route; returns the report's id. */
async function report(by: P, body: object): Promise<string> {
  const res = await messageRoutes.request('/v1/report', {
    method: 'POST', headers: { Authorization: `Bearer ${by.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  const { rows } = await owner.query<{ id: string }>(
    'SELECT id FROM reports WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 1', [by.userId]);
  reportIds.push(rows[0]!.id);
  return rows[0]!.id;
}
const readChat = (token: string, id: string) =>
  adminRoutes.request(`/v1/admin/reports/${id}/chat`, { headers: { Authorization: `Bearer ${token}` } });
const kept = async (id: string) => (await owner.query<{ body: string }>(
  'SELECT body FROM report_messages WHERE report_id = $1 ORDER BY seq', [id])).rows.map((r) => r.body);

let reviewer: P;
beforeAll(async () => {
  reviewer = await person('reviewer');
  env.ADMIN_USER_IDS = reviewer.userId;
});
afterAll(async () => {
  // Reports whose both people are gone belong to no test tenant any more.
  await owner.query('DELETE FROM reports WHERE id = ANY($1)', [reportIds]);
  await removeTenants(owner, made);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('the chat a report is about', () => {
  let asha: P, ravi: P, reportId = '', chatId = '';

  it('survives the reported person deleting their account, then the reporter deleting theirs', async () => {
    asha = await person('asha');
    ravi = await person('ravi');
    chatId = await chat(asha, ravi, [
      [ravi, 'hey, free on saturday?'],
      [asha, 'maybe, where?'],
      [ravi, 'I know where you live', true],
      [asha, 'please stop messaging me'],
    ]);
    reportId = await report(asha, { rendezvousId: chatId, reason: 'harassment' });

    expect((await eraseUser({ tenantId: ravi.tenantId, userId: ravi.userId })).verified).toBe(true);
    const gone = await owner.query('SELECT 1 FROM messages WHERE rendezvous_id = $1', [chatId]);
    expect(gone.rows, 'the erasure left the chat itself behind').toHaveLength(0);
    expect(await kept(reportId), 'the reported chat went with their account')
      .toEqual(['hey, free on saturday?', 'maybe, where?', 'I know where you live', 'please stop messaging me']);

    expect((await eraseUser({ tenantId: asha.tenantId, userId: asha.userId })).verified).toBe(true);
    expect(await kept(reportId), 'the reported chat went with the reporter\'s account').toHaveLength(4);
  });

  it('can be read by the reviewer: who of the two said each line, words taken back marked, no ids', async () => {
    const res = await readChat(reviewer.token, reportId);
    expect(res.status).toBe(200);
    const text = await res.text();
    const { lines } = JSON.parse(text) as { lines: Line[] };
    expect(lines.map((l) => [l.from, l.text, l.takenBack])).toEqual([
      ['them', 'hey, free on saturday?', false],
      ['reporter', 'maybe, where?', false],
      ['them', 'I know where you live', true],
      ['reporter', 'please stop messaging me', false],
    ]);
    for (const id of [asha.userId, ravi.userId, chatId]) expect(text).not.toContain(id);
    const queue = await (await adminRoutes.request('/v1/admin/reports?all=1', {
      headers: { Authorization: `Bearer ${reviewer.token}` },
    })).json() as { reports: { id: string; chatLines: number }[] };
    expect(queue.reports.find((r) => r.id === reportId)?.chatLines).toBe(4);
  });

  it('can be read by the reviewer only', async () => {
    const someone = await person('someone');
    expect((await readChat(someone.token, reportId)).status).toBe(404);
  });

  it('is the two people\'s own chat, whatever chat id the phone sends', async () => {
    const [c, d, e, f] = await Promise.all(['c', 'd', 'e', 'f'].map(person));
    await chat(c!, d!, [[d!, 'you looked better in your photos']]);
    const others = await chat(e!, f!, [[e!, 'meet me at noon'], [f!, 'ok, see you']]);
    const id = await report(c!, { userId: d!.userId, rendezvousId: others, reason: 'inappropriate' });
    expect(await kept(id), 'somebody else\'s chat was copied into the report').toEqual(['you looked better in your photos']);
  });

  it('keeps the last 200 messages of a long chat', async () => {
    const [g, h] = await Promise.all(['g', 'h'].map(person));
    const id = await chat(g!, h!, []);
    await owner.query(`INSERT INTO messages (id, rendezvous_id, sender_id, body, seq)
      SELECT gen_random_uuid(), $1, $2, 'line ' || n, n FROM generate_series(1, 205) n`, [id, g!.userId]);
    const r = await report(h!, { rendezvousId: id, reason: 'spam' });
    const lines = await kept(r);
    expect(lines).toHaveLength(200);
    expect([lines[0], lines[199]]).toEqual(['line 6', 'line 205']);
  });

  it('cannot be read or written by the application, or deleted by the eraser', async () => {
    const can = async (role: string, priv: string) => (await owner.query<{ ok: boolean }>(
      'SELECT has_table_privilege($1, $2, $3) AS ok', [role, 'report_messages', priv])).rows[0]!.ok;
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      for (const role of ['clone_app', 'clone_match', 'clone_eraser', 'clone_door', 'clone_discovery']) {
        expect(await can(role, priv), `${role} may ${priv}`).toBe(false);
      }
    }
    expect(await can('clone_matchmaker', 'SELECT')).toBe(true);
    for (const priv of ['INSERT', 'UPDATE', 'DELETE']) expect(await can('clone_matchmaker', priv), priv).toBe(false);
  });
});
