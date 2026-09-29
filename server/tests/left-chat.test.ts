/**
 * A deleted account's chats are held for thirty days, hidden, for a report (0082; the
 * founder, 2026-09-29: "hidden 30-day chat copy after deletion (reviewer-only, only with
 * a report, auto-deleted, stated in the privacy notice)").
 *
 * WHAT WAS WRONG: deleting an account deleted every chat it was in at once, both halves.
 * Somebody could threaten a person and delete their account the same minute, and the
 * person they threatened had nothing left to report, and nothing to report it from.
 *
 * WHAT IS PINNED, through the real erasure and the real routes:
 *   - the chat is held for the person who stayed, and nobody can read the words: not
 *     the application, not the matcher, not the reviewer, not the eraser that wrote them;
 *     the person who stayed sees that the other left, and by what name, never the keys;
 *   - the person who stayed can report it, once: the report carries the words to the
 *     reviewer, who reads them as "them" and "reporter", and it is keyed to the phone of
 *     the one who left, so it points at them again if they come back;
 *   - nobody else can report it;
 *   - their chat list says they left -- the name they knew, never the words -- and says
 *     so once they reported it; nobody else's list shows it;
 *   - thirty days on it is invisible and unreportable at once, and the sweep deletes it;
 *   - a chat the two had blocked their way out of is not held;
 *   - the person who stayed deleting their own account takes their holds with them.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - erasure without the hold                      -> "held for the person who stayed" fails;
 *   - report_left_chat without copying the words    -> "can report it, once" fails;
 *   - the policy without its expiry                 -> "invisible and unreportable" fails;
 *   - the sweep deleting nothing                    -> "the sweep deletes it" fails;
 *   - the chat list without the holds               -> "their chat list says they left" fails.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { eraseUser, forgetLeftChats } = await import('../src/memory/erasure.js');
const { messageRoutes } = await import('../src/api/messages.js');
const { adminRoutes } = await import('../src/api/admin.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
const reportIds: string[] = [];
interface P { tenantId: string; userId: string; token: string }

async function person(label: string, phone: string | null = null): Promise<P> {
  const tag = `lc-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email, phone_hmac) VALUES ($1,$2,$3) RETURNING id',
    [tenantId, `${tag}@example.test`, phone]);
  const userId = u.rows[0]!.id;
  await owner.query(`INSERT INTO match_profile (user_id, tenant_id, age, in_pool, display_name) VALUES ($1,$2,30,false,$3)`,
    [userId, tenantId, label]);
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at, device_hmac)
    VALUES ($1,$2,$3,'t', now() + interval '30 days', $4)`, [sessionId, tenantId, userId, `dev-${tag}`.padEnd(24, 'x')]);
  return { tenantId, userId, token: mintToken(sessionId) };
}
async function chat(a: P, b: P, lines: [P, string, boolean?][]): Promise<string> {
  const [lo, hi] = a.userId < b.userId ? [a, b] : [b, a];
  const r = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status)
     VALUES ($1,$2,$3,$4,0,'introduced') RETURNING id`, [lo.userId, hi.userId, lo.tenantId, hi.tenantId]);
  let seq = 0;
  for (const [from, body, takenBack] of lines) {
    await owner.query(`INSERT INTO messages (id, rendezvous_id, sender_id, body, seq, redacted_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`, [r.rows[0]!.id, from.userId, body, ++seq, takenBack ? new Date() : null]);
  }
  return r.rows[0]!.id;
}
/** The holds `who` can see, as the application sees them. */
const heldFor = (who: P) => tenantSession(who, async (c) =>
  (await c.query<{ id: string; left_name: string | null; reported_at: Date | null }>(
    'SELECT id, left_name, reported_at FROM left_chats')).rows);
const reportLeft = (who: P, id: string) => messageRoutes.request(`/v1/left/${id}/report`, {
  method: 'POST', headers: { Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ reason: 'harassment', detail: 'threats, then he deleted his account' }),
});
/** `who`'s chat list, as the phone reads it. */
const list = async (who: P) => (await (await messageRoutes.request('/v1/conversations', {
  headers: { Authorization: `Bearer ${who.token}` },
})).json()) as { conversations: { id: string }[]; left: { id: string; name: string; reported: boolean }[] };
const can = async (role: string, table: string, priv: string) => (await owner.query<{ ok: boolean }>(
  'SELECT has_table_privilege($1, $2, $3) AS ok', [role, table, priv])).rows[0]!.ok;

const PHONE = `phone-key-${Date.now()}-${Math.random()}`;
let reviewer: P, asha: P, ravi: P, holdId = '';

