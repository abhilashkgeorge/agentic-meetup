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
  /** Make the next N model calls die, the way the free tier actually dies. */
  failNext: 0,
  /**
   * Fail by call NUMBER, so a test can choose which phase dies.
   *
   * `failNext` alone cannot reach the top-up: it is spent in the main loop long
   * before the top-up starts, which is why the first version of the overshoot test
   * passed against the broken code it was written to catch.
   */
  failWhen: null as null | ((call: number) => boolean),
  /** Every call the adapter was asked for, so a test can count the retries. */
  calls: 0,
}));

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'google:gemini-3.5-flash-lite',
  llm: {
    complete: async (req: { outputSchema?: unknown }) => {
      stub.calls++;
      if (stub.failWhen?.(stub.calls)) throw new Error('fetch failed: read ECONNRESET');
      if (stub.failNext > 0) {
        stub.failNext--;
        throw new Error('fetch failed: read ECONNRESET');
      }
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
const { meet, passes, quorum } = await import('../src/matching/rendezvous.js');

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
    expect(passes(r.bothYes, r.runs, r.runs)).toBe(true);
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
    expect(passes(r.bothYes, r.runs, r.runs)).toBe(false);
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
    expect(passes(1, 5, 5)).toBe(false);
    expect(passes(2, 5, 5)).toBe(false);
    expect(passes(3, 5, 5)).toBe(true);
    expect(passes(0, 0, 5)).toBe(false);

    // A QUORUM, and this line used to assert the opposite. `passes(1, 1)` returned
    // true: one run, both sides agreed, pair passed. Dropped connections made that
    // the common case rather than the edge case -- in a fifty-pair measurement every
    // single pair completed fewer runs than were planned, several only two.
    //
    // A single agreement is the base rate for two polite language models. It is the
    // exact thing five runs exist to rule out, and it was passing.
    expect(passes(1, 1, 5)).toBe(false);
    expect(passes(2, 2, 5)).toBe(false);
    // Three of five planned is enough to have a verdict; two of three of them is a
    // majority of it.
    expect(passes(2, 3, 5)).toBe(true);
    expect(passes(1, 3, 5)).toBe(false);
    // A short run is not a NO. It is no measurement at all, and the pair is free to
    // be measured again -- unlike a pair that genuinely disagreed.
    expect(quorum(5)).toBe(3);
    expect(quorum(2)).toBe(2);
    expect(quorum(1)).toBe(1);
  });
});

describe('a pair meets once, ever', () => {
  it('refuses a second rendezvous for the same two people', async () => {
    const { p, q } = await freshPair();
    // Running the same pair again next week turns a match into a war of attrition.
    await expect(openFor(p, q)).rejects.toThrow(/rendezvous_pair/);
  });
});

/**
 * A dropped call must not quietly raise the bar.
 *
 * `passes` asks for a majority, and a majority of a smaller denominator is a bigger
 * fraction: 3 of 5 is 60%, 3 of 4 is 75%, 2 of 2 is 100%. Across 47 measured pairs and
 * then 8 more the denominator was 1, 2, 3 or 4 and never 5 -- so every pair was judged
 * against a threshold set by the network rather than by us, and none of them was told
 * which one.
 */
describe('runs that die on the wire', () => {
  it('are made up, so the denominator is what was planned', async () => {
    const { converse } = await import('../src/matching/rendezvous.js');
    stub.verdicts = [{ verdict: 'yes', learned: ['a', 'b', 'c'], concern: 'c' }];
    stub.at = 0; stub.calls = 0; stub.failWhen = null;
    // Two whole runs worth of dead calls: withRetry burns two per lost run.
    stub.failNext = 4;

    const side = { userId: 'u', tenantId: 't', dossier: 'd', voice: '' };
    const out = await converse(side, { ...side, userId: 'v' }, 3);

    // Three planned, three counted, despite the wire eating two.
    expect(out.counted).toBe(3);
    expect(out.bothYes).toBe(3);
  }, 30_000);

  it('never re-rolls a verdict that actually came back', async () => {
    const { converse } = await import('../src/matching/rendezvous.js');
    // Every run is inconclusive -- a real verdict about a thin conversation, not a
    // dropped call. Topping these up would be optional stopping: re-running until we
    // like the answer.
    stub.verdicts = [{ verdict: 'not_enough', learned: [], concern: 'thin' }];
    stub.at = 0; stub.calls = 0; stub.failNext = 0; stub.failWhen = null;

    const side = { userId: 'u', tenantId: 't', dossier: 'd', voice: '' };
    const out = await converse(side, { ...side, userId: 'v' }, 3);

    expect(out.counted).toBe(0);
    // Three runs only. Each run is TURNS_EACH prober calls plus two assessors; what
    // matters is that no FOURTH run was attempted to escape the result.
    expect(out.results).toHaveLength(3);
  }, 30_000);
});

/**
 * The bar itself.
 *
 * It was the phrase "a majority" turned into `> 0.5`, written before anybody had seen
 * a distribution. Measurement said it was wrong twice over: at 79.3% mean agreement it
 * passed 36 of 47 pairs, and after the assessor was corrected to 33.3% mean the
 * highest any pair reached was exactly 0.5 -- which a strict `>` throws away.
 */
