/**
 * Two agents ask each other the same questions, answer only in their person's own
 * words, and say "I don't know" rather than invent.
 *
 * WHAT THIS IS FOR (the founder, 2026-09-24): agent-to-agent questions during "send my
 * agent out" and the day's visits, where both agents can answer from what their person
 * actually said -- and a question with no answer gets "I don't know". The conversations
 * this replaces were a model writing as each person, and on a real user's card they
 * invented a comedy-writer life he never described (0061's header).
 *
 * WHAT IS PINNED HERE:
 *   - the model is shown ONLY sentences the person verifiably typed: never an invented
 *     line, an interview string, a hidden fact or a core value;
 *   - it may only POINT: numbers are kept, anything else is dropped, and every answer a
 *     card shows is the stored sentence, verbatim;
 *   - a sheet is rebuilt only when what the person said changed, and a round -- which
 *     reads both sheets -- makes no model call at all;
 *   - the card lines both people's answers up on the SAME questions, and an answer only
 *     the reader has becomes "Ask them about ...";
 *   - a hidden answer never reaches a card, by row-level security, with no rebuild;
 *   - a practice profile's answers are templated, labelled, and cost nothing;
 *   - "How you appear" lists every question, and an answer the person hid stays
 *     listed there so the Hide can be undone;
 *   - the five private cards are never in the bank.
 *
 * Negative controls, run by hand:
 *   - loadQuotes' verbatim-episode clause bypassed      -> "shows the model only" fails
 *     (with balanced SQL: an unbalanced edit failed five tests on a syntax error, which
 *     proves nothing, and was redone)
 *   - pointedToAnswers keeping out-of-range numbers     -> "points, and never writes" fails
 *   - ensureSheet ignoring the basis                    -> "no call when nothing changed" fails
 *   - compareSheets dropping the ask-them lines         -> "lines up the same questions" fails
 *   - the facts_matchmaker policy without its disclosure condition (ALTER POLICY on the
 *     dev database, restored and re-read byte for byte) -> "a hidden answer" fails. The
 *     protection there is row-level security, so that is what the control removes.
 *   - the appearance route's hidden list filtered to nothing -> "keeps an answer the
 *     person hid within reach" fails
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

// Three picks and no conversation, whatever .env says (as brief-code-only.test.ts).
vi.hoisted(() => {
  const DEFAULTED = ['RENDEZVOUS_RUNS', 'ROUND_CANDIDATES', 'DECIDE_MODEL', 'WEEKLY_REAL_EXPOSURE'];
  const original = process.loadEnvFile;
  const strip = () => { for (const k of DEFAULTED) delete process.env[k]; };
  process.loadEnvFile = ((...args: Parameters<typeof process.loadEnvFile>) => {
    try { original.apply(process, args); } finally { strip(); }
  }) as typeof process.loadEnvFile;
  strip();
});

const stub = vi.hoisted(() => ({ parsed: {} as unknown, calls: 0, lastContent: '' }));

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real,
    decideModel: () => null,
    modelFor: () => 'google:gemini-3.5-flash-lite',
    llm: {
      ...real.llm,
      complete: async (req: { messages: { content: string }[] }) => {
        stub.calls++;
        stub.lastContent = req.messages.map((m) => m.content).join('\n');
        return {
          text: 'She loves hiking and cooks Thai food every Sunday', // never read
          parsed: stub.parsed,
          usage: {
            inputTokens: 0, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
            reasoningTokens: 0, provider: 'google', modelId: 'x', costUsd: 0, latencyMs: 0,
          },
        };
      },
      decide: async () => { stub.calls++; throw new Error('no typed model'); },
    },
  };
});

const { env } = await import('../src/env.js');
const { pool, tenantSession, matchmakerSession, closeMatchPool } = await import('../src/db/client.js');
const { commit } = await import('../src/memory/facts.js');
const episodes = await import('../src/memory/episodes.js');
const {
  SHEET, compareSheets, ensureSheet, pointedToAnswers, practiceSheet, readOwnSheet, readSheets,
} = await import('../src/matching/answer-sheet.js');
const { namesCoreValue } = await import('../src/matching/brief.js');
const { runRound } = await import('../src/matching/orchestrator.js');
const { meRoutes } = await import('../src/api/me.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 120_000 });
beforeEach(() => { stub.calls = 0; stub.parsed = {}; stub.lastContent = ''; });

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

async function person(label: string, over: Record<string, unknown>): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id',
    [`as-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `as-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  // AN INTENT OF ITS OWN unless the scene gives one. Every candidate clause passes on
  // an empty intent, and real people are picked first: the first version of this file
  // left three in-pool women with no intent, and round-queue.test.ts's rounds -- running
  // at the same time -- met them instead of their own scene's spare candidate.
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: [`as-own-${userId}`],
    in_pool: true, is_synthetic: false, sees_synthetic: false, display_name: label, ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map((k) => cols[k]));
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

/** Something the person typed: what makes a sentence of theirs verifiable. */
const typed = (p: P, rawText: string) => tenantSession(p, (db) => episodes.append(db, {
  tenantId: p.tenantId, userId: p.userId, sessionId: crypto.randomUUID(), turnId: crypto.randomUUID(),
  role: 'user', source: 'text', rawText, occurredAt: new Date(),
}));

