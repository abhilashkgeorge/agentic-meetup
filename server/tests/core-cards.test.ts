/**
 * The five core cards: kids, one person or open, smoking, drinking, food.
 *
 * WHAT WAS WRONG, three ways, all found reading the live pipeline:
 *
 *   1. NOBODY WAS ASKED. After the three basics a new person is not in the pool yet,
 *      so the interview measured its chips against an EMPTY candidate list, every chip
 *      scored 0, and the picker fell through to the sentence and then to "done". The
 *      five fields two people are compared on were never reached.
 *   2. THE RULE WAS INVERTED. "Could you be with a smoker?" wrote a rule whose value
 *      was copied from the person's OWN answer, so a daily smoker who said "No" got
 *      `smoking in ["daily"]` -- a rule only daily smokers pass.
 *   3. THE POOL DID NOT WAIT. A person with none of the five answered was sent out and
 *      shown to others, and every rule on those fields passed them as unknown.
 *
 * THE FIX, pinned here: the cards come straight after the basics in a fixed order; each
 * one has a Who's-fine row that is required, never pre-ticked, and becomes either no
 * rule ("anyone") or one hard `in [accepted]` rule; and a card counts toward the pool.
 *
 * Fixtures are written through the owner pool; the code under test runs through the
 * real routes and the real role sessions. The model is stubbed: the only call on these
 * paths is the sentence mapper, and it returns whatever `stub.parsed` says.
 *
 * Negative controls, run by hand (see the session report):
 *   - next-question.ts without the CORE step          -> (a) fails
 *   - writeCard storing the person's OWN answer        -> (b) fails
 *     (the old "same as me" behaviour)
 *   - profile.ts without the card loop                 -> (i) fails
 *   - writeCard without the retire UPDATE              -> "re-answering" fails
 *   - dealbreaker.ts closeUpward returning its input    -> (h) fails
 *   - /next counting a basic only by its row           -> "does not ask the basics
 *                                                          again" fails (q-gender)
 *   - readWhoFine without its subset check              -> "refuses an empty list"
 *     fails (200); with card-smoking unknown, as before the cards, it fails on the
 *     body ('unknown question'), where a status-only check had passed
 *   - no check on the You value                         -> "refuses a You answer"
 *     fails (200 for ["chain"])
 *   - the sentence writing its not_in rule straight away -> (h), "leaves the pool
 *     (the pre-proposal behaviour)                          exactly as it was" and
 *                                                           "proposes nothing" fail
 *   - proposeFromSentence starting from every option     -> "proposes from what the
 *                                                           card already accepts" fails
 *     (a smoking version of that test passed with this bug in: frequency closes
 *     upward, so it cannot tell the two starts apart -- hence the food card)
 *   - who-fine without the answered-card check           -> "changes only the
 *                                                           Who's-fine half" fails (200)
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({ parsed: {} as unknown, instructions: '' }));

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real,
    // The prose mapper, never the typed one, and never a real vendor.
    decideModel: () => null,
    modelFor: () => 'google:gemini-3.5-flash-lite',
    llm: {
      ...real.llm,
      complete: async (req: { instructions: string }) => {
        stub.instructions = req.instructions;
        return {
          text: '', parsed: stub.parsed,
          usage: {
            inputTokens: 0, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
            reasoningTokens: 0, provider: 'google', modelId: 'x', costUsd: 0, latencyMs: 0,
          },
        };
      },
      decide: async () => { throw new Error('no model in this test'); },
    },
  };
});

const { pool, tenantSession, matchSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const { rebuildMatchProfile } = await import('../src/matching/profile.js');
const { candidateIds, isCandidate } = await import('../src/matching/candidates.js');
const { runRound } = await import('../src/matching/orchestrator.js');
const { interviewRoutes } = await import('../src/api/interview.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');
const { CORE, GATING, BY_ID, TAPPED_PREDICATES } = await import('../src/onboarding/questions.js');
const { loadQuotes } = await import('../src/matching/brief.js');
const { meRoutes } = await import('../src/api/me.js');
const { loadProfiles, makeProfile, rng } = await import('../src/matching/synthetic.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

type Person = { tenantId: string; userId: string; token: string };
type WhoFine = { anyone: true } | { only: string[] };

async function person(label: string): Promise<Person> {
  const tag = `cc-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

const headers = (p: Person) => ({
  Authorization: `Bearer ${p.token}`,
  'Content-Type': 'application/json',
  'x-forwarded-for': '203.0.113.31',
});

const answer = (p: Person, questionId: string, values: string[], whoFine?: WhoFine, text?: string) =>
  interviewRoutes.request('/v1/interview/answer', {
    method: 'POST', headers: headers(p),
    body: JSON.stringify({ questionId, values, ...(whoFine ? { whoFine } : {}), ...(text ? { text } : {}) }),
  });

const next = async (p: Person) => {
  const res = await interviewRoutes.request('/v1/interview/next', { headers: headers(p) });
  return await res.json() as {
    question: {
      id: string; tier: string; declinable: boolean; required: boolean;
      options: { value: string }[]; whoFine?: { text: string; options: { value: string }[] };
      topic?: string; text: string;
    } | null;
    poolSize: number; ready: boolean; missing: string[];
  };
};

const fact = (p: Person, predicate: string, objectText: string, objectValue?: unknown) =>
  tenantSession(p, (c) =>
    commit(c, p, {
      predicate, objectText, ...(objectValue !== undefined ? { objectValue } : {}),
      stance: 'asserted', originClass: 'owner', sourceQuote: objectText, sourceEpisodeIds: [],
      extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }),
  );

/**
 * Everything but the cards: the basics, a birth year, a city, consent. Real people
 * only see each other here (sees_synthetic off) unless a test says otherwise, so an
 * assertion is about the people the test built.
 */
