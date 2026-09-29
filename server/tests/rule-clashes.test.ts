/**
 * Two wants on one question keep two rules, and any rule -- a must-have too -- can be
 * removed (0085; the founder, 2026-09-29; docs 15.3 item 18).
 *
 * WHAT WAS WRONG: one live rule per (person, field, operator). Two wants tied to the same
 * question -- "a saver" and "someone who pays off their debts", both the money question --
 * hit the same key, so the second overwrote the first's answers, strength and words, and
 * the first want lost its rule silently. And a rule could only change strength: a
 * must-have stayed hiding people for as long as the account lived.
 *
 * WHAT IS PINNED, through the real routes:
 *   - two wants tied to one question each keep their own rule, with their own answers;
 *   - a must-have can be removed: it stops applying, it is retired (kept on record), and
 *     it leaves the list; somebody else's rule cannot be removed.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - 0018's index back (one per field and operator) and setPreference's old key
 *                                              -> "each keep their own rule" fails;
 *   - the remove route not retiring anything   -> "can be removed" fails.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  const refuse = () => { throw new Error('no model in this test'); };
  return { ...real, llm: { ...real.llm, complete: refuse, stream: refuse, decide: refuse } };
});

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const { wantRoutes } = await import('../src/api/wants.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { BY_ID } = await import('../src/onboarding/questions.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
interface P { tenantId: string; userId: string; token: string }

async function person(): Promise<P> {
  const tag = `rc-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}@example.test`]);
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
    VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, u.rows[0]!.id]);
  return { tenantId, userId: u.rows[0]!.id, token: mintToken(sessionId) };
}
const H = (p: P) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.85' });
const post = (routes: typeof wantRoutes | typeof datingRoutes, path: string, p: P, body: object) =>
  routes.request(path, { method: 'POST', headers: H(p), body: JSON.stringify(body) });

const MONEY = BY_ID.get('sit-windfall')!;
const [SAVE, PAY] = MONEY.options.map((o) => o.value);
let me: P;

beforeAll(async () => {
  me = await person();
  await tenantSession(me, (c) => commit(c, me, {
    predicate: 'seeking', objectText: 'A saver. Someone who pays off their debts.',
    stance: 'asserted', originClass: 'owner', sourceQuote: 'A saver. Someone who pays off their debts.',
    sourceEpisodeIds: [], extractorModel: 'test', extractorVersion: '0', promptVersion: '0',
  }));
});
afterAll(async () => {
  await owner.query('DELETE FROM preferences WHERE tenant_id = ANY($1)', [made]);
  await owner.query('DELETE FROM facts WHERE tenant_id = ANY($1)', [made]);
  await removeTenants(owner, made);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('rules a person made', () => {
  it('two wants tied to one question each keep their own rule', async () => {
    expect((await post(wantRoutes, '/v1/me/wants/question', me, { want: 'A saver', questionId: MONEY.id, accepted: [SAVE] })).status).toBe(200);
    expect((await post(wantRoutes, '/v1/me/wants/question', me, { want: 'Someone who pays off their debts', questionId: MONEY.id, accepted: [PAY] })).status).toBe(200);

    const { wants } = await (await wantRoutes.request('/v1/me/wants', { headers: H(me) })).json() as
      { wants: { text: string; accepted: string[] | null; rule: { id: string } | null }[] };
    const saver = wants.find((w) => w.text === 'A saver')!;
    const payer = wants.find((w) => w.text === 'Someone who pays off their debts')!;
    expect(saver.rule, 'the second want overwrote the first one\'s rule').not.toBeNull();
    expect(payer.rule).not.toBeNull();
    expect(saver.rule!.id).not.toBe(payer.rule!.id);
    const { rows } = await owner.query<{ source_quote: string; value: string[] }>(
      `SELECT source_quote, value FROM preferences WHERE user_id = $1 AND predicate = $2 AND retired_at IS NULL ORDER BY source_quote`,
      [me.userId, MONEY.predicate]);
    expect(rows.map((r) => [r.source_quote, r.value])).toEqual([
      ['A saver', [SAVE]], ['Someone who pays off their debts', [PAY]]]);
  });

  it('can be removed, a must-have too -- and only by its owner', async () => {
    const { rows } = await owner.query<{ id: string }>(
      `SELECT id FROM preferences WHERE user_id = $1 AND source_quote = 'A saver' AND retired_at IS NULL`, [me.userId]);
    const id = rows[0]!.id;
    expect((await post(datingRoutes, '/v1/preferences/strength', me, { id, strength: 'dealbreaker' })).status).toBe(200);

    const stranger = await person();
    expect((await post(datingRoutes, '/v1/preferences/remove', stranger, { id })).status, 'somebody else removed her rule').toBe(404);

    expect((await post(datingRoutes, '/v1/preferences/remove', me, { id })).status).toBe(200);
    const after = await owner.query<{ retired_at: Date | null }>('SELECT retired_at FROM preferences WHERE id = $1', [id]);
    expect(after.rows[0]!.retired_at, 'the must-have is still live').not.toBeNull();
    const list = await (await datingRoutes.request('/v1/preferences', { headers: H(me) })).json() as { preferences: { id: string }[] };
    expect(list.preferences.map((x) => x.id)).not.toContain(id);
  });
});
