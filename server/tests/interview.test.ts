/**
 * The interview turns answers into rules. These are the ways it turned them into the
 * WRONG rule.
 *
 * THE "SAME AS ME" QUESTIONS, and why they are gone. Four preference questions in the
 * bank ("Would it be a problem if they ate differently from you?", "Could you be with
 * a smoker?" and two like them) did not name a value. Their answer was a STRENGTH --
 * "yes I couldn't", "I'd prefer they matched" -- and the value the rule was about was
 * copied from the person's own answer on the paired fact. That was wrong twice over:
 * with no fact to copy it once wrote the strength word itself (`diet in
 * ["dealbreaker"]`, a rule nobody passes), and with a fact it wrote the person's OWN
 * answer, so a daily smoker who said "No" to "Could you be with a smoker?" got
 * `smoking in ["daily"]`, a rule only daily smokers pass. The core cards replaced all
 * four; core-cards.test.ts pins what they write. What is pinned here is that the old
 * questions cannot come back, and that the one preference question left still works.
 *
 * No model is called: every question exercised here is chips, and the only model call
 * in this route is for the free-text dealbreaker, which these tests do not touch.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { interviewRoutes } from '../src/api/interview.js';
import { mintToken, newSessionId } from '../src/tokens.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

async function person(): Promise<{ tenantId: string; userId: string; token: string }> {
  const tag = `iv-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

const answer = (token: string, questionId: string, values: string[]) =>
  interviewRoutes.request('/v1/interview/answer', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-forwarded-for': '203.0.113.21',
    },
    body: JSON.stringify({ questionId, values }),
  });

const prefsOf = async (userId: string) =>
  (await owner.query<{ predicate: string; operator: string; value: unknown; strength: string }>(
    `SELECT predicate, operator, value, strength FROM preferences
      WHERE user_id = $1 AND retired_at IS NULL ORDER BY predicate`, [userId])).rows;

describe('the interview', () => {
  it('no longer holds the "same as me" questions, or the fact questions the cards replaced', async () => {
    const { BY_ID } = await import('../src/onboarding/questions.js');
    const me = await person();
    for (const id of [
      'q-diet-pref', 'q-kids-pref', 'q-smoke-pref', 'q-religion-pref',
      'q-kids', 'q-monogamy', 'q-smoke', 'q-drink', 'q-diet',
    ]) {
      expect(BY_ID.has(id), `${id} is still in the bank`).toBe(false);
      // And an app still holding the old id gets a refusal, not a rule.
      const res = await answer(me.token, id, ['dealbreaker']);
      expect(res.status, id).toBe(400);
    }
    expect(await prefsOf(me.userId)).toEqual([]);
  });

  it('holds no preference question whose answer is a strength rather than a value', async () => {
    // A strength answer has to borrow its value from somewhere, and borrowing it is
    // exactly the bug above. Every preference question left must name its own values.
    const { QUESTIONS } = await import('../src/onboarding/questions.js');
    const strengths = new Set(['dealbreaker', 'strong', 'none']);
    for (const q of QUESTIONS.filter((x) => x.kind === 'preference')) {
      expect(q.multi, `${q.id} is a single-choice preference`).toBe(true);
      for (const o of q.options) {
        expect(strengths.has(o.value), `${q.id} offers the strength "${o.value}"`).toBe(false);
      }
    }
  });

  it('drops "anything" from a rule that names the fields they would like', async () => {
    // q-works-pref is the one preference question whose answer IS the wanted values,
    // and it carries an "anything" option. Stored, it is a field nobody works in.
    const me = await person();
    await answer(me.token, 'q-works-in', ['ai']);
    expect((await answer(me.token, 'q-works-pref', ['ai', 'anything'])).status).toBe(200);

    const works = (await prefsOf(me.userId)).find((p) => p.predicate === 'works_in');
    expect(works, 'the rule was not written at all').toBeDefined();
    expect(works!.value).toEqual(['ai']);
  });

  it('writes nothing when the only thing they picked was "anything"', async () => {
    const me = await person();
    await answer(me.token, 'q-works-in', ['ai']);
    expect((await answer(me.token, 'q-works-pref', ['anything'])).status).toBe(200);
    expect((await prefsOf(me.userId)).find((p) => p.predicate === 'works_in')).toBeUndefined();
  });

  it('walks basics, cards, sentence, then the preference that names its own values', async () => {
    // The whole order, end to end, skipping everything that can be skipped. A multi
    // preference names its own values and stands on its own, so it is still offered
    // after its fact was skipped.
    const me = await person();
    await answer(me.token, 'q-gender', ['man']);
    await answer(me.token, 'q-seeking', ['woman']);
    await answer(me.token, 'q-intent', ['long_term']);
    await answer(me.token, 'q-works-in', []);

    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      const res = await interviewRoutes.request('/v1/interview/next', {
        headers: { Authorization: `Bearer ${me.token}`, 'x-forwarded-for': '203.0.113.21' },
      });
      const body = await res.json() as { question: { id: string; tier: string } | null };
      if (!body.question) break;
      seen.push(body.question.id);
      const res2 = await interviewRoutes.request('/v1/interview/answer', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${me.token}`, 'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.21',
        },
        body: JSON.stringify({
          questionId: body.question.id, values: [],
          ...(body.question.tier === 'core' ? { whoFine: { anyone: true } } : {}),
        }),
      });
      expect(res2.status, body.question.id).toBe(200);
    }
    expect(seen).toEqual([
      'card-kids', 'card-monogamy', 'card-smoking', 'card-drinking', 'card-food',
      // The optional faith card (2026-09-25), straight after the five.
      'card-faith',
      'q-dealbreaker', 'q-works-pref',
    ]);
  });

  it('refuses to finish the three questions the pool cannot run without', async () => {
    const me = await person();
    for (const id of ['q-gender', 'q-seeking', 'q-intent']) {
      const res = await answer(me.token, id, []);
      expect(res.status, `${id} let itself be skipped`).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'required' });
    }
  });
});
