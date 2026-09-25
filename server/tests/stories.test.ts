/**
 * Stories: the open questions that give a person's agent something true to say.
 *
 * WHY THEY EXIST (the founder, 2026-09-24): agents that talk to each other invent when
 * they have nothing real to say -- a prompt line forbidding it was already there when
 * one invented a comedy-writer life -- so onboarding asks for material, and the talk
 * (matching/talk.ts) may only repeat sentences the person typed.
 *
 * WHAT IS PINNED HERE:
 *   - an answer becomes a sentence the ordinary quote check accepts: found word for word
 *     in something the person typed, so loadQuotes -- and so the talk -- can use it;
 *   - answering again retires the old answer, kept and never deleted, and only the new
 *     one is quotable;
 *   - an answer that names a private card is saved, flagged, and never quoted;
 *   - unknown stories and answers too short to quote are refused, and nothing calls a
 *     model.
 *
 * Negative controls, run by hand:
 *   - saveStory without the episode                      -> "becomes a sentence" fails
 *   - saveStory writing as the 'interview' extractor     -> "becomes a sentence" fails
 *   - saveStory without retiring the old answer          -> "answering again" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real,
    decideModel: () => null,
    llm: {
      ...real.llm,
      complete: async () => { calls.n++; throw new Error('no model in this test'); },
      decide: async () => { calls.n++; throw new Error('no model in this test'); },
    },
  };
});

const { pool, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { loadQuotes } = await import('../src/matching/brief.js');
const { storyRoutes } = await import('../src/api/stories.js');
const { STORIES } = await import('../src/onboarding/stories.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

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

type Person = { tenantId: string; userId: string; token: string };

async function person(label: string): Promise<Person> {
  const tag = `story-${label}-${Date.now()}-${Math.random()}`;
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

const auth = (p: Person) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' });
const save = (p: Person, id: string, text: string) =>
  storyRoutes.request('/v1/stories', { method: 'POST', headers: auth(p), body: JSON.stringify({ id, text }) });
const list = async (p: Person) => (await (await storyRoutes.request('/v1/stories', { headers: auth(p) })).json()) as {
  stories: { id: string; text: string; answer: { factId: string; text: string; private: boolean } | null }[];
};

const SUNDAY = 'Filter coffee on the balcony, then a long walk in Lalbagh before it gets hot';

describe('stories', () => {
  it('lists them all, none answered yet', async () => {
    const me = await person('list');
    const { stories } = await list(me);
    expect(stories.map((s) => s.id)).toEqual(STORIES.map((s) => s.id));
    expect(stories.every((s) => s.answer === null)).toBe(true);
  });

  it('an answer becomes a sentence the quote check accepts, with no model call', async () => {
    const me = await person('quote');
    calls.n = 0;
    expect((await save(me, 'story-sunday', `  ${SUNDAY}  `)).status).toBe(200);
    const { stories } = await list(me);
    expect(stories.find((s) => s.id === 'story-sunday')?.answer).toMatchObject({ text: SUNDAY, private: false });
    // The same loader every card, sheet and talk reads through.
    const quotes = await loadQuotes(me);
    expect(quotes.map((q) => q.text)).toContain(SUNDAY);
    expect(calls.n, 'saving a story called a model').toBe(0);
  });

  it('answering again retires the old answer -- kept, not deleted -- and only the new one is quoted', async () => {
    const me = await person('again');
    await save(me, 'story-trip', 'Hampi on a bicycle, sleeping on the boulders at sunset');
    await save(me, 'story-trip', 'Next up is Spiti in the winter, if my knees agree');
    const { stories } = await list(me);
    expect(stories.find((s) => s.id === 'story-trip')?.answer?.text).toBe('Next up is Spiti in the winter, if my knees agree');
    const quotes = (await loadQuotes(me)).map((q) => q.text);
    expect(quotes).toContain('Next up is Spiti in the winter, if my knees agree');
    expect(quotes).not.toContain('Hampi on a bicycle, sleeping on the boulders at sunset');
    const { rows } = await owner.query<{ status: string }>(
      `SELECT status FROM facts WHERE user_id = $1 AND predicate = 'prompt_answer' ORDER BY recorded_at`, [me.userId]);
    expect(rows.map((r) => r.status)).toEqual(['superseded', 'active']);
  });

  it('an answer that names a private card is saved and flagged, and never quoted', async () => {
    const me = await person('private');
    const KIDS = 'Honestly I mostly talk about wanting kids some day, and cricket';
    expect((await save(me, 'story-hours', KIDS)).status).toBe(200);
    const { stories } = await list(me);
    expect(stories.find((s) => s.id === 'story-hours')?.answer).toMatchObject({ text: KIDS, private: true });
    expect((await loadQuotes(me)).map((q) => q.text)).not.toContain(KIDS);
  });

  it('refuses an unknown story, and an answer too short to quote', async () => {
    const me = await person('refuse');
    expect((await save(me, 'story-nope', SUNDAY)).status).toBe(400);
    const short = await save(me, 'story-sunday', 'Sleeping');
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ error: 'too_short' });
    const { rows } = await owner.query('SELECT 1 FROM facts WHERE user_id = $1', [me.userId]);
    expect(rows).toHaveLength(0);
  });
});
