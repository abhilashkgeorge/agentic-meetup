/**
 * When chat hits the day's limit, it says so clearly (the founder, 2026-09-29: "when chat
 * hits the limit, say so clearly").
 *
 * WHAT WAS WRONG: the ten turns a day are shared by chat, learning and rounds (setup is
 * counted apart since 2026-09-28: setup-calls.test.ts). When they ran out mid-chat, the
 * server said "You have hit today's turn limit." or "That is enough for today. Try again
 * tomorrow." -- and the app showed neither (app tests/turn-note.test.ts).
 *
 * WHAT IS PINNED, with a real chat turn on the real socket handler, the day's ten used:
 * the answer is the budget error, in words that say it is the day's limit, that chat,
 * learning and rounds share it, how many, and that it comes back tomorrow -- and no model
 * is called. Embeddings are stubbed too: this test must not spend anything.
 *
 * Negative control, run by hand and recorded in the commit: the old message back in
 * chat.ts -> "says so clearly" fails.
 */
import { EventEmitter } from 'node:events';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  const refuse = () => { calls.n++; throw new Error('no model in this test'); };
  return { ...real, llm: { ...real.llm, complete: refuse, stream: refuse, decide: refuse } };
});
vi.mock('../src/llm/embeddings.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/embeddings.js')>();
  return { ...real, embeddingsAvailable: () => false, embed: async () => { throw new Error('no embeddings in this test'); } };
});

const { pool, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { attachChat } = await import('../src/api/chat.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  await removeTenants(owner, made);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('chat, once the day\'s turns are used', () => {
  it('says so clearly: the day\'s limit, shared, how many, back tomorrow -- and calls no model', async () => {
    const tag = `limit-${Date.now()}-${Math.random()}`;
    const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
    const tenantId = t.rows[0]!.id; made.push(tenantId);
    const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
      [tenantId, `${tag}@example.test`]);
    const userId = u.rows[0]!.id;
    await owner.query(`INSERT INTO tenant_budget (tenant_id, user_id, day, turns_used, setup_used, cost_usd, turn_cap, daily_cost_cap)
      VALUES ($1,$2,CURRENT_DATE,10,0,0,10,5)`, [tenantId, userId]);

    const frames: { type: string; code?: string; message?: string }[] = [];
    const ws = Object.assign(new EventEmitter(), {
      readyState: 1, OPEN: 1, send: (s: string) => { frames.push(JSON.parse(s)); }, close: () => {},
    });
    attachChat(ws as never, { tenantId, userId });
    ws.emit('message', Buffer.from(JSON.stringify({
      type: 'turn', turnId: crypto.randomUUID(), sessionId: crypto.randomUUID(), text: 'what should I cook tonight?', source: 'text',
    })));
    await vi.waitFor(() => expect(frames.some((f) => f.type === 'error')).toBe(true), { timeout: 20_000 });
    ws.emit('close');

    const err = frames.find((f) => f.type === 'error')!;
    expect(err.code).toBe('budget_exceeded');
    expect(err.message, 'the limit was not said clearly').toBe(
      "That's all for today. Chat, learning and your agent's rounds share 10 turns a day, and today's are used up. "
      + 'Your clone can talk again tomorrow.');
    expect(calls.n, 'a model was called past the limit').toBe(0);
  });
});
