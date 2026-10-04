/**
 * A story written while setting up is read on setup's count, never the day's ten.
 *
 * THE RULE (the founder, 2026-09-28): "setup and onboarding calls shouldn't count
 * against the 10-calls-a-day limit" (setup-calls.test.ts).
 *
 * WHAT WAS WRONG (the Pixel, 2026-10-04, a new test person in the setup chat): a story
 * is saved word for word with no model, but in a session of its own that the sweeper
 * reads five minutes later for anything else it says -- an ordinary learning call, on
 * the ten that chat, learning and rounds share (llm_calls 04:41, her story). The setup
 * chat offers three: three of a new person's ten turns before they have said a word to
 * anybody.
 *
 * WHAT IS PINNED, with the model stubbed and counted: a story sent with `setup` is read
 * at once and counted as setup, and the sweeper's later pass over it calls no model; a
 * story from the Stories screen (no `setup`) is not read at save, as before.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - the route not reading a setup story -> "read at once, as setup" fails;
 *   - extractSession ignoring `setup` -> "counted as setup" fails.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({ calls: 0 }));
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
        const usage = { inputTokens: 1, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1,
                        reasoningTokens: 0, provider: 'google', modelId: 'x', costUsd: 0.0001, latencyMs: 0 };
        // What the real wrapper does with every call: tell the open meter (metering.ts).
        const { noteUsage } = await import('../src/metering.js');
        noteUsage(usage, 'stub');
        return { text: '', parsed: { facts: [], possibly_false: [], intents: [] }, usage };
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
const { pool, closeMatchPool } = await import('../src/db/client.js');
const { extractSession } = await import('../src/memory/session.js');
const { storyRoutes } = await import('../src/api/stories.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 60_000 });
beforeEach(() => { stub.calls = 0; });

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
  const tag = `story-${Date.now()}-${Math.random()}`;
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
const today = async (p: P) => (await owner.query<{ turns_used: number; setup_used: number }>(
  'SELECT turns_used, setup_used FROM tenant_budget WHERE user_id = $1 AND day = CURRENT_DATE', [p.userId])).rows[0]
  ?? { turns_used: 0, setup_used: 0 };
/** The story's own session: the one its episode is in. */
const sessionOf = async (p: P, text: string) => (await owner.query<{ session_id: string }>(
  'SELECT session_id FROM episodes WHERE user_id = $1 AND raw_text = $2', [p.userId, text])).rows[0]!.session_id;

const SUNDAY = 'A long trek up Nandi Hills at dawn, then dosa and a nap.';

describe('a story written in the setup chat', () => {
  it('is read at once, as setup -- and the sweeper later calls no model for it', async () => {
    const me = await person();
    const res = await storyRoutes.request('/v1/stories', {
      method: 'POST', headers: H(me), body: JSON.stringify({ id: 'story-sunday', text: SUNDAY, setup: true }),
    });
    expect(res.status).toBe(200);
    // Read after the reply: wait for it.
    await vi.waitFor(async () => expect((await today(me)).setup_used, 'the story was not read as setup').toBe(1), { timeout: 10_000 });
    expect((await today(me)).turns_used, 'setting up used one of the day\'s ten').toBe(0);
    expect(stub.calls).toBe(1);

    const again = await extractSession({ tenantId: me.tenantId, userId: me.userId }, await sessionOf(me, SUNDAY));
    expect(again, 'the sweeper read it a second time').toBeNull();
    expect(stub.calls).toBe(1);
  });
});

describe('a story from the Stories screen', () => {
  it('is saved with no model call, as before (the sweeper reads it later, on the ten)', async () => {
    const me = await person();
    const res = await storyRoutes.request('/v1/stories', {
      method: 'POST', headers: H(me), body: JSON.stringify({ id: 'story-sunday', text: SUNDAY }),
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    expect(stub.calls).toBe(0);
    expect(await today(me)).toMatchObject({ turns_used: 0, setup_used: 0 });
  });
});
