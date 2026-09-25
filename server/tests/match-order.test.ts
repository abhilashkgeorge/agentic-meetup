/**
 * The matches list is ordered by when, never by a score -- and says nothing a
 * conversation produced.
 *
 * WHAT WAS WRONG. GET /v1/matches ordered the queue `agreement DESC, rank_score DESC`,
 * and the app said so out loud ("The one it liked most is first"). A list ordered by a
 * score teaches the person the score: the head of the queue reads as the agent's pick,
 * position becomes a verdict, and every yes that compare-scorers later counts has been
 * nudged by the very scorer it is judging. The card also carried `agreement` (shown as
 * "Your agents got on") and the assessor's `concern`, which is where an invented
 * "comedy writer" reached a real person.
 *
 * WHAT IS CHECKED. Four pairs planted straight into the table: one from an older round
 * with the best agreement and rank there is, three from one newer round with worse
 * ones. The old order puts the old pair first; the new order is newest round first,
 * then a hash of the id. Then every score is shuffled across the rows and the order
 * must not move, which is what "does not depend on agreement" means. One of the rows
 * carries a brief a model wrote -- headline, concern, quote pairs -- as rows written
 * before 2026-09-23 do; it must come back as the plain card.
 *
 * AND WHOSE TURN IT IS. The first mover decides alone and first; the reveal holds
 * back their age, where they live and their tags until they have said yes. The
 * code-written card carries exactly those, so the second mover is shown the plain card
 * until then -- the second test plants that pair.
 *
 * Negative control, run by hand: put the old ORDER BY back -> the first assertion
 * fails with the older pair at the head; put `concern` back in the payload -> the
 * payload assertions fail; show the second mover readBrief(r) whatever the turn ->
 * the second test fails on the first mover's age.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { pool, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { datingRoutes } from '../src/api/dating.js';
import { BRIEF_LINE, PLAIN_HEADLINE } from '../src/matching/brief.js';
import { mintToken, newSessionId } from '../src/tokens.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string; token: string }

async function person(label: string, over: Record<string, unknown> = {}): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`mo-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `mo-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: ['long_term'],
    in_pool: true, is_synthetic: false, sees_synthetic: false, display_name: label, ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map((k) => cols[k]));
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

/**
 * A decided pair with a card for `me`, from a round that ran at `at`. `me` moves first
 * unless `firstMover` says otherwise.
 */
async function pair(me: P, them: P, at: string, agreement: number | null, rankScore: number, legacy = false,
                    firstMover: P = me) {
  const [lo, hi] = me.userId < them.userId ? [me, them] : [them, me];
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover,
                             agreement, rank_score, created_at, decided_at)
     VALUES ($1,$2,$3,$4,5,'decided',$5,$6,$7,$8::timestamptz,$8::timestamptz) RETURNING id`,
    [lo.userId, hi.userId, lo.tenantId, hi.tenantId, firstMover.userId, agreement, rankScore, at]);
  const id = rows[0]!.id;
  const brief = legacy
    // What a model-written brief looked like: its own headline, an assessor's concern,
    // quote pairs it picked by index, two questions it wrote.
    ? ['They are a comedy writer who lights up a room', 'He is a comedy writer who smokes daily',
       JSON.stringify([{ quoteA: 'Children? have_and_done', dateA: '', quoteB: 'Children? have_and_done', dateB: '', shared: 'kids' }]),
       JSON.stringify(['What is it like writing comedy?'])]
    : ['Here for something long-term · 30', '',
       JSON.stringify({ v: 2, shared: ['pottery'], quotes: [] }), JSON.stringify(['Ask them about: pottery'])];
  await owner.query(
    `INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, concern, overlap_quotes, questions)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, me.userId, ...brief]);
  return id;
}

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

const list = async (who: P) => {
  const res = await datingRoutes.request('/v1/matches', {
    headers: { Authorization: `Bearer ${who.token}`, 'x-forwarded-for': '203.0.113.22' },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { matches: Array<Record<string, unknown> & { id: string }> }).matches;
};

describe('the matches list', () => {
  it('is newest round first, then a hash of the id -- never agreement or rank', async () => {
    const tag = `mo-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const them = await Promise.all(['a', 'b', 'c', 'd'].map((l) => person(l, { intent: [tag] })));

    // The older round: the best scores there are. Under the old ORDER BY it led.
    const old = await pair(me, them[0]!, '2026-09-20T10:00:00Z', 1, 0.99, true);
    // The newer round: three pairs claimed in one transaction share one created_at.
    const round = '2026-09-22T10:00:00.123456Z';
    const fresh = [
      await pair(me, them[1]!, round, 0, 0.1),
      await pair(me, them[2]!, round, 0.4, 0.5),
      await pair(me, them[3]!, round, null, 0.9),
    ];
    const expected = [...[...fresh].sort((x, y) => (md5(x) < md5(y) ? -1 : 1)), old];

    const first = await list(me);
    expect(first.map((m) => m.id)).toEqual(expected);

    // Shuffle every score across the rows. The order must not move.
    const scores: Array<[number | null, number]> = [[null, 0.2], [1, 0.95], [0.6, 0.01], [0, 0.7]];
    for (const [i, id] of [old, ...fresh].entries()) {
      await owner.query('UPDATE rendezvous SET agreement = $2, rank_score = $3 WHERE id = $1',
        [id, scores[i]![0], scores[i]![1]]);
    }
    const second = await list(me);
    expect(second.map((m) => m.id)).toEqual(expected);

    // Nothing a conversation produced is on the wire, and a brief a model wrote comes
    // back as the plain card: its headline, concern and picked quotes stay in the row.
    for (const card of second) {
      expect(card).not.toHaveProperty('agreement');
      expect(card).not.toHaveProperty('concern');
      expect(card).not.toHaveProperty('overlaps');
      expect(card.line).toBe(BRIEF_LINE);
    }
    const legacy = second.find((m) => m.id === old)!;
    expect(legacy).toMatchObject({ headline: PLAIN_HEADLINE, shared: [], quotes: [], opener: null });
    expect(JSON.stringify(second)).not.toMatch(/comedy|have_and_done|smokes/);
    const current = second.find((m) => m.id === fresh[0])!;
    expect(current).toMatchObject({
      headline: 'Here for something long-term · 30', shared: ['pottery'], quotes: [], opener: 'Ask them about: pottery',
    });
  });

  it("shows the second mover nothing of the first mover's until the first mover says yes", async () => {
    const tag = `mo-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const them = await person('them', { intent: [tag] });
    // THEY move first. My card about them is written and stored like any other.
    const id = await pair(me, them, '2026-09-22T10:00:00Z', null, 0.5, false, them);

    const [waiting] = await list(me);
    expect(waiting?.id).toBe(id);
    expect(waiting).toMatchObject({
      headline: PLAIN_HEADLINE, line: BRIEF_LINE, shared: [], work: [], quotes: [], opener: null,
      waitingOnYou: false, waitingOnThem: true,
    });
    expect(JSON.stringify(waiting)).not.toMatch(/30|long-term|pottery/);

    // They say yes: now it is my turn, and the card is the one that was written.
    await owner.query(
      `INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, concern, human_says_yes, decided_at)
       VALUES ($1,$2,'Here for something long-term · 30','',true, now())`, [id, them.userId]);
    const [mine] = await list(me);
    expect(mine).toMatchObject({
      headline: 'Here for something long-term · 30', shared: ['pottery'], opener: 'Ask them about: pottery',
      waitingOnYou: true,
    });
  });
});
