/**
 * A must-have hides somebody only over an answer they tapped -- and only once they have
 * answered.
 *
 * WHAT THE FOUNDER DECIDED (2026-09-26): must-haves hide people only on tapped answers;
 * a typed answer the model reads can only move people down. Nice-to-haves only move
 * people. The pool says how many match all the must-haves, in words when it is small.
 *
 * WHAT IS PINNED HERE:
 *   - a must-have on a situation answer ("Money: Saved or invested") hides the person who
 *     answered "a treat", keeps the one who answered "saved", and keeps the one who never
 *     answered -- unknown is never a mismatch;
 *   - it is refused on a field chat changes without asking (interests): the route says
 *     why, the rule stays a want, and "Must have" is not offered for it;
 *   - it IS offered on every question a want can be tied to -- the work field included,
 *     since 2026-09-28 chat changes to those wait for a Yes (must-have-fields.test.ts).
 *
 * Negative controls, run 2026-09-26 and again 2026-09-28, each restored byte-identical:
 *   - mustHaveAllowed true for everything              -> "refused" fails
 *   - the strength route without the tapped check      -> "refused" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return { ...real, decideModel: () => null,
    llm: { ...real.llm, complete: async () => { throw new Error('no model'); }, decide: async () => { throw new Error('no model'); } } };
});

const { env } = await import('../src/env.js');
const { pool, tenantSession, matchSession, closeMatchPool } = await import('../src/db/client.js');
const { commit } = await import('../src/memory/facts.js');
const { candidateIds } = await import('../src/matching/candidates.js');
const { setPreference, PreferenceCannotFilter } = await import('../src/matching/profile.js');
const { wantRoutes } = await import('../src/api/wants.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
afterAll(async () => {
  if (made.length) {
    await owner.query('DELETE FROM facts WHERE tenant_id = ANY($1)', [made]);
    await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  }
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

type Who = { tenantId: string; userId: string; token: string };
async function person(label: string, over: Record<string, unknown>): Promise<Who> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`mh-${label}-${Date.now()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `mh-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, in_pool: true, is_synthetic: false, sees_synthetic: false,
    display_name: label, traits: {}, ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map((k) => (k === 'traits' ? JSON.stringify(cols[k]) : cols[k])));
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}
const H = (p: Who) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' });
const said = (p: Who, text: string) => tenantSession(p, (db) => commit(db, p, {
  predicate: 'seeking', objectText: text, stance: 'asserted', originClass: 'owner', sourceQuote: text,
  sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
}));
const tie = (p: Who, want: string, questionId: string, accepted: string[]) =>
  wantRoutes.request('/v1/me/wants/question', { method: 'POST', headers: H(p), body: JSON.stringify({ want, questionId, accepted }) });
type Pref = { id: string; predicate: string; strength: string; mustHave: boolean };
const prefs = async (p: Who) => ((await (await datingRoutes.request('/v1/preferences', { headers: H(p) })).json()) as { preferences: Pref[] }).preferences;
const strength = (p: Who, id: string, s: string) =>
  datingRoutes.request('/v1/preferences/strength', { method: 'POST', headers: H(p), body: JSON.stringify({ id, strength: s }) });

describe('a must-have', () => {
  it('on a tapped situation answer hides only those who answered otherwise', async () => {
    const tag = `mh-${Date.now()}-${Math.random()}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const saver = await person('saver', { intent: [tag], traits: { money_windfall: 'save-invest' } });
    const treat = await person('treat', { intent: [tag], traits: { money_windfall: 'treat' } });
    const never = await person('never', { intent: [tag] });
    const SAVER = 'I want a saver, not an impulse spender';
    await said(me, SAVER);
    expect((await tie(me, SAVER, 'sit-windfall', ['save-invest', 'pay-off'])).status).toBe(200);

    // A nice-to-have first: nobody is hidden.
    const all = await matchSession((c) => candidateIds(c, me.userId));
    for (const x of [saver, treat, never]) expect(all).toContain(x.userId);

    // Made a must-have, the way the phone does it.
    const rule = (await prefs(me)).find((r) => r.predicate === 'money_windfall')!;
    expect(rule.mustHave).toBe(true);
    expect((await strength(me, rule.id, 'dealbreaker')).status).toBe(200);
    const after = await matchSession((c) => candidateIds(c, me.userId));
    expect(after).toContain(saver.userId);
    expect(after, 'someone who answered otherwise was kept').not.toContain(treat.userId);
    expect(after, 'someone who never answered was hidden').toContain(never.userId);
  });

  it('is refused on a field chat changes without asking, and is not offered there', async () => {
    // Interests are learned from chat as they are said -- not a field that waits for a
    // Yes -- so a rule on one may rank but never hide anybody.
    const me = await person('me2', { gender: 'man', seeking_gender: ['woman'], intent: [`mh2-${Math.random()}`] });
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO preferences (tenant_id, user_id, predicate, operator, value, strength, source_quote)
       VALUES ($1,$2,'interest','in','["hiking"]','strong','Someone who hikes') RETURNING id`, [me.tenantId, me.userId]);
    const rule = (await prefs(me)).find((r) => r.id === rows[0]!.id)!;
    expect(rule.mustHave, '"Must have" offered on a field chat fills without asking').toBe(false);
    const res = await strength(me, rule.id, 'dealbreaker');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(/tapped/);
    expect((await prefs(me)).find((r) => r.id === rule.id)!.strength).toBe('strong');
    // And at the source, whoever calls it.
    await expect(tenantSession(me, (db) => setPreference(db, me, {
      predicate: 'interest', operator: 'in', value: ['hiking'], strength: 'dealbreaker' }))).rejects.toBeInstanceOf(PreferenceCannotFilter);
  });

  it('is offered on every question a want can be tied to (2026-09-28: the work field too)', async () => {
    const me = await person('me3', { gender: 'man', seeking_gender: ['woman'], intent: [`mh3-${Math.random()}`] });
    const AI = 'Software engineer working on AI';
    await said(me, AI);
    await tie(me, AI, 'q-works-in', ['ai']);
    const rule = (await prefs(me)).find((r) => r.predicate === 'works_in')!;
    expect(rule.mustHave).toBe(true);
    expect((await strength(me, rule.id, 'dealbreaker')).status).toBe(200);
  });
});
