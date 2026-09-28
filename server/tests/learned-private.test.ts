/**
 * What the clone learns in chat is private until the person says it may be shared.
 *
 * WHAT CHANGED (the founder, 2026-09-25): "sentences learned from clone chat are private
 * by default. The agent can use them for matching, but they're never quoted on cards or
 * in the agents' chat until the person taps 'OK to share'. Only answers to the 5 set
 * questions are shareable by default." Before this, everything the extractor learned
 * from a public kind -- an interest, a thing they did -- was public at once, and a
 * sentence typed in passing to the clone could be quoted to a stranger.
 *
 * WHAT IS PINNED HERE (through the real "tell" route, the extractor stubbed):
 *   - a learned sentence starts match-only: the agent uses it for matching (it is in the
 *     profile's tags) but it comes out of no quote door and makes no public tag;
 *   - "How you appear" lists it, with "OK to share"; sharing it (the disclosure route)
 *     makes it quotable and its tag public, and it leaves that list;
 *   - an answer to one of the five set questions is shareable from the start;
 *   - a Yes on a heard work or exercise sentence (fields that wait for a Yes since
 *     2026-09-28) keeps it match-only: "that is true" is not "OK to share";
 *   - public tags are decided per fact: one shared interest does not make every interest
 *     of theirs public.
 *
 * Negative controls, run by hand:
 *   - extract.ts without the match-only disclosure  -> "starts private" fails
 *   - publicTags filtering by kind, as it used to    -> "per fact" fails
 *   - the appearance route without `learned`        -> "OK to share" fails
 *   - learnedDisclosure back to "any tapped field keeps its default" (the 34f33cf
 *     behaviour), run 2026-09-28                    -> "not OK to share" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({ parsed: {} as unknown }));
vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real,
    decideModel: () => null,
    modelFor: () => 'google:gemini-3.5-flash-lite',
    llm: {
      ...real.llm,
      complete: async () => ({
        text: '', parsed: stub.parsed,
        usage: { inputTokens: 0, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
                 reasoningTokens: 0, provider: 'google', modelId: 'x', costUsd: 0, latencyMs: 0 },
      }),
      decide: async () => { throw new Error('no model in this test'); },
    },
  };
});

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const episodes = await import('../src/memory/episodes.js');
const { loadQuotes, learnedDisclosure } = await import('../src/matching/brief.js');
const { knowledgeRoutes } = await import('../src/api/profile.js');
const { TAPPED_PREDICATES } = await import('../src/onboarding/questions.js');
const { publicTags } = await import('../src/matching/rendezvous.js');
const { rebuildMatchProfile } = await import('../src/matching/profile.js');
const { SHEET_SOURCES } = await import('../src/matching/answer-sheet.js');
const { tellRoutes } = await import('../src/api/tell.js');
const { meRoutes } = await import('../src/api/me.js');
const { storyRoutes } = await import('../src/api/stories.js');
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

type Person = { tenantId: string; userId: string; token: string };
async function person(label: string): Promise<Person> {
  const tag = `lp-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}
const H = (p: Person) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.77' });

const TABLA = 'I have been learning the tabla for two years now';

/** Tell the clone one sentence; the stubbed extractor learns one interest from it. */
async function tellTabla(me: Person): Promise<string> {
  stub.parsed = {
    facts: [{ predicate: 'interest', object_text: 'tabla', stance: 'asserted', hedge_span: '', source_quote: TABLA, valid_from: '' }],
    possibly_false: [], intents: [],
  };
  const res = await tellRoutes.request('/v1/tell', { method: 'POST', headers: H(me), body: JSON.stringify({ text: `${TABLA}.`, sessionId: crypto.randomUUID() }) });
  expect(res.status).toBe(200);
  const { rows } = await owner.query<{ id: string; disclosure: string }>(
    `SELECT id, disclosure FROM facts WHERE user_id = $1 AND predicate = 'interest' AND object_text = 'tabla' AND status = 'active'`,
    [me.userId]);
  expect(rows).toHaveLength(1);
  return rows[0]!.id;
}

const tagsOf = async (me: Person) => {
  await tenantSession(me, (c) => rebuildMatchProfile(c, me));
  const { rows } = await owner.query<{ attribute_tags: string[] }>('SELECT attribute_tags FROM match_profile WHERE user_id = $1', [me.userId]);
  return rows[0]?.attribute_tags ?? [];
};
const appearance = async (me: Person) => (await (await meRoutes.request('/v1/me/appearance', { headers: H(me) }))
  .json()) as { quotes: { text: string }[]; learned: { factId: string; text: string }[] };

