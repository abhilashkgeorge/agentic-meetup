/**
 * A new person's ten turns are theirs, not spent by the server behind their back.
 *
 * WHAT WAS WRONG (found on the Pixel, 2026-10-04, as a new test person): after setting
 * up and ONE message to her clone, the clone said "That's all for today" -- the day's ten
 * turns (chat, learning and rounds share them) were used. llm_calls showed whose they
 * were: one was her message. The rest:
 *   - her one true thing, read when she typed it (a setup call), was read AGAIN five
 *     minutes later by the sweeper as an idle chat session: tell never marked its session
 *     read (04:24 and 04:30);
 *   - her answer sheet was built three times at once, twice (04:38, 04:43): opening the
 *     town asked "How you appear" three times for the "Your clone" count, each request
 *     brought the sheet up to date, and each read the old basis and paid for the build.
 *
 * WHAT IS PINNED, with the model stubbed and counted:
 *   - after tell, the sweeper's pass over that session calls no model;
 *   - three builds of one person's sheet at once are one model call;
 *   - the learned list has a read of its own that calls no model, the same list "How you
 *     appear" carries (which, with the sheet out of date, still builds it: the control).
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - tell not marking its session -> "read once" fails;
 *   - ensureSheet without the one-at-a-time map -> "one model call" fails;
 *   - /v1/me/learned bringing the sheet up to date -> "calls no model" fails.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({ parsed: {} as unknown, calls: 0 }));
vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real,
    decideModel: () => null,
    modelFor: () => 'google:gemini-3.5-flash-lite',
    llm: {
      ...real.llm,
      complete: async () => {
        stub.calls++;
        // A model takes a while: long enough for a second caller to arrive mid-build.
        await new Promise((r) => setTimeout(r, 60));
        return {
          text: '', parsed: stub.parsed,
          usage: { inputTokens: 1, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1,
                   reasoningTokens: 0, provider: 'google', modelId: 'x', costUsd: 0, latencyMs: 0 },
        };
      },
      stream: () => { throw new Error('no model in this test'); },
      decide: async () => { throw new Error('no model in this test'); },
    },
  };
});
vi.mock('../src/llm/embeddings.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/embeddings.js')>();
  return { ...real, embeddingsAvailable: () => false, embed: async () => { throw new Error('no embeddings in this test'); } };
});

const { env } = await import('../src/env.js');
const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { commit } = await import('../src/memory/facts.js');
const episodes = await import('../src/memory/episodes.js');
const { ensureSheet } = await import('../src/matching/answer-sheet.js');
const { extractSession } = await import('../src/memory/session.js');
const { tellRoutes } = await import('../src/api/tell.js');
const { meRoutes } = await import('../src/api/me.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 60_000 });
beforeEach(() => { stub.calls = 0; stub.parsed = {}; });

afterAll(async () => {
  if (made.length) {
    await owner.query('DELETE FROM facts WHERE tenant_id = ANY($1)', [made]);
    await owner.query('DELETE FROM episodes WHERE tenant_id = ANY($1)', [made]);
    await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  }
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string; token: string }

async function person(): Promise<P> {
  const tag = `day1-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}
const H = (p: P) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' });

/** A sentence the person typed, kept as a fact: what a sheet and the learned list are made of. */
async function said(p: P, text: string, disclosure?: 'matchable_only'): Promise<string> {
  const ep = await tenantSession(p, (db) => episodes.append(db, {
    tenantId: p.tenantId, userId: p.userId, sessionId: crypto.randomUUID(), turnId: crypto.randomUUID(),
    role: 'user', source: 'text', rawText: text, occurredAt: new Date(),
  }));
  // Read already, as the sweeper would have: these scenes are about the sheet, not learning.
  await owner.query(
    `INSERT INTO session_extractions (tenant_id, user_id, session_id, last_turn_index, facts_staged)
     SELECT tenant_id, user_id, session_id, turn_index, 0 FROM episodes WHERE id = $1`, [ep!.id]);
  const r = await tenantSession(p, (c) => commit(c, p, {
    predicate: 'interest', objectText: text.slice(0, 40), stance: 'asserted', originClass: 'owner', sourceQuote: text,
    sourceEpisodeIds: [ep!.id], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    ...(disclosure ? { disclosure } : {}),
  }));
  return r.factId!;
}

describe('the one true thing', () => {
  it('is read once: the sweeper, passing its session later, calls no model', async () => {
    const me = await person();
    const TABLA = 'I have been learning the tabla for two years';
    stub.parsed = {
      facts: [{ predicate: 'interest', object_text: 'tabla', stance: 'asserted', hedge_span: '', source_quote: TABLA, valid_from: '' }],
      possibly_false: [], intents: [],
    };
    const sessionId = crypto.randomUUID();
    const told = await tellRoutes.request('/v1/tell', { method: 'POST', headers: H(me), body: JSON.stringify({ text: `${TABLA}.`, sessionId }) });
    expect(told.status).toBe(200);
    expect(((await told.json()) as { learned: number }).learned, 'nothing was learned: the scene did not run').toBe(1);
    stub.calls = 0;
    // What the sweeper does once the session has been quiet for five minutes.
    const again = await extractSession({ tenantId: me.tenantId, userId: me.userId }, sessionId);
    expect(again, 'the sentence was read a second time').toBeNull();
    expect(stub.calls, 'a model was called for words already read').toBe(0);
  });
});

describe('the answer sheet', () => {
  it('three builds at once for one person are one model call', async () => {
    const me = await person();
    await said(me, 'Most weekends I am up Nandi Hills before sunrise');
    const who = { tenantId: me.tenantId, userId: me.userId };
    const three = await Promise.all([ensureSheet(who), ensureSheet(who), ensureSheet(who)]);
    expect(stub.calls, 'the same sheet was paid for more than once').toBe(1);
    expect(three.filter((r) => r.built)).toHaveLength(3); // each caller hears of the one build
    // And once built, no call at all until something changes.
    expect(await ensureSheet(who)).toEqual({ built: false, answered: -1 });
    expect(stub.calls).toBe(1);
  });
});

describe('what the clone learned', () => {
  it('has a read of its own that calls no model -- the list "How you appear" carries', async () => {
    const me = await person();
    // A shared sentence, so the sheet is out of date; and one learned, not yet shared.
    await said(me, 'Lately it is all old jazz records on my turntable');
    const id = await said(me, 'I just started learning the guitar', 'matchable_only');
    const res = await meRoutes.request('/v1/me/learned', { headers: H(me) });
    expect(res.status).toBe(200);
    const { learned } = (await res.json()) as { learned: { factId: string; text: string }[] };
    expect(learned.map((l) => l.factId)).toEqual([id]);
    expect(stub.calls, 'reading the learned list called a model').toBe(0);

    // The control: "How you appear", with the sheet out of date, brings it up to date.
    const seen = (await (await meRoutes.request('/v1/me/appearance', { headers: H(me) })).json()) as { learned: unknown };
    expect(stub.calls, 'the scene had nothing to build: the read above proved nothing').toBe(1);
    expect(seen.learned).toEqual(learned);
  });
});
