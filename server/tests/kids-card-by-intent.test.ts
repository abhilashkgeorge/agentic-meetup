/**
 * The kids card is asked only of people for whom it means something (questions.ts
 * coreCardsFor; the founder, 2026-10-01: "skip for Casual and Company").
 *
 * WHAT WAS WRONG: every new person was asked "Do you want children?" and who could be their
 * partner on it, and could not go out until they answered -- somebody here for something
 * casual, or for company, included.
 *
 * WHAT IS PINNED, through the real routes and pool checks:
 *   - here for something casual (or company): the cards start at "one person or open",
 *     the kids card is never offered, and four cards put them in the pool;
 *   - here for something long-term: the kids card comes first, and without it they wait;
 *   - the Home's quick check (poolNow) checks each card they need by id -- an extra kids
 *     answer cannot stand in for a missing smoking one -- and the founder's sweep
 *     (holdUntilCardsDone) holds only those missing a card they need;
 *   - changing to long-term later makes the kids card needed again.
 *
 * Negative controls, run by hand and recorded in the commit: coreCardsFor always returning
 * all five -> "casual" fails; poolNow back to a count of five -> "by id" fails; the sweep
 * back to its count -> "the sweep" fails.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  const no = async () => { throw new Error('no model on this path'); };
  return { ...real, decideModel: () => null, llm: { ...real.llm, complete: no, decide: no } };
});

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const { rebuildMatchProfile, poolNow, holdUntilCardsDone } = await import('../src/matching/profile.js');
const { interviewRoutes } = await import('../src/api/interview.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');
const { CORE } = await import('../src/onboarding/questions.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

type Person = { tenantId: string; userId: string; token: string };

async function person(label: string): Promise<Person> {
  const tag = `kc-${label}-${Date.now()}-${Math.random()}`;
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
  return { tenantId, userId, token: mintToken(sessionId) };
}

const fact = (p: Person, predicate: string, objectText: string, objectValue?: unknown) =>
  tenantSession(p, (c) => commit(c, p, {
    predicate, objectText, ...(objectValue !== undefined ? { objectValue } : {}),
    stance: 'asserted', originClass: 'owner', sourceQuote: objectText, sourceEpisodeIds: [],
    extractorModel: 't', extractorVersion: '0', promptVersion: '0',
  }));

/** Everything but the cards, with the given intent, out of everybody else's pool. */
async function setUp(p: Person, intent: string) {
  await owner.query(
    `INSERT INTO match_profile (user_id, tenant_id, in_pool, sees_synthetic) VALUES ($1,$2,false,false)`,
    [p.userId, p.tenantId]);
  const { REQUIRED } = await import('../src/api/consent.js');
  for (const r of REQUIRED) {
    await owner.query(
      `INSERT INTO consents (tenant_id, user_id, document, version) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [p.tenantId, p.userId, r.document, r.version]);
  }
  await fact(p, 'gender', 'woman');
  await fact(p, 'seeking_gender', 'man');
  await fact(p, 'relationship_intent', intent);
  await fact(p, 'birth_date', '1997', { year: 1997, month: null });
  // Far out at sea, so this person stands in nobody else's scene.
  await fact(p, 'lives_in', 'Atlantis', { city: 'Atlantis', lat: -41.5, lon: -31.5, precision_km: 20 });
}

const headers = (p: Person) => ({
  Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.61',
});
const nextCard = async (p: Person) =>
  ((await (await interviewRoutes.request('/v1/interview/next', { headers: headers(p) })).json()) as
    { question: { id: string } | null }).question?.id ?? null;
const answer = (p: Person, id: string) => interviewRoutes.request('/v1/interview/answer', {
  method: 'POST', headers: headers(p), body: JSON.stringify({ questionId: id, values: [], whoFine: { anyone: true } }),
});
const rebuild = (p: Person) => tenantSession(p, (c) => rebuildMatchProfile(c, p));
const answerAllBut = async (p: Person, skip: string[]) => {
  for (const id of CORE) if (!skip.includes(id)) expect((await answer(p, id)).status, id).toBe(200);
};

describe('the kids card', () => {
  it('is never asked of somebody here for something casual, and four cards put them in the pool', async () => {
    for (const intent of ['casual', 'companionship']) {
      const me = await person(intent);
      await setUp(me, intent);
      expect(await nextCard(me), `${intent}: the first card`).toBe('card-monogamy');
      await answerAllBut(me, ['card-kids']);
      expect(await nextCard(me), `${intent}: the kids card came after the others`).not.toBe('card-kids');
      const r = await rebuild(me);
      expect(r.missing, intent).not.toContain('wants_children');
      expect(r.inPool, `${intent}: ${JSON.stringify(r.missing)}`).toBe(true);
    }
  });

  it('comes first for somebody here for something long-term, and they wait without it', async () => {
    const me = await person('long');
    await setUp(me, 'long term');
    expect(await nextCard(me)).toBe('card-kids');
    await answerAllBut(me, ['card-kids']);
    const r = await rebuild(me);
    expect(r.missing).toContain('wants_children');
    expect(r.inPool).toBe(false);
  });

  it('is checked card by card on the Home, not by a count', async () => {
    // Casual, answered kids (allowed) but not smoking: four answers, one of them not needed.
    const me = await person('by-id');
    await setUp(me, 'casual');
    await answerAllBut(me, ['card-smoking']);
    await owner.query('UPDATE match_profile SET in_pool = true WHERE user_id = $1', [me.userId]);
    const r = await tenantSession(me, (c) => poolNow(c, me));
    expect(r.inPool, 'an extra kids answer stood in for the missing smoking one').toBe(false);
    expect(r.missing).toContain('smoking');
  });

  it('is needed again after changing to long-term, and the sweep holds only who misses a card they need', async () => {
    const casual = await person('sweep-casual');
    await setUp(casual, 'casual');
    await answerAllBut(casual, ['card-kids']);
    expect((await rebuild(casual)).inPool).toBe(true);
    const long = await person('sweep-long');
    await setUp(long, 'long term');
    await answerAllBut(long, ['card-kids']);
    await owner.query('UPDATE match_profile SET in_pool = true WHERE user_id = $1', [long.userId]);

    const held = await holdUntilCardsDone(owner as never, { only: [casual.userId, long.userId], dry: true });
    expect(held, 'the sweep').toEqual([long.userId]);

    await fact(casual, 'relationship_intent', 'long term');
    const r = await rebuild(casual);
    expect(r.missing, 'long-term now, and the kids card was not asked for').toContain('wants_children');
    expect(r.inPool).toBe(false);
  });
});