async function basics(p: Person, o: { gender: string; seeking: string; birthYear?: number; seesSynthetic?: boolean }) {
  await owner.query(
    `INSERT INTO match_profile (user_id, tenant_id, in_pool, sees_synthetic)
     VALUES ($1, $2, false, $3)
     ON CONFLICT (user_id) DO UPDATE SET sees_synthetic = EXCLUDED.sees_synthetic`,
    [p.userId, p.tenantId, o.seesSynthetic ?? false]);
  const { REQUIRED } = await import('../src/api/consent.js');
  for (const r of REQUIRED) {
    await owner.query(
      `INSERT INTO consents (tenant_id, user_id, document, version)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [p.tenantId, p.userId, r.document, r.version]);
  }
  await fact(p, 'gender', o.gender);
  await fact(p, 'seeking_gender', o.seeking);
  await fact(p, 'relationship_intent', 'long term');
  const year = o.birthYear ?? 1996;
  await fact(p, 'birth_date', `${year}`, { year, month: null });
  await fact(p, 'lives_in', 'Bangalore', { city: 'bangalore', lat: 12.97, lon: 77.59, precision_km: 20 });
}

/** Answer all five cards through the route. Each is "anyone" unless given. */
async function cards(p: Person, over: Partial<Record<string, { values: string[]; whoFine: WhoFine }>> = {}) {
  for (const id of CORE) {
    const a = over[id] ?? { values: [], whoFine: { anyone: true } as const };
    const res = await answer(p, id, a.values, a.whoFine);
    expect(res.status, `${id}: ${await res.clone().text()}`).toBe(200);
  }
}

const livePrefs = async (userId: string, predicate: string) =>
  (await owner.query<{ operator: string; value: unknown; strength: string }>(
    `SELECT operator, value, strength FROM preferences
      WHERE user_id = $1 AND predicate = $2 AND retired_at IS NULL`, [userId, predicate])).rows;

const canMeet = (a: Person, b: Person) => matchSession((c) => isCandidate(c, a.userId, b.userId));

// ── (a) ───────────────────────────────────────────────────────────────────────

describe('(a) a new person is asked the five cards', () => {
  it('offers all five, in order, straight after the three basics, with an empty pool', async () => {
    const me = await person('fresh');
    // Nothing but the basics: no birth year, no city, no consent. Not in the pool, so
    // the route has no candidates to measure against -- the exact state the old picker
    // fell through on.
    for (const id of GATING) {
      const q = await next(me);
      expect(q.question?.id).toBe(id);
      expect(q.question?.tier).toBe('basics');
      expect(q.question?.declinable).toBe(false);
      await answer(me, id, [q.question!.options[0]!.value]);
    }

    const seen: string[] = [];
    for (let i = 0; i < CORE.length; i++) {
      const q = await next(me);
      // The pool is checked server-side: the wire says "under 20" (null) for anything
      // below twenty, so it cannot say zero any more (shownCount).
      expect((await matchSession((c) => candidateIds(c, me.userId, 500))).length,
        'the pool was not empty, so this proves nothing').toBe(0);
      expect(q.poolSize, 'a pool count under twenty went out exact').toBeNull();
      expect(q.ready).toBe(false);
      expect(q.question, `the interview ended after ${seen.length} cards`).not.toBeNull();
      seen.push(q.question!.id);

      // The contract the app renders from.
      expect(q.question!.tier).toBe('core');
      expect(q.question!.declinable).toBe(true);
      expect(q.question!.required).toBe(false);
      expect(q.question!.whoFine, `${q.question!.id} has no Who's-fine row`).toBeDefined();
      expect(q.question!.whoFine!.options.map((o) => o.value))
        .toEqual(q.question!.options.map((o) => o.value));
      // Whose box is which, in words (the founder, 2026-09-24: "A normal user cannot
      // understand what the two boxes are"). The screen is titled by the topic; the
      // partner box asks about the partner by name, never "Who would you be fine with?".
      expect(q.question!.topic, `${q.question!.id} has no title`).toMatch(/\S/);
      expect(q.question!.topic).not.toBe(q.question!.text);
      expect(q.question!.whoFine!.text).toMatch(/\bpartner\b/);

      await answer(me, q.question!.id, [], { anyone: true });
    }
    expect(seen).toEqual([...CORE]);

    // Then the optional faith card -- ready already, because it is not a condition --
    // skipped whole, which the route accepts for an optional card and no other.
    const faith = await next(me) as Awaited<ReturnType<typeof next>> & { question: { optional?: boolean } | null };
    expect(faith.question?.id).toBe('card-faith');
    expect(faith.question?.optional).toBe(true);
    expect(faith.missing, 'the faith card was counted as missing').not.toContain('religion');
    expect((await answer(me, 'card-faith', [])).status).toBe(200);

    // Then the sentence, and only then anything optional.
    const after = await next(me);
    expect(after.question?.id).toBe('q-dealbreaker');
    expect(after.question?.tier).toBe('free');
  });

  it('does not ask the basics again of somebody who gave them in the essentials wizard', async () => {
    // Three of the six real users did exactly this: the wizard writes the fact and no
    // question_answers row, and the picker used to count only the row. "Finish setting
    // it up" sends them here for the cards, and they were asked "You are…", "You want
    // to meet…" and "What are you here for?" again first, with no skip button.
    const me = await person('wizard');
    for (const [predicate, value] of [
      ['gender', 'man'], ['seeking_gender', ['woman']], ['relationship_intent', 'long_term'],
    ] as const) {
      const res = await datingRoutes.request('/v1/essentials', {
        method: 'POST', headers: headers(me), body: JSON.stringify({ predicate, value }),
      });
      expect(res.status, `${predicate}: ${await res.clone().text()}`).toBe(200);
    }
    const q = await next(me);
    expect(q.missing, 'the wizard did not store the basics').not.toContain('gender');
    expect(q.question?.id, 'a basic was asked again').toBe('card-kids');
  });

  it('writes each card onto the predicate the contract names', () => {
    expect(CORE.map((id) => BY_ID.get(id)!.predicate))
      .toEqual(['wants_children', 'monogamy_stance', 'smoking', 'drinking', 'diet']);
  });
});

