/**
 * The agents' chat never judges the pair, and its date idea never states anything that
 * is not in the two people's own words.
 *
 * ASKED FOR (the founder, 2026-09-25): "Confirm with tests that the agents' chat shown to
 * users has no verdict words, and that the date idea never states a fact not in either
 * person's own words."
 *
 * WHAT IS PINNED HERE:
 *   - every fixed line the chat can say -- the bank's questions, the four reactions,
 *     "I don't know." -- is free of verdict words, and a person's own sentence is the
 *     only other thing a line can hold;
 *   - the date idea, the one thing a model writes, is refused when it judges ("a
 *     perfect match") and when any word of it comes from neither of the two sentences it
 *     is built on nor the short list of plain going-out words and public places;
 *   - end to end, the chat a person is served (GET /v1/matches) holds no verdict word
 *     outside their own sentences, and its date idea is grounded in the two sentences
 *     shown beside it -- including when the model tried otherwise.
 *
 * Negative controls, run by hand:
 *   - safeIdea without the VERDICT check           -> "a date idea that judges" fails
 *   - checkTalk without the grounding check         -> "states nothing new" fails
 *   - a reaction rewritten as "Great match!"        -> "every fixed line" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
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

const stub = vi.hoisted(() => ({ idea: '' }));
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
        const prompt = req.messages.map((m) => m.content).join('\n');
        if (!prompt.includes("A'S SENTENCES")) return { text: '', parsed: { answers: [] }, usage };
        return {
          text: 'You two are a perfect match', // never read
          parsed: {
            lines: [
              { by: 'A', kind: 'ask', question: 'weekends', sentence: 0, reaction: '' },
              { by: 'B', kind: 'answer', question: '', sentence: 1, reaction: '' },
              { by: 'A', kind: 'react', question: '', sentence: 0, reaction: 'love' },
              { by: 'A', kind: 'answer', question: '', sentence: 1, reaction: '' },
              { by: 'B', kind: 'ask', question: 'music', sentence: 0, reaction: '' },
              { by: 'A', kind: 'dont_know', question: '', sentence: 0, reaction: '' },
            ],
            shared: [{ a: 1, b: 1 }],
            date: [{ idea: stub.idea, a: 1, b: 1 }],
          },
          usage,
        };
      },
      decide: async () => { throw new Error('no typed model'); },
    },
  };
});

const { env } = await import('../src/env.js');
const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { commit } = await import('../src/memory/facts.js');
const episodes = await import('../src/memory/episodes.js');
const { REACTIONS, VERDICT, checkTalk, safeIdea, ungrounded } = await import('../src/matching/talk.js');
const { SHEET } = await import('../src/matching/answer-sheet.js');
const { runRound } = await import('../src/matching/orchestrator.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 120_000 });

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

const RIDE = 'I cycle out of the city before sunrise most weekends';
const HILLS = 'Most Sundays I am up Nandi Hills before sunrise';
const line = (by: 'A' | 'B', kind: string, x: { question?: string; sentence?: number } = {}) =>
  ({ by, kind, question: x.question ?? '', sentence: x.sentence ?? 0, reaction: '' });
const talkWith = (idea: string, a: string[] = [RIDE], b: string[] = [HILLS]) => checkTalk({
  lines: [line('A', 'ask', { question: 'weekends' }), line('B', 'answer', { sentence: 1 }), line('A', 'answer', { sentence: 1 })],
  shared: [],
  date: [{ idea, a: 1, b: 1 }],
}, a.map((text) => ({ text })), b.map((text) => ({ text })));

describe('no verdict words', () => {
  it('in every fixed line the chat can say', () => {
    const fixed = [...SHEET.flatMap((q) => [q.ask, q.short]), ...Object.values(REACTIONS), "I don't know."];
    for (const text of fixed) expect(VERDICT.test(text), text).toBe(false);
  });

  it('refuses a date idea that judges the pair', () => {
    for (const idea of [
      'A perfect match: sunrise ride up Nandi Hills', 'Great fit: a sunrise walk up Nandi Hills',
      'Sunrise at Nandi Hills, you will click', 'Sunrise ride up Nandi Hills, 90% chemistry',
    ]) {
      expect(safeIdea(idea), idea).toBeNull();
      expect(talkWith(idea)!.date, idea).toBeNull();
    }
    expect(talkWith('Sunrise ride up Nandi Hills, then breakfast')!.date?.idea).toBe('Sunrise ride up Nandi Hills, then breakfast');
  });
});

describe('the date idea states nothing new', () => {
  it('keeps an idea built from their words and plain going-out words, and nothing else', () => {
    expect(ungrounded('Sunrise ride up Nandi Hills, then breakfast', [RIDE, HILLS])).toEqual([]);
    expect(ungrounded('Salsa night at a rooftop spot in Indiranagar', [RIDE, HILLS])).toEqual(['salsa', 'rooftop']);
    for (const idea of ['Salsa night at a rooftop spot in Indiranagar', 'Pottery class near Cubbon Park', 'Board games at a Koramangala cafe with the whole gang']) {
      expect(talkWith(idea)!.date, idea).toBeNull();
    }
    // The same idea is fine once one of them said it.
    expect(talkWith('Pottery class near Cubbon Park', ['I have been throwing pottery for years'])!.date?.idea)
      .toBe('Pottery class near Cubbon Park');
  });
});

// ── end to end ──────────────────────────────────────────────────────────────

interface P { tenantId: string; userId: string; token: string }
async function person(label: string, over: Record<string, unknown>): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id',
    [`tv-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `tv-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, in_pool: true, is_synthetic: false, sees_synthetic: false,
    display_name: label, ...over,
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
  await episodes.append(db, { tenantId: p.tenantId, userId: p.userId, sessionId: crypto.randomUUID(),
                              turnId: crypto.randomUUID(), role: 'user', source: 'text', rawText: sentence, occurredAt: new Date() });
  await commit(db, p, { predicate: 'did', objectText: sentence.slice(0, 40), stance: 'asserted', originClass: 'owner',
                        sourceQuote: sentence, sourceEpisodeIds: [], extractorModel: 'story', extractorVersion: '0', promptVersion: '0' });
});

async function served(idea: string) {
  const tag = `tv-${Date.now()}-${Math.random()}`;
  const a = await person('a', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
  const b = await person('b', { intent: [tag] });
  await says(a, RIDE);
  await says(b, HILLS);
  stub.idea = idea;
  await runRound(a.userId);
  await owner.query(`UPDATE rendezvous SET first_mover = $1 WHERE $1 IN (user_a, user_b)`, [a.userId]);
  const res = await datingRoutes.request('/v1/matches', { headers: { Authorization: `Bearer ${a.token}` } });
  const card = (await res.json() as { matches: { talk: { lines: { kind: string; text: string }[];
    shared: { mine: string; theirs: string }[]; date: { idea: string; mine: string; theirs: string } | null } | null }[] }).matches[0]!;
  return card.talk!;
}

describe('the chat a person is served', () => {
  it('holds no verdict word outside their own sentences, and a grounded date idea', async () => {
    const talk = await served('Sunrise ride up Nandi Hills, then breakfast');
    for (const l of talk.lines) {
      if (l.kind === 'say') expect([RIDE, HILLS], 'a line held words nobody typed').toContain(l.text);
      else expect(VERDICT.test(l.text), l.text).toBe(false);
    }
    expect(talk.date).not.toBeNull();
    expect(VERDICT.test(talk.date!.idea)).toBe(false);
    expect(ungrounded(talk.date!.idea, [talk.date!.mine, talk.date!.theirs])).toEqual([]);
  });

  it('when the model judges or invents, the idea is simply not there', async () => {
    for (const idea of ['A perfect match: sunrise ride up Nandi Hills', 'Salsa night at a rooftop spot in Indiranagar']) {
      const talk = await served(idea);
      expect(talk.date, idea).toBeNull();
      expect(JSON.stringify(talk)).not.toMatch(/perfect match|salsa/i);
    }
  });
});
