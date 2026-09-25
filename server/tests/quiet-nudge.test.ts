/**
 * One gentle nudge when a new conversation is quiet for two days, once per match.
 *
 * WHAT THE FOUNDER ASKED FOR (build list item 8): "one gentle nudge if chat quiet 2 days
 * after match, mentioning date idea, once per match" -- in the app for now.
 *
 * WHAT WAS MISSING: nothing noticed a conversation nobody started.
 *
 * WHAT IS PINNED HERE:
 *   - due two days after the introduction with nothing written; not after one day;
 *     not while somebody wrote in the last two days; due again once it has been quiet
 *     two days since the last message -- if it was never seen;
 *   - it comes with the date idea, when there is one;
 *   - each person gets their own, and once seen it never comes back for that match,
 *     however quiet it gets again;
 *   - the chat list shows it by the same rule;
 *   - nothing across a block.
 *
 * Negative controls, run by hand:
 *   - QUIET_DUE without "b.nudged_at IS NULL"        -> "never comes back" fails
 *   - QUIET_DUE without the recent-message check      -> "not while somebody wrote"
 *     fails
 *   - QUIET_DUE without the two days since the match  -> "not after one day" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real,
    decideModel: () => null,
    llm: {
      ...real.llm,
      complete: async () => { throw new Error('no model in this test'); },
      decide: async () => { throw new Error('no model in this test'); },
    },
  };
});

const { env } = await import('../src/env.js');
const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { commit } = await import('../src/memory/facts.js');
const episodes = await import('../src/memory/episodes.js');
const { dateIdeaRoutes } = await import('../src/api/date-idea.js');
const { messageRoutes } = await import('../src/api/messages.js');
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

interface P { tenantId: string; userId: string; token: string }
async function person(label: string): Promise<P> {
  const tag = `qn-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  await owner.query(`INSERT INTO match_profile (user_id, tenant_id, in_pool, intent) VALUES ($1,$2,false,$3)`,
    [userId, tenantId, [tag]]);
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

const HERS = 'I walk in Cubbon Park before work';
const HIS = 'Filter coffee is the best part of my morning';
const IDEA = 'Sunrise walk in Cubbon Park, then filter coffee';

/** Introduced `daysAgo` days ago, each with a card carrying the date idea. */
async function scene(daysAgo: number) {
  const her = await person('her');
  const him = await person('him');
  await says(her, HERS);
  await says(him, HIS);
  const [lo, hi] = her.userId < him.userId ? [her, him] : [him, her];
  const r = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover, introduced_at)
     VALUES ($1,$2,$3,$4,0,'introduced',$5, now() - ($6::int * interval '1 day')) RETURNING id`,
    [lo.userId, hi.userId, lo.tenantId, hi.tenantId, her.userId, daysAgo]);
  const card = (mine: string, theirs: string) => JSON.stringify({
    v: 2, shared: [], work: [], quotes: [], qa: [], wants: [],
    talk: { lines: [], shared: [], date: { idea: IDEA, mine, theirs } },
  });
  for (const [who, mine, theirs] of [[her, HERS, HIS], [him, HIS, HERS]] as const) {
    await owner.query(
      `INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, overlap_quotes, concern, questions)
       VALUES ($1,$2,'Here for something long-term · 30',$3,'','[]')`, [r.rows[0]!.id, who.userId, card(mine, theirs)]);
  }
  return { her, him, id: r.rows[0]!.id };
}

const H = (p: P) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' });
const chat = async (p: P, id: string) =>
  (await (await dateIdeaRoutes.request(`/v1/conversations/${id}/date`, { headers: H(p) })).json()) as
    { idea: string | null; proposed: boolean; quiet: boolean };
const listed = async (p: P, id: string) =>
  ((await (await messageRoutes.request('/v1/conversations', { headers: H(p) })).json()) as
    { conversations: { id: string; quiet: boolean }[] }).conversations.find((c) => c.id === id)?.quiet;
const seen = (p: P, id: string) =>
  dateIdeaRoutes.request(`/v1/conversations/${id}/nudge`, { method: 'POST', headers: H(p) });
/** A message from `p`, written `daysAgo` days ago. */
const wrote = (p: P, id: string, daysAgo: number) => owner.query(
  `INSERT INTO messages (id, rendezvous_id, sender_id, body, seq, sent_at)
   VALUES ($1,$2,$3,'hi', next_message_seq($2), now() - ($4::float * interval '1 day'))`,
  [crypto.randomUUID(), id, p.userId, daysAgo]);

describe('the quiet nudge', () => {
  it('is due two days after the match with nothing written, with the date idea -- and not after one day', async () => {
    const early = await scene(1);
    expect((await chat(early.her, early.id)).quiet).toBe(false);

    const { her, him, id } = await scene(3);
    expect(await chat(her, id)).toEqual({ idea: IDEA, proposed: false, quiet: true });
    expect(await listed(her, id)).toBe(true);
    expect((await chat(him, id)).quiet).toBe(true);
  });

  it('is not due while somebody wrote in the last two days, and is once they stop', async () => {
    const { her, him, id } = await scene(5);
    await wrote(him, id, 1);
    expect((await chat(her, id)).quiet).toBe(false);
    expect(await listed(her, id)).toBe(false);

    const later = await scene(5);
    await wrote(later.him, later.id, 3);
    expect((await chat(later.her, later.id)).quiet).toBe(true);
    void her;
  });

  it('each person gets their own, and once seen it never comes back for that match', async () => {
    const { her, him, id } = await scene(3);
    expect((await seen(her, id)).status).toBe(200);
    expect((await chat(her, id)).quiet).toBe(false);
    expect(await listed(her, id)).toBe(false);
    // His is still his.
    expect((await chat(him, id)).quiet).toBe(true);

    // They talk, then it goes quiet again for days: still no second nudge for her.
    await wrote(him, id, 4);
    expect((await chat(her, id)).quiet).toBe(false);
  });

  it('never across a block', async () => {
    const { her, him, id } = await scene(3);
    await owner.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2)', [him.userId, her.userId]);
    expect((await chat(her, id)).quiet).toBe(false);
    expect(await listed(her, id)).toBeUndefined();
  });
});