// ── the Who's-fine row ────────────────────────────────────────────────────────

describe("the Who's-fine row", () => {
  it('is required on a core card, even when the You row is declined', async () => {
    const me = await person('nowho');
    for (const values of [['never'], []]) {
      const res = await answer(me, 'card-smoking', values);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'who_fine_required' });
    }
    // Refused means nothing written: the card is not done.
    const { rows } = await owner.query(
      `SELECT 1 FROM question_answers WHERE user_id = $1 AND question_id = 'card-smoking'`, [me.userId]);
    expect(rows).toHaveLength(0);
  });

  it('refuses an empty list, or a value the card does not have', async () => {
    const me = await person('badwho');
    for (const only of [[], ['sometimes', 'chain']]) {
      const res = await answer(me, 'card-smoking', ['never'], { only });
      expect(res.status, JSON.stringify(only)).toBe(400);
      // The body, not only the status: before the cards, card-smoking was an unknown
      // id and got a 400 too, so a status alone passed on the old code.
      expect(await res.json(), JSON.stringify(only)).toMatchObject({ error: 'who_fine_invalid' });
    }
    expect(await livePrefs(me.userId, 'smoking')).toEqual([]);
  });

  it('refuses a You answer the card does not have, or more than one, and writes nothing', async () => {
    // One answer about yourself, and one of the card's own. "chain" is not a level
    // anybody's rule can name, so a fact holding it could never be tested; two levels
    // at once is not an answer to "Do you smoke?".
    const me = await person('badyou');
    for (const values of [['chain'], ['never', 'daily']]) {
      const res = await answer(me, 'card-smoking', values, { anyone: true });
      expect(res.status, JSON.stringify(values)).toBe(400);
    }
    const { rows: qa } = await owner.query(
      `SELECT 1 FROM question_answers WHERE user_id = $1 AND question_id = 'card-smoking'`, [me.userId]);
    expect(qa, 'the card was recorded as done').toHaveLength(0);
    const { rows: f } = await owner.query(
      `SELECT 1 FROM facts WHERE user_id = $1 AND predicate = 'smoking'`, [me.userId]);
    expect(f, 'a fact was written from a refused answer').toHaveLength(0);
  });

  it('"anyone" writes no rule, and is recorded as a choice', async () => {
    const me = await person('anyone');
    expect((await answer(me, 'card-drinking', ['sometimes'], { anyone: true })).status).toBe(200);
    expect(await livePrefs(me.userId, 'drinking')).toEqual([]);

    const { rows } = await owner.query<{ answer: unknown; skipped: boolean }>(
      `SELECT answer, skipped FROM question_answers WHERE user_id = $1 AND question_id = 'card-drinking'`,
      [me.userId]);
    // Distinct from never answered: the row exists, and says what was chosen.
    expect(rows[0]?.answer).toEqual({ values: ['sometimes'], whoFine: { anyone: true } });
    expect(rows[0]?.skipped).toBe(false);
  });

  it('ticking every option is "anyone", said the long way, and writes no rule', async () => {
    const me = await person('every');
    const all = BY_ID.get('card-food')!.options.map((o) => o.value);
    expect((await answer(me, 'card-food', ['vegetarian'], { only: all })).status).toBe(200);
    expect(await livePrefs(me.userId, 'diet')).toEqual([]);
  });

  it('a narrowed list becomes one hard `in` rule of exactly what they accepted', async () => {
    const me = await person('narrow');
    expect((await answer(me, 'card-kids', ['yes'], { only: ['maybe', 'yes'] })).status).toBe(200);
    const prefs = await livePrefs(me.userId, 'wants_children');
    // Card order, whatever order the taps came in.
    expect(prefs).toEqual([{ operator: 'in', value: ['yes', 'maybe'], strength: 'dealbreaker' }]);
  });

  it('re-answering a card retires the old rule instead of deleting it', async () => {
    const me = await person('reanswer');
    await answer(me, 'card-smoking', ['never'], { only: ['never'] });
    await answer(me, 'card-smoking', ['never'], { only: ['never', 'rarely'] });

    const all = await owner.query<{ value: unknown; retired: boolean }>(
      `SELECT value, retired_at IS NOT NULL AS retired FROM preferences
        WHERE user_id = $1 AND predicate = 'smoking' ORDER BY created_at, retired_at NULLS LAST`,
      [me.userId]);
    expect(all.rows, 'the first rule is gone, not retired').toEqual([
      { value: ['never'], retired: true },
      { value: ['never', 'rarely'], retired: false },
    ]);

    // And "anyone" afterwards retires the narrowed one and writes nothing new.
    await answer(me, 'card-smoking', ['never'], { anyone: true });
    const after = await owner.query<{ n: string; live: string }>(
      `SELECT count(*) AS n, count(*) FILTER (WHERE retired_at IS NULL) AS live
         FROM preferences WHERE user_id = $1 AND predicate = 'smoking'`, [me.userId]);
    expect(after.rows[0]).toEqual({ n: '2', live: '0' });
  });

  it('"Prefer not to say" records a decline and leaves the field unknown', async () => {
    const me = await person('decline');
    await basics(me, { gender: 'woman', seeking: 'man' });
    await answer(me, 'card-drinking', ['often'], { anyone: true });
    await answer(me, 'card-drinking', [], { anyone: true });

    const { rows: st } = await owner.query<{ state: string }>(
      `SELECT state FROM predicate_status WHERE user_id = $1 AND predicate = 'drinking'`, [me.userId]);
    expect(st[0]?.state).toBe('declined');
    // The earlier answer is retired, never deleted, and no longer read as theirs.
    const { rows: f } = await owner.query<{ status: string; open: boolean }>(
      `SELECT status, valid_to IS NULL AS open FROM facts WHERE user_id = $1 AND predicate = 'drinking'`,
      [me.userId]);
    expect(f).toEqual([{ status: 'retracted', open: false }]);
    const { rows: mp } = await owner.query<{ traits: Record<string, unknown> }>(
      'SELECT traits FROM match_profile WHERE user_id = $1', [me.userId]);
    expect(mp[0]!.traits).not.toHaveProperty('drinking');
  });
});

