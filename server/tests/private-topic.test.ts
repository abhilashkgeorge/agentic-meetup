/**
 * A sentence on a private topic -- relationship history first -- is caught by what it
 * means when it is learned, and never goes public.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-28): "relationship history ('engaged', 'ex',
 * 'called off', 'left me', etc.) must be caught by topic when a sentence is learned, and
 * kept match-only by default -- not by a word list alone."
 *
 * WHAT WAS WRONG (found by the clone-brain test, evals/clone-brain): only a word list
 * stood between relationship history and a stranger's card, and it knew "married" and
 * "divorce" and nothing else. "I called off an engagement three weeks before the date",
 * "My ex-boyfriend and I still talk", "Two people have left me over how much I work" and
 * two more passed mayRepeat; filed as `did`, one tap on "OK to share" made them public.
 *
 * WHAT IS PINNED HERE, through the real tell, disclosure and appearance routes, the
 * model stubbed (no call, no cost):
 *   - the extractor's private topic stays on the fact, which stays match-only -- even a
 *     sentence with no topic word in it ("we split last spring"), which the word list
 *     passes: the topic, not the list, is what holds it;
 *   - the model is asked for the topic as a required field, by the same rule in both
 *     learners (chat and paste);
 *   - commit() keeps it match-only whatever the writer asked for, and the database
 *     refuses it going public;
 *   - "How you appear" never offers it, and "OK to share" refuses it (hiding still works);
 *   - an old public sentence, heard again with its topic, leaves the cards;
 *   - a paste import, and its "Yes, that's true", keep the topic;
 *   - the word list -- the second line -- now blocks the five sentences that passed, and
 *     not every sentence with "relationship" in it.
 *
 * Negative controls, run by hand (2026-09-28), each restored byte-identical:
 *   - extract.ts dropping private_topic from the candidate -> "caught by meaning" fails
 *   - commit() writing the kind's own disclosure            -> "whatever the writer asked" fails
 *   - loadQuotes without `private_topic IS NULL`           -> "never offered" fails
 *   - the disclosure route without the private-topic test  -> "refuses" fails (500, not 400)
 *   - the new stems removed from CORE_STEMS                -> "second line" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({ parsed: {} as unknown, schemas: [] as unknown[] }));
vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real,
    decideModel: () => null,
    modelFor: () => 'google:gemini-3.5-flash-lite',
    llm: {
      ...real.llm,
      complete: async (req: { outputSchema?: unknown }) => {
        stub.schemas.push(req.outputSchema);
        return {
          text: '', parsed: stub.parsed,
          usage: { inputTokens: 0, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
                   reasoningTokens: 0, provider: 'google', modelId: 'x', costUsd: 0, latencyMs: 0 },
        };
      },
      decide: async () => { throw new Error('no model in this test'); },
    },
  };
});

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const episodes = await import('../src/memory/episodes.js');
const { EXTRACTION_PROMPT, PRIVATE_TOPIC_RULE } = await import('../src/memory/extract.js');
const { IMPORT_PROMPT, importPastedText, confirmStagedFact } = await import('../src/memory/pasteImport.js');
const { loadQuotes, mayRepeat } = await import('../src/matching/brief.js');
const { SHEET_SOURCES } = await import('../src/matching/answer-sheet.js');
const { tellRoutes } = await import('../src/api/tell.js');
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

type Person = { tenantId: string; userId: string; token: string };
async function person(label: string): Promise<Person> {
  const tag = `pt-${label}-${Date.now()}-${Math.random()}`;
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
const H = (p: Person) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.78' });

/** No topic word in it anywhere: only its meaning says what it is about. */
const SPLIT = 'We split last spring and I am still working out who I am on my own';
const TABLA = 'I have been learning the tabla for two years now';

const fact = (source: string, objectText: string, topic: string) => ({
  predicate: 'did', object_text: objectText, stance: 'asserted', hedge_span: '', source_quote: source,
  valid_from: '', private_topic: topic,
});

