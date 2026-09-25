/**
 * Wants: each free-text want checked against the other person's own sentences --
 * evidence, never a verdict, and it can only lower the rank.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-25): "for each free-text want, read the other
 * person's own sentences and mark met / not met / unknown, always citing the exact
 * quote. It never excludes anyone, it can only lower the rank, and the brief shows her
 * want next to his quote, not a verdict word."
 *
 * WHAT IS PINNED HERE:
 *   - only valid pointers survive: a met or not-met with no valid sentence number is
 *     unknown, and every quote is looked up, never taken from the reply;
 *   - ONLY DOWN: a not-met want moves a candidate later -- inside their group, so a real
 *     person is never put behind a practice profile -- and a met want moves nobody up;
 *   - in a round: the candidate listed first whose sentence contradicts the want is not
 *     among this round's three; with nobody else to meet they are still met (never
 *     excluded); a failed check leaves the order alone;
 *   - the card carries the want beside their quote, the stored brief keeps the status for
 *     measurement, and no status word reaches a phone;
 *   - the other side's wants are checked against the starter for their own card.
 *
 *   - a want about a private topic (kids, drinking, faith...) is CHECK-ONLY: matched
 *     against the other person's card answer by code, shown as matches / doesn't match,
 *     and never beside a quote -- not even a sentence of theirs about exactly that;
 *   - NO WANT IS DROPPED: one nothing can check -- no card covers it, they never
 *     answered the card, the check failed -- is on the card as "can't check".
 *
 * Negative controls, run by hand:
 *   - the round ignoring the demotion             -> "not among this round's three" fails
 *   - demote without the real-before-practice key -> "never behind a practice profile" fails
 *   - notMetCounts counting a met as -1            -> "a met want moves nobody up" fails
 *   - readWantChecks not range-checking            -> "only valid pointers" fails
 *   - readBrief passing the status on              -> "no status word reaches a phone" fails
 *   - readWantChecks reading a private want like any other (by sentence) -> "a quote is
 *     never beside it" and "never quotes his sentence" fail. Behind it, wantRows,
 *     composeBrief and readBrief each null a private want's quote again, by design.
 *   - the orchestrator dropping a failed check      -> "never dropped" fails
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

const stub = vi.hoisted(() => ({
  rules: [] as { contains: string; status: 'met' | 'not_met' }[], wantCalls: 0, failWants: false, prompts: [] as string[],
  cardRules: [] as { contains: string; card: string; values: string[] }[],
}));

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  const usage = { inputTokens: 1, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1,
                  reasoningTokens: 0, provider: 'google', modelId: 'x', costUsd: 0.0005, latencyMs: 0 };
  return {
    ...real,
    decideModel: () => null,
    modelFor: () => 'google:gemini-3.5-flash-lite',
    llm: {
      ...real.llm,
      complete: async (req: { messages: { content: string }[] }) => {
        const prompt = req.messages.map((m) => m.content).join('\n');
        stub.prompts.push(prompt);
        if (!prompt.startsWith('WANTS\n')) return { text: '', parsed: {}, usage }; // the talk: nothing
        stub.wantCalls++;
        if (stub.failWants) throw new Error('the model is down');
        // Point by words: for each person and want, the first sentence a rule matches.
        const wants = prompt.split('\n\n')[0]!.split('\n').slice(1);
        const people = prompt.split(/\n\nPERSON \d+\n/).slice(1).map((sec) => sec.split('\n').filter((l) => /^\d+\. /.test(l)));
        const checks = people.flatMap((lines, pi) => wants.map((_, wi) => {
          for (const r of stub.rules) {
            const l = lines.find((x) => x.includes(r.contains));
            if (l) return { person: pi + 1, want: wi + 1, status: r.status, sentence: Number(l.split('.')[0]) };
          }
          return { person: pi + 1, want: wi + 1, status: 'unknown', sentence: 0 };
        }));
        // A PRIVATE want is mapped to a card by the words it uses -- never to a sentence.
        const cards = wants.flatMap((line, wi) => {
          if (!line.includes('PRIVATE')) return [];
          const r = stub.cardRules.find((x) => line.includes(x.contains));
          return [{ want: wi + 1, card: r?.card ?? '', values: r?.values ?? [] }];
        });
        return { text: 'He clearly loves dogs, a great match', parsed: { checks, cards }, usage };
      },
      decide: async () => { throw new Error('no typed model'); },
    },
  };
});

const { env } = await import('../src/env.js');
const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { commit } = await import('../src/memory/facts.js');
const episodes = await import('../src/memory/episodes.js');
const { demote, notMetCounts, readWantChecks, splitWants } = await import('../src/matching/wants.js');
const { runRound } = await import('../src/matching/orchestrator.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 120_000 });
beforeEach(() => { stub.rules = []; stub.cardRules = []; stub.wantCalls = 0; stub.failWants = false; stub.prompts = []; });

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

// ── pure ────────────────────────────────────────────────────────────────────

describe('reading the check', () => {
  const wants = [{ text: 'Must love dogs', kind: 'wants' as const }, { text: 'Someone glued to their phone', kind: 'not' as const }];
  const people = [[{ text: 'I have two indies and walk them daily' }, { text: 'I check my phone constantly' }], [{ text: 'I bake bread' }]];

  it('only valid pointers survive, and every quote is looked up', () => {
    const r = readWantChecks({ checks: [
      { person: 1, want: 1, status: 'met', sentence: 1 },
      { person: 1, want: 1, status: 'not_met', sentence: 2 },   // second entry for the pair: ignored
      { person: 1, want: 2, status: 'not_met', sentence: 2 },
      { person: 2, want: 1, status: 'met', sentence: 7 },       // out of range: unknown
      { person: 2, want: 2, status: 'not_met', sentence: 0 },   // no sentence: unknown
    ] }, wants, people);
    expect(r[0]).toEqual([
      { want: 'Must love dogs', kind: 'wants', status: 'met', quote: 'I have two indies and walk them daily' },
      { want: 'Someone glued to their phone', kind: 'not', status: 'not_met', quote: 'I check my phone constantly' },
    ]);
    expect(r[1]!.map((x) => [x.status, x.quote])).toEqual([['unknown', null], ['unknown', null]]);
    expect(readWantChecks('they match', wants, people).flat().every((x) => x.status === 'unknown')).toBe(true);
  });

  it('a sentence holding a contact detail is never the quote', () => {
    const r = readWantChecks({ checks: [{ person: 1, want: 1, status: 'met', sentence: 1 }] },
      [wants[0]!], [[{ text: 'Dog walks daily, message me on 98450 12345' }]]);
    expect(r[0]![0]).toMatchObject({ status: 'unknown', quote: null });
  });

  it('splits a want a sentence at a time', () => {
    expect(splitWants('Must love dogs. Someone who reads!\nNot glued to their phone')).toEqual([
      'Must love dogs', 'Someone who reads', 'Not glued to their phone',
    ]);
  });
});

describe('only down', () => {
  const c = (userId: string, synthetic = false) => ({ userId, synthetic });

  it('moves a not-met candidate later, never behind a practice profile', () => {
    const order = [c('r1'), c('r2'), c('r3'), c('s1', true), c('s2', true)];
    const out = demote(order, new Map([['r1', 1], ['r3', 2], ['s1', 1]]));
    expect(out.map((x) => x.userId)).toEqual(['r2', 'r1', 'r3', 's2', 's1']);
  });

  it('a met want moves nobody up', () => {
    const met = { want: 'w', kind: 'wants' as const, status: 'met' as const, quote: 'q' };
    const unknown = { want: 'w', kind: 'wants' as const, status: 'unknown' as const, quote: null };
    const counts = notMetCounts(new Map([['a', [unknown]], ['b', [met, met]]]));
    expect(counts.get('b')).toBe(0);
    const order = [c('a'), c('b')];
    expect(demote(order, counts).map((x) => x.userId)).toEqual(['a', 'b']);
  });
});

// ── in a round ──────────────────────────────────────────────────────────────

interface P { tenantId: string; userId: string; token: string }

async function person(label: string, over: Record<string, unknown>): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id',
    [`wt-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `wt-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: [`wt-own-${userId}`],
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

/** Something the person typed, and the fact that quotes it. */
const says = async (p: P, predicate: string, sentence: string, disclosure?: 'matchable_only') => {
  await tenantSession(p, async (db) => {
    await episodes.append(db, {
      tenantId: p.tenantId, userId: p.userId, sessionId: crypto.randomUUID(), turnId: crypto.randomUUID(),
      role: 'user', source: 'text', rawText: sentence, occurredAt: new Date(),
    });
    await commit(db, p, {
      predicate, objectText: sentence, stance: 'asserted', originClass: 'owner', sourceQuote: sentence,
      sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
      ...(disclosure ? { disclosure } : {}),
    });
  });
};