// ── (b) ───────────────────────────────────────────────────────────────────────

describe('(b) a daily smoker who is fine only with non-smokers', () => {
  it('excludes daily smokers, keeps non-smokers, and lets an unknown through', async () => {
    const me = await person('smoker');
    await basics(me, { gender: 'woman', seeking: 'man' });
    await cards(me, { 'card-smoking': { values: ['daily'], whoFine: { only: ['never'] } } });

    const daily = await person('daily');
    await basics(daily, { gender: 'man', seeking: 'woman' });
    await cards(daily, { 'card-smoking': { values: ['daily'], whoFine: { anyone: true } } });

    const never = await person('never');
    await basics(never, { gender: 'man', seeking: 'woman' });
    await cards(never, { 'card-smoking': { values: ['never'], whoFine: { anyone: true } } });

    const unknown = await person('unknown');
    await basics(unknown, { gender: 'man', seeking: 'woman' });
    await cards(unknown, { 'card-smoking': { values: [], whoFine: { anyone: true } } });

    // The rule is what they accepted -- never their own answer copied across.
    expect(await livePrefs(me.userId, 'smoking'))
      .toEqual([{ operator: 'in', value: ['never'], strength: 'dealbreaker' }]);

    expect(await canMeet(me, daily), 'a daily smoker passed "only non-smokers"').toBe(false);
    expect(await canMeet(me, never), 'the one kind of person they said yes to was excluded').toBe(true);
    expect(await canMeet(me, unknown), 'an unknown was treated as a mismatch').toBe(true);
    // Both ways: the same pair, asked from the other side.
    expect(await canMeet(daily, me)).toBe(false);
  });
});