const fact = async (p: P, predicate: string, sourceQuote: string, extractorModel = 't') =>
  (await tenantSession(p, (c) => commit(c, p, {
    predicate, objectText: sourceQuote.slice(0, 40), stance: 'asserted', originClass: 'owner', sourceQuote,
    sourceEpisodeIds: [], extractorModel, extractorVersion: '0', promptVersion: '0',
  }))).factId!;

/** Point the stub at sentences by their text, in the numbering the prompt used. */
function pointAt(pairs: Record<string, string>) {
  const lines = stub.lastContent.split('\n');
  const num = (text: string) => {
    const l = lines.find((x) => /^\d+\. /.test(x) && x.includes(text));
    return l ? Number(l.split('.')[0]) : null;
  };
  return { answers: Object.entries(pairs).map(([question, text]) => ({ question, sentence: num(text) })) };
}

const HIKE = 'Most weekends I am up Nandi Hills before sunrise';
const THAI = 'I could eat green curry every single day';
const JAZZ = 'Lately it is all old jazz records on my turntable';
const INVENTED = 'I do stand-up at a comedy club every Friday';
const SMOKES = 'I smoke a pack a day, always have';

describe('the bank', () => {
  it('never asks about the five private cards', () => {
    for (const q of SHEET) {
      expect(namesCoreValue(`${q.ask} ${q.short}`), q.id).toBe(false);
    }
    const ids = SHEET.map((q) => q.id);
    for (const card of ['kids', 'children', 'monogamy', 'smoking', 'drinking', 'diet', 'faith', 'religion', 'politics']) {
      expect(ids).not.toContain(card);
    }
    expect(SHEET.length).toBe(12);
  });
});

describe('pointing, never writing', () => {
  it('points, and never writes: only numbers in range are kept, once each', () => {
    const sentences = [{ id: 'f1' }, { id: 'f2' }];
    expect(pointedToAnswers({ answers: [
      { question: 'weekends', sentence: 1 },
      { question: 'food', sentence: 99 },      // out of range
      { question: 'music', sentence: 0 },      // numbered from 1
      { question: 'work', sentence: 1 },       // already used by weekends
      { question: 'travel', sentence: 2 },
      { question: 'not-a-question', sentence: 2 },
    ] }, sentences)).toEqual({ weekends: 'f1', travel: 'f2' });
    // Words where a number belongs: the whole answer is refused, not half-read.
    expect(pointedToAnswers({ answers: [{ question: 'weekends', sentence: 'hiking' }] }, sentences)).toEqual({});
    expect(pointedToAnswers('I love hiking', sentences)).toEqual({});
  });
});