const SCARED = 'Honestly I am scared of dogs, cats are more my speed';
const INDIES = 'I have two indies and walk them every morning';

async function scene(tag: string, n = 4) {
  const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
  await says(me, 'seeking', 'Must love dogs', 'matchable_only');
  await says(me, 'did', 'I cook for friends every Friday night');
  // Listed in this order: the most recently active first (candidates.ts).
  const lines = [SCARED, INDIES, 'I bake sourdough every Sunday morning', 'I paint badly on weekends'];
  const them: P[] = [];
  for (let i = 0; i < n; i++) {
    const p = await person(`w${i}`, { intent: [tag], last_active_at: new Date(Date.now() - i * 60_000) });
    await says(p, 'did', lines[i]!);
    them.push(p);
  }
  return { me, them };
}

const storedWants = async (reader: P, other: P) => {
  const { rows } = await owner.query<{ overlap_quotes: { wants: { want: string; theirs: string | null; status: string }[] } }>(
    `SELECT b.overlap_quotes FROM rendezvous_briefs b JOIN rendezvous r ON r.id = b.rendezvous_id
      WHERE b.for_user = $1 AND $2 IN (r.user_a, r.user_b)`, [reader.userId, other.userId]);
  return rows[0]?.overlap_quotes.wants;
};