async function tell(me: Person, text: string, facts: unknown[]): Promise<void> {
  stub.parsed = { facts, possibly_false: [], intents: [] };
  const res = await tellRoutes.request('/v1/tell', { method: 'POST', headers: H(me), body: JSON.stringify({ text: `${text}.`, sessionId: crypto.randomUUID() }) });
  expect(res.status).toBe(200);
}
const row = async (me: Person, objectText: string) => (await owner.query<{ id: string; disclosure: string; private_topic: string | null }>(
  `SELECT id, disclosure, private_topic FROM facts
    WHERE user_id = $1 AND object_text = $2 AND status = 'active' AND valid_to IS NULL`, [me.userId, objectText])).rows;
const learnedOf = async (me: Person) => ((await (await meRoutes.request('/v1/me/appearance', { headers: H(me) }))
  .json()) as { learned: { factId: string; text: string }[] }).learned.map((l) => l.text);

describe('a sentence on a private topic, learned in chat', () => {
  it('is caught by meaning when learned -- a sentence the word list would pass -- and stays match-only', async () => {
    const me = await person('meaning');
    expect(mayRepeat(SPLIT), 'the word list catches this one, so it proves nothing about the topic').toBe(true);
    await tell(me, SPLIT, [fact(SPLIT, 'split last spring', 'relationships')]);
    await tell(me, TABLA, [fact(TABLA, 'learning the tabla', 'none')]);

    expect(await row(me, 'split last spring')).toEqual([expect.objectContaining({ disclosure: 'matchable_only', private_topic: 'relationships' })]);
    expect(await row(me, 'learning the tabla')).toEqual([expect.objectContaining({ disclosure: 'matchable_only', private_topic: null })]);

    // Never offered: not on the cards, not as "OK to share" -- while the harmless one is.
    const learned = await learnedOf(me);
    expect(learned).toContain(TABLA);
    expect(learned).not.toContain(SPLIT);
    for (const opts of [{}, { predicates: SHEET_SOURCES, limit: 40 }, { includeHidden: true }, { disclosures: ['matchable_only'] as const }]) {
      expect((await loadQuotes(me, opts)).map((q) => q.text)).not.toContain(SPLIT);
    }
  });

  it('is asked of the model as a required field, by one rule in both learners', async () => {
    // The judgement itself is the model's and no test here can make it; what can be
    // pinned is that the model is always asked, by the same words for chat and paste.
    expect(EXTRACTION_PROMPT).toContain(PRIVATE_TOPIC_RULE);
    expect(IMPORT_PROMPT).toContain(PRIVATE_TOPIC_RULE);
    expect(PRIVATE_TOPIC_RULE).toMatch(/relationships: .*engagements.*exes.*being left/);
    const me = await person('asked');
    const from = stub.schemas.length;
    await tell(me, TABLA, [fact(TABLA, 'learning the tabla', 'none')]);
    const sent = stub.schemas[from] as { safeParse: (v: unknown) => { success: boolean } };
    const withoutTopic = { facts: [{ predicate: 'did', object_text: 'x', stance: 'asserted', hedge_span: '', source_quote: 'x', valid_from: '' }], possibly_false: [], intents: [] };
    expect(sent.safeParse(withoutTopic).success, 'the model may leave the topic out').toBe(false);
  });

  it('is refused by "OK to share" and by the database; hiding it still works', async () => {
    const me = await person('share');
    await tell(me, SPLIT, [fact(SPLIT, 'split last spring', 'relationships')]);
    const [f] = await row(me, 'split last spring');

    const share = await meRoutes.request(`/v1/facts/${f!.id}/disclosure`, { method: 'POST', headers: H(me), body: JSON.stringify({ hidden: false }) });
    expect(share.status).toBe(400);
    expect(await share.json()).toMatchObject({ error: 'never_public' });
    expect((await row(me, 'split last spring'))[0]!.disclosure).toBe('matchable_only');

    await expect(owner.query(`UPDATE facts SET disclosure = 'public' WHERE id = $1`, [f!.id]))
      .rejects.toMatchObject({ code: '23514' });

    const hide = await meRoutes.request(`/v1/facts/${f!.id}/disclosure`, { method: 'POST', headers: H(me), body: JSON.stringify({ hidden: true }) });
    expect(hide.status).toBe(200);
    expect((await row(me, 'split last spring'))[0]!.disclosure).toBe('private');
  });

  it('stays match-only whatever the writer asked for', async () => {
    const me = await person('writer');
    const put = (objectText: string, disclosure: 'public' | 'private') => tenantSession(me, (c) => commit(c, me, {
      // prompt_answer starts PUBLIC by its kind: the topic has to win over it.
      predicate: 'prompt_answer', objectText, stance: 'asserted', sourceQuote: objectText, sourceEpisodeIds: [],
      originClass: 'owner', extractorModel: 't', extractorVersion: '0', promptVersion: '0',
      disclosure, privateTopic: 'relationships',
    }));
    await put('asked for public', 'public');
    await put('asked for private', 'private');
    expect((await row(me, 'asked for public'))[0]).toMatchObject({ disclosure: 'matchable_only', private_topic: 'relationships' });
    expect((await row(me, 'asked for private'))[0]).toMatchObject({ disclosure: 'private', private_topic: 'relationships' });
  });

  it('takes an old public sentence off the cards when it is heard again with its topic', async () => {
    const me = await person('again');
    // As it was before topics: typed by them, learned as `did`, and shared.
    await tenantSession(me, async (c) => {
      const ep = await episodes.append(c, { tenantId: me.tenantId, userId: me.userId, sessionId: crypto.randomUUID(),
        turnId: crypto.randomUUID(), role: 'user', source: 'text', rawText: SPLIT, occurredAt: new Date() });
      await commit(c, me, { predicate: 'did', objectText: 'split last spring', stance: 'asserted', sourceQuote: SPLIT,
        sourceEpisodeIds: ep ? [ep.id] : [], originClass: 'owner', extractorModel: 't', extractorVersion: '0',
        promptVersion: '0', disclosure: 'public' });
    });
    expect((await loadQuotes(me)).map((q) => q.text)).toContain(SPLIT);

    await tell(me, SPLIT, [fact(SPLIT, 'split last spring', 'relationships')]);
    expect((await row(me, 'split last spring'))[0]).toMatchObject({ disclosure: 'matchable_only', private_topic: 'relationships' });
    expect((await loadQuotes(me)).map((q) => q.text)).not.toContain(SPLIT);
  });

  it('keeps its topic through a paste import and its "Yes, that\'s true"', async () => {
    const me = await person('paste');
    const SPAN = 'Called off an engagement three weeks before the wedding.';
    stub.parsed = {
      facts: [{ predicate: 'did', object_text: 'called off an engagement', source_span: SPAN, valid_from: '', private_topic: 'relationships' }],
      unsure: [],
    };
    await tenantSession(me, (c) => importPastedText(c, me, `About me: ${SPAN}`, 'self'));
    const { rows: staged } = await owner.query<{ id: string; private_topic: string | null }>(
      `SELECT id, private_topic FROM facts WHERE user_id = $1 AND status = 'staged'`, [me.userId]);
    expect(staged).toEqual([expect.objectContaining({ private_topic: 'relationships' })]);

    await tenantSession(me, (c) => confirmStagedFact(c, me, staged[0]!.id));
    expect((await row(me, 'called off an engagement'))[0]).toMatchObject({ disclosure: 'matchable_only', private_topic: 'relationships' });
  });
});

describe('the word list, the second line', () => {
  it('now blocks the five sentences that passed', () => {
    for (const s of [
      'I called off an engagement three weeks before the date.',
      'I was engaged at twenty-six and called it off.',
      'Recently ended a seven-year relationship and I am not over it.',
      'My ex-boyfriend and I still talk.',
      'Two people have left me over how much I work.',
    ]) expect(mayRepeat(s), s).toBe(false);
  });

  it('does not swallow every sentence near the topic', () => {
    for (const s of [
      'I am looking for a long-term relationship with someone kind',
      'The trek was called off because of the rain',
      'I play cricket every Sunday with my colleagues',
    ]) expect(mayRepeat(s), s).toBe(true);
  });
});