// ── (h) through the route ─────────────────────────────────────────────────────

const whoFineReq = (p: Person, questionId: string, whoFine: WhoFine) =>
  interviewRoutes.request('/v1/interview/who-fine', {
    method: 'POST', headers: headers(p), body: JSON.stringify({ questionId, whoFine }),
  });

type Proposal = { questionId: string; text: string; options: { value: string }[]; accept: string[] } | null;

describe('(h) the sentence "no smokers"', () => {
  it('is proposed, writes nothing, and once confirmed excludes rarely through daily and still passes an unknown', async () => {
    const me = await person('nosmokers');
    await basics(me, { gender: 'woman', seeking: 'man' });
    await cards(me);

    // A model that only thought of the lowest level. Closing upward is code's job,
    // not the prompt's: "rarely" means every smoker.
    stub.parsed = { predicate: 'smoking', excludes: ['rarely'], because: 'said smokers' };
    const res = await answer(me, 'q-dealbreaker', [], undefined, 'No smokers.');
    expect(res.status).toBe(200);
    const body = await res.json() as { mapped: { predicate: string | null; proposal: Proposal } };

    // A PROPOSAL, NOT A RULE. The model read one line; the person has not seen what it
    // would remove. Nothing may filter anybody yet.
    expect(await livePrefs(me.userId, 'smoking'), 'the sentence wrote a rule on its own').toEqual([]);
    expect(body.mapped.proposal).toMatchObject({ questionId: 'card-smoking', card: 'Do you smoke?', accept: ['never'] });

    // The person keeps it -- the same one tap the card itself takes.
    const kept = await whoFineReq(me, 'card-smoking', { only: body.mapped.proposal!.accept });
    expect(kept.status).toBe(200);
    expect(await livePrefs(me.userId, 'smoking')).toEqual([
      { operator: 'in', value: ['never'], strength: 'dealbreaker' },
    ]);

    const make = async (label: string, smoking: string[]) => {
      const p = await person(label);
      await basics(p, { gender: 'man', seeking: 'woman' });
      await cards(p, { 'card-smoking': { values: smoking, whoFine: { anyone: true } } });
      return p;
    };
    for (const level of ['rarely', 'sometimes', 'often', 'daily']) {
      expect(await canMeet(me, await make(level, [level])), `${level} passed "no smokers"`).toBe(false);
    }
    expect(await canMeet(me, await make('nev', ['never']))).toBe(true);
    expect(await canMeet(me, await make('unk', []))).toBe(true);
  });

  it('leaves the pool exactly as it was when the person does not keep it', async () => {
    // "Leave it" is no request at all. The proof that the sentence alone filters
    // nobody: a daily smoker still meets this person after the sentence was answered.
    const me = await person('leaveit');
    await basics(me, { gender: 'woman', seeking: 'man' });
    await cards(me);
    stub.parsed = { predicate: 'smoking', excludes: ['daily'], because: 'said heavy smokers' };
    expect((await answer(me, 'q-dealbreaker', [], undefined, 'No heavy smokers.')).status).toBe(200);

    const smoker = await person('dailysmoker');
    await basics(smoker, { gender: 'man', seeking: 'woman' });
    await cards(smoker, { 'card-smoking': { values: ['daily'], whoFine: { anyone: true } } });
    expect(await canMeet(me, smoker), 'an unconfirmed sentence removed somebody').toBe(true);
  });

  it('proposes from what the card already accepts, not from every option', async () => {
    // Somebody whose food card accepts only vegetarian, vegan and pescatarian, who then
    // writes "no vegans", is proposed vegetarian and pescatarian -- NOT handed back the
    // omnivores they had already ruled out on the card.
    //
    // A food card, not a frequency one, on purpose: smoking and drinking close upward,
    // so "only never or rarely" minus "no smokers" is [never] whichever set it starts
    // from, and a smoking case here passed with the bug in (it was tried).
    const me = await person('narrowed');
    await basics(me, { gender: 'woman', seeking: 'man' });
    await cards(me, {
      'card-food': { values: ['vegetarian'], whoFine: { only: ['pescatarian', 'vegetarian', 'vegan'] } },
    });
    stub.parsed = { predicate: 'diet', excludes: ['vegan'], because: 'said vegans' };
    const res = await answer(me, 'q-dealbreaker', [], undefined, 'No vegans.');
    const { mapped } = await res.json() as { mapped: { proposal: Proposal } };
    expect(mapped.proposal?.accept).toEqual(['pescatarian', 'vegetarian']);
  });

  it('proposes nothing when the sentence names no card, adds nothing, or would leave nobody', async () => {
    const me = await person('noproposal');
    await basics(me, { gender: 'woman', seeking: 'man' });
    await cards(me, { 'card-smoking': { values: ['never'], whoFine: { only: ['never'] } } });

    const tryIt = async (parsed: unknown, line: string) => {
      stub.parsed = parsed;
      const res = await answer(me, 'q-dealbreaker', [], undefined, line);
      expect(res.status).toBe(200);
      return (await res.json() as { mapped: { proposal: Proposal } | null }).mapped?.proposal ?? null;
    };
    // Not a card: stays a sentence.
    expect(await tryIt({ predicate: null, excludes: [], because: 'not a field' }, 'Talks through films.')).toBeNull();
    // Already ruled out on the card: nothing to change.
    expect(await tryIt({ predicate: 'smoking', excludes: ['daily'], because: 'x' }, 'No chain smokers.')).toBeNull();
    // Would untick the only option left: an empty pool, not a preference.
    expect(await tryIt({ predicate: 'smoking', excludes: ['never'], because: 'x' }, 'Only smokers.')).toBeNull();
    expect(await livePrefs(me.userId, 'smoking')).toEqual([
      { operator: 'in', value: ['never'], strength: 'dealbreaker' },
    ]);
  });
});