describe('in a round', () => {
  it('the first-listed person whose sentence contradicts the want is not among this round\'s three', async () => {
    const { me, them } = await scene(`wt-down-${Date.now()}`);
    stub.rules = [{ contains: 'scared of dogs', status: 'not_met' }, { contains: 'indies', status: 'met' }];
    const r = await runRound(me.userId);
    expect(stub.wantCalls, 'one check for the shortlist, and none for sides without wants').toBe(1);
    expect(r.metAll).toHaveLength(3);
    expect(r.metAll, 'demoted, and still met').not.toContain(them[0]!.userId);
    expect(r.metAll).toEqual(expect.arrayContaining([them[1]!.userId, them[2]!.userId, them[3]!.userId]));

    // The card: the want beside their words; unknown with nothing beside it.
    expect(await storedWants(me, them[1]!)).toEqual([{ want: 'Must love dogs', kind: 'wants', theirs: INDIES, status: 'met' }]);
    expect(await storedWants(me, them[2]!)).toEqual([{ want: 'Must love dogs', kind: 'wants', theirs: null, status: 'unknown' }]);
  });

  it('never excludes: with nobody else to meet, the contradicting person is still met', async () => {
    const { me, them } = await scene(`wt-only-${Date.now()}`, 1);
    stub.rules = [{ contains: 'scared of dogs', status: 'not_met' }];
    const r = await runRound(me.userId);
    expect(r.metAll).toEqual([them[0]!.userId]);
    expect(await storedWants(me, them[0]!)).toEqual([{ want: 'Must love dogs', kind: 'wants', theirs: SCARED, status: 'not_met' }]);
  });

  it('a failed check leaves the order alone', async () => {
    const { me, them } = await scene(`wt-fail-${Date.now()}`);
    stub.failWants = true;
    const r = await runRound(me.userId);
    expect(r.metAll).toContain(them[0]!.userId);
  });

  it('no status word reaches a phone: the want and the quote, side by side', async () => {
    const { me, them } = await scene(`wt-phone-${Date.now()}`, 2);
    stub.rules = [{ contains: 'scared of dogs', status: 'not_met' }, { contains: 'indies', status: 'met' }];
    await runRound(me.userId);
    const res = await datingRoutes.request('/v1/matches', { headers: { Authorization: `Bearer ${me.token}` } });
    const body = await res.json() as { matches: { wants?: { want: string; theirs: string | null }[] }[] };
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/not_met|"met"|"unknown"|"status"/);
    // Who reads first is the busier side, ties broken by id (brief.ts busierSide): a
    // card this person may not read yet is the plain card, and carries no wants either.
    const cards = body.matches as { wants?: { want: string; kind: string; theirs: string | null }[]; waitingOnYou: boolean }[];
    for (const m of cards.filter((x) => !x.waitingOnYou)) expect(m.wants ?? []).toEqual([]);
    const rows = cards.filter((x) => x.waitingOnYou).flatMap((m) => m.wants ?? []);
    expect(rows.length, 'no card this person may read carried a want').toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['kind', 'theirs', 'want']);
      expect(row.want).toBe('Must love dogs');
      expect([INDIES, SCARED]).toContain(row.theirs);
    }
    void them;
  });

  it('the other side\'s wants are checked against the starter, for their own card', async () => {
    const { me, them } = await scene(`wt-both-${Date.now()}`, 1);
    await says(them[0]!, 'seeking', 'Someone who cooks', 'matchable_only');
    stub.rules = [{ contains: 'cook for friends', status: 'met' }];
    await runRound(me.userId);
    expect(stub.wantCalls).toBe(2);
    expect(await storedWants(them[0]!, me)).toEqual([
      { want: 'Someone who cooks', kind: 'wants', theirs: 'I cook for friends every Friday night', status: 'met' },
    ]);
  });
});

// ── private topics, and nothing dropped ─────────────────────────────────────