describe('building a sheet', () => {
  it('shows the model only what the person verifiably typed, and stores their words', async () => {
    const me = await person('builder', {});
    await typed(me, `${HIKE}. ${THAI}. ${JAZZ}. ${SMOKES}.`);
    await fact(me, 'did', HIKE);
    await fact(me, 'interest', THAI);
    await fact(me, 'media_taste', JAZZ);
    await fact(me, 'did', INVENTED);                         // never typed
    await fact(me, 'did', SMOKES);                           // a core value
    await fact(me, 'interest', 'Children? have_and_done at the moment', 'interview');
    const hidden = await fact(me, 'interest', 'I secretly love bad reality television shows');
    await typed(me, 'I secretly love bad reality television shows');
    await owner.query(`UPDATE facts SET disclosure = 'private' WHERE id = $1`, [hidden]);

    // First call: capture what the model was shown, then answer by pointing.
    stub.parsed = { answers: [] };
    await ensureSheet(me);
    expect(stub.calls).toBe(1);
    for (const ok of [HIKE, THAI, JAZZ]) expect(stub.lastContent).toContain(ok);
    for (const never of [INVENTED, SMOKES, 'have_and_done', 'reality television']) {
      expect(stub.lastContent, `the model was shown "${never}"`).not.toContain(never);
    }

    // Make it rebuild, pointing properly this time.
    await owner.query('UPDATE answer_sheets SET basis = $2 WHERE user_id = $1', [me.userId, 'stale']);
    stub.parsed = pointAt({ weekends: HIKE, food: THAI, music: JAZZ });
    const r = await ensureSheet(me);
    expect(r).toEqual({ built: true, answered: 3 });

    const mine = await readOwnSheet(me);
    expect(mine.find((q) => q.id === 'weekends')?.answer?.text).toBe(HIKE);
    expect(mine.find((q) => q.id === 'food')?.answer?.text).toBe(THAI);
    expect(mine.find((q) => q.id === 'travel')?.answer, 'an unanswered question is "I don\'t know"').toBeNull();
  });

  it('makes no call when nothing changed, and none when there is nothing to point at', async () => {
    const me = await person('quiet', {});
    await ensureSheet(me);
    expect(stub.calls, 'called a model with no sentences to point at').toBe(0);
    expect((await readOwnSheet(me)).every((q) => q.answer === null)).toBe(true);

    await typed(me, `${HIKE}.`);
    await fact(me, 'did', HIKE);
    stub.parsed = { answers: [{ question: 'weekends', sentence: 1 }] };
    await ensureSheet(me);
    expect(stub.calls).toBe(1);
    await ensureSheet(me);
    await ensureSheet(me);
    expect(stub.calls, 'rebuilt a sheet whose sentences had not changed').toBe(1);
  });
});

