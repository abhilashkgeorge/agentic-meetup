/**
 * The agents talk -- and every word about a person is that person's own.
 *
 * WHAT THIS IS FOR (the founder, 2026-09-24): agent-to-agent talk that does what no
 * filter can -- notice what two people share when they say it in different words, and
 * come back with a first-date idea -- without the invention that put a comedy-writer
 * life on a real user's card. A prompt line forbidding invention was already there
 * then (rendezvous.ts PROBER); what guards this one is code: the model points at
 * numbered sentences, and checkTalk builds every word shown from the bank, the fixed
 * reactions or the sentence lists (talk.ts).
 *
 * WHAT IS PINNED HERE:
 *   - only valid pointers survive: out of range, the wrong side's number, an unknown
 *     question or reaction, an answer with no question open, a repeated sentence --
 *     all dropped, and nothing the reply says in words of its own is ever kept;
 *   - a date idea is shown only if it talks about no one, claims nothing, and names no
 *     private card;
 *   - in a round: the model sees only verified, public sentences; the card carries both
 *     sides' own sentences verbatim; one call per pair; a failed call leaves the
 *     answer-sheet exchange and the round still completes; AGENT_TALK=off makes no call;
 *   - the second mover sees no talk until the first mover says yes;
 *   - a practice profile talks in its template lines, marked practice.
 *
 * Negative controls, run by hand:
 *   - checkTalk clamping an out-of-range number onto a real sentence -> "only valid
 *     pointers" fails (a first control that kept a `!list[i]` guard passed, and proved
 *     nothing: it was redone)
 *   - checkTalk reading the other side's list for an answer -> "only valid pointers" fails
 *   - safeIdea without the person check                    -> "a date idea" fails
 *   - the round not passing the talk to composeBoth        -> "carries both sides" fails
 *   - GET /v1/matches giving the second mover readBrief     -> "the second mover" fails
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

type Reply = unknown | ((prompt: string) => unknown);
const stub = vi.hoisted(() => ({ reply: {} as unknown, calls: 0, prompts: [] as string[], fail: false }));

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
        const prompt = req.messages.map((m) => m.content).join('\n');
        stub.prompts.push(prompt);
        if (stub.fail) throw new Error('the model is down');
        const r = stub.reply as Reply;
        return {
          text: 'She is a comedy writer who loves stand-up', // never read
          parsed: typeof r === 'function' ? (r as (p: string) => unknown)(prompt) : r,
          usage: {
            inputTokens: 1, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1,
            reasoningTokens: 0, provider: 'google', modelId: 'x', costUsd: 0.0005, latencyMs: 0,
          },
        };
      },
      decide: async () => { stub.calls++; throw new Error('no typed model'); },
    },
  };
});

const { env } = await import('../src/env.js');
const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { commit } = await import('../src/memory/facts.js');
const episodes = await import('../src/memory/episodes.js');
const { checkTalk, safeIdea, talkFor, REACTIONS } = await import('../src/matching/talk.js');
const { SHEET } = await import('../src/matching/answer-sheet.js');
const { runRound } = await import('../src/matching/orchestrator.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 120_000 });
beforeEach(() => {
  stub.calls = 0; stub.reply = {}; stub.prompts = []; stub.fail = false;
  delete process.env.AGENT_TALK;
});

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

// ── the checker, pure ───────────────────────────────────────────────────────

const A = [{ text: 'I cycle out of the city most weekends' }, { text: 'Old jazz records, always' }];
const B = [
  { text: 'Most Sundays I am up Nandi Hills before sunrise' },
  { text: 'I could eat green curry every single day' },
  { text: 'Learning the violin, badly' },
];
const line = (by: 'A' | 'B', kind: string, x: { question?: string; sentence?: number; reaction?: string } = {}) =>
  ({ by, kind, question: x.question ?? '', sentence: x.sentence ?? 0, reaction: x.reaction ?? '' });
const reply = (lines: unknown[], extra: Record<string, unknown> = {}) => ({ lines, shared: [], date: [], ...extra });

describe('checkTalk: the model points, and never writes', () => {
  it('only valid pointers survive, and every word comes from the bank, the reactions or a list', () => {
    const t = checkTalk(reply([
      line('A', 'ask', { question: 'weekends' }),
      line('B', 'answer', { sentence: 1 }),
      line('A', 'react', { reaction: 'love' }),
      line('A', 'answer', { sentence: 99 }),            // out of range
      line('A', 'answer', { sentence: 3 }),             // in range for B's list, not A's
      line('A', 'answer', { sentence: 1 }),
      line('B', 'react', { reaction: 'she-is-a-comedian' }), // not a reaction
      line('A', 'ask', { question: 'kids' }),           // not in the bank
      line('B', 'answer', { sentence: 2 }),             // weekends: B already answered
      line('B', 'ask', { question: 'music' }),
      line('B', 'dont_know'),                           // asker saying it has nothing: allowed
      line('A', 'answer', { sentence: 1 }),             // already used
      line('A', 'answer', { sentence: 2 }),
      line('A', 'ask', { question: 'weekends' }),       // asked already
    ], { text: 'She is a comedy writer' }), A, B);
    expect(t).not.toBeNull();
    expect(t!.lines.map((l) => [l.by, l.kind, l.text])).toEqual([
      ['a', 'ask', SHEET.find((q) => q.id === 'weekends')!.ask],
      ['b', 'say', B[0]!.text],
      ['a', 'react', REACTIONS.love],
      ['a', 'say', A[0]!.text],
      ['b', 'ask', SHEET.find((q) => q.id === 'music')!.ask],
      ['b', 'dunno', "I don't know."],
      ['a', 'say', A[1]!.text],
    ]);
    const words = new Set([...A, ...B].map((s) => s.text));
    for (const l of t!.lines.filter((x) => x.kind === 'say')) {
      expect(words.has(l.text), l.text).toBe(true);
      expect((l.by === 'a' ? A : B).map((s) => s.text), `${l.by} spoke the other side's sentence`).toContain(l.text);
    }
    expect(JSON.stringify(t)).not.toContain('comedy');
  });

  it('is nothing at all with fewer than two answers, or a reply of the wrong shape', () => {
    expect(checkTalk(reply([line('A', 'ask', { question: 'weekends' }), line('B', 'answer', { sentence: 1 })]), A, B)).toBeNull();
    expect(checkTalk({ lines: 'hello' }, A, B)).toBeNull();
    expect(checkTalk('They would get on', A, B)).toBeNull();
  });

  it('keeps shared pairs that point at real sentences, two at most', () => {
    const t = checkTalk(reply([
      line('A', 'ask', { question: 'weekends' }), line('B', 'answer', { sentence: 1 }), line('A', 'answer', { sentence: 1 }),
    ], { shared: [{ a: 1, b: 1 }, { a: 5, b: 1 }, { a: 1, b: 1 }, { a: 2, b: 3 }, { a: 2, b: 2 }] }), A, B);
    expect(t!.shared).toEqual([{ a: A[0]!.text, b: B[0]!.text }, { a: A[1]!.text, b: B[2]!.text }]);
  });

  it('a date idea talks about no one, claims nothing, and names no private card', () => {
    expect(safeIdea('Sunrise ride out to Nandi Hills, then dosa.')).toBe('Sunrise ride out to Nandi Hills, then dosa');
    expect(safeIdea('Filter coffee and a walk in Cubbon Park')).not.toBeNull();
    expect(safeIdea('She loves hiking, so Nandi Hills')).toBeNull();
    expect(safeIdea('Take him to a jazz bar')).toBeNull();
    expect(safeIdea('Loves jazz: a record store crawl')).toBeNull();
    expect(safeIdea('Craft beers at a brewery in Indiranagar')).toBeNull();
    expect(safeIdea('A long lunch somewhere quiet where the waiters leave you alone for hours and hours')).toBeNull();
    const base = [line('A', 'ask', { question: 'weekends' }), line('B', 'answer', { sentence: 1 }), line('A', 'answer', { sentence: 1 })];
    expect(checkTalk(reply(base, { date: [{ idea: 'Sunrise ride to Nandi Hills', a: 1, b: 1 }] }), A, B)!.date)
      .toEqual({ idea: 'Sunrise ride to Nandi Hills', a: A[0]!.text, b: B[0]!.text });
    expect(checkTalk(reply(base, { date: [{ idea: 'Sunrise ride to Nandi Hills', a: 1, b: 9 }] }), A, B)!.date).toBeNull();
  });

  it('each reader sees their own side as "you"', () => {
    const t = checkTalk(reply([
      line('A', 'ask', { question: 'weekends' }), line('B', 'answer', { sentence: 1 }), line('A', 'answer', { sentence: 1 }),
    ], { shared: [{ a: 1, b: 1 }] }), A, B)!;
    const forB = talkFor(t, 'b')!;
    expect(forB.lines.map((l) => l.who)).toEqual(['them', 'you', 'them']);
    expect(forB.shared[0]).toEqual({ mine: B[0]!.text, theirs: A[0]!.text });
    expect(talkFor(null, 'a')).toBeNull();
  });
});

// ── in a round ──────────────────────────────────────────────────────────────

interface P { tenantId: string; userId: string; token: string }

async function person(label: string, over: Record<string, unknown>): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id',
    [`tk-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `tk-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: [`tk-own-${userId}`],
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

const typed = (p: P, rawText: string) => tenantSession(p, (db) => episodes.append(db, {
  tenantId: p.tenantId, userId: p.userId, sessionId: crypto.randomUUID(), turnId: crypto.randomUUID(),
  role: 'user', source: 'text', rawText, occurredAt: new Date(),
}));
const fact = async (p: P, predicate: string, sourceQuote: string) =>
  (await tenantSession(p, (c) => commit(c, p, {
    predicate, objectText: sourceQuote.slice(0, 40), stance: 'asserted', originClass: 'owner', sourceQuote,
    sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
  }))).factId!;

/** A talk that points at sentences by their words, in the numbering the prompt used. */
function scripted(steps: Array<[by: 'A' | 'B', kind: string, arg?: string]>, date?: [string, string, string]) {
  return (prompt: string) => {
    const section = (who: 'A' | 'B') => {
      const from = prompt.indexOf(`${who}'S SENTENCES`);
      const to = who === 'A' ? prompt.indexOf("B'S SENTENCES") : prompt.length;
      return prompt.slice(from, to).split('\n').filter((l) => /^\d+\. /.test(l));
    };
    const num = (who: 'A' | 'B', words: string) => {
      const l = section(who).find((x) => x.includes(words));
      return l ? Number(l.split('.')[0]) : 0;
    };
    return {
      lines: steps.map(([by, kind, arg]) => ({
        by, kind,
        question: kind === 'ask' ? arg ?? '' : '',
        sentence: kind === 'answer' && arg ? num(by, arg) : 0,
        reaction: kind === 'react' ? arg ?? '' : '',
      })),
      shared: [],
      date: date ? [{ idea: date[0], a: num('A', date[1]), b: num('B', date[2]) }] : [],
    };
  };
}

