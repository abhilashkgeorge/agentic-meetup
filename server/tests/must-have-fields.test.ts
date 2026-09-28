/**
 * Every field a must-have can depend on is one chat cannot change without a Yes -- and a
 * must-have on a field with several answers reads all of them.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-28): "make chat changes to the work/field wait for
 * the person's yes, like the cards -- and apply that rule to any field a must-have can
 * depend on."
 *
 * WHAT IS PINNED HERE:
 *   - a sentence in chat about the field you work in, exercise, sleep or moving cities is
 *     STAGED, never live, and a Yes on the You screen makes it the answer;
 *   - the two rules are one set: a field may carry a must-have exactly when chat must ask
 *     first (mustHaveAllowed is TAPPED_PREDICATES), every question a want can be tied to
 *     is in it, and every extractor path stages it;
 *   - "must work in AI" keeps somebody in software AND AI whichever of the two their
 *     traits happen to hold, hides somebody only in design, and keeps somebody who never
 *     said (0071, match_pref_satisfied_multi);
 *   - 0071's one-time fix stages only what a chat model wrote live on these fields --
 *     never a tap, an edit or an invented person.
 *
 * Negative controls, run 2026-09-28, each restored byte-identical:
 *   - the four fields taken back out of TAPPED_PREDICATES  -> "waits for a Yes" and "one
 *     set" fail
 *   - the candidate query without the many-answer branch    -> "reads all of them" fails
 *   - 0071's UPDATE without the model-name match            -> "only what a chat model
 *     wrote" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const stub = vi.hoisted(() => ({ parsed: {} as unknown }));
vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real, decideModel: () => null, modelFor: () => 'google:gemini-3.5-flash-lite',
    llm: { ...real.llm,
      complete: async () => ({ text: '', parsed: stub.parsed, usage: { inputTokens: 0, cachedReadTokens: 0, cacheWriteTokens: 0,
        outputTokens: 0, reasoningTokens: 0, provider: 'google', modelId: 'x', costUsd: 0, latencyMs: 0 } }),
      decide: async () => { throw new Error('no model'); } },
  };
});

const { canFilterOn } = await import('@clone/shared');
const { env } = await import('../src/env.js');
const { pool, matchSession, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { commit } = await import('../src/memory/facts.js');
const { tellRoutes } = await import('../src/api/tell.js');
const { knowledgeRoutes } = await import('../src/api/profile.js');
const { candidateIds } = await import('../src/matching/candidates.js');
const { TAPPED_PREDICATES, mustHaveAllowed, QUESTIONS } = await import('../src/onboarding/questions.js');
const { WANT_QUESTION_PREDICATES } = await import('../src/matching/want-questions.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
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

type Who = { tenantId: string; userId: string; token: string };
async function person(label: string, over: Record<string, unknown> = {}): Promise<Who> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`mf-${label}-${Date.now()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `mf-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, in_pool: true, is_synthetic: false, sees_synthetic: false,
    display_name: label, traits: {}, attribute_tags: [], intent: [`mf-${label}`], ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map((k) => (k === 'traits' ? JSON.stringify(cols[k]) : cols[k])));
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}
const H = (p: Who) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.61' });
const fact = (said: string, predicate: string, objectText: string) =>
  ({ predicate, object_text: objectText, stance: 'asserted', hedge_span: '', source_quote: said, valid_from: '' });

describe('a sentence in chat about a must-have field', () => {
  it('waits for a Yes on the work field, exercise, sleep and moving cities -- and a Yes makes it the answer', async () => {
    const me = await person('talker');
    const said = 'I moved into AI research last year, I run most mornings, I am up by six, and I would move for the right person.';
    stub.parsed = { facts: [
      fact(said, 'works_in', 'ai'), fact(said, 'exercise_habit', 'often'),
      fact(said, 'sleep_pattern', 'early'), fact(said, 'relocation_openness', 'yes'),
    ], possibly_false: [], intents: [] };
    const res = await tellRoutes.request('/v1/tell', { method: 'POST', headers: H(me), body: JSON.stringify({ text: said, sessionId: crypto.randomUUID() }) });
    expect(res.status).toBe(200);
    const { rows } = await owner.query<{ predicate: string; status: string; origin_class: string }>(
      `SELECT predicate, status, origin_class FROM facts WHERE user_id = $1 AND valid_to IS NULL ORDER BY predicate`, [me.userId]);
    expect(rows.filter((r) => r.status === 'active').map((r) => r.predicate), 'a chat sentence became a must-have field’s answer').toEqual([]);
    expect(rows.map((r) => r.predicate).sort()).toEqual(['exercise_habit', 'relocation_openness', 'sleep_pattern', 'works_in']);

    // Asked one at a time, and a Yes makes it live (as a new row -- the staged one is kept).
    const k = await (await knowledgeRoutes.request('/v1/knowledge', { headers: H(me) })).json() as { confirm: { factId: string } | null };
    expect(k.confirm).not.toBeNull();
    const { rows: asked } = await owner.query<{ predicate: string }>('SELECT predicate FROM facts WHERE id = $1', [k.confirm!.factId]);
    await knowledgeRoutes.request('/v1/knowledge/confirm', { method: 'POST', headers: H(me), body: JSON.stringify({ factId: k.confirm!.factId, verdict: 'yes' }) });
    const { rows: live } = await owner.query('SELECT 1 FROM facts WHERE user_id = $1 AND predicate = $2 AND status = $3 AND valid_to IS NULL',
      [me.userId, asked[0]!.predicate, 'active']);
    expect(live, 'a Yes did not make it the answer').toHaveLength(1);
  });

  it('is one set: a field carries a must-have exactly when chat must ask first, every tied question is in it, every extractor stages it', () => {
    const fields = new Set([...QUESTIONS.map((q) => q.predicate), ...WANT_QUESTION_PREDICATES]);
    for (const p of fields) expect(mustHaveAllowed(p), p).toBe(TAPPED_PREDICATES.has(p));
    for (const p of WANT_QUESTION_PREDICATES) {
      expect(mustHaveAllowed(p), `${p}: a want tied to it could never be a must-have`).toBe(true);
      expect(canFilterOn(p), p).toBe(true);
    }
    // Chat and "tell" stage exactly the tapped fields; a paste stages everything.
    const src = (file: string) => readFileSync(join(import.meta.dirname, '..', 'src', 'memory', file), 'utf8');
    expect(src('extract.ts'), 'chat does not stage the must-have fields')
      .toMatch(/originClass: TAPPED_PREDICATES\.has\(f\.predicate\) \? 'untrusted' : 'owner'/);
    expect(src('pasteImport.ts'), 'a paste does not stage what it imports').toMatch(/originClass: 'untrusted',/);
  });
});

describe('a must-have on a field with several answers', () => {
  it('reads all of them: software-and-AI kept, design-only hidden, never-said kept', async () => {
    const tag = `mf-many-${Math.random()}`;
    const me = await person('seeker', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    // traits hold ONE of her two fields -- "software" -- as the profile builder leaves it.
    const both = await person('both', { intent: [tag], traits: { works_in: 'software' }, attribute_tags: ['works_in:software', 'works_in:ai'] });
    const design = await person('design', { intent: [tag], traits: { works_in: 'design' }, attribute_tags: ['works_in:design'] });
    const never = await person('never', { intent: [tag] });
    await owner.query(
      `INSERT INTO preferences (tenant_id, user_id, predicate, operator, value, strength, source_quote)
       VALUES ($1,$2,'works_in','in','["ai"]','dealbreaker','Works in AI')`, [me.tenantId, me.userId]);
    const ids = await matchSession((c) => candidateIds(c, me.userId));
    expect(ids, 'somebody in software AND AI was hidden by "must work in AI"').toContain(both.userId);
    expect(ids).not.toContain(design.userId);
    expect(ids, 'somebody who never said was hidden').toContain(never.userId);
  });
});

describe('0071, the one-time fix', () => {
  it('stages only what a chat model wrote live on these fields', async () => {
    const who = await person('history');
    // Live facts as each writer leaves them -- through the app's own write path.
    const write = async (predicate: string, text: string, model: string) => (await tenantSession(who, (db) => commit(db, who, {
      predicate, objectText: text, stance: 'asserted', originClass: 'owner', sourceQuote: text,
      sourceEpisodeIds: [], extractorModel: model, extractorVersion: '0', promptVersion: '0',
    }))).factId!;
    const fromChat = await write('works_in', 'ai', 'gemini-3.5-flash-lite');
    const tapped = await write('works_in', 'software', 'interview');
    const edited = await write('exercise_habit', 'often', 'direct');
    const invented = await write('sleep_pattern', 'early', 't');
    const sql = readFileSync(join(import.meta.dirname, '..', 'migrations', '0071_must_have_fields_wait_for_yes.sql'), 'utf8');
    const update = sql.slice(sql.indexOf('UPDATE facts'), sql.indexOf(';', sql.indexOf('UPDATE facts')) + 1);
    const c = await owner.connect();
    try {
      await c.query('BEGIN');
      await c.query(update);
      const { rows } = await c.query<{ id: string; status: string; origin_class: string }>(
        'SELECT id, status, origin_class FROM facts WHERE id = ANY($1)', [[fromChat, tapped, edited, invented]]);
      const by = new Map(rows.map((r) => [r.id, `${r.status}/${r.origin_class}`]));
      expect(by.get(fromChat)).toBe('staged/untrusted');
      expect([by.get(tapped), by.get(edited), by.get(invented)]).toEqual(['active/owner', 'active/owner', 'active/owner']);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
