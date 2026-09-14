/**
 * Two agents meeting, several times, and the counting rule that makes it mean anything.
 *
 * The mechanic comes from "Hang the DJ": run the pair repeatedly and count how often
 * both say yes. The useful part is that the score comes from watching them interact
 * rather than from comparing questionnaires.
 *
 * Getting here took three attempts and each failure is worth keeping:
 *
 *   v1  two outcomes. A good pair scored 2/5 and a bad one 0/4 -- real separation, but
 *       the good pair's noes read "the conversation revealed very little", which is a
 *       verdict about the transcript, not about the person.
 *   v2  added `not_enough`. Every single run became inconclusive: a free "not sure"
 *       option is the cheapest answer available and gets taken every time.
 *   v3  made it expensive. The assessor must first LIST what it learned, and may only
 *       claim insufficiency if it listed fewer than three things. A model that has
 *       just enumerated four facts cannot then say it learned nothing.
 *
 * These tests pin the counting, which is where the meaning lives. The prompts are
 * tested against a live model by hand.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({
  /** One entry per assessor call, cycled. Lets a test script exact run outcomes. */
  verdicts: [] as { verdict: string; learned: string[]; concern: string }[],
  at: 0,
}));

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'google:gemini-3.5-flash-lite',
  llm: {
    complete: async (req: { outputSchema?: unknown }) => {
      const usage = {
        inputTokens: 500, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 60,
        reasoningTokens: 0, provider: 'google', modelId: 'flash-lite',
        costUsd: 0.0001, latencyMs: 100,
      };
      // No schema means it is the prober writing a message.
      if (!req.outputSchema) return { text: 'a message', parsed: null, usage };
      const v = stub.verdicts[stub.at % stub.verdicts.length] ?? {
        verdict: 'no', learned: [], concern: 'x',
      };
      stub.at++;
      return { text: '', parsed: v, usage };
    },
  },
}));

// The matchmaker session, not a tenant one. Transcripts live in rendezvous_runs,
// which the app role may not touch at all (migration 0028) -- a person is never shown
// the conversation their agent had about them.
const { pool, tenantSession, matchmakerSession, closeMatchPool } =
  await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { meet, passes } = await import('../src/matching/rendezvous.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
let a = { userId: '', tenantId: '', dossier: 'A', voice: '' };
let b = { userId: '', tenantId: '', dossier: 'B', voice: '' };
const made: string[] = [];

async function person(label: string) {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`${label}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${label}-${Math.random()}@example.test`]);
  return { userId: u.rows[0]!.id, tenantId, dossier: label, voice: '' };
}

