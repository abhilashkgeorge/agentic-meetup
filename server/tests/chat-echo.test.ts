/**
 * Your clone answers what you tell it -- it does not say it back.
 *
 * WHAT WAS WRONG (found on the Pixel, 2026-10-04, as a new test person): "I just started
 * learning the guitar." to her own clone came back as "I just started learning the
 * guitar." -- the model's whole reply, 7 tokens (llm_calls). The prompt said "You are
 * this person's clone ... speaks with their voice", and the style block says "Match
 * this -- their words, their length"; nothing said WHO was writing. So a person telling
 * their clone something new got their own words back, in the chat that setup now ends on
 * ("Talk to me any time from the town").
 *
 * WHAT IS PINNED, with a real turn on the real socket handler and the model stubbed (no
 * spend; embeddings off): the instructions sent to the model say the writer is the
 * person themselves, and to reply to what they say, never with it; and a reply that is
 * their own words is logged, so it can be counted if it ever comes back. Whether the
 * model now does what it is told cannot be seen without a model: that was checked by
 * hand on the Pixel, recorded in the commit.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - the old prompt back -> "who is writing" fails;
 *   - the echo check removed -> "is logged" fails.
 */
import { EventEmitter } from 'node:events';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';

const model = vi.hoisted(() => ({ seen: [] as { instructions?: string }[], reply: '' }));
vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  const refuse = () => { throw new Error('no model in this test'); };
  async function* stream(req: { instructions?: string }) {
    model.seen.push(req);
    yield { type: 'text.delta' as const, text: model.reply };
  }
  return { ...real, llm: { ...real.llm, complete: refuse, stream, decide: refuse } };
});
vi.mock('../src/llm/embeddings.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/embeddings.js')>();
  return { ...real, embeddingsAvailable: () => false, embed: async () => { throw new Error('no embeddings in this test'); } };
});

const { pool, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { log } = await import('../src/log.js');
const { attachChat, sameWords } = await import('../src/api/chat.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  await removeTenants(owner, made);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

/** One person, with turns left today. */
async function person(): Promise<{ tenantId: string; userId: string }> {
  const tag = `echo-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  await owner.query(`INSERT INTO tenant_budget (tenant_id, user_id, day, turns_used, setup_used, cost_usd, turn_cap, daily_cost_cap)
    VALUES ($1,$2,CURRENT_DATE,0,0,0,10,5)`, [tenantId, userId]);
  return { tenantId, userId };
}

/** One turn on the real handler; the frames it sent, once it is done. */
async function turn(ctx: { tenantId: string; userId: string }, text: string): Promise<{ type: string; text?: string }[]> {
  const frames: { type: string; text?: string }[] = [];
  const ws = Object.assign(new EventEmitter(), {
    readyState: 1, OPEN: 1, send: (s: string) => { frames.push(JSON.parse(s)); }, close: () => {},
  });
  attachChat(ws as never, ctx);
  ws.emit('message', Buffer.from(JSON.stringify({
    type: 'turn', turnId: crypto.randomUUID(), sessionId: crypto.randomUUID(), text, source: 'text',
  })));
  await vi.waitFor(() => expect(frames.some((f) => f.type === 'turn.done' || f.type === 'error')).toBe(true), { timeout: 20_000 });
  ws.emit('close');
  return frames;
}

describe('your clone, told something new', () => {
  it('is told who is writing: the person themselves -- and to reply to it, never with it', async () => {
    const me = await person();
    model.seen.length = 0;
    model.reply = 'Nice. Acoustic or electric?';
    const frames = await turn(me, 'I just started learning the guitar.');
    expect(frames.find((f) => f.type === 'turn.done')?.text).toBe('Nice. Acoustic or electric?');
    const said = model.seen[0]?.instructions ?? '';
    expect(said, 'the model is not told who is writing').toContain(
      'The person writing to you is that person, talking to their own clone');
    expect(said).toContain('Never repeat their message back to them.');
  });

  it('saying their own words back is logged, so it can be counted', async () => {
    const me = await person();
    const warn = vi.spyOn(log, 'warn');
    try {
      model.reply = 'I just started learning the guitar.';
      await turn(me, 'I just started learning the guitar.');
      expect(warn.mock.calls.some((c) => c[1] === 'clone said the message back'), 'an echo went unnoticed').toBe(true);
      warn.mockClear();
      model.reply = 'Since when? You never said.';
      await turn(me, 'I just started learning the guitar.');
      expect(warn.mock.calls.some((c) => c[1] === 'clone said the message back'), 'a real reply taken for an echo').toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('the same words: case, spacing and punctuation aside', () => {
    expect(sameWords('I just started learning the guitar.', 'i just  started learning the guitar')).toBe(true);
    expect(sameWords('I just started learning the guitar!', 'I just started learning guitar.')).toBe(false);
    expect(sameWords('', '')).toBe(false);
    expect(sameWords('...', '!!!')).toBe(false);
  });
});
