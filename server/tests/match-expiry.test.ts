/**
 * A match nobody answers expires after three days, and is recorded as expired -- not
 * as a no.
 *
 * WHAT THE FOUNDER ASKED FOR (build list item 9): "matches expire after 3 days with no
 * answer; card fades; record 'expired' separately from 'no'."
 *
 * WHAT WAS WRONG: a card waited for ever -- 55 unanswered 'decided' rows in the dev
 * database, most older than three days (0069's header).
 *
 * WHAT IS PINNED HERE, through a real round and the real routes:
 *   - issuing the cards gives the first answer three days; a yes hands the other person
 *     their own three days;
 *   - the card carries when it fades, for the person whose turn it is only;
 *   - past the deadline the card is gone from both lists, the profile does not open,
 *     an answer is refused, and the town drops it -- even before the timer comes round;
 *   - it is 'expired', never 'lapsed', and both answers stay empty, so the measurement
 *     does not count silence as a no (pairOutcome leaves it unlabelled);
 *   - a real no is still a no.
 *
 * Negative controls, run by hand:
 *   - rendezvous.ts issuing cards without answer_by    -> "three days" fails
 *   - decide() not moving answer_by on a yes           -> "hands the turn" fails
 *   - GET /v1/matches without expireDue first           -> "gone the moment" fails
 *   - expireDue writing 'lapsed' instead of 'expired'   -> "not a no" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'google:gemini-3.5-flash-lite',
  decideModel: () => null,
  llm: {
    complete: async () => { throw new Error('no model in this test'); },
    decide: async () => { throw new Error('no model in this test'); },
  },
}));

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { runRound, decide } = await import('../src/matching/orchestrator.js');
const { pairOutcome } = await import('../src/matching/evaluate.js');
const { expireMatches } = await import('../src/matching/expiry.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { worldRoutes } = await import('../src/api/world.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

vi.setConfig({ testTimeout: 180_000 });

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

type Who = { tenantId: string; userId: string; token: string };
async function person(label: string, over: Record<string, unknown>): Promise<Who> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`ex-${label}-${Date.now()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `ex-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, in_pool: true, is_synthetic: false, sees_synthetic: false,
    display_name: label, ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map((k) => cols[k]));
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

/** Two people isolated by a made-up intent, met by a real round. */
async function met() {
  const tag = `ex-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
  const them = await person('them', { intent: [tag] });
  const { commit } = await import('../src/memory/facts.js');
  for (const [who, what] of [[me, 'climbing'], [them, 'pottery']] as const) {
    await tenantSession(who, (c) => commit(c, who, {
      predicate: 'interest', objectText: what, objectValue: what, stance: 'asserted', originClass: 'owner',
      sourceQuote: what, sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }));
  }
  await runRound(me.userId);
  const { rows } = await owner.query<{ id: string; first_mover: string }>(
    'SELECT id, first_mover FROM rendezvous WHERE user_a = $1 OR user_b = $1', [me.userId]);
  const first = rows[0]!.first_mover === me.userId ? me : them;
  const second = first === me ? them : me;
  return { id: rows[0]!.id, first, second };
}

const H = (p: Who) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' });
const cards = async (p: Who) =>
  ((await (await datingRoutes.request('/v1/matches', { headers: H(p) })).json()) as
    { matches: { id: string; fadesAt: string | null; waitingOnYou: boolean }[] }).matches;
const hoursLeft = async (id: string) => {
  const { rows } = await owner.query<{ h: number }>(
    `SELECT extract(epoch FROM answer_by - now()) / 3600 AS h FROM rendezvous WHERE id = $1`, [id]);
  return Number(rows[0]!.h);
};
const overdue = (id: string) => owner.query(`UPDATE rendezvous SET answer_by = now() - interval '1 minute' WHERE id = $1`, [id]);

describe('three days to answer', () => {
  it('issuing the cards gives the first answer three days, and a yes hands the turn on with three more', async () => {
    const { id, first, second } = await met();
    expect(await hoursLeft(id)).toBeGreaterThan(71.9);
    expect(await hoursLeft(id)).toBeLessThanOrEqual(72);

    // The card says when it fades -- to the person whose turn it is, and nobody else.
    const mine = (await cards(first)).find((c) => c.id === id)!;
    expect(mine.waitingOnYou).toBe(true);
    expect(mine.fadesAt).not.toBeNull();
    expect((await cards(second)).find((c) => c.id === id)?.fadesAt ?? null).toBeNull();

    // Most of the time gone, then a yes: the other person gets their own three days.
    await owner.query(`UPDATE rendezvous SET answer_by = now() + interval '2 hours' WHERE id = $1`, [id]);
    await decide(first.userId, id, true);
    expect(await hoursLeft(id), 'the yes did not hand the turn on with three days').toBeGreaterThan(71.9);
    expect((await cards(second)).find((c) => c.id === id)!.fadesAt).not.toBeNull();
  });

  it('past the deadline it is gone the moment anyone looks -- lists, profile, answer, town', async () => {
    const { id, first, second } = await met();
    await overdue(id);
    expect((await cards(first)).map((c) => c.id), 'an expired card was shown').not.toContain(id);
    expect((await cards(second)).map((c) => c.id)).not.toContain(id);
    expect((await datingRoutes.request(`/v1/matches/${id}`, { headers: H(first) })).status).toBe(404);
    const answer = await datingRoutes.request(`/v1/matches/${id}/decide`, {
      method: 'POST', headers: H(first), body: JSON.stringify({ yes: true }) });
    expect(answer.status).toBe(404);
    const town = (await (await worldRoutes.request('/v1/world', { headers: H(first) })).json()) as
      { agents: { rendezvousId?: string }[] };
    expect(town.agents.map((a) => a.rendezvousId)).not.toContain(id);
  });

  it('is recorded as expired, not as a no -- and a real no is still a no', async () => {
    const { id, first } = await met();
    await overdue(id);
    expect(await expireMatches()).toBeGreaterThanOrEqual(1);
    const { rows } = await owner.query<{ status: string; expired: boolean; yes: (boolean | null)[] }>(
      `SELECT r.status, r.expired_at IS NOT NULL AS expired,
              array_agg(b.human_says_yes ORDER BY b.for_user) AS yes
         FROM rendezvous r JOIN rendezvous_briefs b ON b.rendezvous_id = r.id
        WHERE r.id = $1 GROUP BY r.id`, [id]);
    expect(rows[0]).toEqual({ status: 'expired', expired: true, yes: [null, null] });
    // The measurement leaves it unlabelled rather than counting silence as a no.
    expect(pairOutcome(null, null)).toBeNull();
    expect(pairOutcome(true, null)).toBeNull();

    // A no, for contrast: 'lapsed', and a false on the brief.
    const other = await met();
    await decide(other.first.userId, other.id, false);
    const { rows: no } = await owner.query<{ status: string }>('SELECT status FROM rendezvous WHERE id = $1', [other.id]);
    expect(no[0]!.status).toBe('lapsed');
    void first;
  });
});
