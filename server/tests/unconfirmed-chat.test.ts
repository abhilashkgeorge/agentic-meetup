/**
 * A sentence nobody confirmed cannot retire an answer (memory/session.ts P2; the founder,
 * 2026-09-29: "Test first whether unconfirmed chat can replace answers; fix it if so").
 *
 * WHAT WAS SUSPECTED (docs 15.3 item 17, read, not run): after a chat, a model is asked
 * which of the person's existing multi-answer facts the new sentences contradict, and
 * those are retired at once -- with no Yes and no record. For a card field the new
 * sentence itself is only HELD until the person says yes (extract.ts stages every tapped
 * field), so the card's answer could be retired by a sentence that never became true.
 *
 * WHAT WAS FOUND, running it: yes, on both counts -- see the commit. The card's answer went
 * ("superseded") while the sentence that retired it was still waiting for a Yes, and a
 * hedged sentence ("I might ...") retired a plain one.
 *
 * WHAT IS PINNED, with the extraction's two model calls stubbed (nothing is spent):
 *   - a held sentence never retires a card's answer;
 *   - a held sentence never retires anything;
 *   - a confirmed sentence still retires what it contradicts, off the cards, with a record.
 *
 * Negative controls, run by hand and recorded in the commit: P2 fed every candidate again
 * -> the first two fail; the retirement written under another op -> "with a record" fails.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import type { FactCandidate } from '../src/memory/facts.js';

const script = vi.hoisted(() => ({ candidates: [] as unknown[] }));
vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  const refuse = () => { throw new Error('no model in this test'); };
  return { ...real, llm: { ...real.llm, complete: refuse, stream: refuse, decide: refuse } };
});
vi.mock('../src/memory/extract.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/memory/extract.js')>();
  return {
    ...real,
    extractSessionFacts: async () => ({ candidates: script.candidates, possiblyFalse: [], intents: [], costUsd: 0 }),
  };
});
// The resolver, as a model that finds every existing answer contradicted by the new ones.
vi.mock('../src/memory/resolve.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/memory/resolve.js')>();
  return {
    ...real,
    resolveConflicts: async (input: { existing: { id: string }[] }) =>
      ({ contradictedIds: input.existing.map((e) => e.id), uncertainIds: [], costUsd: 0, model: 'stub' }),
  };
});

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const episodes = await import('../src/memory/episodes.js');
const { extractSession } = await import('../src/memory/session.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  await owner.query('DELETE FROM facts WHERE tenant_id = ANY($1)', [made]);
  await owner.query('DELETE FROM episodes WHERE tenant_id = ANY($1)', [made]);
  await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

async function person(): Promise<{ tenantId: string; userId: string }> {
  const tag = `uc-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  made.push(t.rows[0]!.id);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [t.rows[0]!.id, `${tag}@example.test`]);
  return { tenantId: t.rows[0]!.id, userId: u.rows[0]!.id };
}
const cand = (predicate: string, objectText: string, over: Partial<FactCandidate> = {}): FactCandidate => ({
  predicate, objectText, stance: 'asserted', originClass: 'owner', sourceQuote: objectText, sourceEpisodeIds: [],
  extractorModel: 'test', extractorVersion: '0', promptVersion: '0', ...over,
});
/** A person with `had` true of them, then a chat in which the extractor hears `heard`. */
async function chat(had: FactCandidate, heard: FactCandidate): Promise<{ userId: string; hadId: string }> {
  const who = await person();
  const hadId = (await tenantSession(who, (c) => commit(c, who, had))).factId!;
  const sessionId = crypto.randomUUID();
  await tenantSession(who, (c) => episodes.append(c, {
    tenantId: who.tenantId, userId: who.userId, sessionId, turnId: crypto.randomUUID(), role: 'user',
    source: 'text', rawText: heard.objectText, occurredAt: new Date(),
  }));
  script.candidates = [heard];
  await extractSession(who, sessionId);
  return { userId: who.userId, hadId };
}
const statusOf = async (id: string) => (await owner.query<{ status: string }>('SELECT status FROM facts WHERE id = $1', [id])).rows[0]!.status;

describe('a chat sentence nobody confirmed', () => {
  it('never retires a card\'s answer while it waits for a Yes', async () => {
    // The work field is a card; the extractor stages what chat says about it (extract.ts).
    const { hadId } = await chat(
      cand('works_in', 'Software', { objectValue: 'software', extractorModel: 'direct' }),
      cand('works_in', 'AI research', { originClass: 'untrusted' }));
    expect(await statusOf(hadId), 'a held sentence retired the card\'s answer').toBe('active');
  });

  it('never retires anything while it is held', async () => {
    const { hadId } = await chat(
      cand('interest', 'climbing'),
      cand('interest', 'I might give up climbing for pottery', { stance: 'hedged', hedgeSpan: 'might' }));
    expect(await statusOf(hadId), 'a hedged sentence retired a plain one').toBe('active');
  });

  it('still retires what a confirmed sentence contradicts, off the cards', async () => {
    const { hadId } = await chat(cand('interest', 'climbing'), cand('interest', 'I stopped climbing, it is all pottery now'));
    expect(await statusOf(hadId)).toBe('superseded');
    const { rows } = await owner.query<{ op: string }>('SELECT op FROM memory_audit WHERE fact_id = $1', [hadId]);
    expect(rows.map((r) => r.op), 'retired with no record').toContain('contradicted');
  });
});