describe('the pass bar', () => {
  it('compares against the lattice, not through it', async () => {
    const { passes, MIN_AGREEMENT } = await import('../src/matching/rendezvous.js');
    // With five runs the only reachable rates are 0, .2, .4, .6, .8, 1. A strict
    // inequality against a value that sits ON that lattice deletes a whole step --
    // which is how "more than half" quietly became "at least three quarters".
    const reachable = [0, 0.2, 0.4, 0.6, 0.8, 1];
    expect(reachable).toContain(MIN_AGREEMENT);
    const atTheBar = Math.round(MIN_AGREEMENT * 5);
    expect(passes(atTheBar, 5, 5)).toBe(true);
    expect(passes(atTheBar - 1, 5, 5)).toBe(false);
  });

  it('will not pass a pair that was barely measured, however well it did', async () => {
    const { passes } = await import('../src/matching/rendezvous.js');
    // Perfect agreement over one run is the coin toss five runs exist to rule out.
    expect(passes(1, 1, 5)).toBe(false);
    expect(passes(2, 2, 5)).toBe(false);
  });

  it('does not move when the network does', async () => {
    const { passes, MIN_AGREEMENT } = await import('../src/matching/rendezvous.js');
    // The same underlying rate must give the same answer whether four runs survived
    // or five. Under the old code it did not: 3-of-4 passed and 3-of-5 did not,
    // because the denominator was whatever the wire allowed.
    for (const counted of [3, 4, 5]) {
      const agreeing = Math.ceil(counted * MIN_AGREEMENT);
      expect(passes(agreeing, counted, 5), `${agreeing}/${counted}`).toBe(true);
    }
  });
});

/**
 * The top-up must never overshoot.
 *
 * A measurement run reported `1/6` -- six counted runs where five were planned. Making
 * up a dropped run is supposed to restore the denominator, not inflate it: a bar of
 * "a majority" means something different over six runs than over five, which is the
 * exact failure the top-up exists to prevent.
 */
describe('the top-up', () => {
  /**
   * Three runs rather than five, and few cases: every attempt carries a 1.5s spacing
   * delay against the free tier's rate limit, so an exhaustive sweep takes longer than
   * the whole rest of the suite. Three is enough -- the overshoot needs one failed
   * top-up followed by two successful ones, which fits.
   */
  it('does not overshoot when a made-up run ALSO dies', async () => {
    const { converse } = await import('../src/matching/rendezvous.js');
    const side = { userId: 'u', tenantId: 't', dossier: 'd', voice: '' };

    // THE EXACT SHAPE OF THE BUG. Keying the loop on losses rather than on verdicts
    // in hand meant a failed top-up attempt incremented the loss count itself, so the
    // loop kept going after the denominator was already full:
    //
    //     main loop ends   lost 1, counted 2
    //     first top-up fails    lost 2
    //     then two succeed      counted 4, with 3 planned
    //
    // Reaching that needs a death in the TOP-UP phase, which `failNext` cannot
    // express -- it is spent in the main loop. The first version of this test passed
    // against the broken code because of exactly that, so it proved nothing.
    stub.verdicts = [{ verdict: 'yes', learned: ['a', 'b', 'c'], concern: 'c' }];
    stub.at = 0; stub.calls = 0; stub.failNext = 0;
    // MEASURED, AND THE FIRST TWO MEASUREMENTS WERE WRONG. A healthy run costs
    // twelve model calls -- ten messages and two assessments -- but a DYING one costs
    // exactly one, because it throws on its first call; `withRetry` then spends one
    // more. So a lost run is two calls, not twenty-four, and with three planned:
    //
    //     calls  1-2    run 0 and its retry, both dead   -> lost 1
    //     calls  3-26   runs 1 and 2                     -> counted 2
    //     calls 27-28   the first made-up run and retry  -> dead, and THIS is what
    //                                                       inflated the loss count
    //     calls 29-52   two more made-up runs            -> counted 4, with 3 planned
    //
    // Two earlier versions of this test guessed those offsets, never reached the
    // top-up phase, and passed against the broken code they were written to catch.
    stub.failWhen = (call) => call <= 2 || call === 27 || call === 28;

    const out = await converse(side, { ...side, userId: 'v' }, 3);
    stub.failWhen = null;

    expect(out.results.length, 'verdicts obtained').toBeLessThanOrEqual(3);
    expect(out.counted, 'counted runs').toBeLessThanOrEqual(3);
  }, 180_000);

  it('never counts more runs than were planned, whatever the wire does', async () => {
    const { converse } = await import('../src/matching/rendezvous.js');
    const side = { userId: 'u', tenantId: 't', dossier: 'd', voice: '' };

    for (const dead of [0, 4, 8]) {
      stub.verdicts = [{ verdict: 'yes', learned: ['a', 'b', 'c'], concern: 'c' }];
      stub.at = 0; stub.calls = 0; stub.failNext = dead; stub.failWhen = null;

      const out = await converse(side, { ...side, userId: 'v' }, 3);
      // The whole point of making up a dropped run is to RESTORE the denominator, not
      // to inflate it: "a majority" over six runs is a different bar than over five.
      expect(out.counted, `counted with ${dead} dead calls`).toBeLessThanOrEqual(3);
      expect(out.results.length, `verdicts with ${dead} dead calls`).toBeLessThanOrEqual(3);
    }
  }, 180_000);

  it('does not retry a run that came back inconclusive', async () => {
    const { converse } = await import('../src/matching/rendezvous.js');
    const side = { userId: 'u', tenantId: 't', dossier: 'd', voice: '' };

    // A thin conversation is a real verdict, not a dropped call. Retrying it would be
    // optional stopping -- re-running until the answer changes.
    stub.verdicts = [{ verdict: 'not_enough', learned: [], concern: 'thin' }];
    stub.at = 0; stub.calls = 0; stub.failNext = 0; stub.failWhen = null;

    const out = await converse(side, { ...side, userId: 'v' }, 3);
    expect(out.counted).toBe(0);
    expect(out.results).toHaveLength(3);
  }, 180_000);
});