describe('POST /v1/interview/who-fine', () => {
  it('changes only the Who\'s-fine half, and refuses anything that is not an answered card', async () => {
    const me = await person('whofine');
    await basics(me, { gender: 'woman', seeking: 'man' });

    // Not a card at all.
    expect((await whoFineReq(me, 'q-dealbreaker', { anyone: true })).status).toBe(400);
    // A card nobody has answered: no Who's-fine by a side door.
    const early = await whoFineReq(me, 'card-drinking', { only: ['never'] });
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: 'card_not_answered' });
    expect(await livePrefs(me.userId, 'drinking')).toEqual([]);

    await cards(me, { 'card-drinking': { values: ['sometimes'], whoFine: { anyone: true } } });
    // A value the card does not have.
    const bad = await whoFineReq(me, 'card-drinking', { only: ['wine'] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'who_fine_invalid' });

    // The real change: a rule appears, the You answer and its fact do not move.
    expect((await whoFineReq(me, 'card-drinking', { only: ['never', 'rarely'] })).status).toBe(200);
    expect(await livePrefs(me.userId, 'drinking')).toEqual([
      { operator: 'in', value: ['never', 'rarely'], strength: 'dealbreaker' },
    ]);
    const { rows } = await owner.query<{ answer: { values: string[]; whoFine: unknown } }>(
      `SELECT answer FROM question_answers WHERE user_id = $1 AND question_id = 'card-drinking'`, [me.userId]);
    expect(rows[0]!.answer).toEqual({ values: ['sometimes'], whoFine: { only: ['never', 'rarely'] } });
    const { rows: f } = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM facts WHERE user_id = $1 AND predicate = 'drinking'`, [me.userId]);
    expect(Number(f[0]!.n), 'changing who is fine re-committed the You fact').toBe(1);

    // Back to anyone: the rule is retired, not deleted.
    expect((await whoFineReq(me, 'card-drinking', { anyone: true })).status).toBe(200);
    expect(await livePrefs(me.userId, 'drinking')).toEqual([]);
    const { rows: all } = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM preferences WHERE user_id = $1 AND predicate = 'drinking'`, [me.userId]);
    expect(Number(all[0]!.n)).toBe(1);
  });
});