describe('a want about a private topic', () => {
  it('is matched against the card by code, and a quote is never beside it', () => {
    const wants = [{ text: "Someone who doesn't drink", kind: 'wants' as const, private: true }];
    const people = [[{ text: 'Weekend treks and filter coffee' }], [{ text: 'I paint' }], [{ text: 'I read' }]];
    const r = readWantChecks({
      checks: [{ person: 1, want: 1, status: 'met', sentence: 1 }],   // a pointer for a private want: ignored
      cards: [{ want: 1, card: 'drinking', values: ['never'] }],
    }, wants, people, [{ drinking: 'never' }, { drinking: 'often' }, {}]);
    expect(r.map((x) => [x[0]!.status, x[0]!.quote])).toEqual([['met', null], ['not_met', null], ['cant_check', null]]);
    // A mapping onto no card, or onto answers a card does not have, checks nothing.
    for (const cards of [[{ want: 1, card: 'politics', values: ['left'] }], [{ want: 1, card: 'drinking', values: ['socially'] }]]) {
      expect(readWantChecks({ checks: [], cards }, wants, people, [{ drinking: 'never' }])[0]![0]!.status).toBe('cant_check');
    }
  });
});

describe('in a round, private topics and nothing dropped', () => {
  const DRY = 'I never drink, not even at weddings';

  async function privateScene(tag: string) {
    const her = await person('her', { intent: [tag] });
    await says(her, 'seeking', "Someone who doesn't drink. Someone politically on the left", 'matchable_only');
    const men: P[] = [];
    const answers = [{ drinking: 'never' }, { drinking: 'often' }, {}];
    for (let i = 0; i < 3; i++) {
      const m = await person(`m${i}`, { gender: 'man', seeking_gender: ['woman'], intent: [tag], traits: answers[i],
                                         last_active_at: new Date(Date.now() - i * 60_000) });
      await says(m, 'did', i === 0 ? DRY : `I go cycling on weekend mornings ${i}`);
      men.push(m);
    }
    return { her, men };
  }

  const herCards = async (her: P) => {
    // Who reads first is not what is under test: she does, on every pair.
    await owner.query(`UPDATE rendezvous SET first_mover = $1 WHERE $1 IN (user_a, user_b)`, [her.userId]);
    const res = await datingRoutes.request('/v1/matches', { headers: { Authorization: `Bearer ${her.token}` } });
    return (await res.json() as { matches: { wants?: { want: string; theirs: string | null; check?: string }[] }[] }).matches;
  };

  it('never quotes his sentence, only matches or doesn\'t -- and a want no card covers says so', async () => {
    const { her, men } = await privateScene(`wt-private-${Date.now()}`);
    stub.cardRules = [{ contains: "doesn't drink", card: 'drinking', values: ['never'] }];
    const r = await runRound(her.userId);
    expect(r.metAll).toHaveLength(3);
    expect(await storedWants(her, men[0]!)).toEqual([
      { want: "Someone who doesn't drink", kind: 'wants', theirs: null, status: 'met', private: true },
      { want: 'Someone politically on the left', kind: 'wants', theirs: null, status: 'cant_check', private: true },
    ]);
    expect((await storedWants(her, men[1]!))![0]).toMatchObject({ status: 'not_met', theirs: null });
    expect((await storedWants(her, men[2]!))![0]).toMatchObject({ status: 'cant_check', theirs: null });

    const cards = await herCards(her);
    const text = JSON.stringify(cards);
    expect(text, 'his sentence about drinking reached her card').not.toContain(DRY);
    const rows = cards.flatMap((m) => m.wants ?? []);
    expect(rows).toContainEqual({ want: "Someone who doesn't drink", kind: 'wants', theirs: null, check: 'matches' });
    expect(rows).toContainEqual({ want: "Someone who doesn't drink", kind: 'wants', theirs: null, check: 'doesnt_match' });
    expect(rows).toContainEqual({ want: 'Someone politically on the left', kind: 'wants', theirs: null, check: 'cant_check' });
    expect(rows.every((w) => w.theirs === null)).toBe(true);
  });

  it('never dropped: when the check fails, every want is still on the card', async () => {
    const { her, men } = await privateScene(`wt-dropped-${Date.now()}`);
    stub.failWants = true;
    await runRound(her.userId);
    expect(await storedWants(her, men[0]!)).toEqual([
      { want: "Someone who doesn't drink", kind: 'wants', theirs: null, status: 'cant_check', private: true },
      { want: 'Someone politically on the left', kind: 'wants', theirs: null, status: 'cant_check', private: true },
    ]);
    const rows = (await herCards(her)).flatMap((m) => m.wants ?? []);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((w) => w.check === 'cant_check')).toBe(true);
  });
});
