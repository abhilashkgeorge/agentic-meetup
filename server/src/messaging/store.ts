/**
 * Sending, reading and stopping.
 *
 * The edge cases that make messaging feel broken when they are missing -- and which
 * are the actual reason chat looks like a big job:
 *
 *   DUPLICATES   the client generates the id, so a retry after a dropped response
 *                writes nothing new. Send is idempotent by construction.
 *   ORDER        a per-conversation sequence allocated under a lock. Two messages in
 *                the same millisecond still have a defined order, and a phone with a
 *                wrong clock cannot sort itself into last week.
 *   OFFLINE      the client keeps unsent messages and replays on reconnect. Because
 *                sends are idempotent, replaying costs nothing.
 *   RECEIPTS     delivered and read are separate, and read implies delivered.
 *   BLOCKING     enforced on the write, both directions, silent to the blocked person
 *                -- telling somebody they are blocked is an invitation to make a
 *                second account.
 */
import type { PoolClient } from 'pg';

export interface Message {
  id: string;
  rendezvousId: string;
  senderId: string;
  body: string;
  sentAt: Date;
  seq: string;
  deliveredAt: Date | null;
  readAt: Date | null;
  redactedAt: Date | null;
}

const map = (r: Record<string, unknown>): Message => ({
  id: r.id as string,
  rendezvousId: r.rendezvous_id as string,
  senderId: r.sender_id as string,
  // A redacted message keeps its row and loses its words. Hard-deleting one silently
  // rewrites a conversation somebody may need to report.
  body: r.redacted_at ? '' : (r.body as string),
  sentAt: r.sent_at as Date,
  seq: String(r.seq),
  deliveredAt: (r.delivered_at as Date | null) ?? null,
  readAt: (r.read_at as Date | null) ?? null,
  redactedAt: (r.redacted_at as Date | null) ?? null,
});

export class Blocked extends Error {
  constructor() {
    super('blocked');
    this.name = 'Blocked';
  }
}

/**
 * Either direction. The blocked person is never told, so both sides simply stop.
 *
 * This goes through a SECURITY DEFINER function rather than reading `blocks` directly,
 * and the reason is a bug this replaced: the row-level policy on `blocks` shows you
 * only the blocks you wrote yourself, so a direct query run on behalf of the BLOCKED
 * person saw nothing and their messages kept arriving. Reading the table needs
 * permission the blocked person must not have; asking the yes/no question does not.
 */
export async function isBlocked(c: PoolClient, a: string, b: string): Promise<boolean> {
  const { rows } = await c.query<{ blocked: boolean }>(
    'SELECT block_exists($1, $2) AS blocked', [a, b],
  );
  return rows[0]!.blocked;
}

export interface SendResult {
  message: Message;
  /** False when this id had already been written. The retry case. */
  fresh: boolean;
}

/**
 * Write one message.
 *
 * The sequence is allocated and used inside one transaction under an advisory lock,
 * because two simultaneous sends would otherwise read the same max and collide on the
 * unique index -- survivable, but it produces a failed send for a message the person
 * already watched leave.
 */
export async function send(
  c: PoolClient,
  args: { id: string; rendezvousId: string; senderId: string; recipientId: string; body: string },
): Promise<SendResult> {
  if (await isBlocked(c, args.senderId, args.recipientId)) throw new Blocked();

  // The client's own id. A retry after a dropped response finds the existing row, so
  // the person never sees their message twice.
  const existing = await c.query(`SELECT * FROM messages WHERE id = $1`, [args.id]);
  if (existing.rowCount) return { message: map(existing.rows[0]!), fresh: false };

  await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [args.rendezvousId]);

  const { rows } = await c.query(
    `INSERT INTO messages (id, rendezvous_id, sender_id, body, seq)
     VALUES ($1, $2, $3, $4, next_message_seq($2))
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [args.id, args.rendezvousId, args.senderId, args.body.trim()],
  );

  if (!rows.length) {
    const again = await c.query(`SELECT * FROM messages WHERE id = $1`, [args.id]);
    return { message: map(again.rows[0]!), fresh: false };
  }
  return { message: map(rows[0]!), fresh: true };
}

/** Oldest-first, paged backwards. `before` is a seq, not a timestamp. */
export async function history(
  c: PoolClient,
  rendezvousId: string,
  limit = 50,
  before?: string,
): Promise<Message[]> {
  const { rows } = await c.query(
    `SELECT * FROM messages
      WHERE rendezvous_id = $1 AND ($3::bigint IS NULL OR seq < $3::bigint)
      ORDER BY seq DESC
      LIMIT $2`,
    [rendezvousId, limit, before ?? null],
  );
  return rows.map(map).reverse();
}

export async function markDelivered(
  c: PoolClient,
  rendezvousId: string,
  readerId: string,
): Promise<string[]> {
  const { rows } = await c.query<{ id: string }>(
    `UPDATE messages SET delivered_at = now()
      WHERE rendezvous_id = $1 AND sender_id <> $2 AND delivered_at IS NULL
    RETURNING id`,
    [rendezvousId, readerId],
  );
  return rows.map((r) => r.id);
}

/**
 * Read implies delivered. Leaving that gap produces the state where a message shows
 * one tick for ever after being read on a flaky connection.
 */
export async function markRead(
  c: PoolClient,
  rendezvousId: string,
  readerId: string,
): Promise<string[]> {
  const { rows } = await c.query<{ id: string }>(
    `UPDATE messages
        SET read_at = now(), delivered_at = coalesce(delivered_at, now())
      WHERE rendezvous_id = $1 AND sender_id <> $2 AND read_at IS NULL
    RETURNING id`,
    [rendezvousId, readerId],
  );
  return rows.map((r) => r.id);
}

export async function unreadCount(
  c: PoolClient,
  rendezvousId: string,
  userId: string,
): Promise<number> {
  const { rows } = await c.query<{ n: string }>(
    `SELECT count(*) AS n FROM messages
      WHERE rendezvous_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
    [rendezvousId, userId],
  );
  return Number(rows[0]!.n);
}

/**
 * Block, silently. Somebody told they have been blocked makes a second account;
 * somebody whose messages simply stop arriving usually does not.
 */
export async function block(c: PoolClient, blockerId: string, blockedId: string): Promise<void> {
  await c.query(
    `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [blockerId, blockedId],
  );
}

export async function report(
  c: PoolClient,
  args: {
    reporterId: string; reportedId: string; rendezvousId: string | null;
    reason: string; detail: string;
  },
): Promise<void> {
  await c.query(
    `INSERT INTO reports (reporter_id, reported_id, rendezvous_id, reason, detail)
     VALUES ($1,$2,$3,$4,$5)`,
    [args.reporterId, args.reportedId, args.rendezvousId, args.reason, args.detail.slice(0, 2000)],
  );
  // Reporting blocks too. Nobody reports somebody they want to keep hearing from, and
  // making it two actions is how a person ends up still receiving messages.
  await block(c, args.reporterId, args.reportedId);
}
