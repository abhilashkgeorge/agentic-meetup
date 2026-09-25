/**
 * The recap after a round: templates and the person's own shareable words, nothing else.
 *
 * WHAT THE FOUNDER ASKED FOR (build list item 11): "agent recap after each round (code
 * templates + shareable own words only, no verdicts, no numbers, no invented facts)."
 *
 * WHAT IS PINNED HERE:
 *   - the sentence about what happened is a template, with no digit and no verdict word;
 *   - the person's own sentences appear only if their agent used them this round AND they
 *     are shareable now: hidden since, or holding a contact detail, and they are gone;
 *   - the other person's words never appear, nor the date idea (a model wrote it);
 *   - "I don't know" becomes a topic to tell the agent about, never a sentence;
 *   - GET /v1/matches carries it once the round is done, built from that round's cards.
 *
 * Negative controls, run 2026-09-25, each restored byte-identical:
 *   - composeRecap repeating the date idea              -> "never the date idea" fails
 *   - composeRecap without the live check               -> "hidden since" fails
 *   - the matches route not sending it                  -> "carries it" fails
 * (Their words cannot slip in even without the `who` filter: a sentence of theirs is
 * not among the person's own shareable sentences, which every repeated line must be.)
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return { ...real, decideModel: () => null,
    llm: { ...real.llm, complete: async () => { throw new Error('no model'); }, decide: async () => { throw new Error('no model'); } } };
});

const { env } = await import('../src/env.js');
const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { commit } = await import('../src/memory/facts.js');
const episodes = await import('../src/memory/episodes.js');
const { composeRecap, RECAP_WENT } = await import('../src/matching/recap.js');
const { sentenceKey, plainCard } = await import('../src/matching/brief.js');
const { VERDICT } = await import('../src/matching/talk.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) {
    await owner.query('DELETE FROM facts WHERE tenant_id = ANY($1)', [made]);
    await owner.query('DELETE FROM episodes WHERE tenant_id = ANY($1)', [made]);
    await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  }
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

const MINE = 'I cycle out of the city most weekends';
const MINE_TOO = 'Filter coffee is the best part of my morning';
const HIDDEN = 'I bake bread every Sunday morning';
const NUMBER = 'Weekend rides, ping me on 98450 12345';
const THEIRS = 'I walk in Cubbon Park before work';
const IDEA = 'Sunrise walk in Cubbon Park, then filter coffee';

const card = (over: Partial<ReturnType<typeof plainCard>>) => ({ ...plainCard(), ...over });

describe('composeRecap', () => {
  const live = new Set([MINE, MINE_TOO, NUMBER].map(sentenceKey));

  it('says what happened in a template: no digit, no verdict', () => {
    expect(composeRecap(0, [], live).went).toBe(RECAP_WENT.nobody);
    expect(composeRecap(1, [], live).went).toBe(RECAP_WENT.one);
    expect(composeRecap(3, [], live).went).toBe(RECAP_WENT.some);
    for (const t of Object.values(RECAP_WENT)) {
      expect(t).not.toMatch(/\d/);
      expect(t).not.toMatch(VERDICT);
    }
  });

  it('repeats only their own shareable words -- never their words, never the date idea', () => {
    const r = composeRecap(1, [card({
      qa: [
        { q: 'Weekends', ask: 'What do you do on weekends?', theirs: THEIRS, mine: MINE },
        { q: 'Kids', ask: 'Do you want kids?', theirs: THEIRS, mine: null },
      ],
      talk: {
        lines: [
          { who: 'them', kind: 'ask', text: 'What do you do in the mornings?', q: 'Mornings' },
          { who: 'you', kind: 'say', text: MINE_TOO },
          { who: 'you', kind: 'ask', text: 'What do you eat?', q: 'Food' },
          { who: 'them', kind: 'say', text: THEIRS },
          { who: 'them', kind: 'ask', text: 'Where do you live?', q: 'Home' },
          { who: 'you', kind: 'dunno', text: "I don't know." },
        ],
        shared: [{ mine: MINE, theirs: THEIRS }],
        date: { idea: IDEA, mine: MINE, theirs: THEIRS },
      },
    })], live);
    expect(r.said).toEqual([MINE, MINE_TOO]);
    expect(r.topics).toEqual(['Weekends', 'Kids', 'Mornings']);
    expect(r.unsure).toEqual(['Kids', 'Home']);
    const all = JSON.stringify(r);
    expect(all, 'their words reached the recap').not.toContain(THEIRS);
    expect(all, 'the date idea reached the recap').not.toContain(IDEA);
  });

  it('drops a sentence hidden since, and one holding a contact detail', () => {
    const r = composeRecap(1, [card({
      qa: [
        { q: 'Sundays', ask: 'What do you do on Sundays?', theirs: null, mine: HIDDEN },
        { q: 'Weekends', ask: 'What do you do on weekends?', theirs: null, mine: NUMBER },
      ],
    })], live);
    expect(r.said, 'a sentence hidden since, or with a number to call, was repeated').toEqual([]);
  });
});

interface P { tenantId: string; userId: string; token: string }
async function person(label: string): Promise<P> {
  const tag = `rc-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  await owner.query(`INSERT INTO match_profile (user_id, tenant_id, in_pool, intent) VALUES ($1,$2,false,$3)`, [userId, tenantId, [tag]]);
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}
const says = async (p: P, sentence: string) => (await tenantSession(p, async (db) => {
  await episodes.append(db, {
    tenantId: p.tenantId, userId: p.userId, sessionId: crypto.randomUUID(), turnId: crypto.randomUUID(),
    role: 'user', source: 'text', rawText: sentence, occurredAt: new Date(),
  });
  return commit(db, p, {
    predicate: 'did', objectText: sentence.slice(0, 40), stance: 'asserted', originClass: 'owner', sourceQuote: sentence,
    sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
  });
})).factId!;

describe('after a round', () => {
  it('GET /v1/matches carries the recap, built from that round\'s own cards', async () => {
    const me = await person('me');
    const them = await person('them');
    await says(me, MINE);
    await owner.query(
      `INSERT INTO rounds (user_id, tenant_id, status, requested_at, finished_at, result)
       VALUES ($1,$2,'done', now() - interval '5 minutes', now() + interval '1 minute', $3)`,
      [me.userId, me.tenantId, JSON.stringify({
        userId: me.userId, considered: 1, met: them.userId, metAll: [them.userId], bothYes: 0, runs: 0, passed: true, costUsd: 0,
      })]);
    const [lo, hi] = me.userId < them.userId ? [me, them] : [them, me];
    const r = await owner.query<{ id: string }>(
      `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover, answer_by)
       VALUES ($1,$2,$3,$4,0,'decided',$5, now() + interval '3 days') RETURNING id`,
      [lo.userId, hi.userId, lo.tenantId, hi.tenantId, me.userId]);
    await owner.query(
      `INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, overlap_quotes, concern, questions)
       VALUES ($1,$2,'x',$3,'','[]')`, [r.rows[0]!.id, me.userId, JSON.stringify({
        v: 2, shared: [], work: [], quotes: [], wants: [], talk: null,
        qa: [{ q: 'Weekends', ask: 'What do you do on weekends?', theirs: THEIRS, mine: MINE }],
      })]);

    const res = await datingRoutes.request('/v1/matches', { headers: { Authorization: `Bearer ${me.token}` } });
    const body = (await res.json()) as { round: { recap: unknown } | null };
    expect(body.round?.recap).toEqual({ went: RECAP_WENT.one, said: [MINE], topics: ['Weekends'], unsure: [] });
  });
});
