/**
 * After a date: "You wanted <your own words>. Did they seem that way?"
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-26): add to the post-date check-in "Were they like
 * their profile said?" -- that tells you where people fudge. Asked per want, in the
 * person's own words, and only about a want their card already showed as matching: the
 * check-in asks about nothing the person was not shown (checkin/questions.ts).
 *
 * WHAT IS PINNED HERE:
 *   - a want tied to a tapped question, shown as "Matches" on the card, is asked about --
 *     with the reader's own words, never the other person's answer;
 *   - one that did not match, one nobody could check, and one never tied are not;
 *   - nor one tied to a SITUATION question, even when it matched (the founder's (b),
 *     2026-09-29): its card says only "A private topic", and asking only when it matched
 *     would tell the reader her answer anyway;
 *   - the answer is stored with the check-in, an answer to a want never asked is refused,
 *     and a "could not be with" want is asked the other way round.
 *
 * Negative controls, run by hand:
 *   - matchedWants without the status filter      -> "only a want that matched" fails
 *   - the check-in routes without wants            -> "is asked about" fails
 *   - matchedWants by the stored status, not what the card showed (2026-09-29)
 *                                                  -> "only a want that matched" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

process.env.MET_ASK_AFTER_HOURS = '0';
vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return { ...real, decideModel: () => null,
    llm: { ...real.llm, complete: async () => { throw new Error('no model'); }, decide: async () => { throw new Error('no model'); } } };
});

const { pool, closeMatchPool, tenantSession } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { wantRoutes } = await import('../src/api/wants.js');
const { checkinQuestions } = await import('../src/checkin/questions.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
afterAll(async () => {
  if (made.length) {
    await owner.query('DELETE FROM facts WHERE tenant_id = ANY($1)', [made]);
    await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  }
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string; token: string }
async function person(label: string): Promise<P> {
  const tag = `cw-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  await owner.query(`INSERT INTO match_profile (user_id, tenant_id, in_pool, intent) VALUES ($1,$2,false,$3)`, [userId, tenantId, [tag]]);
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}
const H = (me: P) => ({ Authorization: `Bearer ${me.token}`, 'Content-Type': 'application/json' });

const SAVER = 'I want a saver, not an impulse spender';
const STREET = 'Okay with street food and small shops';
const PETS = 'Someone who loves dogs';
const KIND = 'Someone kind and funny';
const WORK = 'Someone who works in AI';

async function scene() {
  const me = await person('me');
  const them = await person('them');
  await tenantSession(me, (db) => commit(db, me, {
    predicate: 'seeking', objectText: `${SAVER}. ${STREET}. ${PETS}. ${KIND}. ${WORK}.`, stance: 'asserted', originClass: 'owner',
    sourceQuote: 'x', sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
  }));
  for (const [want, q, a] of [[SAVER, 'sit-windfall', ['save-invest']], [STREET, 'sit-street-food', ['dig-in']], [PETS, 'sit-pet-sitting', ['gladly']], [WORK, 'q-works-in', ['ai']]] as const) {
    expect((await wantRoutes.request('/v1/me/wants/question', {
      method: 'POST', headers: H(me), body: JSON.stringify({ want, questionId: q, accepted: [...a] }) })).status).toBe(200);
  }
  const [lo, hi] = me.userId < them.userId ? [me, them] : [them, me];
  const r = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover, introduced_at)
     VALUES ($1,$2,$3,$4,0,'introduced',$1, now() - interval '4 days') RETURNING id`, [lo.userId, hi.userId, lo.tenantId, hi.tenantId]);
  const id = r.rows[0]!.id;
  // What MY card recorded: the work want matched (shown "Matches"), the saver want
  // matched too (a situation: shown only "A private topic"), street food did not, pets
  // could not be checked, and the untied want said nothing.
  const card = { v: 2, shared: [], work: [], quotes: [], qa: [], talk: null, wants: [
    { want: WORK, kind: 'wants', theirs: null, status: 'met', private: true },
    { want: SAVER, kind: 'wants', theirs: null, status: 'met', private: true },
    { want: STREET, kind: 'wants', theirs: null, status: 'not_met', private: true },
    { want: PETS, kind: 'wants', theirs: null, status: 'cant_check', private: true },
    { want: KIND, kind: 'wants', theirs: null, status: 'unknown' },
  ] };
  for (const who of [me, them]) {
    await owner.query(
      `INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, overlap_quotes, concern, questions, human_says_yes, decided_at, met)
       VALUES ($1,$2,'h',$3,'','[]',true, now(), true)`, [id, who.userId, JSON.stringify(who === me ? card : { v: 2, shared: [], work: [], quotes: [] })]);
  }
  return { me, them, id };
}

describe('the after-date check-in', () => {
  it('asks about a want that matched, in the reader’s own words -- and only that one', async () => {
    const { me, id } = await scene();
    const got = (await (await datingRoutes.request(`/v1/matches/${id}/checkin`, { headers: H(me) })).json()) as {
      state: string; questions: { key: string; text: string; identity: boolean }[];
    };
    expect(got.state).toBe('ask');
    const wantQs = got.questions.filter((q) => q.key.startsWith('want:'));
    expect(wantQs, 'only a want that matched is asked about -- and never a situation one').toEqual([
      { key: 'want:q-works-in', text: `You wanted “${WORK}”. Did they seem that way?`, identity: false },
    ]);

    // Stored with the check-in; a want never asked about is refused -- the matched
    // situation want among them.
    for (const never of ['want:sit-street-food', 'want:sit-windfall']) {
      const bad = await datingRoutes.request(`/v1/matches/${id}/checkin`, {
        method: 'POST', headers: H(me), body: JSON.stringify({ answers: { [never]: 'no' }, feltSafe: true, seeAgain: null }) });
      expect(bad.status, never).toBe(400);
    }
    const ok = await datingRoutes.request(`/v1/matches/${id}/checkin`, {
      method: 'POST', headers: H(me), body: JSON.stringify({ answers: { 'want:q-works-in': 'no' }, feltSafe: true, seeAgain: null }) });
    expect(ok.status).toBe(200);
    const { rows } = await owner.query<{ answers: Record<string, string> }>(
      'SELECT answers FROM date_checkins WHERE rendezvous_id = $1 AND for_user = $2', [id, me.userId]);
    expect(rows[0]!.answers).toEqual({ 'want:q-works-in': 'no' });
  });

  it('asks a "could not be with" want the other way round', () => {
    const qs = checkinQuestions({ name: 'Someone', age: null, livesIn: null, tags: [], photosVisible: false,
      wants: [{ key: 'want:sit-last-minute', text: 'Someone who parties every weekend', kind: 'not' }] });
    expect(qs).toEqual([{ key: 'want:sit-last-minute', text: "You didn't want “Someone who parties every weekend”. Were they fine on that?", identity: false }]);
  });
});
