/**
 * Wants checked against the right question, not guessed from a label.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-26): for each want, find the question the other
 * person answers -- facts and situations, never labels ("You get an unexpected ₹50,000.
 * What happens to most of it?", not "Do you save money?") -- from a bank that grows.
 *
 * WHAT IS PINNED HERE:
 *   - the bank: every situation option is stored exactly as offered (a tapped answer
 *     goes through deriveValue, which turns "save_invest" into "save-invest" -- an
 *     option not already in that form could never match a stored answer, and a
 *     must-have on it would hide everyone who answered); none asks for a label; and
 *     onboarding never asks one;
 *   - a want finds its question by code, and a want that fits none is left a sentence;
 *   - the routes: a want tied to its question writes an ordinary rule from the person's
 *     own ticks, nothing ticked for them, every answer ticked is no rule, only their own
 *     wants, and stopping retires the rule;
 *   - in a round a tied want is checked BY CODE against the other person's tapped answer
 *     -- met, not met, or can't check yet -- and never reaches the model.
 *
 * Negative controls, run 2026-09-26, each restored byte-identical:
 *   - a situation option written as "save_invest"            -> "stored as offered" and
 *     the three route/round tests fail
 *   - next-question.ts without the situation exclusion         -> "never asked by
 *     onboarding" fails (its first version read a count the picker never returned --
 *     it passed without the exclusion, and was rewritten)
 *   - checkWants sending tied wants to the model              -> "never sends it to the
 *     model" fails
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({ prompts: [] as string[] }));
vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real,
    decideModel: () => null,
    modelFor: () => 'google:gemini-3.5-flash-lite',
    llm: {
      ...real.llm,
      complete: async (req: { messages: { content: string }[] }) => {
        stub.prompts.push(req.messages.map((m) => m.content).join('\n'));
        return {
          text: '', parsed: { checks: [], cards: [] },
          usage: { inputTokens: 0, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
                   reasoningTokens: 0, provider: 'google', modelId: 'x', costUsd: 0, latencyMs: 0 },
        };
      },
      decide: async () => { throw new Error('no model in this test'); },
    },
  };
});

const { deriveValue } = await import('@clone/shared');
const { env } = await import('../src/env.js');
const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { commit } = await import('../src/memory/facts.js');
const { SITUATIONS, QUESTIONS, BY_ID } = await import('../src/onboarding/questions.js');
const { nextQuestion } = await import('../src/onboarding/next-question.js');
const { questionForWant, WANT_QUESTIONS } = await import('../src/matching/want-questions.js');
const { checkWants, loadWants } = await import('../src/matching/wants.js');
const { wantRoutes } = await import('../src/api/wants.js');
const { interviewRoutes } = await import('../src/api/interview.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
beforeEach(() => { stub.prompts.length = 0; });
afterAll(async () => {
  if (made.length) {
    await owner.query('DELETE FROM facts WHERE tenant_id = ANY($1)', [made]);
    await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  }
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('the bank', () => {
  it('stores every situation answer exactly as it offers it', () => {
    expect(SITUATIONS.length).toBeGreaterThanOrEqual(8);
    for (const q of SITUATIONS) {
      for (const o of q.options) {
        expect(deriveValue(q.predicate, o.value), `${q.id} offers "${o.value}" but would store something else`).toBe(o.value);
      }
    }
    // And every question a want can be tied to.
    for (const w of WANT_QUESTIONS) {
      const q = BY_ID.get(w.questionId)!;
      for (const o of q.options) expect(deriveValue(q.predicate, o.value), `${q.id}: ${o.value}`).toBe(o.value);
    }
  });

  it('asks about situations and facts, never for a label', () => {
    for (const q of SITUATIONS) {
      expect(q.text, q.id).not.toMatch(/^(are|do|would) you\b/i);
      expect(q.topic, q.id).toBeTruthy();
      expect(q.declinable, q.id).toBe(true);
    }
  });

  it('is never asked by onboarding, nor counted as still to ask', async () => {
    // Everything answered but the one sentence question, which the picker returns without
    // scoring -- so `remaining` is exactly what onboarding thinks is left.
    const all = new Set(QUESTIONS.filter((q) => q.tier !== 'situation' && q.id !== 'q-dealbreaker').map((q) => q.id));
    const zero = '00000000-0000-0000-0000-000000000000';
    const next = await tenantSession({ tenantId: zero, userId: zero }, (db) => nextQuestion(db, zero, all, [], new Set()));
    expect(next?.question.id).toBe('q-dealbreaker');
    expect(next?.remaining, 'situation questions counted as still to ask in onboarding').toBe(1);
  });
});

describe('a want finds its question', () => {
  it.each([
    ['a saver, not an impulse spender', 'sit-windfall'],
    ['okay with street food, small shops', 'sit-street-food'],
    ['Software engineer working on AI', 'q-works-in'],
    ['Someone who reads', 'sit-last-book'],
    ['Must love dogs', 'sit-pet-sitting'],
    ['Loves to travel', 'sit-long-weekend'],
    ['Someone who cooks', 'sit-weeknight-dinner'],
  ])('"%s" -> %s', (want, id) => {
    expect(questionForWant(want)?.question.id).toBe(id);
  });

  it.each(['someone kind and funny', 'a good listener', 'emotionally mature'])('"%s" stays a sentence', (want) => {
    expect(questionForWant(want)).toBeNull();
  });
});

interface P { tenantId: string; userId: string; token: string }
async function person(label: string, seeking?: string): Promise<P> {
  const tag = `wq-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  await owner.query(`INSERT INTO match_profile (user_id, tenant_id, in_pool, intent) VALUES ($1,$2,false,$3)`, [userId, tenantId, [tag]]);
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  const p = { tenantId, userId, token: mintToken(sessionId) };
  if (seeking) {
    await tenantSession(p, (db) => commit(db, p, {
      predicate: 'seeking', objectText: seeking, stance: 'asserted', originClass: 'owner', sourceQuote: seeking,
      sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }));
  }
  return p;
}
const H = (p: P) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' });
const SAVER = 'I want a saver, not an impulse spender';
const KIND = 'Someone kind and funny';
type WantsBody = { wants: { text: string; question: { id: string } | null; accepted: string[] | null; rule: { strength: string } | null }[] };
const wantsOf = async (p: P) => ((await (await wantRoutes.request('/v1/me/wants', { headers: H(p) })).json()) as WantsBody).wants;
const tie = (p: P, want: string, questionId: string, accepted: string[]) =>
  wantRoutes.request('/v1/me/wants/question', { method: 'POST', headers: H(p), body: JSON.stringify({ want, questionId, accepted }) });
const rules = async (p: P) => (await owner.query<{ predicate: string; value: string[]; strength: string; source_quote: string }>(
  `SELECT predicate, value, strength, source_quote FROM preferences WHERE user_id = $1 AND retired_at IS NULL`, [p.userId])).rows;

describe('the routes', () => {
  it('shows each want with its question, nothing ticked, and ties it from the person’s own ticks', async () => {
    const me = await person('me', `${SAVER}. ${KIND}.`);
    const before = await wantsOf(me);
    expect(before.find((w) => w.text === SAVER)).toMatchObject({ question: { id: 'sit-windfall' }, accepted: null, rule: null });
    expect(before.find((w) => w.text === KIND)).toMatchObject({ question: null });

    expect((await tie(me, SAVER, 'sit-windfall', ['save-invest', 'pay-off'])).status).toBe(200);
    expect(await rules(me)).toEqual([{ predicate: 'money_windfall', value: ['save-invest', 'pay-off'], strength: 'strong', source_quote: SAVER }]);
    expect((await wantsOf(me)).find((w) => w.text === SAVER)).toMatchObject({ accepted: ['save-invest', 'pay-off'], rule: { strength: 'strong' } });
  });

  it('every answer ticked is no rule; only your own wants; only real answers; stopping retires it', async () => {
    const me = await person('me2', `${SAVER}.`);
    const all = BY_ID.get('sit-windfall')!.options.map((o) => o.value);
    expect((await tie(me, SAVER, 'sit-windfall', all)).status).toBe(200);
    expect(await rules(me), 'a rule that accepts everybody was written').toEqual([]);
    expect((await tie(me, 'someone else’s want', 'sit-windfall', ['save-invest'])).status).toBe(404);
    expect((await tie(me, SAVER, 'sit-windfall', ['lottery'])).status).toBe(400);
    expect((await tie(me, SAVER, 'sit-windfall', [])).status).toBe(400);
    expect((await tie(me, SAVER, 'sit-windfall', ['save-invest'])).status).toBe(200);
    await wantRoutes.request('/v1/me/wants/question/clear', { method: 'POST', headers: H(me), body: JSON.stringify({ want: SAVER }) });
    expect(await rules(me)).toEqual([]);
  });
});

describe('in a round', () => {
  it('checks a tied want by code against the tapped answer, and never sends it to the model', async () => {
    const me = await person('seeker', `${SAVER}.`);
    await tie(me, SAVER, 'sit-windfall', ['save-invest', 'pay-off']);
    const wants = await loadWants(me);
    expect(wants[0]!.ask).toMatchObject({ questionId: 'sit-windfall', predicate: 'money_windfall' });

    // Three people: one who answered "saved or invested" through the real answer route,
    // one "a treat", one who never answered.
    const saver = await person('saver');
    const treat = await person('treat');
    for (const [who, v] of [[saver, 'save-invest'], [treat, 'treat']] as const) {
      const res = await interviewRoutes.request('/v1/interview/answer', {
        method: 'POST', headers: H(who), body: JSON.stringify({ questionId: 'sit-windfall', values: [v] }) });
      expect(res.status).toBe(200);
    }
    const traitsOf = async (p: P) => (await owner.query<{ traits: Record<string, unknown> }>(
      'SELECT traits FROM match_profile WHERE user_id = $1', [p.userId])).rows[0]!.traits;
    expect((await traitsOf(saver)).money_windfall, 'the stored answer is not the offered value').toBe('save-invest');

    const r = await checkWants(me, wants, [[], [], []], [await traitsOf(saver), await traitsOf(treat), {}]);
    expect(r!.results.map((x) => x[0]!.status)).toEqual(['met', 'not_met', 'cant_check']);
    expect(r!.results.every((x) => x[0]!.quote === null && x[0]!.question === 'sit-windfall')).toBe(true);
    expect(stub.prompts.join('\n'), 'a tied want was sent to the model').not.toContain(SAVER);
  });
});
