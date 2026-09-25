/**
 * A round costs nothing in model calls, and nothing a model invented reaches a card.
 *
 * WHAT WAS WRONG, measured on the live database on 2026-09-23. A round was about 189
 * model calls ($0.055): five conversations a pair, a file score, and two model-written
 * briefs. And what those calls produced reached real people as fact -- a real user with
 * nine facts and one episode, none about comedy, received two briefs whose concern
 * called him a comedy writer. The briefs also offered the interview's own bookkeeping
 * as quotes ("Children? have_and_done" -- the question text plus the stored value, from
 * api/interview.ts), and nothing but a prompt kept smoking, drinking, kids, monogamy or
 * diet off a card.
 *
 * THE GUARDS, from the spec:
 *   (f) a round with DEFAULT settings makes 0 model calls and writes 3 briefs
 *   (d) brief text never contains have_and_done, a smoking / drinking / monogamy /
 *       diet value, or a "Question? value" string
 *   (e) a made-up first-person line that is NOT in the person's user-role episodes
 *       never becomes a quote -- here, a line the CLONE said in the first person, and
 *       a paraphrase no episode contains
 *
 * AND WHAT REVIEW FOUND THE FIRST VERSION OF THESE MISSED, each planted below:
 *   - a core value in the WORDS of a sentence filed under an allowed kind ("I'm
 *     vegetarian and love cooking" as interest:cooking, "Picked my daughter up from
 *     school" as did), and a practice profile's interest:whisky tag;
 *   - the loader's own clauses: every fact the first version planted was public, so
 *     `disclosure = 'public'` -- the only disclosure check left once the loader runs
 *     as the person rather than the matchmaker -- could be deleted and nothing failed.
 *     Likewise `extractor_model <> 'interview'` and the active / not-ended clause;
 *   - the path every real user is actually on today: all six real users are men
 *     seeking women, so every card they get is about a PRACTICE profile, whose
 *     sentences a model wrote (match_profile.synthetic_quotes) and which the old loader
 *     served verbatim;
 *   - "default settings" that were not: the mock hard-coded decideModel to null, and
 *     DECIDE_MODEL was deleted after env.ts had already parsed it.
 *
 * THE STUB IS ADVERSARIAL ON PURPOSE. Every model call it answers says the worst thing
 * it could: the brief headline names the core values, it picks every quote index it
 * is offered, and every concern calls him a comedy writer. On the old code that text
 * is what reached the card; on the new code no call is made, so none of it can. The
 * planted DATA is the failing case: public interview facts, a smoking sentence the
 * person really typed, a line only the clone said, and one honest sentence that must
 * still come through -- so a card that says nothing cannot pass by being empty.
 *
 * Negative controls, run by hand (see the report for this change): put the RUNS
 * default back to 5 -> (f) fails on the call count; call llmFileScore again -> (f)
 * fails on the call count; give DECIDE_MODEL a default in env.ts -> (f) fails on the
 * call count; drop the QUOTABLE / TAGGABLE filters -> (d) fails on the smoking
 * sentence and the shared core tags; drop namesCoreValue -> (d) fails on the diet,
 * the daughter and the whisky; drop the EXISTS clause in loadQuotes -> (e) fails on
 * the comedy lines; drop the disclosure, interview or active clause -> the loader
 * test fails on the hidden, the interview or the retired sentence; serve
 * synthetic_quotes again -> the practice test fails.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => {
  // THE CODE'S DEFAULTS, NOT THIS MACHINE'S. env.ts loads .env and parses process.env
  // once, when it is first imported, and rendezvous.ts reads RENDEZVOUS_RUNS when it
  // is -- so a variable deleted after that has already been read, and one deleted
  // before it is put straight back by the file load. The three settings that can put
  // a model call back on a round are therefore removed BETWEEN the load and the parse:
  // env.ts calls process.loadEnvFile, and this wraps it until env.ts has run. A shell
  // export of any of them goes the same way.
  const DEFAULTED = ['RENDEZVOUS_RUNS', 'ROUND_CANDIDATES', 'DECIDE_MODEL'];
  const original = process.loadEnvFile;
  const strip = () => { for (const k of DEFAULTED) delete process.env[k]; };
  process.loadEnvFile = ((...args: Parameters<typeof process.loadEnvFile>) => {
    try { original.apply(process, args); } finally { strip(); }
  }) as typeof process.loadEnvFile;
  strip();
  return { calls: 0, original };
});

vi.mock('../src/llm/index.js', async (importOriginal) => {
  // The REAL decideModel, reading the real routing from the env as parsed: if the
  // code's default ever switched the typed scorer on, jevFileScore would call
  // llm.decide below and the count would say so. Only the two calls that spend are
  // stubbed.
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  const usage = {
    inputTokens: 500, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 60,
    reasoningTokens: 0, provider: 'google', modelId: 'flash-lite', costUsd: 0.0001, latencyMs: 100,
  };
  const every = Array.from({ length: 12 }, (_, i) => ({ mine: i, theirs: i, shared: 'everything' }));
  return {
    modelFor: () => 'google:gemini-3.5-flash-lite',
    decideModel: real.decideModel,
    llm: {
      complete: async (req: { outputSchema?: unknown; outputSchemaName?: string }) => {
        stub.calls++;
        // An agent inventing its human, which is what the prober did.
        if (!req.outputSchema) return { text: 'I do stand-up at a comedy club every Friday night', parsed: null, usage };
        if (req.outputSchemaName === 'brief') {
          return { text: '', usage, parsed: {
            headline: 'They smoke daily, are have_and_done with kids, and write comedy',
            pairs: every,
            questions: ['Children? have_and_done', 'Do you drink? often'],
          } };
        }
        if (req.outputSchemaName === 'file_verdict') {
          return { text: '', parsed: { concern: 'He is a comedy writer', score: 0.5 }, usage };
        }
        return { text: '', usage, parsed: {
          learned: ['a', 'b', 'c'], concern: 'He is a comedy writer who smokes daily', verdict: 'yes',
        } };
      },
      decide: async () => { stub.calls++; throw new Error('no typed model in this test'); },
    },
  };
});

const { env } = await import('../src/env.js');
// env.ts has parsed; nothing else loads the file.
process.loadEnvFile = stub.original;
const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { commit } = await import('../src/memory/facts.js');
const { decideModel } = await import('../src/llm/index.js');
const { runRound, decide, CANDIDATES_PER_ROUND } = await import('../src/matching/orchestrator.js');
const { RUNS } = await import('../src/matching/rendezvous.js');
const { BRIEF_LINE, composeBrief, loadQuotes } = await import('../src/matching/brief.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 180_000 });
beforeEach(() => { stub.calls = 0; });

afterAll(async () => {
  if (made.length) {
    // Episodes carry no foreign key at all and facts none to tenants, so deleting the
    // tenant leaves both behind: the first version of this file left 22 copies of
    // "Well, I do stand-up at a comedy club..." in the table. This file's own
    // fixtures, by its own tenants, and nothing else.
    await owner.query('DELETE FROM episodes WHERE tenant_id = ANY($1)', [made]);
    await owner.query('DELETE FROM facts WHERE tenant_id = ANY($1)', [made]);
    await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  }
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string; token: string }

async function person(label: string, over: Record<string, unknown> = {}): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`bc-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `bc-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: ['long_term'],
    in_pool: true, is_synthetic: false, sees_synthetic: false, display_name: label, ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map((k) => cols[k]));
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

/** A fact, written the way the named writer writes it. Public unless said otherwise. */
async function fact(
  who: P, predicate: string, value: string, sourceQuote: string, extractorModel = 'gemini-test',
  disclosure: 'public' | 'matchable_only' | 'private' = 'public',
) {
  const r = await tenantSession(who, (c) => commit(c, who, {
    predicate, objectText: value, objectValue: value, stance: 'asserted', originClass: 'owner',
    sourceQuote, sourceEpisodeIds: [], extractorModel, extractorVersion: '1', promptVersion: 'test',
    disclosure,
  }));
  expect(r.outcome, `${predicate} committed`).not.toBe('rejected');
}

