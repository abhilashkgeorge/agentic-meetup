/**
 * "Your agent heard something" never asks about what the person has since answered
 * (memory/pasteImport.ts pendingConfirmation and reviewable).
 *
 * WHAT WAS WRONG (the two-phone test, 2026-10-02). The clone heard "I spend Sundays in
 * bookshops in Indiranagar" and staged "Part of town: Indiranagar" to ask about. Five
 * minutes later the map saved Indiranagar as her part of town -- and the You tab still
 * asked "Your agent heard something: Part of town: Indiranagar. Is that right?". A
 * person's own answer only ever retired the ACTIVE fact before it, never a staged guess.
 *
 * WHAT IS PINNED, through the real GET /v1/knowledge:
 *   - a guess with no answer of the person's is asked about;
 *   - the same thing saved by the person (any case) is not asked again;
 *   - a single-valued field answered AFTER the guess is not asked: the answer stands;
 *   - an answer given BEFORE a different guess still asks -- that may be a move;
 *   - the bulk list of small things drops what the person has since said, and keeps the rest.
 *
 * Negative control, run by hand and recorded in the commit: pendingConfirmation and
 * reviewable without NOT_ANSWERED -> the three "not asked"/"drops" tests fail.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const { knowledgeRoutes } = await import('../src/api/profile.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
type Me = { tenantId: string; userId: string; token: string };

async function person(): Promise<Me> {
  const tag = `ha-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}@example.test`]);
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
    VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, u.rows[0]!.id]);
  return { tenantId, userId: u.rows[0]!.id, token: mintToken(sessionId) };
}

/**
 * A fact as the app writes it: `heard` is a sentence the clone picked up (untrusted, so
 * staged), otherwise the person's own answer. `minutesAgo` places it in time, so which
 * came first is set, not left to the clock.
 */
async function fact(me: Me, predicate: string, objectText: string, heard: boolean, minutesAgo: number): Promise<void> {
  const r = await tenantSession(me, (c) => commit(c, me, {
    predicate, objectText, stance: 'asserted', originClass: heard ? 'untrusted' : 'owner',
    sourceQuote: heard ? `something about ${objectText}` : objectText, sourceEpisodeIds: [],
    extractorModel: heard ? 'test-extractor' : 'direct', extractorVersion: '0', promptVersion: '0',
  }));
  expect(r.outcome).toBe(heard ? 'staged' : 'asserted');
  await owner.query(`UPDATE facts SET recorded_at = now() - make_interval(mins => $2) WHERE id = $1`, [r.factId, minutesAgo]);
}

async function knowledge(me: Me) {
  const res = await knowledgeRoutes.request('/v1/knowledge', { headers: { Authorization: `Bearer ${me.token}` } });
  expect(res.status).toBe(200);
  return (await res.json()) as { confirm: { claim: string } | null; review: { label: string; value: string }[] };
}

afterAll(async () => {
  await owner.query('DELETE FROM facts WHERE tenant_id = ANY($1)', [made]);
  await removeTenants(owner, made);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('"Your agent heard something"', () => {
  it('asks about a guess the person has not answered', async () => {
    const me = await person();
    await fact(me, 'area', 'Indiranagar', true, 10);
    expect((await knowledge(me)).confirm?.claim).toBe('Part of town: Indiranagar');
  });

  it('does not ask again what the person saved themselves, in any case', async () => {
    const me = await person();
    await fact(me, 'area', 'Indiranagar', true, 10);
    await fact(me, 'area', 'indiranagar', false, 5); // the map, five minutes later
    expect((await knowledge(me)).confirm).toBeNull();
  });

  it('does not ask about a single-valued guess the person answered differently since', async () => {
    const me = await person();
    await fact(me, 'lives_in', 'Mumbai', true, 10);
    await fact(me, 'lives_in', 'Bangalore', false, 5);
    expect((await knowledge(me)).confirm).toBeNull();
  });

  it('still asks when the guess came after a different answer: they may have moved', async () => {
    const me = await person();
    await fact(me, 'lives_in', 'Bangalore', false, 10);
    await fact(me, 'lives_in', 'Mumbai', true, 5);
    expect((await knowledge(me)).confirm?.claim).toMatch(/Mumbai$/);
  });

  it('the list of small things drops what the person has since said themselves, and keeps the rest', async () => {
    // (Heard AFTER the person said it, it never stages: commit counts it as corroboration.)
    const me = await person();
    await fact(me, 'interest', 'chess', true, 10);
    await fact(me, 'interest', 'tennis', true, 9);
    await fact(me, 'interest', 'Chess', false, 5);
    const review = (await knowledge(me)).review.map((r) => r.value.toLowerCase());
    expect(review).toEqual(['tennis']);
  });
});