describe('two agents meeting', () => {
  async function scene(tag: string) {
    const a = await person('a', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const b = await person('b', { intent: [tag] });
    await typed(a, `${HIKE}. ${JAZZ}.`);
    await fact(a, 'did', HIKE);
    await fact(a, 'media_taste', JAZZ);
    await typed(b, `${THAI}. Weekends are for long bike rides out of the city.`);
    await fact(b, 'interest', THAI);
    const bRide = await fact(b, 'did', 'Weekends are for long bike rides out of the city');
    stub.parsed = { answers: [] };
    await ensureSheet(a);
    stub.parsed = pointAt({ weekends: HIKE, music: JAZZ });
    await owner.query('UPDATE answer_sheets SET basis = $2 WHERE user_id = $1', [a.userId, 'stale']);
    await ensureSheet(a);
    stub.parsed = { answers: [] };
    await ensureSheet(b);
    stub.parsed = pointAt({ weekends: 'long bike rides', food: THAI });
    await owner.query('UPDATE answer_sheets SET basis = $2 WHERE user_id = $1', [b.userId, 'stale']);
    await ensureSheet(b);
    return { a, b, bRide };
  }

  const card = async (reader: P, other: P) => {
    const { rows } = await owner.query<{ overlap_quotes: { qa?: { q: string; ask?: string; theirs: string | null; mine: string | null }[] }; questions: string[] }>(
      `SELECT b.overlap_quotes, b.questions FROM rendezvous_briefs b
         JOIN rendezvous r ON r.id = b.rendezvous_id
        WHERE b.for_user = $1 AND $2 IN (r.user_a, r.user_b)`, [reader.userId, other.userId]);
    return rows[0]!;
  };

  it('lines up the same questions, turns "I don\'t know" into what to ask, and calls no model', async () => {
    const { a, b } = await scene(`as-meet-${Date.now()}`);
    stub.calls = 0;
    // The exchange is what a card carries when the agents do not talk (talk.ts, which
    // makes one call a pair and is pinned in talk.test.ts). Reading two sheets must
    // never call a model, so the talk is switched off to watch the sheets alone.
    process.env.AGENT_TALK = 'off';
    const r = await runRound(a.userId).finally(() => { delete process.env.AGENT_TALK; });
    expect(r.metAll).toContain(b.userId);
    expect(stub.calls, 'a round called a model').toBe(0);

    const forA = await card(a, b);
    const qa = forA.overlap_quotes.qa!;
    // Both answered weekends: the trekking and the bike rides, side by side.
    expect(qa[0]).toEqual({ q: 'Weekends', ask: 'What do you do on weekends?',
                            theirs: 'Weekends are for long bike rides out of the city', mine: HIKE });
    // Only she answered food.
    expect(qa).toContainEqual({ q: 'Favourite food', ask: 'What food could you eat every day?', theirs: THAI, mine: null });
    // Only he answered music: her agent said "I don't know" -- so that is what to ask.
    expect(qa).toContainEqual({ q: 'Music', ask: 'What are you listening to lately?', theirs: null, mine: JAZZ });
    expect(forA.questions[0]).toBe('Ask them about music');
    // Nobody answered travel: not on the card at all.
    expect(qa.map((l) => l.q)).not.toContain('Travel');
  });

  it('a hidden answer never reaches a card, with no rebuild', async () => {
    const { a, b, bRide } = await scene(`as-hide-${Date.now()}`);
    await owner.query(`UPDATE facts SET disclosure = 'private' WHERE id = $1`, [bRide]);
    const sheets = await matchmakerSession((c) => readSheets(c, [b.userId]));
    expect(sheets.get(b.userId)?.get('weekends'), 'a hidden sentence came back to the matchmaker').toBeUndefined();
    await runRound(a.userId);
    const qa = (await card(a, b)).overlap_quotes.qa!;
    expect(JSON.stringify(qa)).not.toContain('bike rides');
  });

  it('gives a practice profile labelled, templated answers, at no cost', () => {
    const s = practiceSheet(['interest:street-food', 'media_taste:regional-cinema', 'works_in:logistics']);
    expect(s.get('work')).toEqual({ factId: null, text: 'I work in logistics.', practice: true });
    expect(s.get('weekends')?.text).toBe('Mostly street food.');
    expect(s.get('watching')?.text).toBe('A lot of regional cinema.');
    expect(s.size).toBe(3);
    const lines = compareSheets(new Map(), s);
    expect(lines.every((l) => l.practice === true)).toBe(true);
  });
});

describe('How you appear', () => {
  it('shows the person their own sheet, every question, "I don\'t know" included', async () => {
    const me = await person('appear', {});
    await typed(me, `${THAI}.`);
    await fact(me, 'interest', THAI);
    stub.parsed = { answers: [] };
    const res = await meRoutes.request('/v1/me/appearance', { headers: { Authorization: `Bearer ${me.token}` } });
    expect(res.status).toBe(200);
    const body = await res.json() as { sheet: { id: string; answer: { text: string } | null }[] };
    expect(body.sheet.map((q) => q.id)).toEqual(SHEET.map((q) => q.id));
    expect(body.sheet.every((q) => q.answer === null)).toBe(true);
  });

  it('keeps an answer the person hid within reach, so the Hide can be undone', async () => {
    // A goal: something the sheet answers from and a card never quotes, so it is not
    // in the quotes list above and its own Show is the only way back.
    const GOAL = 'I am saving up to open a tiny bakery in Basavanagudi';
    const me = await person('unhide', {});
    await typed(me, `${GOAL}.`);
    const goalId = await fact(me, 'goal', GOAL);
    await ensureSheet(me);
    stub.parsed = pointAt({ goal: 'bakery' });
    await owner.query('UPDATE answer_sheets SET basis = $2 WHERE user_id = $1', [me.userId, 'stale']);
    await ensureSheet(me);
    const auth = { Authorization: `Bearer ${me.token}` };
    const before = await (await meRoutes.request('/v1/me/appearance', { headers: auth })).json() as {
      sheet: { id: string; answer: { factId: string } | null }[]; hidden: { factId: string; text: string }[];
    };
    expect(before.sheet.find((q) => q.id === 'goal')?.answer?.factId).toBe(goalId);
    expect(before.hidden).toEqual([]);

    const hide = await meRoutes.request(`/v1/facts/${goalId}/disclosure`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden: true }),
    });
    expect(hide.status).toBe(200);
    stub.parsed = { answers: [] };
    const after = await (await meRoutes.request('/v1/me/appearance', { headers: auth })).json() as typeof before;
    expect(after.sheet.find((q) => q.id === 'goal')?.answer).toBeNull();
    expect(after.hidden).toEqual([{ factId: goalId, text: GOAL }]);
  });
});