beforeAll(async () => {
  reviewer = await person('reviewer');
  env.ADMIN_USER_IDS = reviewer.userId;
  asha = await person('Asha');
  ravi = await person('Ravi', PHONE);
  await chat(asha, ravi, [
    [ravi, 'you will regret ignoring me'],
    [asha, 'please stop'],
    [ravi, 'I know where you work', true],
  ]);
});
afterAll(async () => {
  await owner.query('DELETE FROM reports WHERE id = ANY($1)', [reportIds]);
  await removeTenants(owner, made);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('a chat, after one of the two deletes their account', () => {
  it('is held for the person who stayed, and nobody can read the words', async () => {
    const blockedOut = await person('Blocked');
    await chat(blockedOut, ravi, [[ravi, 'hello']]);
    await owner.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2)', [blockedOut.userId, ravi.userId]);

    expect((await eraseUser({ tenantId: ravi.tenantId, userId: ravi.userId })).verified).toBe(true);
    const held = await heldFor(asha);
    expect(held, 'the chat went with his account').toHaveLength(1);
    expect(held[0]!.left_name).toBe('Ravi');
    holdId = held[0]!.id;
    const words = await owner.query('SELECT 1 FROM left_chat_messages WHERE left_chat_id = $1', [holdId]);
    expect(words.rows).toHaveLength(3);
    expect(await heldFor(blockedOut), 'a chat blocked out of was held').toHaveLength(0);

    // Nobody reads the words -- and the person who stayed does not get his keys.
    for (const role of ['clone_app', 'clone_match', 'clone_matchmaker', 'clone_eraser', 'clone_door', 'clone_discovery']) {
      expect(await can(role, 'left_chat_messages', 'SELECT'), `${role} reads the held words`).toBe(false);
    }
    await expect(tenantSession(asha, (c) => c.query('SELECT left_phone_hmac FROM left_chats')))
      .rejects.toThrow(/permission denied/);
  });

  it('shows in their chat list that he left -- his name, never the words -- and in nobody else\'s', async () => {
    const mine = await list(asha);
    expect(mine.left, 'her chat with him vanished from her list').toEqual([
      expect.objectContaining({ id: holdId, name: 'Ravi', reported: false })]);
    expect(JSON.stringify(mine), 'the held words reached her list').not.toMatch(/regret|please stop|where you work/);
    expect(mine.conversations).toEqual([]);
    const onlooker = await person('Onlooker');
    expect((await list(onlooker)).left).toEqual([]);
  });

  it('can be reported by the person who stayed, once: the words reach the reviewer, keyed to his phone', async () => {
    const someone = await person('Someone');
    expect((await reportLeft(someone, holdId)).status, 'somebody else reported a chat held for her').toBe(404);

    expect((await reportLeft(asha, holdId)).status).toBe(200);
    expect((await reportLeft(asha, holdId)).status, 'reported twice').toBe(404);
    expect((await list(asha)).left.find((l) => l.id === holdId)?.reported, 'her list did not say she reported it').toBe(true);
    const { rows } = await owner.query<{ id: string; reported_id: string | null; reported_phone_hmac: string | null; reason: string }>(
      'SELECT id, reported_id, reported_phone_hmac, reason FROM reports WHERE reporter_id = $1', [asha.userId]);
    expect(rows).toHaveLength(1);
    reportIds.push(rows[0]!.id);
    expect(rows[0]).toMatchObject({ reported_id: null, reported_phone_hmac: PHONE, reason: 'harassment' });

    const res = await adminRoutes.request(`/v1/admin/reports/${rows[0]!.id}/chat`, { headers: { Authorization: `Bearer ${reviewer.token}` } });
    const { lines } = await res.json() as { lines: { from: string; text: string; takenBack: boolean }[] };
    expect(lines.map((l) => [l.from, l.text, l.takenBack])).toEqual([
      ['them', 'you will regret ignoring me', false],
      ['reporter', 'please stop', false],
      ['them', 'I know where you work', true],
    ]);

    // He comes back under the same phone: the report is about him again.
    const back = await person('Ravi again', PHONE);
    const now = await owner.query<{ id: string | null }>('SELECT reported_now($1) AS id', [rows[0]!.id]);
    expect(now.rows[0]!.id).toBe(back.userId);
  });

  it('is invisible and unreportable once thirty days are up, and the sweep deletes it', async () => {
    const dev = await person('Dev');
    await chat(asha, dev, [[dev, 'hi']]);
    expect((await eraseUser({ tenantId: dev.tenantId, userId: dev.userId })).verified).toBe(true);
    const fresh = (await heldFor(asha)).find((h) => h.id !== holdId)!;
    await owner.query("UPDATE left_chats SET expires_at = now() - interval '1 second' WHERE id = $1", [fresh.id]);

    expect((await heldFor(asha)).map((h) => h.id), 'an expired hold still showed').not.toContain(fresh.id);
    expect((await reportLeft(asha, fresh.id)).status, 'an expired hold was reported').toBe(404);
    await forgetLeftChats();
    const gone = await owner.query('SELECT 1 FROM left_chats WHERE id = $1', [fresh.id]);
    expect(gone.rows, 'the sweep left an expired hold').toHaveLength(0);
    const words = await owner.query('SELECT 1 FROM left_chat_messages WHERE left_chat_id = $1', [fresh.id]);
    expect(words.rows).toHaveLength(0);
  });

  it('goes with the person who stayed, if they delete their account too', async () => {
    expect((await eraseUser({ tenantId: asha.tenantId, userId: asha.userId })).verified).toBe(true);
    const left = await owner.query('SELECT 1 FROM left_chats WHERE id = $1', [holdId]);
    expect(left.rows).toHaveLength(0);
    // The report she made stays, with its words (0079, 0080).
    const words = await owner.query('SELECT 1 FROM report_messages WHERE report_id = $1', [reportIds[0]]);
    expect(words.rows).toHaveLength(3);
  });
});