describe('what the clone learns in chat', () => {
  it('starts private: used for matching, quoted nowhere, and no public tag', async () => {
    const me = await person('private');
    const id = await tellTabla(me);
    const { rows } = await owner.query<{ disclosure: string }>('SELECT disclosure FROM facts WHERE id = $1', [id]);
    expect(rows[0]!.disclosure, 'a learned sentence started shareable').toBe('matchable_only');
    // The agent uses it for matching...
    expect(await tagsOf(me)).toContain('interest:tabla');
    // ...and nobody hears it.
    for (const opts of [{}, { predicates: SHEET_SOURCES, limit: 40 }]) {
      expect((await loadQuotes(me, opts)).map((q) => q.text)).not.toContain(TABLA);
    }
    expect(await tenantSession(me, (c) => publicTags(c, me.userId))).not.toContain('interest:tabla');
  });

  it('is listed with "OK to share", and sharing it is what makes it quotable', async () => {
    const me = await person('share');
    const id = await tellTabla(me);
    let seen = await appearance(me);
    expect(seen.learned).toEqual([{ factId: id, text: TABLA }]);
    expect(seen.quotes.map((q) => q.text)).not.toContain(TABLA);

    const ok = await meRoutes.request(`/v1/facts/${id}/disclosure`, { method: 'POST', headers: H(me), body: JSON.stringify({ hidden: false }) });
    expect(ok.status).toBe(200);
    expect((await loadQuotes(me)).map((q) => q.text)).toContain(TABLA);
    await tagsOf(me);
    expect(await tenantSession(me, (c) => publicTags(c, me.userId))).toContain('interest:tabla');
    seen = await appearance(me);
    expect(seen.learned.map((l) => l.factId)).not.toContain(id);
  });

  it('an answer to one of the five set questions is shareable from the start', async () => {
    const me = await person('story');
    const SUNDAY = 'Filter coffee on the balcony, then a long walk in Lalbagh';
    const res = await storyRoutes.request('/v1/stories', { method: 'POST', headers: H(me), body: JSON.stringify({ id: 'story-sunday', text: SUNDAY }) });
    expect(res.status).toBe(200);
    expect((await loadQuotes(me)).map((q) => q.text)).toContain(SUNDAY);
  });

  it('a Yes on a heard work or exercise sentence means "true", not "OK to share"', async () => {
    // Since 2026-09-28 (34f33cf) these fields wait for a Yes like a card -- and the old
    // rule let a tapped field keep its default, which for them is public AND quotable.
    const me = await person('confirm');
    const SAID = 'I moved into AI research last year and I run most mornings before work';
    const heard = (predicate: string, objectText: string) =>
      ({ predicate, object_text: objectText, stance: 'asserted', hedge_span: '', source_quote: SAID, valid_from: '' });
    stub.parsed = { facts: [heard('works_in', 'ai'), heard('exercise_habit', 'often'), heard('relationship_intent', 'long_term')],
                    possibly_false: [], intents: [] };
    const told = await tellRoutes.request('/v1/tell', { method: 'POST', headers: H(me), body: JSON.stringify({ text: `${SAID}.`, sessionId: crypto.randomUUID() }) });
    expect(told.status).toBe(200);
    const { rows: held } = await owner.query<{ id: string }>(
      `SELECT id FROM facts WHERE user_id = $1 AND status = 'staged' AND valid_to IS NULL`, [me.userId]);
    expect(held).toHaveLength(3);
    for (const { id } of held) {
      const yes = await knowledgeRoutes.request('/v1/knowledge/confirm', { method: 'POST', headers: H(me), body: JSON.stringify({ factId: id, verdict: 'yes' }) });
      expect(yes.status).toBe(200);
    }
    const { rows } = await owner.query<{ predicate: string; disclosure: string }>(
      `SELECT predicate, disclosure FROM facts WHERE user_id = $1 AND status = 'active' AND valid_to IS NULL`, [me.userId]);
    const level = Object.fromEntries(rows.map((r) => [r.predicate, r.disclosure]));
    expect(level.works_in, 'a confirmed chat sentence about work went public').toBe('matchable_only');
    expect(level.exercise_habit).toBe('matchable_only');
    // The exception still stands where nothing ever quotes the field: intent keeps its default.
    expect(level.relationship_intent).toBe('public');
    expect((await loadQuotes(me, { predicates: SHEET_SOURCES, limit: 40 })).map((q) => q.text), 'a stranger could hear it')
      .not.toContain(SAID);
    // And no tapped field that any reader says can ever start or end up shareable by itself.
    for (const p of TAPPED_PREDICATES) {
      if (SHEET_SOURCES.includes(p)) expect(learnedDisclosure(p), p).toEqual({ disclosure: 'matchable_only' });
    }
  });

  it('public tags are per fact: one shared interest does not make every interest public', async () => {
    const me = await person('per-fact');
    const POTS = 'I throw pots at a studio every Saturday';
    await tenantSession(me, async (c) => {
      await episodes.append(c, { tenantId: me.tenantId, userId: me.userId, sessionId: crypto.randomUUID(),
                                 turnId: crypto.randomUUID(), role: 'user', source: 'text', rawText: POTS, occurredAt: new Date() });
      await commit(c, me, { predicate: 'interest', objectText: 'pottery', stance: 'asserted', originClass: 'owner',
                            sourceQuote: POTS, sourceEpisodeIds: [], extractorModel: 'story', extractorVersion: '1', promptVersion: '1' });
    });
    await tellTabla(me);
    const tags = await tagsOf(me);
    expect(tags).toEqual(expect.arrayContaining(['interest:pottery', 'interest:tabla']));
    const shown = await tenantSession(me, (c) => publicTags(c, me.userId));
    expect(shown).toContain('interest:pottery');
    expect(shown, 'a learned interest rode along with a shared one').not.toContain('interest:tabla');
  });
});