/** Something said in a chat, by the person ('user') or by their clone ('assistant'). */
async function episode(who: P, role: 'user' | 'assistant', text: string) {
  await owner.query(
    `INSERT INTO episodes (tenant_id, user_id, session_id, turn_id, turn_index, role, raw_text, occurred_at)
     VALUES ($1,$2,gen_random_uuid(),gen_random_uuid(),0,$3,$4, now())`,
    [who.tenantId, who.userId, role, text]);
}

/** Typed by the person, word for word, and committed as a fact quoting part of it. */
async function said(who: P, predicate: string, value: string, typed: string, quote: string,
                    extractorModel?: string, disclosure?: 'public' | 'matchable_only' | 'private') {
  expect(typed, 'the quote really is in what was typed').toContain(quote);
  await episode(who, 'user', typed);
  await fact(who, predicate, value, quote, extractorModel, disclosure);
}

const matchesOf = async (who: P) => {
  const res = await datingRoutes.request('/v1/matches', {
    headers: { Authorization: `Bearer ${who.token}`, 'x-forwarded-for': '203.0.113.21' },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { matches: Array<Record<string, unknown>> };
};

/**
 * Make it the reader's turn. Whoever has more matches waiting decides first, and a
 * tie breaks on the id -- so in a fresh pair it is a coin toss -- and the second mover
 * sees the plain card until the first says yes (api/dating.ts). The card under test
 * is the one the reader sees once it is theirs to decide.
 */
async function readersTurn(reader: P, other: { userId: string }) {
  const { rows } = await owner.query<{ id: string; first_mover: string }>(
    `SELECT id, first_mover FROM rendezvous
      WHERE (user_a = $1 AND user_b = $2) OR (user_a = $2 AND user_b = $1)`, [reader.userId, other.userId]);
  expect(rows).toHaveLength(1);
  if (rows[0]!.first_mover !== reader.userId) await decide(other.userId, rows[0]!.id, true);
}

describe('(f) a round with the default settings', () => {
  it('makes no model call, and writes a brief for each of the three people it meets', async () => {
    expect(RUNS, 'the code default is no conversation').toBe(0);
    const tag = `bc-f-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    // One public fact each, so the file scorers the old code ran had something to
    // read -- both skip two empty dossiers, and a stub that is never called proves
    // nothing.
    await fact(me, 'interest', 'climbing', 'climbing');
    for (let i = 0; i < CANDIDATES_PER_ROUND + 1; i++) {
      const them = await person(`c${i}`, { intent: [tag] });
      await fact(them, 'interest', 'pottery', 'pottery');
    }

    const r = await runRound(me.userId);
    expect(r.skipped).toBeUndefined();
    expect(stub.calls, 'model calls in a default round').toBe(0);
    // Said as well as counted: the count above is the behaviour, this is the cause.
    expect(decideModel(), 'the code default is no typed scorer').toBeNull();
    expect(r.costUsd).toBe(0);
    expect(r.metAll).toHaveLength(3);

    const { rows } = await owner.query<{
      id: string; status: string; agreement: string | null; llm_file_score: string | null;
      jev_file_score: string | null; runs_done: number; runs: string; mine: string; briefs: string;
      concerns: string[];
    }>(
      `SELECT r.id, r.status, r.agreement, r.llm_file_score, r.jev_file_score, r.runs_done,
              (SELECT count(*) FROM rendezvous_runs x WHERE x.rendezvous_id = r.id) AS runs,
              (SELECT count(*) FROM rendezvous_briefs b WHERE b.rendezvous_id = r.id AND b.for_user = $1) AS mine,
              (SELECT count(*) FROM rendezvous_briefs b WHERE b.rendezvous_id = r.id) AS briefs,
              (SELECT array_agg(b.concern) FROM rendezvous_briefs b WHERE b.rendezvous_id = r.id) AS concerns
         FROM rendezvous r WHERE r.user_a = $1 OR r.user_b = $1`, [me.userId]);
    expect(rows).toHaveLength(3);
    expect(rows.reduce((n, x) => n + Number(x.mine), 0), 'briefs for the person who sent the agent').toBe(3);
    for (const row of rows) {
      expect(row.status).toBe('decided');
      expect(Number(row.briefs), 'one brief each side').toBe(2);
      expect(row.agreement, 'no conversation, so nothing measured').toBeNull();
      expect(row.llm_file_score, 'the file score is no longer taken').toBeNull();
      expect(row.jev_file_score, 'the typed scorer is off').toBeNull();
      expect(row.runs_done).toBe(0);
      expect(Number(row.runs)).toBe(0);
      expect(row.concerns).toEqual(['', '']);
    }
    const { rows: spent } = await owner.query<{ n: string }>(
      'SELECT count(*) AS n FROM llm_calls WHERE user_id = $1', [me.userId]);
    expect(spent[0]!.n).toBe('0');
  });
});

describe('what a card may say', () => {
  it('says the same line on every card, in the words the spec fixed', () => {
    // Pinned as a literal once, here: it is the only line on the card that speaks to
    // fit, and every other test compares against the imported constant -- which would
    // follow it anywhere, including to a verdict.
    expect(BRIEF_LINE).toBe("Passes your rules both ways, on everything they've answered");
  });

  /**
   * One pair, built to fail. Both carry the same core-value tags, so every one of
   * them is "shared"; the other person's facts include interview answers, a smoking
   * sentence they really typed, a line only their clone said, a paraphrase nobody
   * said, sentences they typed that name a core value under an allowed kind, and
   * sentences they typed that the loader must leave alone for its OWN reasons (hidden,
   * from the interview, retired) -- and exactly one honest sentence.
   */
  async function scene() {
    const tag = `bc-d-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const core = ['wants_children:have_and_done', 'smoking:daily', 'drinking:often',
      'diet:vegetarian', 'monogamy_stance:non_monogamous'];
    // interest:whisky is an allowed kind naming a drinking value, as on 511 practice
    // profiles; works_in:finance is shared, and must not be said as "You both like".
    const tags = ['interest:pottery', 'interest:whisky', 'works_in:finance', ...core];
    const reader = await person('reader', { gender: 'man', seeking_gender: ['woman'], intent: [tag],
      attribute_tags: tags });
    const other = await person('other', { intent: [tag], attribute_tags: tags });

    for (const who of [reader, other]) {
      // The interview's own bookkeeping: "${question} ${value}", public by default
      // for three of these and made public here for the rest.
      await fact(who, 'wants_children', 'have_and_done', 'Children? have_and_done', 'interview');
      await fact(who, 'drinking', 'often', 'Do you drink? often', 'interview');
      await fact(who, 'diet', 'vegetarian', 'How do you eat? vegetarian', 'interview');
      await fact(who, 'monogamy_stance', 'non_monogamous', 'One person, or open? non_monogamous', 'interview');
      await fact(who, 'interest', 'pottery', 'pottery');
      await fact(who, 'interest', 'whisky', 'whisky');
      await fact(who, 'works_in', 'finance', 'finance');
    }
    // Really typed, verbatim -- and still a core value.
    await episode(other, 'user', 'Honestly? I smoke daily, a pack since college.');
    await fact(other, 'smoking', 'daily', 'I smoke daily, a pack since college');
    // (e) Said by the CLONE, in the first person, and read back as his.
    await episode(other, 'assistant', 'Well, I do stand-up at a comedy club every Friday night!');
    await fact(other, 'did', 'stand-up comedy', 'I do stand-up at a comedy club every Friday night');
    // (e) A paraphrase no episode contains.
    await fact(other, 'interest', 'comedy writing', 'I am a comedy writer by trade and I love it');

    // (d) Typed word for word, filed under a kind a card may quote -- and naming a
    // diet, a child, a habit. The kind passes; the words must not.
    await said(other, 'interest', 'cooking',
      "Honestly I'm vegetarian and love cooking, mostly South Indian food.", "I'm vegetarian and love cooking");
    await said(other, 'did', 'school run',
      'Picked my daughter up from school and then went bouldering.', 'Picked my daughter up from school');
    await said(other, 'did', 'quit smoking',
      'I quit smoking last year and took up running.', 'I quit smoking last year');

    // The loader's own clauses. Each of these is typed word for word and filed under
    // an allowed kind, so only the clause named stands between it and the card.
    //   disclosure = 'public'
    await said(other, 'interest', 'tea blending',
      'I blend my own tea at home every weekend, it is my thing.', 'I blend my own tea at home every weekend',
      undefined, 'private');
    await said(other, 'interest', 'chess',
      'I play chess online until two most nights.', 'I play chess online until two most nights',
      undefined, 'matchable_only');
    //   extractor_model <> 'interview'
    await said(other, 'interest', 'cycling',
      'I cycle to work along the lake every morning.', 'I cycle to work along the lake every morning',
      'interview');
    //   status = 'active' AND valid_to IS NULL: one taken back, one that has ended.
    await said(other, 'interest', 'kayaking',
      'I kayak on the backwaters whenever I can get away.', 'I kayak on the backwaters whenever I can get away');
    await said(other, 'interest', 'sailing',
      'I sailed a small dinghy round the harbour every summer.', 'I sailed a small dinghy round the harbour every summer');
    await owner.query(
      `UPDATE facts SET status = 'retracted' WHERE user_id = $1 AND source_quote LIKE 'I kayak%'`, [other.userId]);
    await owner.query(
      `UPDATE facts SET valid_to = now() - interval '1 day' WHERE user_id = $1 AND source_quote LIKE 'I sailed%'`,
      [other.userId]);

    // The one honest sentence: typed by the person, quoted from the middle. Its own
    // value, because a second `interest: pottery` would corroborate the first fact
    // and keep the first fact's one-word quote.
    await episode(other, 'user', 'Last year I spent the whole winter learning to throw pots, badly.');
    await fact(other, 'interest', 'throwing pots', 'spent the whole winter learning to throw pots');
    return { reader, other };
  }

  const FORBIDDEN = [
    'have_and_done', 'have and done', 'daily', 'often', 'vegetarian', 'non_monogamous',
    'non monogamous', 'smok', 'Children?', 'Do you drink', 'How do you eat', 'One person, or open',
    'comedy', 'stand-up', 'daughter', 'whisky', 'like finance',
    // hidden, from the interview, taken back, ended
    'blend my own tea', 'chess', 'cycle to work', 'kayak', 'dinghy',
  ];

  it('(d)(e) names no core value, no interview string and no invented line -- and keeps the honest one', async () => {
    const { reader, other } = await scene();
    const r = await runRound(reader.userId);
    expect(r.metAll).toEqual([other.userId]);
    expect(stub.calls).toBe(0);
    await readersTurn(reader, other);

    // What the reader's phone receives.
    const { matches } = await matchesOf(reader);
    expect(matches).toHaveLength(1);
    const card = matches[0]!;
    const text = JSON.stringify(card);
    for (const bad of FORBIDDEN) expect(text, `the card said "${bad}"`).not.toContain(bad);
    // "Question? value" in any form, not only the ones planted.
    expect(text).not.toMatch(/\?\s+[a-z]+_[a-z_]+/);
    expect(card).not.toHaveProperty('concern');
    expect(card).not.toHaveProperty('agreement');
    // And it is not passing by saying nothing.
    expect(card.quotes).toEqual([{ text: 'spent the whole winter learning to throw pots', when: '' }]);
    expect(card.shared).toEqual(['pottery']);
    expect(card.work).toEqual(['finance']);
    expect(card.line).toBe(BRIEF_LINE);
    expect(card.opener).toBe('Ask them about: pottery');

    // What is stored, both sides -- the other person's card about the reader too.
    const { rows } = await owner.query<{ headline: string; overlap_quotes: unknown; concern: string; questions: unknown }>(
      `SELECT b.headline, b.overlap_quotes, b.concern, b.questions
         FROM rendezvous_briefs b JOIN rendezvous r ON r.id = b.rendezvous_id
        WHERE r.user_a = $1 OR r.user_b = $1`, [reader.userId]);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const stored = JSON.stringify(row);
      for (const bad of FORBIDDEN) expect(stored, `a stored brief said "${bad}"`).not.toContain(bad);
      expect(row.concern).toBe('');
    }
  });

  it('(e) a sentence is a quote only if the person typed it, shows it, and still stands by it', async () => {
    const { other } = await scene();
    const quotes = await loadQuotes(other);
    expect(quotes.map((q) => q.text)).toEqual(['spent the whole winter learning to throw pots']);
  });

  it('(d) the composer drops a core value, by kind or by word, even when a caller hands it one', () => {
    // loadQuotes already filters; this is the second line, for a Quote[] built by hand
    // (a script, a later loader). Shared tags are held to the same rules.
    const side = (tags: string[], quotes: { predicate: string; text: string }[]) => ({
      card: { age: 29, intent: ['long_term', 'marriage'], area: 'indiranagar', city: 'Bangalore' },
      tags,
      quotes: quotes.map((q, i) => ({ id: String(i), when: 'May 2026', ...q })),
    });
    const brief = composeBrief(
      side(['interest:pottery', 'interest:whisky', 'works_in:finance', 'smoking:daily', 'diet:vegetarian'], []),
      side(['interest:pottery', 'interest:whisky', 'works_in:finance', 'smoking:daily', 'diet:vegetarian',
            'wants_children:have_and_done'], [
        { predicate: 'wants_children', text: 'I have two kids and I am done' },
        { predicate: 'smoking', text: 'I smoke daily, a pack since college' },
        { predicate: 'interest', text: "I'm vegetarian and love cooking" },
        { predicate: 'did', text: 'Picked my daughter up from school' },
        { predicate: 'did', text: 'I quit smoking last year' },
        { predicate: 'interest', text: 'I throw pots on Sundays' },
      ]),
    );
    expect(brief).toEqual({
      headline: 'Here for something long-term or marriage · 29 · Indiranagar',
      line: BRIEF_LINE,
      shared: ['pottery'],
      work: ['finance'],
      quotes: [{ text: 'I throw pots on Sundays', when: 'May 2026' }],
      opener: 'Ask them about: pottery',
      // No answer sheets handed in, so no exchange (answer-sheet.test.ts covers one),
      // no talk (talk.test.ts), and no wants (wants.test.ts).
      qa: [],
      talk: null,
      wants: [],
    });
  });
});

describe('a practice profile', () => {
  /**
   * The path every real user is on today. A practice profile has no episodes and no
   * facts; what it has is `synthetic_quotes`, sentences a model wrote from its traits,
   * and tags that are not filtered by disclosure at all. The old loader served those
   * sentences verbatim as the person's own words. None of them is anybody's, so none
   * may be quoted -- and its tags meet the same kind and word checks as anyone's.
   */
  it('is quoted never, and its tags pass the same checks as a person\'s', async () => {
    const tag = `bc-p-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const reader = await person('reader', { gender: 'man', seeking_gender: ['woman'], intent: [tag],
      sees_synthetic: true, attribute_tags: ['interest:pottery', 'interest:whisky'] });
    await fact(reader, 'interest', 'pottery', 'pottery');
    await fact(reader, 'interest', 'whisky', 'whisky');
    const practice = await person('practice', {
      intent: [tag], is_synthetic: true,
      attribute_tags: ['interest:pottery', 'interest:whisky', 'smoking:daily', 'wants_children:have_and_done'],
      synthetic_quotes: JSON.stringify([
        { predicate: 'interest', text: 'I do stand-up at a comedy club every Friday night', when: '2026-01-01' },
        { predicate: 'interest', text: 'Children? have_and_done', when: '' },
        { predicate: 'did', text: 'I spent a whole winter throwing pots at the studio', when: '' },
      ]),
    });

    const r = await runRound(reader.userId);
    expect(r.metAll).toEqual([practice.userId]);
    expect(stub.calls).toBe(0);
    await readersTurn(reader, practice);

    const { matches } = await matchesOf(reader);
    expect(matches).toHaveLength(1);
    const card = matches[0]!;
    expect(card.practice).toBe(true);
    expect(card.quotes).toEqual([]);
    expect(card.shared).toEqual(['pottery']);
    const text = JSON.stringify(card);
    for (const bad of ['comedy', 'stand-up', 'have_and_done', 'have and done', 'Children?', 'whisky',
                       'smok', 'daily', 'throwing pots']) {
      expect(text, `the card said "${bad}"`).not.toContain(bad);
    }
  });
});