const openFor = async (
  p: { userId: string; tenantId: string },
  q: { userId: string; tenantId: string },
) => {
  const [x, y] = p.userId < q.userId ? [p, q] : [q, p];
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned)
     VALUES ($1,$2,$3,$4,5) RETURNING id`,
    [x.userId, y.userId, x.tenantId, y.tenantId]);
  return rows[0]!.id;
};

/**
 * A FRESH pair per test. A pair may only ever meet once, so reusing one across tests
 * makes the second test fail on the uniqueness rule rather than on what it is testing.
 */
async function freshPair() {
  const p = await person('alpha');
  const q = await person('beta');
  return { p, q, id: await openFor(p, q) };
}

beforeAll(async () => {
  a = await person('alpha');
  b = await person('beta');
});

afterAll(async () => {
  for (const t of made) await owner.query('DELETE FROM tenants WHERE id = $1', [t]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('whose concern is whose', () => {
  it('stores each side\'s worry against the right person, whichever way round they ran', async () => {
    // The columns are named after `rendezvous.user_a`, which is the LOWER of the two
    // ids. A run's "a" is whoever the caller passed first -- normally the person whose
    // agent went out, who is user_a only half the time. Confusing the two meant each
    // person was shown their own agent's worry ABOUT THEMSELVES, labelled as the one
    // thing to check about the person they were about to meet. It read perfectly until
    // somebody who knew both people looked at it.
    stub.verdicts = [
      { verdict: 'yes', learned: ['a', 'b', 'c'], concern: 'worried about the FIRST side' },
      { verdict: 'yes', learned: ['a', 'b', 'c'], concern: 'worried about the SECOND side' },
    ];
    stub.at = 0;
    const { p, q, id } = await freshPair();

    // Deliberately the reverse of the stored order: user_a is the lower id, and this
    // passes the higher one first.
    const [lo, hi] = p.userId < q.userId ? [p, q] : [q, p];
    await matchmakerSession((c) =>
      meet(c, id, { ...hi, dossier: 'H', voice: '' }, { ...lo, dossier: 'L', voice: '' }, 1));

    const { rows } = await owner.query<{ a_concern: string; b_concern: string }>(
      'SELECT a_concern, b_concern FROM rendezvous_runs WHERE rendezvous_id = $1', [id]);

    // `a_concern` means user_a's agent, always -- not "whoever was passed first".
    expect(rows[0]!.a_concern).toBe('worried about the SECOND side');
    expect(rows[0]!.b_concern).toBe('worried about the FIRST side');
  });
});

describe('counting', () => {
  it('counts a run only when BOTH sides reached a verdict', async () => {
    stub.verdicts = [{ verdict: 'yes', learned: ['x', 'y', 'z'], concern: 'c' }];
    stub.at = 0;
    const { p, q, id } = await freshPair();
    const r = await matchmakerSession((c) => meet(c, id, { ...p, dossier: 'A', voice: '' }, { ...q, dossier: 'B', voice: '' }, 3));
    expect(r.runs).toBe(3);
    expect(r.bothYes).toBe(3);
    expect(passes(r.bothYes, r.runs)).toBe(true);
  });

  it('an inconclusive run counts as neither a yes nor a no', async () => {
    // The rule that makes this different from v1, and it is the same rule the rest of
    // the system runs on: an unknown is never a mismatch. A thin transcript must not
    // be recorded as a rejection of a person.
    stub.verdicts = [{ verdict: 'not_enough', learned: [], concern: 'thin' }];
    stub.at = 0;
    const { p, q, id } = await freshPair();
    const r = await matchmakerSession((c) => meet(c, id, { ...p, dossier: 'A', voice: '' }, { ...q, dossier: 'B', voice: '' }, 3));
    expect(r.runs).toBe(0);
    expect(r.bothYes).toBe(0);
    // Zero out of zero is not a match. It is an absence of evidence.
    expect(passes(r.bothYes, r.runs)).toBe(false);
  });

  it('one side saying no is not a match, however keen the other was', async () => {
    stub.verdicts = [
      { verdict: 'yes', learned: ['a', 'b', 'c'], concern: 'c' },
      { verdict: 'no', learned: ['a', 'b', 'c'], concern: 'c' },
    ];
    stub.at = 0;
    const { p, q, id } = await freshPair();
    const r = await matchmakerSession((c) => meet(c, id, { ...p, dossier: 'A', voice: '' }, { ...q, dossier: 'B', voice: '' }, 4));
    expect(r.runs).toBe(4);
    expect(r.bothYes).toBe(0);
  });

  it('needs a majority, so a single agreeable run is not a match', async () => {
    // Language models are agreeable by construction. One yes is the base rate.
    expect(passes(1, 5)).toBe(false);
    expect(passes(2, 5)).toBe(false);
    expect(passes(3, 5)).toBe(true);
    expect(passes(1, 1)).toBe(true);
    expect(passes(0, 0)).toBe(false);
  });
});

describe('a pair meets once, ever', () => {
  it('refuses a second rendezvous for the same two people', async () => {
    const { p, q } = await freshPair();
    // Running the same pair again next week turns a match into a war of attrition.
    await expect(openFor(p, q)).rejects.toThrow(/rendezvous_pair/);
  });
});
