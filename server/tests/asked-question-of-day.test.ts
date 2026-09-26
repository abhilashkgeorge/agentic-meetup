/**
 * A want's question the other person never answered becomes their question of the day --
 * and never says whose want it was.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-26): "If the other person hasn't answered that
 * question, it becomes their question of the day. Never say who asked."
 *
 * WHAT IS PINNED HERE, through a real round:
 *   - A's want, tied to the ₹50,000 question, meets B who never answered it: B's gap is
 *     recorded, and B's question of the day is that question -- with its topic and a
 *     count, and nothing about A;
 *   - B opens it by id and answers with one tap; it is marked done and not offered again,
 *     and A's want can now be checked;
 *   - a want tied to a many-answer question (the field you work in) is read from the
 *     other person's tags on B's side of a round too. Found building this: B's wants were
 *     checked without A's tags, so such a want could only ever say "can't check yet".
 *
 * Negative controls, run by hand:
 *   - the round without unknownAsksOf                      -> "becomes their question"
 *     fails
 *   - the round's second check without the tags            -> "read from the tags" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'google:gemini-3.5-flash-lite',
  decideModel: () => null,
  llm: {
    complete: async () => { throw new Error('no model in this test'); },
    decide: async () => { throw new Error('no model in this test'); },
  },
}));

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const { runRound } = await import('../src/matching/orchestrator.js');
const { checkWants, loadWants } = await import('../src/matching/wants.js');
const { wantRoutes } = await import('../src/api/wants.js');
const { interviewRoutes } = await import('../src/api/interview.js');
const { questionOfDayRoutes } = await import('../src/api/question-of-day.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 180_000 });

afterAll(async () => {
  if (made.length) {
    await owner.query('DELETE FROM facts WHERE tenant_id = ANY($1)', [made]);
    await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  }
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

type Who = { tenantId: string; userId: string; token: string };
async function person(label: string, over: Record<string, unknown>): Promise<Who> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`aq-${label}-${Date.now()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `aq-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, in_pool: true, is_synthetic: false, sees_synthetic: false,
    display_name: label, ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map((k) => cols[k]));
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}
const H = (p: Who) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' });
const said = (p: Who, predicate: string, text: string) => tenantSession(p, (db) => commit(db, p, {
  predicate, objectText: text, stance: 'asserted', originClass: 'owner', sourceQuote: text,
  sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
}));
const answer = (p: Who, questionId: string, values: string[]) => interviewRoutes.request('/v1/interview/answer', {
  method: 'POST', headers: H(p), body: JSON.stringify({ questionId, values }) });

/** Two people a round will pair: a made-up intent keeps every other test's people out. */
async function pairOf() {
  const tag = `aq-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const a = await person('a', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
  const b = await person('b', { intent: [tag] });
  for (const [who, what] of [[a, 'climbing'], [b, 'pottery']] as const) {
    await said(who, 'interest', what);
  }
  return { a, b };
}

describe('a want’s question, asked of the other person', () => {
  it('becomes their question of the day, never saying whose; one tap answers it; the want can then be checked', async () => {
    const { a, b } = await pairOf();
    const SAVER = 'I want a saver, not an impulse spender';
    await said(a, 'seeking', SAVER);
    expect((await wantRoutes.request('/v1/me/wants/question', {
      method: 'POST', headers: H(a), body: JSON.stringify({ want: SAVER, questionId: 'sit-windfall', accepted: ['save-invest', 'pay-off'] }),
    })).status).toBe(200);

    await runRound(a.userId);
    const { rows: gaps } = await owner.query<{ question_id: string }>('SELECT question_id FROM unknown_asks WHERE user_id = $1', [b.userId]);
    expect(gaps.map((g) => g.question_id), 'the unanswered question was not recorded as theirs').toContain('ask:sit-windfall');

    const qod = await (await questionOfDayRoutes.request('/v1/question-of-day', { headers: H(b) })).json() as {
      question: { id: string; ask: string; count: number; card?: { id: string; topic: string } } | null;
    };
    expect(qod.question).toEqual({
      id: 'ask:sit-windfall', ask: 'You get an unexpected ₹50,000. What happens to most of it?', count: 1,
      card: { id: 'sit-windfall', topic: 'Money' },
    });
    // Never whose want it was: nothing of A anywhere in what B is sent.
    const sent = JSON.stringify(qod);
    for (const x of [a.userId, a.tenantId, 'a', SAVER]) expect(sent.includes(`"${x}"`) || sent.includes(SAVER)).toBe(false);

    // Opened by its id, one tap, done.
    const open = await (await interviewRoutes.request('/v1/interview/next?card=sit-windfall', { headers: H(b) })).json() as { question: { id: string } };
    expect(open.question.id).toBe('sit-windfall');
    expect((await answer(b, 'sit-windfall', ['treat'])).status).toBe(200);
    expect((await questionOfDayRoutes.request('/v1/question-of-day/done', {
      method: 'POST', headers: H(b), body: JSON.stringify({ id: 'ask:sit-windfall' }) })).status).toBe(200);
    const again = await (await questionOfDayRoutes.request('/v1/question-of-day', { headers: H(b) })).json() as { question: { id: string } | null };
    expect(again.question?.id).not.toBe('ask:sit-windfall');

    // And A's want reads B's answer now.
    const { rows: tr } = await owner.query<{ traits: Record<string, unknown> }>('SELECT traits FROM match_profile WHERE user_id = $1', [b.userId]);
    const checked = await checkWants(a, await loadWants(a), [[]], [tr[0]!.traits]);
    expect(checked!.results[0]![0]!.status).toBe('not_met');
  });

  it('reads a many-answer question from the tags on the other side of a round too', async () => {
    const { a, b } = await pairOf();
    // B wants someone in AI; A answered the field question with two fields.
    const AI = 'Software engineer working on AI';
    await said(b, 'seeking', AI);
    await wantRoutes.request('/v1/me/wants/question', {
      method: 'POST', headers: H(b), body: JSON.stringify({ want: AI, questionId: 'q-works-in', accepted: ['ai'] }) });
    // As a fixture, not through the answer route: that rebuilds A's profile from facts,
    // and this A has none for gender or age, so it would leave the pool before the round.
    await owner.query(
      `UPDATE match_profile SET attribute_tags = ARRAY['works_in:software','works_in:ai'],
              traits = traits || '{"works_in":"software"}'::jsonb WHERE user_id = $1`, [a.userId]);

    await runRound(a.userId);
    const { rows } = await owner.query<{ overlap_quotes: { wants?: { want: string; status: string }[] } }>(
      `SELECT b.overlap_quotes FROM rendezvous_briefs b JOIN rendezvous r ON r.id = b.rendezvous_id
        WHERE b.for_user = $1 AND (r.user_a = $2 OR r.user_b = $2)`, [b.userId, a.userId]);
    const row = rows[0]!.overlap_quotes.wants?.find((w) => w.want === AI);
    expect(row?.status, 'B’s want on the field question could not read A’s tags').toBe('met');
  });
});
