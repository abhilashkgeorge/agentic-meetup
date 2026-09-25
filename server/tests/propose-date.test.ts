/**
 * "Propose this date" sends the agents' idea as a message from the person, and the
 * agent never schedules anything.
 *
 * WHAT THE FOUNDER ASKED FOR (build list item 7): a button that sends the date idea as
 * a normal chat message from me; the agent never schedules.
 *
 * WHAT WAS MISSING: once two people were introduced, the idea the agents came back with
 * was nowhere -- no route read it after the reveal.
 *
 * WHAT IS PINNED HERE:
 *   - the message is from the caller, in the conversation, the other person gets it,
 *     and its words are the idea in a fixed frame -- nothing added: no day, no time;
 *   - words sent by the phone are ignored: the server builds the message itself;
 *   - it is marked as a proposal (0067) so the funnel can count it, and both sides see
 *     "proposed"; a second proposal is refused, a retry of the same one is not a second;
 *   - the idea is withdrawn once the other person hides the sentence it stands on;
 *   - nothing before the introduction, and nothing across a block.
 *
 * Negative controls, run by hand:
 *   - the route taking the phone's `text` instead of building its own -> "ignores
 *     words from the phone" fails
 *   - liveIdea without liveCard (the stored idea as written)          -> "withdrawn"
 *     fails
 *   - without the one-proposal check                                  -> "a second
 *     proposal" fails
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
const { dateIdeaRoutes, proposalText } = await import('../src/api/date-idea.js');
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
  const tag = `pd-${label}-${Date.now()}-${Math.random()}`;
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

/** Something they typed, and the public fact that quotes it. */
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

/** Two people, introduced, each with a card carrying the agents' date idea. */
async function scene(status = 'introduced') {
  const her = await person('her');
  const him = await person('him');
  await says(her, HERS);
  const hisFact = await says(him, HIS);
  const [lo, hi] = her.userId < him.userId ? [her, him] : [him, her];
  const r = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover)
     VALUES ($1,$2,$3,$4,0,$5,$6) RETURNING id`, [lo.userId, hi.userId, lo.tenantId, hi.tenantId, status, her.userId]);
  const card = (mine: string, theirs: string) => JSON.stringify({
    v: 2, shared: [], work: [], quotes: [], qa: [], wants: [],
    talk: { lines: [], shared: [], date: { idea: IDEA, mine, theirs } },
  });
  for (const [who, mine, theirs] of [[her, HERS, HIS], [him, HIS, HERS]] as const) {
    await owner.query(
      `INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, overlap_quotes, concern, questions)
       VALUES ($1,$2,'Here for something long-term · 30',$3,'','[]')`, [r.rows[0]!.id, who.userId, card(mine, theirs)]);
  }
  return { her, him, id: r.rows[0]!.id, hisFact };
}

const H = (p: P) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' });
const look = async (p: P, id: string) =>
  (await (await dateIdeaRoutes.request(`/v1/conversations/${id}/date`, { headers: H(p) })).json()) as
    { idea: string | null; proposed: boolean; quiet: boolean };
const propose = (p: P, id: string, extra: Record<string, unknown> = {}, messageId: string = crypto.randomUUID()) =>
  dateIdeaRoutes.request(`/v1/conversations/${id}/date`, {
    method: 'POST', headers: H(p), body: JSON.stringify({ messageId, ...extra }) });
const thread = async (p: P, id: string) =>
  ((await (await messageRoutes.request(`/v1/conversations/${id}/messages`, { headers: H(p) })).json()) as
    { messages: { senderId?: string; mine?: boolean; text?: string; body?: string }[] }).messages;

describe('Propose this date', () => {
  it('sends the idea as a message from me, with nothing added, and both see it proposed', async () => {
    const { her, him, id } = await scene();
    expect(await look(her, id)).toEqual({ idea: IDEA, proposed: false, quiet: false });

    // A phone that sends words of its own has them ignored.
    const res = await propose(her, id, { text: 'Saturday 7pm at my place', body: 'x' });
    expect(res.status).toBe(200);
    const sent = ((await res.json()) as { message: { senderId: string; text: string } }).message;
    expect(sent.senderId).toBe(her.userId);
    expect(sent.text, 'the agent added something, or the phone did').toBe(proposalText(IDEA));
    expect(sent.text).toBe('How about this: Sunrise walk in Cubbon Park, then filter coffee?');

    // A normal message: in his conversation, from her.
    const his = await thread(him, id);
    expect(his.map((m) => m.text ?? m.body)).toContain(proposalText(IDEA));
    const { rows } = await owner.query<{ kind: string; sender_id: string }>(
      'SELECT kind, sender_id FROM messages WHERE rendezvous_id = $1', [id]);
    expect(rows).toEqual([{ kind: 'date_idea', sender_id: her.userId }]);

    expect(await look(her, id)).toEqual({ idea: IDEA, proposed: true, quiet: false });
    expect(await look(him, id)).toEqual({ idea: IDEA, proposed: true, quiet: false });
  });

  it('one proposal per conversation, and a retry of it is not a second', async () => {
    const { her, him, id } = await scene();
    const messageId = crypto.randomUUID();
    expect((await propose(her, id, {}, messageId)).status).toBe(200);
    expect((await propose(her, id, {}, messageId)).status, 'a retry was refused').toBe(200);
    expect((await propose(him, id)).status, 'a second proposal was sent').toBe(409);
    const { rows } = await owner.query('SELECT 1 FROM messages WHERE rendezvous_id = $1', [id]);
    expect(rows).toHaveLength(1);
  });

  it('is withdrawn once the other person hides the sentence it stands on', async () => {
    const { her, id, hisFact } = await scene();
    await owner.query(`UPDATE facts SET disclosure = 'private' WHERE id = $1`, [hisFact]);
    expect(await look(her, id)).toEqual({ idea: null, proposed: false, quiet: false });
    expect((await propose(her, id)).status).toBe(404);
  });

  it('is nothing before the introduction, and nothing across a block', async () => {
    const early = await scene('decided');
    expect(await look(early.her, early.id)).toEqual({ idea: null, proposed: false, quiet: false });
    expect((await propose(early.her, early.id)).status).toBe(404);

    const blocked = await scene();
    await owner.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2)', [blocked.him.userId, blocked.her.userId]);
    expect((await propose(blocked.her, blocked.id)).status).toBe(404);
    const { rows } = await owner.query('SELECT 1 FROM messages WHERE rendezvous_id = $1', [blocked.id]);
    expect(rows).toHaveLength(0);
  });
});
