/**
 * "How you appear", the hide control, and the rules read back.
 *
 * WHAT WAS MISSING. The brief became code-only in phase 0 and quotes a person's own
 * sentences to strangers -- but the person had no way to see which ones, and no way to
 * take one back. facts.ts has promised a disclosure control since the column existed
 * ("the person can change any of their own"); no endpoint ever wrote it. And an agent
 * that filters people gave no account of its rules: nobody meets the people it ruled
 * out, so nobody notices a rule stricter than they meant.
 *
 * Pinned here: the preview shows exactly the sentences that can reach a card and marks
 * the two that do; a hidden sentence never reaches a brief (the default loader is what
 * briefs use); a hide can be undone, except on the kinds nobody may volunteer; one
 * person cannot touch another's facts; and the readback says the rules and the "or
 * haven't said" half.
 *
 * Negative controls, run by hand:
 *   - loadQuotes' default list including 'private'      -> "never reaches a brief" fails
 *   - the disclosure route not writing                   -> "never reaches a brief" fails
 *   - no NEVER_PUBLIC check on showing again              -> "cannot be shown again" fails
 *   - the readback joining rules with the "or" joiner     -> "keeps a rule's own or" fails
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

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const episodes = await import('../src/memory/episodes.js');
const { loadQuotes } = await import('../src/matching/brief.js');
const { cardRuleLine, readback, READBACK_FOOTER } = await import('../src/matching/readback.js');
const { meRoutes } = await import('../src/api/me.js');
const { interviewRoutes } = await import('../src/api/interview.js');
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
  const tag = `app-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  await owner.query(
    `INSERT INTO match_profile (user_id, tenant_id, in_pool, intent) VALUES ($1,$2,false,$3)`,
    [userId, tenantId, ['marriage']]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

const headers = (p: Person) => ({
  Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.71',
});

/** Something the person typed, kept as a user-role episode: what makes a quote verifiable. */
const typed = (p: Person, rawText: string) => tenantSession(p, (db) => episodes.append(db, {
  tenantId: p.tenantId, userId: p.userId, sessionId: crypto.randomUUID(), turnId: crypto.randomUUID(),
  role: 'user', source: 'text', rawText, occurredAt: new Date(),
}));

const fact = async (p: Person, predicate: string, objectText: string, sourceQuote: string) => {
  const r = await tenantSession(p, (c) => commit(c, p, {
    predicate, objectText, stance: 'asserted', originClass: 'owner', sourceQuote,
    sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
  }));
  return r.factId!;
};

type Appearance = {
  headline: string; line: string; tags: string[];
  quotes: { factId: string; text: string; hidden: boolean; shown: boolean }[];
};
const appearance = async (p: Person) =>
  (await (await meRoutes.request('/v1/me/appearance', { headers: headers(p) })).json()) as Appearance;
const disclose = (p: Person, factId: string, hidden: boolean) =>
  meRoutes.request(`/v1/facts/${factId}/disclosure`, {
    method: 'POST', headers: headers(p), body: JSON.stringify({ hidden }),
  });

const CANOE = 'I spent last summer building a canoe with my uncle';
const BOULDER = 'I go bouldering at the gym every Thursday night';
const SUBS = 'Honestly every film is better with the subtitles on';
const INVENTED = 'I once did stand-up comedy in three cities in a week';