// ── (i) ───────────────────────────────────────────────────────────────────────

describe('(i) a person missing one card', () => {
  it('is not sent out and is nobody\'s candidate, until the card is done', async () => {
    const x = await person('fourcards');
    await basics(x, { gender: 'man', seeking: 'woman' });
    for (const id of CORE.filter((k) => k !== 'card-food')) {
      await answer(x, id, [], { anyone: true });
    }

    const y = await person('seeker');
    await basics(y, { gender: 'woman', seeking: 'man' });
    await cards(y);

    const r = await tenantSession(x, (c) => rebuildMatchProfile(c, x));
    expect(r.inPool).toBe(false);
    // Named by predicate, like every other entry on the list.
    expect(r.missing).toEqual(['diet']);

    // Not sent out: the round stops before anything is read or spent.
    const round = await runRound(x.userId);
    expect(round.skipped).toBe('agent is not ready to go out yet');
    // Not anyone's candidate, by the exact check and by the list.
    expect(await canMeet(y, x)).toBe(false);
    expect(await matchSession((c) => candidateIds(c, y.userId, 500))).not.toContain(x.userId);

    // The one card, declined on the You row -- declining counts as done.
    expect((await answer(x, 'card-food', [], { anyone: true })).status).toBe(200);
    expect(await canMeet(y, x), 'the card was the only thing missing').toBe(true);
  });
});

// ── the invented pool ─────────────────────────────────────────────────────────

