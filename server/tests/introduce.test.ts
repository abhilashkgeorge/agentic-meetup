/**
 * The gate between an agent's yes and a human being able to send a message.
 *
 * This is the join that was missing: every piece on either side of it worked, and
 * nothing connected them. `/v1/matches` returned a hard-coded empty list, no endpoint
 * wrote a human decision, and no code set a rendezvous to 'introduced' -- which is
 * exactly the precondition the messaging policy checks. Two working halves and no
 * door between them.
 *
 * What is pinned here is the ORDER: agents agree, then both humans agree, and only
 * then can anybody write to anybody.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, tenantSession, matchmakerSession, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { decide, autoDecideSynthetic } from '../src/matching/orchestrator.js';
import * as messages from '../src/messaging/store.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
let a = { tenantId: '', userId: '' };
let b = { tenantId: '', userId: '' };
let pairId = '';

async function person(label: string, synthetic = false) {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`${label}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${label}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  await owner.query(
    `INSERT INTO match_profile (user_id, tenant_id, display_name, in_pool, is_synthetic)
     VALUES ($1,$2,$3,true,$4)`,
    [userId, tenantId, label, synthetic]);
  return { tenantId, userId };
}

/** A pair the agents have already passed, with a brief written for each side. */
async function decidedPair(x = a, y = b) {
  const [lo, hi] = x.userId < y.userId ? [x, y] : [y, x];
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, status,
                             runs_done, both_yes, decided_at, first_mover)
     VALUES ($1,$2,$3,$4,'decided',5,4,now(),$5) RETURNING id`,
    [lo.userId, hi.userId, lo.tenantId, hi.tenantId, lo.userId]);
  const id = rows[0]!.id;
  for (const who of [x, y]) {
    await owner.query(
      `INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, concern)
       VALUES ($1,$2,'someone worth meeting','one thing to check')`,
      [id, who.userId]);
  }
  return id;
}

beforeAll(async () => {
  a = await person('alpha');
  b = await person('beta');
});

beforeEach(async () => {
  const mine = [a.userId, b.userId];
  await owner.query(
    'DELETE FROM rendezvous WHERE user_a = ANY($1) OR user_b = ANY($1)', [mine]);
  pairId = await decidedPair();
});

afterAll(async () => {
  for (const t of made) await owner.query('DELETE FROM tenants WHERE id = $1', [t]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

const write = (from: typeof a, to: typeof b, body = 'hello') =>
  tenantSession(from, (c) =>
    messages.send(c, {
      id: crypto.randomUUID(), rendezvousId: pairId,
      senderId: from.userId, recipientId: to.userId, body,
    }),
  );

describe('nobody can write until both people have said yes', () => {
  it('refuses a message before either has decided', async () => {
    // Not a policy the server applies -- a row the database will not accept. The
    // WITH CHECK on messages requires an introduced pair, so unsolicited contact is
    // unrepresentable rather than filtered.
    await expect(write(a, b)).rejects.toThrow();
  });

  it('still refuses when only one has said yes', async () => {
    const r = await decide(a.userId, pairId, true);
    expect(r.introduced).toBe(false);
    await expect(write(a, b)).rejects.toThrow();
  });

  it('opens the conversation when the second one says yes', async () => {
    await decide(a.userId, pairId, true);
    const second = await decide(b.userId, pairId, true);
    expect(second.introduced).toBe(true);

    const sent = await write(a, b, 'hello');
    expect(sent.fresh).toBe(true);
    const seen = await tenantSession(b, (c) => messages.history(c, pairId));
    expect(seen.map((m) => m.body)).toEqual(['hello']);
  });
});

describe('a no', () => {
  it('ends it, silently, and cannot be taken back', async () => {
    await decide(a.userId, pairId, false);

    const { rows } = await owner.query<{ status: string }>(
      'SELECT status FROM rendezvous WHERE id = $1', [pairId]);
    expect(rows[0]!.status).toBe('lapsed');

    // Even if the other person says yes afterwards, there is no introduction. And
    // nothing anywhere records that they were passed on: the other side's brief is
    // untouched, so their screen shows a card still waiting, not a rejection.
    const after = await decide(b.userId, pairId, true);
    expect(after.introduced).toBe(false);
    await expect(write(b, a)).rejects.toThrow();
  });

  it('is not reversible by asking twice', async () => {
    await decide(a.userId, pairId, false);
    const again = await decide(a.userId, pairId, true);
    expect(again.introduced).toBe(false);
    const { rows } = await owner.query<{ human_says_yes: boolean }>(
      'SELECT human_says_yes FROM rendezvous_briefs WHERE rendezvous_id = $1 AND for_user = $2',
      [pairId, a.userId]);
    expect(rows[0]!.human_says_yes).toBe(false);
  });
});

describe('invented people', () => {
  it('say yes by themselves, so a real person can see the whole flow', async () => {
    const ghost = await person('ghost', true);
    const id = await decidedPair(a, ghost);
    pairId = id;

    // On the matchmaker session, because it is a system decision. A tenant session
    // sees only its OWN brief, so run from the real person's connection this finds
    // nothing at all -- which is the correct answer to "may I decide for you".
    const n = await matchmakerSession((c) => autoDecideSynthetic(c, id));
    expect(n).toBe(1);

    // Recorded as a decision, not left null -- so a later audit can tell an invented
    // yes from a real one by joining is_synthetic, rather than guessing.
    const { rows } = await owner.query<{ human_says_yes: boolean; decided_at: Date }>(
      'SELECT human_says_yes, decided_at FROM rendezvous_briefs WHERE for_user = $1',
      [ghost.userId]);
    expect(rows[0]!.human_says_yes).toBe(true);
    expect(rows[0]!.decided_at).not.toBeNull();

    // And the real person's own yes is still required.
    expect((await decide(a.userId, id, true)).introduced).toBe(true);
  });
});

describe('who looks first', () => {
  it('the second person can see them once the first has said yes', async () => {
    // Two deadlocks lived here. The gate first waited for `status = 'introduced'`,
    // which only their own answer could produce; then it read the other person's
    // brief, which row-level security correctly hides. Both left the second person
    // looking at "they are deciding first" for ever.
    //
    // `first_mover` is user_a in the fixture, which is the lower id.
    const [first, second] = a.userId < b.userId ? [a, b] : [b, a];

    const before = await tenantSession(second, (c) =>
      c.query<{ yes: boolean }>(
        'SELECT rendezvous_other_said_yes($1, $2) AS yes', [pairId, second.userId]));
    expect(before.rows[0]!.yes).toBe(false);

    await decide(first.userId, pairId, true);

    const after = await tenantSession(second, (c) =>
      c.query<{ yes: boolean }>(
        'SELECT rendezvous_other_said_yes($1, $2) AS yes', [pairId, second.userId]));
    expect(after.rows[0]!.yes).toBe(true);
  });

  it('says the same thing for a no as for a silence', async () => {
    // A no is silent, for ever. If these two answers differed, a rejection could be
    // read off the screen -- and in a small pool where people compare notes, an
    // emitted rejection is unrecoverable.
    const [first, second] = a.userId < b.userId ? [a, b] : [b, a];
    await decide(first.userId, pairId, false);
    const after = await tenantSession(second, (c) =>
      c.query<{ yes: boolean }>(
        'SELECT rendezvous_other_said_yes($1, $2) AS yes', [pairId, second.userId]));
    expect(after.rows[0]!.yes).toBe(false);
  });

  it('cannot be asked about a conversation you are not in', async () => {
    const stranger = await person('nosy');
    const { rows } = await tenantSession(stranger, (c) =>
      c.query<{ yes: boolean }>(
        'SELECT rendezvous_other_said_yes($1, $2) AS yes', [pairId, stranger.userId]));
    expect(rows[0]!.yes).toBe(false);
  });
});

describe('the transcripts', () => {
  it('cannot be read by the people in them', async () => {
    await owner.query(
      `INSERT INTO rendezvous_runs (rendezvous_id, run_no, transcript, a_concern, b_concern)
       VALUES ($1, 0, '[]'::jsonb, 'x', 'y')`, [pairId]);

    // Each agent's characterisation of its own human is unverified, and reading it
    // would quietly turn a claim into a remembered fact about somebody they have not
    // met. 0022 enabled row security on two tables and missed this one.
    await expect(
      tenantSession(a, (c) => c.query('SELECT transcript FROM rendezvous_runs WHERE rendezvous_id = $1', [pairId])),
    ).rejects.toThrow(/permission denied/);
  });
});