describe('How you appear', () => {
  it('shows every sentence that can reach a card, and marks the two that do', async () => {
    const me = await person('preview');
    await typed(me, `${CANOE}. ${BOULDER}.`);
    await typed(me, `${SUBS}, I will not be moved on this.`);
    await fact(me, 'did', 'built a canoe', CANOE);
    await fact(me, 'interest', 'bouldering', BOULDER);
    await fact(me, 'media_taste', 'subtitles', SUBS);
    // Said by nobody: a line with no episode behind it can never be quoted.
    await fact(me, 'did', 'stand-up comedy', INVENTED);

    const a = await appearance(me);
    expect(a.quotes.map((q) => q.text).sort()).toEqual([BOULDER, CANOE, SUBS].sort());
    expect(a.quotes.filter((q) => q.shown)).toHaveLength(2);
    expect(a.quotes.every((q) => !q.hidden)).toBe(true);
    expect(a.line).toMatch(/Passes your rules/);
    expect(a.headline).toMatch(/marriage/);
  });

  it('never reaches a brief once hidden, and can be shown again', async () => {
    const me = await person('hide');
    await typed(me, `${CANOE}. ${BOULDER}. ${SUBS}.`);
    await fact(me, 'did', 'built a canoe', CANOE);
    await fact(me, 'interest', 'bouldering', BOULDER);
    await fact(me, 'media_taste', 'subtitles', SUBS);

    const before = await appearance(me);
    const target = before.quotes.find((q) => q.shown)!;
    expect((await disclose(me, target.factId, true)).status).toBe(200);

    // What a brief loads: the hidden sentence is simply not there.
    const onCards = await loadQuotes(me);
    expect(onCards.map((q) => q.text), 'a hidden sentence can still reach a card').not.toContain(target.text);

    // The preview still lists it -- flagged, off every card -- so it can be undone,
    // and another sentence has taken its place on the card.
    const after = await appearance(me);
    const same = after.quotes.find((q) => q.factId === target.factId)!;
    expect(same).toMatchObject({ hidden: true, shown: false });
    expect(after.quotes.filter((q) => q.shown)).toHaveLength(2);

    expect((await disclose(me, target.factId, false)).status).toBe(200);
    expect((await loadQuotes(me)).map((q) => q.text)).toContain(target.text);
  });

  it('cannot be shown again on a kind nobody may volunteer, and cannot touch somebody else\'s', async () => {
    const me = await person('ceiling');
    const faith = await fact(me, 'religion', 'buddhist', 'I was raised Buddhist and still sit most mornings');
    expect((await disclose(me, faith, true)).status).toBe(200);
    const back = await disclose(me, faith, false);
    expect(back.status, 'a NEVER_PUBLIC fact was made public').toBe(400);
    expect(await back.json()).toMatchObject({ error: 'never_public' });

    const stranger = await person('stranger');
    const theirs = await fact(stranger, 'interest', 'kites', 'I fly kites on the beach every Sunday morning');
    expect((await disclose(me, theirs, true)).status).toBe(404);
    const { rows } = await owner.query<{ disclosure: string }>('SELECT disclosure FROM facts WHERE id = $1', [theirs]);
    expect(rows[0]!.disclosure).toBe('public');
  });
});

describe('the rules, read back', () => {
  it('keeps a rule\'s own "or", joins the rules with "and", and says the honest half', () => {
    const r = readback({
      intent: ['marriage'], ageRange: { min: 26, max: 34 }, maxDistanceKm: null,
      rules: [{ predicate: 'smoking', values: ['never', 'rarely'] }, { predicate: 'diet', values: ['vegetarian'] }],
    });
    expect(r.lines).toEqual(['want marriage', 'are 26 to 34', 'never or rarely smoke', 'are vegetarian']);
    expect(r.sentence).toBe(
      `I'll only bring you people who want marriage, are 26 to 34, never or rarely smoke and are vegetarian. ${READBACK_FOOTER}`);
    expect(r.footer).toMatch(/haven't answered/);
  });

  // The founder's rules card on the Pixel, 2026-09-30, under "Your agent only brings you
  // people who": "kids: want kids" and "one person or open: one person". Every line now
  // reads on from "people who". Negative control, run by hand: the old "card: labels"
  // line back -> this fails.
  it('says every card rule as the rest of "people who"', () => {
    const r = readback({
      intent: [], ageRange: null, maxDistanceKm: null,
      rules: [
        { predicate: 'wants_children', values: ['yes'] },
        { predicate: 'monogamy_stance', values: ['monogamous', 'open_to_either'] },
        { predicate: 'drinking', values: ['sometimes', 'daily'] },
        { predicate: 'diet', values: ['vegetarian', 'vegan'] },
        { predicate: 'religion', values: ['hindu', 'jain'] },
      ],
    });
    expect(r.lines).toEqual([
      'want kids', 'want one person or are open to either', 'sometimes drink or drink every day',
      'are vegetarian or vegan', 'are Hindu or Jain',
    ]);
  });

  it('stands a card rule on its own line for the rules screen, in the card\'s order', () => {
    expect(cardRuleLine('wants_children', ['yes'])).toBe('They want kids');
    expect(cardRuleLine('monogamy_stance', ['open_to_either', 'monogamous'])).toBe('They want one person or are open to either');
    expect(cardRuleLine('smoking', ['rarely', 'never'])).toBe('They never or rarely smoke');
    expect(cardRuleLine('relationship_intent', ['marriage'])).toBeNull();
  });

  it('says so plainly when there are no rules', () => {
    const r = readback({ intent: [], ageRange: null, maxDistanceKm: null, rules: [] });
    expect(r.lines).toEqual([]);
    expect(r.sentence).toMatch(/haven't set any rules/);
  });

  it('reads the person\'s own card rules through the route', async () => {
    const me = await person('readback');
    // As a fact, not on the row: answering the card rebuilds the row from facts.
    await fact(me, 'relationship_intent', 'marriage', 'Looking to get married');
    const res = await interviewRoutes.request('/v1/interview/answer', {
      method: 'POST', headers: headers(me),
      body: JSON.stringify({ questionId: 'card-smoking', values: ['never'], whoFine: { only: ['never'] } }),
    });
    expect(res.status).toBe(200);
    const r = await (await meRoutes.request('/v1/me/readback', { headers: headers(me) })).json() as {
      lines: string[]; footer: string;
    };
    expect(r.lines).toContain('want marriage');
    expect(r.lines).toContain('never smoke');
  });
});
