/**
 * "Is typing" can never use up the allowance a real message needs (api/chat.ts).
 *
 * WHAT WAS WRONG (the Pixel, 2026-10-02, the release app): the app sent "is typing" on
 * every keystroke, and every frame on the socket counted against one limit, sixty a
 * minute. Typing a 74-character first message used the minute up; the message itself
 * was refused with "Slow down a moment" and sat on "sending" for good. Measured: zero
 * rows in `messages` for the conversation, twenty rate_limited frames in the phone's log.
 *
 * WHAT IS PINNED, on the real socket handler: a hundred typing frames, then a message
 * -- the message is stored and echoed, and nothing is refused. And a frame that only
 * starts like a typing frame (a second "type" key further on) is not a way to send a
 * message on the typing allowance.
 *
 * Negative control, run by hand and recorded in the commit: chat.ts without the typing
 * branch -> "gets through" fails (the send is refused, nothing is stored).
 */
import { EventEmitter } from 'node:events';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  const refuse = () => { throw new Error('no model in this test'); };
  return { ...real, llm: { ...real.llm, complete: refuse, stream: refuse, decide: refuse } };
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

async function person(label: string) {
  const tag = `typing-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `${tag}@example.test`]);
  return { tenantId, userId: u.rows[0]!.id };
}

type Frame = { type: string; code?: string; message?: { id: string } };

describe('a long first message, typed', () => {
  it('gets through after a hundred "is typing" frames, and nothing is refused', async () => {
    const me = await person('me');
    const them = await person('them');
    const [a, b] = me.userId < them.userId ? [me, them] : [them, me];
    const r = await owner.query<{ id: string }>(
      `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, status)
       VALUES ($1,$2,$3,$4,'introduced') RETURNING id`, [a.userId, b.userId, a.tenantId, b.tenantId]);
    const rendezvousId = r.rows[0]!.id;

    const frames: Frame[] = [];
    const ws = Object.assign(new EventEmitter(), {
      readyState: 1, OPEN: 1, send: (s: string) => { frames.push(JSON.parse(s)); }, close: () => {},
    });
    attachChat(ws as never, me);
    const frame = (o: object) => ws.emit('message', Buffer.from(JSON.stringify(o)));

    for (let i = 0; i < 100; i++) frame({ type: 'dm.typing', rendezvousId, typing: i % 2 === 0 });
    const messageId = crypto.randomUUID();
    frame({ type: 'dm.send', messageId, rendezvousId, text: 'Hi! Our agents say we both want something long-term. Coffee this weekend?' });

    // A frame that starts like a typing frame and is something else underneath.
    const sneaked = crypto.randomUUID();
    ws.emit('message', Buffer.from(
      `{"type":"dm.typing","type":"dm.send","messageId":"${sneaked}","rendezvousId":"${rendezvousId}","text":"sneaked"}`));

    await vi.waitFor(() => expect(frames.some((f) => f.type === 'dm.message' || f.code === 'rate_limited')).toBe(true),
      { timeout: 20_000 });
    // Give anything else in flight a moment to land before reading the database.
    await new Promise((res) => setTimeout(res, 500));
    ws.emit('close');

    expect(frames.filter((f) => f.code === 'rate_limited'), 'a frame was refused').toEqual([]);
    expect(frames.find((f) => f.type === 'dm.message')?.message?.id).toBe(messageId);
    const stored = await owner.query<{ id: string }>('SELECT id FROM messages WHERE rendezvous_id = $1', [rendezvousId]);
    expect(stored.rows.map((m) => m.id), 'the message was not stored, or the sneaked one was').toEqual([messageId]);
  }, 30_000);
});
