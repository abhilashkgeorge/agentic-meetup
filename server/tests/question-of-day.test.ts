/**
 * The question of the day: what other agents asked a person's agent that it could not
 * answer, asked instead of the person -- at most two a day, skippable, never who asked.
 *
 * WHY (the founder, 2026-09-25): "when an agent's answer is 'unknown', queue a question
 * for that person's human, max 1-2 a day, skippable, and never say who asked." Before
 * this, an "I don't know" in a meeting was the end of it; every later meeting hit the
 * same gap.
 *
 * WHAT IS PINNED HERE:
 *   - a round records each "I don't know" against the side that said it, by bank
 *     question, and the table has no column that could say who asked;
 *   - the person is offered the question asked most, with a count and nothing else;
 *   - an answer is their own sentence: quotable, that question's answer on their sheet at
 *     once, and still its answer after the sheet is rebuilt by the pointer;
 *   - a question already answered on their sheet is never offered;
 *   - two a day at most, answered or skipped; a skipped one stays quiet for a week;
 *   - nobody reads anybody else's, and the app role cannot write one;
 *   - on a CARD topic (drinking, kids, faith...) the gap is the card: a private want
 *     that could not be read because the other person has no answer on that card is
 *     recorded as `card:<predicate>` for them, their question of the day opens that card,
 *     and answering the card through the card route is what counts -- a card value, never
 *     a sentence; a card they have a value on is never offered;
 *   - an answer goes through the same rules as every sentence: one holding a contact
 *     detail, or naming a private topic, is kept but never goes on the sheet, never
 *     comes out of the quote door, never reaches a round's read of the sheets, and the
 *     person is told which it was.
 *
 * Negative controls, run by hand:
 *   - unknownsOf giving a "dunno" to the other side     -> "against the side that said it" fails
 *   - questionOfDay without the daily cap               -> "two a day" fails
 *   - questionOfDay offering what the sheet answers     -> "already answered" fails
 *   - ensureSheet without withExplicit                  -> "after the sheet is rebuilt" fails
 *   - answerDailyQuestion writing every answer onto the sheet -> "same rules" fails
 *   - unknownCardsOf returning nothing                  -> "opens that card" fails
 *   - a valued card not counted as known                -> "never offered" fails
 *   - markCardAnswered not checking the card's answer   -> "only once the card is answered" fails
 *   - /v1/interview/next ignoring ?card=                -> "opens that card" fails
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

vi.hoisted(() => {
  const DEFAULTED = ['RENDEZVOUS_RUNS', 'ROUND_CANDIDATES', 'DECIDE_MODEL', 'WEEKLY_REAL_EXPOSURE', 'AGENT_TALK',
                     'SYNTHETIC_AUTO_YES'];
  const original = process.loadEnvFile;
  const strip = () => { for (const k of DEFAULTED) delete process.env[k]; };
  process.loadEnvFile = ((...args: Parameters<typeof process.loadEnvFile>) => {
    try { original.apply(process, args); } finally { strip(); }
  }) as typeof process.loadEnvFile;
  strip();
});

const stub = vi.hoisted(() => ({ talk: null as null | ((prompt: string) => unknown), calls: 0 }));

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  const usage = { inputTokens: 1, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1,
                  reasoningTokens: 0, provider: 'google', modelId: 'x', costUsd: 0, latencyMs: 0 };
  return {
    ...real,
    decideModel: () => null,
    modelFor: () => 'google:gemini-3.5-flash-lite',
    llm: {
      ...real.llm,
      complete: async (req: { messages: { content: string }[] }) => {
        stub.calls++;
        const prompt = req.messages.map((m) => m.content).join('\n');
        // The talk gets the script; a wants check maps a drinking want onto the drinking
        // card; the sheet's pointer points at nothing at all.
        if (prompt.includes("A'S SENTENCES") && stub.talk) return { text: '', parsed: stub.talk(prompt), usage };
        if (prompt.startsWith('WANTS\n')) {
          const wants = prompt.split('\n\n')[0]!.split('\n').slice(1);
          const cards = wants.flatMap((l, i) => (l.includes("doesn't drink") ? [{ want: i + 1, card: 'drinking', values: ['never'] }] : []));
          return { text: '', parsed: { checks: [], cards }, usage };
        }
        return { text: '', parsed: { answers: [] }, usage };
      },
      decide: async () => { throw new Error('no typed model'); },
    },
  };
});

const { env } = await import('../src/env.js');
const { pool, tenantSession, matchmakerSession, closeMatchPool } = await import('../src/db/client.js');
const { commit } = await import('../src/memory/facts.js');
const episodes = await import('../src/memory/episodes.js');
const { SHEET, ensureSheet, readOwnSheet, readSheets, withExplicit } = await import('../src/matching/answer-sheet.js');
const { unknownsOf, unknownCardsOf } = await import('../src/matching/unknowns.js');
const { interviewRoutes } = await import('../src/api/interview.js');
const { loadQuotes } = await import('../src/matching/brief.js');
const { runRound } = await import('../src/matching/orchestrator.js');
const { questionOfDayRoutes } = await import('../src/api/question-of-day.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 120_000 });
beforeEach(() => { stub.talk = null; stub.calls = 0; });

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

const ask = (id: string) => SHEET.find((q) => q.id === id)!;

// ── pure ────────────────────────────────────────────────────────────────────

describe('who said "I don\'t know"', () => {
  it('is the side that said it, by bank question -- from the talk, or from the sheets', () => {
    const talk = {
      lines: [
        { who: 'you' as const, kind: 'ask' as const, text: ask('music').ask, q: ask('music').short },
        { who: 'them' as const, kind: 'dunno' as const, text: "I don't know." },
        { who: 'you' as const, kind: 'say' as const, text: 'Old jazz records' },
        { who: 'them' as const, kind: 'ask' as const, text: ask('travel').ask, q: ask('travel').short },
        { who: 'you' as const, kind: 'dunno' as const, text: "I don't know." },
      ],
      shared: [], date: null,
    };
    expect(unknownsOf(talk, [], [])).toEqual({ a: ['travel'], b: ['music'] });
    const line = (id: string, theirs: string | null, mine: string | null) => ({ q: ask(id).short, ask: ask(id).ask, theirs, mine });
    expect(unknownsOf(null, [line('music', null, 'jazz'), line('work', 'x', 'y')], [line('pets', null, 'a dog')]))
      .toEqual({ a: ['pets'], b: ['music'] });
  });

  it('an answer they typed for a question stays its answer, and answers only that one', () => {
    expect(withExplicit({ music: 'f1', travel: 'f2', pets: 'f3' }, new Map([['weekends', 'f2']])))
      .toEqual({ music: 'f1', pets: 'f3', weekends: 'f2' });
  });
});

// ── through a round and the routes ──────────────────────────────────────────

interface P { tenantId: string; userId: string; token: string }
async function person(label: string, over: Record<string, unknown> = {}): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id',
    [`qd-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `qd-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: [`qd-own-${userId}`],
    in_pool: true, is_synthetic: false, sees_synthetic: false, display_name: label, ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map((k) => cols[k]));
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}
const says = (p: P, sentence: string) => tenantSession(p, async (db) => {
  await episodes.append(db, {
    tenantId: p.tenantId, userId: p.userId, sessionId: crypto.randomUUID(), turnId: crypto.randomUUID(),
    role: 'user', source: 'text', rawText: sentence, occurredAt: new Date(),
  });
  await commit(db, p, {
    predicate: 'did', objectText: sentence.slice(0, 40), stance: 'asserted', originClass: 'owner', sourceQuote: sentence,
    sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
  });
});

const H = (p: P) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' });
const today = async (p: P) => (await (await questionOfDayRoutes.request('/v1/question-of-day', { headers: H(p) }))
  .json() as { question: Record<string, unknown> | null }).question;
const answerQ = (p: P, id: string, text: string) =>
  questionOfDayRoutes.request('/v1/question-of-day', { method: 'POST', headers: H(p), body: JSON.stringify({ id, text }) });
const skipQ = (p: P, id: string) =>
  questionOfDayRoutes.request('/v1/question-of-day/skip', { method: 'POST', headers: H(p), body: JSON.stringify({ id }) });
const seed = async (p: P, id: string, n: number) => {
  for (let i = 0; i < n; i++) {
    await owner.query('INSERT INTO unknown_asks (tenant_id, user_id, question_id) VALUES ($1,$2,$3)', [p.tenantId, p.userId, id]);
  }
};

describe('a round', () => {
  it('records each "I don\'t know" against the side that said it, and nothing about who asked', async () => {
    const tag = `qd-meet-${Date.now()}`;
    const a = await person('a', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const b = await person('b', { intent: [tag] });
    await says(a, 'I cycle out of the city most weekends');
    await says(b, 'Most Sundays I am up Nandi Hills before sunrise');
    stub.talk = () => ({
      lines: [
        { by: 'A', kind: 'ask', question: 'weekends', sentence: 0, reaction: '' },
        { by: 'B', kind: 'answer', question: '', sentence: 1, reaction: '' },
        { by: 'A', kind: 'answer', question: '', sentence: 1, reaction: '' },
        { by: 'A', kind: 'ask', question: 'music', sentence: 0, reaction: '' },
        { by: 'B', kind: 'dont_know', question: '', sentence: 0, reaction: '' },
      ],
      shared: [], date: [],
    });
    await runRound(a.userId);
    const rows = async (p: P) => (await owner.query<{ question_id: string }>(
      'SELECT question_id FROM unknown_asks WHERE user_id = $1', [p.userId])).rows.map((r) => r.question_id);
    expect(await rows(b)).toEqual(['music']);
    expect(await rows(a)).toEqual([]);
    const { rows: cols } = await owner.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'unknown_asks' ORDER BY column_name`);
    expect(cols.map((c) => c.column_name)).toEqual(['at', 'id', 'question_id', 'tenant_id', 'user_id']);

    // She is asked it, with a count -- and the payload has nowhere to say who asked.
    const q = await today(b);
    expect(q).toEqual({ id: 'music', ask: ask('music').ask, count: 1 });
  });
});

describe('answering', () => {
  it('saves their own sentence, makes it the answer at once, and after the sheet is rebuilt', async () => {
    const me = await person('answer');
    await seed(me, 'music', 2);
    expect((await today(me))?.id).toBe('music');
    const SONGS = 'Mostly old Tamil film songs, on repeat';
    const res = await answerQ(me, 'music', SONGS);
    expect(res.status, await res.clone().text()).toBe(200);

    const answerOf = async () => (await readOwnSheet(me)).find((q) => q.id === 'music')?.answer?.text ?? null;
    expect(await answerOf()).toBe(SONGS);
    expect((await loadQuotes(me)).map((q) => q.text)).toContain(SONGS);
    expect(await today(me), 'an answered question came back').toBeNull();

    // The pointer rebuilds the sheet and points at nothing; their answer stands.
    await owner.query(`UPDATE answer_sheets SET basis = 'stale' WHERE user_id = $1`, [me.userId]);
    await ensureSheet(me);
    expect(await answerOf(), 'the rebuild dropped their own answer').toBe(SONGS);
  });

  it('refuses a question that is not in the bank, and an answer too short to quote', async () => {
    const me = await person('refuse');
    expect((await answerQ(me, 'kids', 'I would love three of them')).status).toBe(400);
    expect((await answerQ(me, 'music', 'Jazz')).status).toBe(400);
  });
});

describe('what is offered', () => {
  it('never a question already answered on their sheet', async () => {
    const me = await person('known');
    await seed(me, 'music', 3);
    await seed(me, 'travel', 1);
    await tenantSession(me, async (db) => {
      const f = await commit(db, me, {
        predicate: 'prompt_answer', objectText: 'Jazz', objectValue: { prompt: 'x' }, stance: 'asserted', originClass: 'owner',
        sourceQuote: 'Lately it is all old jazz records', sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
      });
      await episodes.append(db, {
        tenantId: me.tenantId, userId: me.userId, sessionId: crypto.randomUUID(), turnId: crypto.randomUUID(),
        role: 'user', source: 'text', rawText: 'Lately it is all old jazz records', occurredAt: new Date(),
      });
      await db.query(`INSERT INTO answer_sheets (user_id, tenant_id, answers, basis) VALUES ($1,$2,$3,'x')`,
        [me.userId, me.tenantId, JSON.stringify({ music: f.factId })]);
    });
    expect((await today(me))?.id, 'asked about music, which their agent can answer').toBe('travel');
  });

  it('two a day, answered or skipped; a skipped one stays quiet for a week', async () => {
    const me = await person('cap');
    await seed(me, 'music', 3);
    await seed(me, 'travel', 2);
    await seed(me, 'pets', 1);
    expect((await today(me))?.id).toBe('music');
    expect((await skipQ(me, 'music')).status).toBe(200);
    expect((await today(me))?.id).toBe('travel');
    await skipQ(me, 'travel');
    expect(await today(me), 'a third question in one day').toBeNull();
    // Tomorrow: the two skipped stay quiet, the third is offered.
    await owner.query(`UPDATE question_prompts SET day = CURRENT_DATE - 1 WHERE user_id = $1`, [me.userId]);
    expect((await today(me))?.id).toBe('pets');
  });

  it('nobody reads anybody else\'s, and the app role cannot write one', async () => {
    const me = await person('mine');
    const other = await person('other');
    await seed(me, 'music', 1);
    const seen = await tenantSession(other, (db) => db.query('SELECT 1 FROM unknown_asks WHERE user_id = $1', [me.userId]));
    expect(seen.rows).toHaveLength(0);
    await expect(tenantSession(me, (db) => db.query(
      'INSERT INTO unknown_asks (tenant_id, user_id, question_id) VALUES ($1,$2,$3)', [me.tenantId, me.userId, 'pets'])))
      .rejects.toThrow(/permission denied/);
  });
});

describe('an answer goes through the same rules as every sentence', () => {
  const cases = [
    { label: 'contact', question: 'music', reason: 'contact', text: 'Mostly jazz, text me on 98450 12345 for playlists' },
    { label: 'private', question: 'weekends', reason: 'private', text: 'Sunday mornings are for the temple with my parents' },
  ] as const;

  for (const c of cases) {
    it(`an answer holding ${c.label === 'contact' ? 'a contact detail' : 'a private topic'} is kept, and never given`, async () => {
      const me = await person(`rules-${c.label}`);
      await seed(me, c.question, 1);
      const res = await answerQ(me, c.question, c.text);
      expect(res.status).toBe(200);
      // Told which it was, so the screen can say so.
      expect(await res.json()).toMatchObject({ ok: true, usable: false, reason: c.reason });

      // Kept: it is theirs.
      const { rows: kept } = await owner.query<{ status: string }>(
        `SELECT status FROM facts WHERE user_id = $1 AND object_value->>'prompt' = $2`, [me.userId, `sheet:${c.question}`]);
      expect(kept.map((r) => r.status)).toEqual(['active']);

      // Never given: not on the sheet, not through the quote door, not in a round's read.
      const { rows: sheet } = await owner.query<{ answers: Record<string, string> }>(
        'SELECT answers FROM answer_sheets WHERE user_id = $1', [me.userId]);
      expect(sheet[0]?.answers?.[c.question], 'written onto the sheet').toBeUndefined();
      expect((await loadQuotes(me)).map((q) => q.text)).not.toContain(c.text);
      expect((await readOwnSheet(me)).find((q) => q.id === c.question)?.answer).toBeNull();
      const round = await matchmakerSession((m) => readSheets(m, [me.userId]));
      expect(round.get(me.userId)?.get(c.question)).toBeUndefined();
      // And a rebuild does not put it back.
      await owner.query(`UPDATE answer_sheets SET basis = 'stale' WHERE user_id = $1`, [me.userId]);
      await ensureSheet(me);
      expect((await readOwnSheet(me)).find((q) => q.id === c.question)?.answer).toBeNull();
    });
  }
});

describe('a card topic', () => {
  it('is a gap only where a private want met no answer on the card', () => {
    const r = (status: string, card?: string, priv = true) =>
      ({ want: 'w', kind: 'wants' as const, status: status as 'cant_check', quote: null, private: priv, ...(card ? { card } : {}) });
    expect(unknownCardsOf([r('cant_check', 'drinking'), r('cant_check'), r('met', 'smoking'), r('cant_check', 'drinking')]))
      .toEqual(['card:drinking']);
    expect(unknownCardsOf([r('cant_check', 'drinking', false)])).toEqual([]);
    expect(unknownCardsOf(undefined)).toEqual([]);
  });

  it('opens that card, and counts only once the card is answered through the card', async () => {
    const tag = `qd-card-${Date.now()}`;
    const her = await person('her-card', { intent: [tag] });
    await tenantSession(her, (db) => commit(db, her, {
      predicate: 'seeking', objectText: "Someone who doesn't drink", stance: 'asserted', originClass: 'owner',
      sourceQuote: "Someone who doesn't drink", sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0',
      promptVersion: '0', disclosure: 'matchable_only',
    }));
    const him = await person('him-card', { gender: 'man', seeking_gender: ['woman'], intent: [tag], traits: {} });
    await runRound(her.userId);

    const q = await today(him);
    expect(q, 'no card question').toEqual({
      id: 'card:drinking', ask: 'Do you drink?', count: 1, card: { id: 'card-drinking', topic: 'Drinking' },
    });
    // The card itself, opened by id -- not a text box.
    const next = await (await interviewRoutes.request('/v1/interview/next?card=card-drinking', { headers: H(him) }))
      .json() as { question: { id: string; whoFine?: unknown } | null };
    expect(next.question?.id).toBe('card-drinking');
    expect(next.question?.whoFine).toBeTruthy();

    // Not done until the card is answered.
    const early = await questionOfDayRoutes.request('/v1/question-of-day/done',
      { method: 'POST', headers: H(him), body: JSON.stringify({ id: 'card:drinking' }) });
    expect(early.status).toBe(409);
    const answered = await interviewRoutes.request('/v1/interview/answer', {
      method: 'POST', headers: H(him),
      body: JSON.stringify({ questionId: 'card-drinking', values: ['never'], whoFine: { anyone: true } }),
    });
    expect(answered.status, await answered.clone().text()).toBe(200);
    const done = await questionOfDayRoutes.request('/v1/question-of-day/done',
      { method: 'POST', headers: H(him), body: JSON.stringify({ id: 'card:drinking' }) });
    expect(done.status).toBe(200);

    // A card value -- what her want is checked against, by code -- and no sentence.
    const { rows } = await owner.query<{ object_value: unknown; disclosure: string }>(
      `SELECT object_value, disclosure FROM facts WHERE user_id = $1 AND predicate = 'drinking' AND status = 'active'`,
      [him.userId]);
    expect(rows).toEqual([{ object_value: 'never', disclosure: 'matchable_only' }]);
    expect(await today(him), 'the card was offered again').toBeNull();
  });

  it('a card they have a value on is never offered', async () => {
    const me = await person('card-known');
    await seed(me, 'card:smoking', 3);
    await seed(me, 'travel', 1);
    await tenantSession(me, (db) => commit(db, me, {
      predicate: 'smoking', objectText: 'never', objectValue: 'never', stance: 'asserted', originClass: 'owner',
      sourceQuote: 'Do you smoke? never', sourceEpisodeIds: [], extractorModel: 'interview', extractorVersion: '1', promptVersion: 'card-smoking',
    }));
    expect((await today(me))?.id).toBe('travel');
  });
});
