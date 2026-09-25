/**
 * A sentence never changes a card answer. It waits for a Yes.
 *
 * THE BUG THIS EXISTS FOR. Chat, "tell" and a pasted export all run one extractor, and
 * it marked every fact it found as the person's own word (extract.ts, originClass
 * 'owner'). On a single-valued field that superseded whatever the person had TAPPED:
 * a card that said "drinks sometimes", followed by "I drink socially, most weekends"
 * said in passing to the clone, became whatever the extractor made of it -- and every
 * other person's drinking rule was then tested against the extractor's guess instead
 * of the answer the person gave. Found reading memory/facts.ts:170-185 (the
 * supersession) against extract.ts:223 (the origin) in the phase 1 review.
 *
 * THE FIX, pinned here -- spec guard (c): on the basics and the five cards
 * (TAPPED_PREDICATES), a sentence is staged, the tapped answer stands, the staged fact
 * is asked about one at a time on the You screen (never swept into the keep-all pile),
 * and a Yes makes it the answer. Everywhere else a sentence is learned as before.
 *
 * The model is stubbed: the extractor returns what `stub.parsed` says.
 *
 * Negative controls, run by hand:
 *   - extract.ts marking every fact 'owner' again        -> "stands until the person
 *                                                           says yes" fails
 *   - pendingConfirmation back to hard predicates only    -> "asks about it on its own"
 *                                                           fails (drinking is soft, so
 *                                                           it fell into the pile)
 *   - tell counting a staged fact as learned              -> "says so" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({ parsed: {} as unknown }));

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real,
    decideModel: () => null,
    modelFor: () => 'google:gemini-3.5-flash-lite',
    llm: {
      ...real.llm,
      complete: async () => ({
        text: '', parsed: stub.parsed,
        usage: {
          inputTokens: 0, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
          reasoningTokens: 0, provider: 'google', modelId: 'x', costUsd: 0, latencyMs: 0,
        },
      }),
      decide: async () => { throw new Error('no model in this test'); },
    },
  };
});

const { pool, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { interviewRoutes } = await import('../src/api/interview.js');
const { tellRoutes } = await import('../src/api/tell.js');
const { knowledgeRoutes } = await import('../src/api/profile.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) {
    // Facts and episodes first: a tenant delete does not reach them in every table.
    await owner.query('DELETE FROM facts WHERE tenant_id = ANY($1)', [made]);
    await owner.query('DELETE FROM episodes WHERE tenant_id = ANY($1)', [made]);
    await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  }
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

type Person = { tenantId: string; userId: string; token: string };

async function person(label: string): Promise<Person> {
  const tag = `stg-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

const headers = (p: Person) => ({
  Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.59',
});

const fact = (text: string, predicate: string, objectText: string) => ({
  predicate, object_text: objectText, stance: 'asserted', hedge_span: '', source_quote: text, valid_from: '',
});

/** The live value of a field, and any staged ones waiting behind it. */
async function drinking(userId: string) {
  const { rows } = await owner.query<{ status: string; object_text: string; origin_class: string }>(
    `SELECT status, object_text, origin_class FROM facts
      WHERE user_id = $1 AND predicate = 'drinking' AND valid_to IS NULL AND status IN ('active','staged')
      ORDER BY status`, [userId]);
  return { live: rows.filter((r) => r.status === 'active').map((r) => r.object_text),
           staged: rows.filter((r) => r.status === 'staged') };
}

const tell = async (p: Person, text: string) => {
  const res = await tellRoutes.request('/v1/tell', {
    method: 'POST', headers: headers(p), body: JSON.stringify({ text, sessionId: crypto.randomUUID() }),
  });
  expect(res.status).toBe(200);
  return await res.json() as { learned: number; toConfirm: number; message: string };
};

describe('(c) a card answer, then a sentence that disagrees', () => {
  it('stands until the person says yes -- and a sentence about anything else is learned at once', async () => {
    const me = await person('socially');
    const card = await interviewRoutes.request('/v1/interview/answer', {
      method: 'POST', headers: headers(me),
      body: JSON.stringify({ questionId: 'card-drinking', values: ['sometimes'], whoFine: { anyone: true } }),
    });
    expect(card.status).toBe(200);
    expect((await drinking(me.userId)).live).toEqual(['sometimes']);

    const said = 'I drink socially, most weekends really. And I have got into bouldering.';
    stub.parsed = {
      facts: [fact(said, 'drinking', 'often'), fact(said, 'interest', 'bouldering')],
      possibly_false: [], intents: [],
    };
    const told = await tell(me, said);

    // The tapped answer stands, and the sentence waits behind it.
    const after = await drinking(me.userId);
    expect(after.live, 'a sentence replaced a card answer').toEqual(['sometimes']);
    expect(after.staged).toEqual([{ status: 'staged', object_text: 'often', origin_class: 'untrusted' }]);

    // Not over-staged: a field nobody taps is still learned straight away.
    const { rows: interest } = await owner.query<{ status: string }>(
      `SELECT status FROM facts WHERE user_id = $1 AND predicate = 'interest' AND object_text = 'bouldering'`,
      [me.userId]);
    expect(interest.map((r) => r.status)).toEqual(['active']);

    // And the person is told which is which, not that both were learned.
    expect(told.learned).toBe(1);
    expect(told.toConfirm).toBe(1);
    expect(told.message).toMatch(/to check/);
  });

  it('asks about it on its own, never in the keep-everything pile, and a Yes makes it the answer', async () => {
    const me = await person('confirms');
    await interviewRoutes.request('/v1/interview/answer', {
      method: 'POST', headers: headers(me),
      body: JSON.stringify({ questionId: 'card-drinking', values: ['sometimes'], whoFine: { anyone: true } }),
    });
    const said = 'Honestly I drink most days now.';
    stub.parsed = { facts: [fact(said, 'drinking', 'daily')], possibly_false: [], intents: [] };
    await tell(me, said);

    // drinking is a SOFT predicate: the old channel would have put it in the pile that
    // "keep the rest" accepts wholesale.
    const k = await (await knowledgeRoutes.request('/v1/knowledge', { headers: headers(me) })).json() as {
      confirm: { factId: string; claim: string } | null; review: { label: string }[];
    };
    expect(k.confirm?.claim).toMatch(/drinking/);
    expect(k.review.map((r) => r.label)).not.toContain('drinking');

    const yes = await knowledgeRoutes.request('/v1/knowledge/confirm', {
      method: 'POST', headers: headers(me), body: JSON.stringify({ factId: k.confirm!.factId, verdict: 'yes' }),
    });
    expect(yes.status).toBe(200);
    expect((await drinking(me.userId)).live).toEqual(['daily']);
  });

  it('leaves the answer alone when the person says no', async () => {
    const me = await person('declines');
    await interviewRoutes.request('/v1/interview/answer', {
      method: 'POST', headers: headers(me),
      body: JSON.stringify({ questionId: 'card-drinking', values: ['never'], whoFine: { anyone: true } }),
    });
    const said = 'Had a few too many last night!';
    stub.parsed = { facts: [fact(said, 'drinking', 'often')], possibly_false: [], intents: [] };
    await tell(me, said);
    const k = await (await knowledgeRoutes.request('/v1/knowledge', { headers: headers(me) })).json() as {
      confirm: { factId: string } | null;
    };
    await knowledgeRoutes.request('/v1/knowledge/confirm', {
      method: 'POST', headers: headers(me), body: JSON.stringify({ factId: k.confirm!.factId, verdict: 'no' }),
    });
    const after = await drinking(me.userId);
    expect(after.live).toEqual(['never']);
    expect(after.staged).toEqual([]);
  });
});