describe('practice profiles', () => {
  it('stay in the pool and stay candidates, with no cards at all', async () => {
    // Invented people are written straight into match_profile (loadProfiles) and have
    // no question_answers. The card gate lives in rebuildMatchProfile, which never
    // runs for them. Put anywhere else it goes wrong: a gate in the candidate query on
    // question_answers removes every one of them, and a gate on "has a value for each
    // card field" removes about two in three, because the generator leaves one field
    // in five blank on purpose (synthetic.ts, Rule 3). This one has a blank smoking
    // field, so both mistakes fail here.
    const me = await person('practice');
    await basics(me, { gender: 'woman', seeking: 'man', seesSynthetic: true });
    await cards(me);

    const tenant = await owner.query<{ id: string }>(
      'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`cc-synth-${Date.now()}`]);
    made.push(tenant.rows[0]!.id);
    const p = {
      ...makeProfile(rng(4242), tenant.rows[0]!.id),
      gender: 'man', seekingGender: ['woman'], age: 29, ageMin: 20, ageMax: 40,
      lat: 12.97, lon: 77.59, maxDistanceKm: 50, intent: ['long_term'],
    };
    p.traits = { ...p.traits, gender: 'man', relationship_intent: 'long_term', diet: 'omnivore' };
    delete p.traits.smoking;
    const c = await owner.connect();
    try { await loadProfiles(c, [p]); } finally { c.release(); }

    const { rows } = await owner.query<{ in_pool: boolean; is_synthetic: boolean }>(
      'SELECT in_pool, is_synthetic FROM match_profile WHERE user_id = $1', [p.userId]);
    expect(rows[0]).toEqual({ in_pool: true, is_synthetic: true });
    expect(await matchSession((c2) => isCandidate(c2, me.userId, p.userId))).toBe(true);
  });
});

// ── the faith card (2026-09-25) ───────────────────────────────────────────────
//
// Optional, check-only, no caste or community (the founder). Pinned: skipping it is
// allowed and writes nothing; an answer is never public and never quoted; its partner
// row is a rule tested both ways like any card, with an unknown passing; the person's
// own rule is read back to them; chat cannot quietly change it; and nothing on it
// names a caste, a sect or a community.
//
// Negative controls, run by hand:
//   - the answer route without the optional-card skip   -> "skipped whole" fails
//   - VALUE_SHAPES without `religion`                     -> "a rule both ways" and
//     "never public" fail (no value, so no trait, and the rule excludes nobody)
//   The last two edit shared/, so each was run with shared/dist rebuilt either side.
//   - a 'brahmin' option added to FAITHS                  -> "no caste" fails

describe('the faith card', () => {
  it('can be skipped whole, which writes no fact and no rule', async () => {
    const me = await person('faith-skip');
    await basics(me, { gender: 'woman', seeking: 'man' });
    await cards(me);
    const res = await answer(me, 'card-faith', []);
    expect(res.status, await res.clone().text()).toBe(200);
    const { rows } = await owner.query(
      `SELECT 1 FROM facts WHERE user_id = $1 AND predicate = 'religion' AND status = 'active'`, [me.userId]);
    expect(rows).toHaveLength(0);
    expect(await livePrefs(me.userId, 'religion')).toEqual([]);
    // A required card still cannot be skipped this way.
    expect((await answer(me, 'card-kids', [])).status).toBe(400);
  });

  it('is never public and never quoted, and chat cannot quietly change it', async () => {
    const me = await person('faith-private');
    await basics(me, { gender: 'woman', seeking: 'man' });
    await cards(me);
    expect((await answer(me, 'card-faith', ['jain'], { only: ['jain', 'hindu'] })).status).toBe(200);
    const { rows } = await owner.query<{ disclosure: string; object_value: unknown }>(
      `SELECT disclosure, object_value FROM facts WHERE user_id = $1 AND predicate = 'religion' AND status = 'active'`,
      [me.userId]);
    expect(rows).toEqual([{ disclosure: 'matchable_only', object_value: 'jain' }]);
    expect((await loadQuotes(me, { includeHidden: true })).map((q) => q.text).join(' ')).not.toMatch(/jain/i);
    expect(TAPPED_PREDICATES.has('religion')).toBe(true);
    // Her own rule, read back to her -- the one place her faith rule is ever said.
    const rb = await (await meRoutes.request('/v1/me/readback', { headers: headers(me) })).json() as { lines: string[] };
    // In the card's own order, whatever order they were ticked in.
    expect(rb.lines).toContain('are Hindu or Jain');
  });

  it('its partner row is a rule both ways, and an unknown passes', async () => {
    const me = await person('faith-rule');
    await basics(me, { gender: 'woman', seeking: 'man' });
    await cards(me);
    await answer(me, 'card-faith', ['hindu'], { only: ['hindu', 'jain'] });
    const hindu = await person('faith-hindu');
    await basics(hindu, { gender: 'man', seeking: 'woman' });
    await cards(hindu);
    await answer(hindu, 'card-faith', ['hindu'], { anyone: true });
    const muslim = await person('faith-muslim');
    await basics(muslim, { gender: 'man', seeking: 'woman' });
    await cards(muslim);
    await answer(muslim, 'card-faith', ['muslim'], { anyone: true });
    const unsaid = await person('faith-unsaid');
    await basics(unsaid, { gender: 'man', seeking: 'woman' });
    await cards(unsaid);
    await answer(unsaid, 'card-faith', []);
    for (const p of [me, hindu, muslim, unsaid]) await tenantSession(p, (c) => rebuildMatchProfile(c, p));

    expect(await canMeet(me, hindu)).toBe(true);
    expect(await canMeet(me, muslim), 'her rule let through a faith she did not tick').toBe(false);
    expect(await canMeet(me, unsaid), 'an unknown was treated as a mismatch').toBe(true);
    expect(await canMeet(muslim, me), 'not both ways').toBe(false);
  });

  it('offers a faith, or none -- no caste, sect or community', () => {
    const q = BY_ID.get('card-faith')!;
    expect(q.options.map((o) => o.value)).toEqual([
      'hindu', 'muslim', 'christian', 'sikh', 'jain', 'buddhist', 'jewish', 'zoroastrian',
      'spiritual', 'not_religious', 'other',
    ]);
    const words = q.options.map((o) => `${o.value} ${o.label}`).join(' ');
    expect(words).not.toMatch(/caste|brahmin|dalit|kshatriya|vaishya|shudra|jati|sect|shia|sunni|catholic|protestant|community|parsi|gotra/i);
  });
});