const RIDE = 'I cycle out of the city before sunrise most weekends';
const HILLS = 'Most Sundays I am up Nandi Hills before sunrise';
const INVENTED = 'I do stand-up at a comedy club every Friday';
const SECRET = 'I secretly love bad reality television shows';

async function scene(tag: string) {
  const a = await person('a', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
  const b = await person('b', { intent: [tag] });
  await typed(a, `${RIDE}. ${SECRET}.`);
  await fact(a, 'did', RIDE);
  await fact(a, 'did', INVENTED);                     // never typed
  const hidden = await fact(a, 'interest', SECRET);
  await owner.query(`UPDATE facts SET disclosure = 'private' WHERE id = $1`, [hidden]);
  await typed(b, `${HILLS}.`);
  await fact(b, 'did', HILLS);
  return { a, b };
}

const brief = async (reader: P, other: P) => {
  const { rows } = await owner.query<{ overlap_quotes: { talk?: { lines: { who: string; kind: string; text: string }[];
    date: { idea: string; mine: string; theirs: string } | null } | null; qa?: unknown[] } }>(
    `SELECT b.overlap_quotes FROM rendezvous_briefs b JOIN rendezvous r ON r.id = b.rendezvous_id
      WHERE b.for_user = $1 AND $2 IN (r.user_a, r.user_b)`, [reader.userId, other.userId]);
  return rows[0]!.overlap_quotes;
};

describe('in a round', () => {
  it('carries both sides\' own sentences, verbatim, from one call per pair on verified sentences only', async () => {
    const { a, b } = await scene(`tk-meet-${Date.now()}`);
    stub.reply = scripted([
      ['A', 'ask', 'weekends'], ['B', 'answer', 'Nandi Hills'], ['A', 'react', 'nice'], ['A', 'answer', 'cycle'],
      ['B', 'ask', 'music'], ['A', 'dont_know'],
    ], ['Sunrise ride out to Nandi Hills, then breakfast', 'cycle', 'Nandi Hills']);
    const r = await runRound(a.userId);
    expect(r.metAll).toContain(b.userId);
    expect(stub.calls, 'not one call per pair').toBe(r.metAll.length);

    // What the model was shown: the verified, public sentences, nothing else.
    const prompt = stub.prompts[0]!;
    expect(prompt).toContain(RIDE);
    expect(prompt).toContain(HILLS);
    expect(prompt).not.toContain(INVENTED);
    expect(prompt).not.toContain(SECRET);

    const forA = (await brief(a, b)).talk!;
    expect(forA.lines.map((l) => [l.who, l.kind, l.text])).toEqual([
      ['you', 'ask', SHEET.find((q) => q.id === 'weekends')!.ask],
      ['them', 'say', HILLS],
      ['you', 'react', REACTIONS.nice],
      ['you', 'say', RIDE],
      ['them', 'ask', SHEET.find((q) => q.id === 'music')!.ask],
      ['you', 'dunno', "I don't know."],
    ]);
    expect(forA.date).toEqual({ idea: 'Sunrise ride out to Nandi Hills, then breakfast', mine: RIDE, theirs: HILLS });
    const forB = (await brief(b, a)).talk!;
    expect(forB.lines[1]).toEqual({ who: 'you', kind: 'say', text: HILLS });
    expect(forB.date).toEqual({ idea: 'Sunrise ride out to Nandi Hills, then breakfast', mine: HILLS, theirs: RIDE });
  });

  it('a failed talk leaves the answer-sheet exchange, and the round still completes', async () => {
    const { a, b } = await scene(`tk-fail-${Date.now()}`);
    stub.fail = true;
    const r = await runRound(a.userId);
    expect(r.metAll).toContain(b.userId);
    const card = await brief(a, b);
    expect(card.talk ?? null).toBeNull();
    expect(Array.isArray(card.qa)).toBe(true);
  });

  it('AGENT_TALK=off makes no call at all', async () => {
    const { a, b } = await scene(`tk-off-${Date.now()}`);
    process.env.AGENT_TALK = 'off';
    const r = await runRound(a.userId);
    expect(r.metAll).toContain(b.userId);
    expect(stub.calls).toBe(0);
    expect((await brief(a, b)).talk ?? null).toBeNull();
  });

  it('the second mover sees no talk until the first mover says yes', async () => {
    const { a, b } = await scene(`tk-reveal-${Date.now()}`);
    stub.reply = scripted([['A', 'ask', 'weekends'], ['B', 'answer', 'Nandi Hills'], ['A', 'answer', 'cycle']]);
    await runRound(a.userId);
    const { rows } = await owner.query<{ first_mover: string }>(
      `SELECT first_mover FROM rendezvous WHERE $1 IN (user_a, user_b) AND $2 IN (user_a, user_b)`, [a.userId, b.userId]);
    const second = rows[0]!.first_mover === a.userId ? b : a;
    const first = second === a ? b : a;
    const cards = async (p: P) => (await (await datingRoutes.request('/v1/matches', {
      headers: { Authorization: `Bearer ${p.token}` } })).json() as { matches: { talk?: unknown }[] }).matches;
    expect((await cards(second))[0]?.talk ?? null, 'the second mover read the first mover\'s words').toBeNull();
    expect((await cards(first))[0]?.talk).toBeTruthy();
  });

  it('a practice profile talks in its template lines, marked practice', async () => {
    const tag = `tk-practice-${Date.now()}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag], sees_synthetic: true });
    await typed(me, `${RIDE}.`);
    await fact(me, 'did', RIDE);
    const LINE = 'I spend most of my free time on live music, more than is probably reasonable.';
    await person('ghost', {
      intent: [tag], is_synthetic: true,
      synthetic_dossier: `Asha is 29.\n- age: 29\n\nThings they have said:\n- "${LINE}"\n- "I want kids one day."`,
    });
    stub.reply = scripted([['A', 'ask', 'weekends'], ['B', 'answer', 'live music'], ['A', 'answer', 'cycle']]);
    const r = await runRound(me.userId);
    expect(r.metAll.length).toBe(1);
    expect(stub.prompts[0]).toContain(LINE);
    expect(stub.prompts[0], 'a core value reached the model').not.toContain('kids');
    const { rows } = await owner.query<{ overlap_quotes: { talk: { lines: { who: string; text: string; practice?: boolean }[] } } }>(
      `SELECT b.overlap_quotes FROM rendezvous_briefs b WHERE b.for_user = $1`, [me.userId]);
    const said = rows[0]!.overlap_quotes.talk.lines.find((l) => l.who === 'them' && l.text === LINE);
    expect(said?.practice).toBe(true);
  });
});
