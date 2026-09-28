/**
 * What the clone learns from, and what it recalls as "things they said before": the
 * person's own words, never the clone's.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-28, item 3): "the extractor must read only the
 * person's own messages, never the clone's."
 *
 * WHAT WAS WRONG (docs/END-TO-END.md 15.2): the extractor was handed the whole
 * conversation, the clone's replies as CLONE lines, so a reply in the first person --
 * "I do stand-up every Friday" -- could come back as a fact about the person. And chat
 * recall searched every episode, the clone's replies included, under the label
 * "Fragments recalled from things they said before".
 *
 * WHAT IS PINNED HERE, with the model and the embeddings stubbed (no call, no cost):
 *   - the model is never shown a clone's line, whoever calls the extractor;
 *   - a session with nothing the person typed makes no model call, and is recorded;
 *   - facts point at the person's own episodes only;
 *   - recall, by words and by vector, never returns the clone's reply.
 *
 * Negative controls, run 2026-09-28, each restored byte-identical:
 *   - extractSessionFacts without its role filter  -> "never shown a clone's line" fails
 *   - session.ts passing every turn again         -> "points at the person's episodes" fails
 *   - recall's vector channel without role = 'user' -> "by vector" fails
 *   - lexicalOnly without role = 'user'            -> "by words" fails
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({
  calls: 0, seen: [] as string[], parsed: { facts: [], possibly_false: [], intents: [] } as unknown,
  embeddings: false,
}));

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'google:gemini-3.5-flash-lite',
  llm: {
    complete: async (req: { messages: { content: string }[] }) => {
      stub.calls++;
      stub.seen.push(req.messages.map((m) => m.content).join('\n'));
      return {
        text: '', parsed: stub.parsed,
        usage: { inputTokens: 1, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, reasoningTokens: 0,
                 provider: 'google', modelId: 'flash-lite', costUsd: 0, latencyMs: 1 },
      };
    },
  },
}));

// Never a real embedding call from a test: a fixed vector, switched on per test.
const VECTOR = Array.from({ length: 768 }, (_, i) => (i % 7) / 7);
vi.mock('../src/llm/embeddings.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/llm/embeddings.js')>()),
  embeddingsAvailable: () => stub.embeddings,
  embed: async (texts: readonly string[]) => texts.map(() => VECTOR),
}));

const { pool, tenantSession } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { extractSessionFacts } = await import('../src/memory/extract.js');
const { extractSession } = await import('../src/memory/session.js');
const { recall } = await import('../src/memory/retrieval.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
let ctx = { tenantId: '', userId: '' };
const CLONE_SAID = 'I do stand-up comedy every Friday at the Humming Tree';
const THEY_SAID = 'I love hiking in Coorg when the rain stops';

async function turn(sessionId: string, role: 'user' | 'assistant', text: string, idx: number): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO episodes (tenant_id, user_id, session_id, turn_id, turn_index, role, source, raw_text,
                           occurred_at, ingested_at, embedding)
     VALUES ($1,$2,$3,gen_random_uuid(),$4,$5,'text',$6, now(), now(), $7::halfvec) RETURNING id`,
    [ctx.tenantId, ctx.userId, sessionId, idx, role, text, JSON.stringify(VECTOR)]);
  return rows[0]!.id;
}

beforeAll(async () => {
  const tag = `own-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [t.rows[0]!.id, `${tag}@example.test`]);
  ctx = { tenantId: t.rows[0]!.id, userId: u.rows[0]!.id };
});
beforeEach(() => { stub.calls = 0; stub.seen = []; stub.embeddings = false; stub.parsed = { facts: [], possibly_false: [], intents: [] }; });
afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
  await owner.end();
  await pool.end();
});

describe('the extractor reads the person, never the clone', () => {
  it('is never shown a clone\'s line, whoever calls it', async () => {
    await extractSessionFacts({
      transcript: [{ role: 'user', content: THEY_SAID }, { role: 'assistant', content: CLONE_SAID }],
      currentFacts: [], tenantId: ctx.tenantId, userId: ctx.userId,
    }, []);
    expect(stub.calls).toBe(1);
    expect(stub.seen[0]).toContain(`PERSON: ${THEY_SAID}`);
    expect(stub.seen[0], 'the clone\'s reply reached the extractor').not.toContain('stand-up');
    expect(stub.seen[0]).not.toContain('CLONE:');
  });

  it('makes no call at all when the person said nothing', async () => {
    const out = await extractSessionFacts({
      transcript: [{ role: 'assistant', content: CLONE_SAID }], currentFacts: [], tenantId: ctx.tenantId, userId: ctx.userId,
    }, []);
    expect(stub.calls).toBe(0);
    expect(out.candidates).toEqual([]);
  });

  it('a session: facts point at the person\'s episodes; a greeting alone is recorded without a call', async () => {
    const session = crypto.randomUUID();
    const mine = await turn(session, 'user', THEY_SAID, 0);
    await turn(session, 'assistant', CLONE_SAID, 1);
    stub.parsed = { facts: [{ predicate: 'interest', object_text: 'hiking', stance: 'asserted', hedge_span: '',
                              source_quote: 'I love hiking in Coorg', valid_from: '' }], possibly_false: [], intents: [] };
    await extractSession(ctx, session);
    expect(stub.seen.join('\n')).not.toContain('stand-up');
    const { rows } = await owner.query<{ ids: string[] }>(
      `SELECT source_episode_ids AS ids FROM facts WHERE user_id = $1 AND predicate = 'interest' AND object_text = 'hiking'`,
      [ctx.userId]);
    expect(rows.map((r) => r.ids), 'a fact points at the clone\'s reply').toEqual([[mine]]);

    const greeting = crypto.randomUUID();
    await turn(greeting, 'assistant', 'Hi! What should we talk about?', 0);
    stub.calls = 0;
    expect(await extractSession(ctx, greeting)).toBeNull();
    expect(stub.calls).toBe(0);
    const { rows: done } = await owner.query('SELECT 1 FROM session_extractions WHERE user_id = $1 AND session_id = $2',
      [ctx.userId, greeting]);
    expect(done, 'the greeting-only session was not recorded, so it would be read again').toHaveLength(1);
  });
});

describe('"things they said before" are things they said', () => {
  it('by words', async () => {
    const session = crypto.randomUUID();
    await turn(session, 'user', THEY_SAID, 0);
    await turn(session, 'assistant', CLONE_SAID, 1);
    const got = await tenantSession(ctx, (c) => recall(c, ctx.userId, 'stand-up comedy Friday', 5));
    expect(got.map((r) => r.text), 'the clone\'s reply came back as theirs').not.toContain(CLONE_SAID);
    const hiking = await tenantSession(ctx, (c) => recall(c, ctx.userId, 'hiking Coorg', 5));
    expect(hiking.map((r) => r.text)).toContain(THEY_SAID);
  });

  it('by vector', async () => {
    stub.embeddings = true;
    const got = await tenantSession(ctx, (c) => recall(c, ctx.userId, 'what do you do on Fridays', 5));
    expect(got.length, 'the vector channel found nothing at all').toBeGreaterThan(0);
    expect(got.map((r) => r.text), 'the clone\'s reply came back as theirs').not.toContain(CLONE_SAID);
  });
});
