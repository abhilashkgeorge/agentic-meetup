/**
 * A sentence hidden after a card was written comes off that card -- everywhere on it --
 * the next time the card is shown.
 *
 * WHAT WAS WRONG (found 2026-09-25, checking a review of the wants). Cards are written
 * once, when the agents meet, and keep the other person's sentences as text. Hiding a
 * sentence on "How you appear" kept it off every card written AFTER, and left it on
 * every card written before: as a quote, as "They said" beside a want, in the agents'
 * talk, in an answer, in the opener. The founder: "it must never show up as 'They said'
 * on her card."
 *
 * WHAT IS PINNED HERE (GET /v1/matches, the only route that serves a stored card):
 *   - before he hides it, his sentence is on her card -- so the fixture reaches the
 *     screen and the rest of the test means something;
 *   - after he hides it (through the real route), it is nowhere in her card: not a quote,
 *     not "They said", not a talk line or a date idea, not an answer, not the opener --
 *     and the want it stood beside is still listed, with nothing beside it;
 *   - a sentence he takes back goes the same way;
 *   - a stored sentence that breaks today's rules (a phone number) is dropped on read.
 *
 * Negative control, run by hand: GET /v1/matches serving readBrief(r) without liveCard
 * -> "after he hides it" fails.
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
const { datingRoutes } = await import('../src/api/dating.js');
const { meRoutes } = await import('../src/api/me.js');
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
  const tag = `cl-${label}-${Date.now()}-${Math.random()}`;
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

/** Something he typed, and the public fact that quotes it. */
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

const HIDE = 'Most Sundays I am up Nandi Hills before sunrise';
const KEEP = 'I cycle out of the city most weekends';
const TAKEN_BACK = 'I bake bread every Sunday morning';
const NUMBER = 'Weekend rides, ping me on 98450 12345';
const MINE = 'I dance salsa on Friday nights';

async function scene() {
  const her = await person('her');
  const him = await person('him');
  const hide = await says(him, HIDE);
  await says(him, KEEP);
  const back = await says(him, TAKEN_BACK);
  await says(him, NUMBER);
  const [lo, hi] = her.userId < him.userId ? [her, him] : [him, her];
  const r = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover)
     VALUES ($1,$2,$3,$4,0,'decided',$5) RETURNING id`, [lo.userId, hi.userId, lo.tenantId, hi.tenantId, her.userId]);
  // Her card, as a round wrote it: his sentences in every place a card carries them.
  const card = {
    v: 2, shared: [], work: [],
    quotes: [{ text: HIDE, when: '' }, { text: KEEP, when: '' }, { text: TAKEN_BACK, when: '' }, { text: NUMBER, when: '' }],
    qa: [
      { q: 'Weekends', ask: 'What do you do on weekends?', theirs: HIDE, mine: MINE },
      { q: 'Food', ask: 'What food could you eat every day?', theirs: TAKEN_BACK, mine: null },
    ],
    talk: {
      lines: [
        { who: 'you', kind: 'ask', text: 'What do you do on weekends?', q: 'Weekends' },
        { who: 'them', kind: 'say', text: HIDE },
        { who: 'you', kind: 'react', text: 'Love that.' },
        { who: 'you', kind: 'say', text: MINE },
        { who: 'them', kind: 'ask', text: 'How do you stay active?', q: 'Staying active' },
        { who: 'them', kind: 'say', text: KEEP },
      ],
      shared: [{ mine: MINE, theirs: HIDE }],
      date: { idea: 'Sunrise walk up Nandi Hills', mine: MINE, theirs: HIDE },
    },
    wants: [
      { want: 'Someone outdoorsy', kind: 'wants', theirs: HIDE, status: 'met' },
      { want: 'Someone who moves', kind: 'wants', theirs: KEEP, status: 'met' },
    ],
  };
  await owner.query(
    `INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, overlap_quotes, concern, questions)
     VALUES ($1,$2,'Here for something long-term · 31',$3,'',$4)`,
    [r.rows[0]!.id, her.userId, JSON.stringify(card), JSON.stringify([`Ask them about: "${HIDE}"`])]);
  await owner.query(`INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, concern) VALUES ($1,$2,'h','')`,
    [r.rows[0]!.id, him.userId]);
  return { her, him, hide, back };
}

const herCard = async (her: P) => {
  const res = await datingRoutes.request('/v1/matches', { headers: { Authorization: `Bearer ${her.token}` } });
  expect(res.status).toBe(200);
  const body = await res.json() as { matches: Record<string, unknown>[] };
  return body.matches[0]! as {
    quotes: { text: string }[]; qa: { theirs: string | null; mine: string | null }[]; opener: string | null;
    talk: { lines: { who: string; kind: string; text: string }[]; shared: unknown[]; date: unknown } | null;
    wants: { want: string; theirs: string | null }[];
  };
};

describe('a card, shown', () => {
  it('carries his sentence before he hides it -- the fixture reaches the screen', async () => {
    const { her } = await scene();
    const card = await herCard(her);
    expect(JSON.stringify(card)).toContain(HIDE);
    expect(card.wants.find((w) => w.want === 'Someone outdoorsy')?.theirs).toBe(HIDE);
  });

  it('after he hides it, it is nowhere on her card, and the want it stood beside is still listed', async () => {
    const { her, him, hide } = await scene();
    const res = await meRoutes.request(`/v1/facts/${hide}/disclosure`, {
      method: 'POST', headers: { Authorization: `Bearer ${him.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: true }),
    });
    expect(res.status).toBe(200);

    const card = await herCard(her);
    expect(JSON.stringify(card), 'a hidden sentence is still on her card').not.toContain(HIDE);
    // Everything else of his that is still his to show stays.
    expect(card.quotes.map((q) => q.text)).toContain(KEEP);
    expect(card.wants).toEqual([
      { want: 'Someone outdoorsy', kind: 'wants', theirs: null },
      { want: 'Someone who moves', kind: 'wants', theirs: KEEP },
    ]);
    expect(card.qa).toContainEqual(expect.objectContaining({ theirs: null, mine: MINE }));
    expect(card.opener).toBeNull();
    expect(card.talk!.date).toBeNull();
    expect(card.talk!.shared).toEqual([]);
    const kinds = card.talk!.lines.map((l) => l.kind);
    kinds.forEach((k, i) => { if (k === 'react') expect(kinds[i - 1]).toBe('say'); });
    expect(card.talk!.lines.some((l) => l.who === 'them' && l.text === KEEP)).toBe(true);
  });

  it('a sentence he takes back goes the same way', async () => {
    const { her, back } = await scene();
    await owner.query(`UPDATE facts SET status = 'retracted', valid_to = now() WHERE id = $1`, [back]);
    const card = await herCard(her);
    expect(JSON.stringify(card)).not.toContain(TAKEN_BACK);
    expect(card.qa.some((l) => l.theirs === null && l.mine === null), 'an empty answer line was kept').toBe(false);
  });

  it('a stored sentence that breaks today\'s rules is dropped on read', async () => {
    const { her } = await scene();
    expect(JSON.stringify(await herCard(her))).not.toContain('98450');
  });
});
