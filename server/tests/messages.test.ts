/**
 * Messaging, and the edge cases that make chat look like a major undertaking.
 *
 * Each of these is a bug people actually hit in real apps: a message sent twice after
 * a flaky retry, two messages arriving in the wrong order, a read receipt that never
 * catches up, a blocked person who can still get through. They are the reason "just
 * use a chat platform" is tempting, and they are each a few lines when the database
 * does the work.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, tenantSession, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import * as messages from '../src/messaging/store.js';
import { eraseUser } from '../src/memory/erasure.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
let alice = { tenantId: '', userId: '' };
let bob = { tenantId: '', userId: '' };
let conversation = '';

async function person(label: string) {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`${label}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${label}-${Math.random()}@example.test`]);
  return { tenantId, userId: u.rows[0]!.id };
}

beforeAll(async () => {
  alice = await person('alice');
  bob = await person('bob');
});

beforeEach(async () => {
  // Scoped to this file's own people. A bare DELETE FROM rendezvous here tore the
  // conversation out from under tests/rendezvous.test.ts, which runs at the same time
  // against the same database.
  const mine = [alice.userId, bob.userId];
  await owner.query(
    'DELETE FROM rendezvous WHERE user_a = ANY($1) OR user_b = ANY($1)', [mine]);
  await owner.query(
    'DELETE FROM blocks WHERE blocker_id = ANY($1) OR blocked_id = ANY($1)', [mine]);
  await owner.query(
    'DELETE FROM reports WHERE reporter_id = ANY($1) OR reported_id = ANY($1)', [mine]);
  const [a, b] = alice.userId < bob.userId ? [alice, bob] : [bob, alice];
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, status)
     VALUES ($1,$2,$3,$4,'introduced') RETURNING id`,
    [a.userId, b.userId, a.tenantId, b.tenantId]);
  conversation = rows[0]!.id;
});

afterAll(async () => {
  for (const t of made) await owner.query('DELETE FROM tenants WHERE id = $1', [t]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

const say = (from: typeof alice, to: typeof bob, id: string, body: string) =>
  tenantSession(from, (c) =>
    messages.send(c, {
      id, rendezvousId: conversation, senderId: from.userId, recipientId: to.userId, body,
    }),
  );

describe('sending the same message twice writes it once', () => {
  it('a retry after a dropped response is not a second message', async () => {
    // The phone sends, the response is lost, the phone sends again. Without a
    // client-generated id this is where duplicate bubbles come from.
    const id = crypto.randomUUID();
    const first = await say(alice, bob, id, 'hello');
    const retry = await say(alice, bob, id, 'hello');

    expect(first.fresh).toBe(true);
    expect(retry.fresh).toBe(false);
    expect(retry.message.id).toBe(first.message.id);
    expect(retry.message.seq).toBe(first.message.seq);

    const all = await tenantSession(alice, (c) => messages.history(c, conversation));
    expect(all).toHaveLength(1);
  });
});

describe('order', () => {
  it('gives every message a distinct, increasing position', async () => {
    for (let i = 0; i < 5; i++) {
      await say(i % 2 ? bob : alice, i % 2 ? alice : bob, crypto.randomUUID(), `m${i}`);
    }
    const all = await tenantSession(alice, (c) => messages.history(c, conversation));
    const seqs = all.map((m) => Number(m.seq));
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(5);
    expect(all.map((m) => m.body)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
  });

  it('two simultaneous sends do not collide', async () => {
    // Both read the same max sequence without the lock, and one send fails for a
    // message the person already watched leave.
    const results = await Promise.all([
      say(alice, bob, crypto.randomUUID(), 'a'),
      say(bob, alice, crypto.randomUUID(), 'b'),
      say(alice, bob, crypto.randomUUID(), 'c'),
    ]);
    const seqs = results.map((r) => Number(r.message.seq));
    expect(new Set(seqs).size).toBe(3);
  });
});

describe('receipts', () => {
  it('marks the OTHER person messages read, never your own', async () => {
    await say(alice, bob, crypto.randomUUID(), 'from alice');
    await say(bob, alice, crypto.randomUUID(), 'from bob');

    const read = await tenantSession(bob, (c) => messages.markRead(c, conversation, bob.userId));
    expect(read).toHaveLength(1);

    const all = await tenantSession(alice, (c) => messages.history(c, conversation));
    expect(all.find((m) => m.body === 'from alice')!.readAt).not.toBeNull();
    expect(all.find((m) => m.body === 'from bob')!.readAt).toBeNull();
  });

  it('read implies delivered', async () => {
    // Otherwise a message read on a flaky connection shows one tick for ever.
    await say(alice, bob, crypto.randomUUID(), 'hi');
    await tenantSession(bob, (c) => messages.markRead(c, conversation, bob.userId));
    const [m] = await tenantSession(alice, (c) => messages.history(c, conversation));
    expect(m!.deliveredAt).not.toBeNull();
    expect(m!.readAt).not.toBeNull();
  });

  it('counts unread for the right person', async () => {
    await say(alice, bob, crypto.randomUUID(), 'one');
    await say(alice, bob, crypto.randomUUID(), 'two');
    expect(await tenantSession(bob, (c) => messages.unreadCount(c, conversation, bob.userId))).toBe(2);
    expect(await tenantSession(alice, (c) => messages.unreadCount(c, conversation, alice.userId))).toBe(0);
  });
});

describe('blocking', () => {
  it('stops messages in BOTH directions', async () => {
    await tenantSession(alice, (c) => messages.block(c, alice.userId, bob.userId));

    // The person who blocked cannot send either -- a one-way block leaves them able
    // to keep talking at somebody who cannot answer.
    await expect(say(alice, bob, crypto.randomUUID(), 'still there?')).rejects.toThrow(messages.Blocked);
    await expect(say(bob, alice, crypto.randomUUID(), 'hello?')).rejects.toThrow(messages.Blocked);
  });

  it('leaves what was already said alone', async () => {
    // The history is evidence. Deleting it on block would destroy what somebody needs
    // if they later report.
    await say(bob, alice, crypto.randomUUID(), 'something horrible');
    await tenantSession(alice, (c) => messages.block(c, alice.userId, bob.userId));
    const all = await tenantSession(alice, (c) => messages.history(c, conversation));
    expect(all).toHaveLength(1);
  });
});

describe('reporting', () => {
  it('blocks as well, in one action', async () => {
    await tenantSession(alice, (c) =>
      messages.report(c, {
        reporterId: alice.userId, reportedId: bob.userId,
        rendezvousId: conversation, reason: 'harassment', detail: 'kept messaging',
      }),
    );
    // Nobody reports somebody they want to keep hearing from.
    expect(await tenantSession(alice, (c) => messages.isBlocked(c, alice.userId, bob.userId))).toBe(true);
    await expect(say(bob, alice, crypto.randomUUID(), 'hey')).rejects.toThrow(messages.Blocked);
  });
});

describe('erasing somebody', () => {
  it('takes the conversation with them, from both sides', async () => {
    // Its own pair, so erasing one of them cannot disturb the other tests.
    const leaver = await person('leaver');
    const stayer = await person('stayer');
    const [x, y] = leaver.userId < stayer.userId ? [leaver, stayer] : [stayer, leaver];
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, status)
       VALUES ($1,$2,$3,$4,'introduced') RETURNING id`,
      [x.userId, y.userId, x.tenantId, y.tenantId]);
    const thread = rows[0]!.id;

    const post = (from: typeof leaver, to: typeof stayer, body: string) =>
      tenantSession(from, (c) =>
        messages.send(c, {
          id: crypto.randomUUID(), rendezvousId: thread,
          senderId: from.userId, recipientId: to.userId, body,
        }));

    await post(leaver, stayer, 'hello');
    await post(stayer, leaver, 'hi back');
    await tenantSession(leaver, (c) =>
      messages.report(c, {
        reporterId: leaver.userId, reportedId: stayer.userId,
        rendezvousId: thread, reason: 'other', detail: 'x',
      }),
    );

    const r = await eraseUser(leaver);
    expect(r.remaining).toEqual([]);
    expect(r.verified).toBe(true);

    // The other person's half goes too. A conversation with one participant erased is
    // not a conversation, and leaving the surviving side would leave somebody talking
    // to a person who no longer exists.
    const left = await owner.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM messages WHERE rendezvous_id = $1', [thread]);
    expect(left.rows[0]!.n).toBe(0);

    // The report survives with the name taken off. The safety signal about the OTHER
    // person is not the reporter's to withdraw by closing their account.
    const report = await owner.query<{ reporter_id: string | null }>(
      'SELECT reporter_id FROM reports WHERE reported_id = $1', [stayer.userId]);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.reporter_id).toBeNull();
  });
});

describe('who can read a conversation', () => {
  it('a stranger sees nothing, even with the right id', async () => {
    await say(alice, bob, crypto.randomUUID(), 'private');
    const stranger = await person('stranger');
    const seen = await tenantSession(stranger, (c) => messages.history(c, conversation));
    // Same answer as a conversation that does not exist, so an id cannot be probed.
    expect(seen).toEqual([]);
  });
});
