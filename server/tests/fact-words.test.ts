/**
 * "What it knows" in words (src/memory/fact-words.ts; the founder's "What it knows" on the
 * Pixel 6a, 2026-09-30, which read "WANTS CHILDREN: yes", "MONOGAMY STANCE: monogamous",
 * "MAX DISTANCE KM: 25").
 *
 * WHAT IS PINNED: a field reads as words; a tapped answer reads as its chip; a number gets
 * its unit; and anything the person typed -- not a chip value -- comes through untouched.
 * Through the real route: GET /v1/knowledge says "Kids" and "Want kids".
 *
 * Negative control, run by hand and recorded in the commit: the route back on the column
 * name and the stored value -> "through the route" fails.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const { knowledgeRoutes } = await import('../src/api/profile.js');
const { fieldWords, valueWords } = await import('../src/memory/fact-words.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
let me: { tenantId: string; userId: string; token: string };

beforeAll(async () => {
  const tag = `fw-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}@example.test`]);
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
    VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, u.rows[0]!.id]);
  me = { tenantId, userId: u.rows[0]!.id, token: mintToken(sessionId) };
});
afterAll(async () => {
  await owner.query('DELETE FROM facts WHERE tenant_id = ANY($1)', [made]);
  await removeTenants(owner, made);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('a fact, in words', () => {
  it('says the field as words, a tapped answer as its chip, a number with its unit', () => {
    expect(fieldWords('wants_children')).toBe('Kids');
    expect(fieldWords('monogamy_stance')).toBe('One person or open');
    expect(fieldWords('max_distance_km')).toBe('How far you would go');
    expect(fieldWords('some_new_field')).toBe('Some new field');
    expect(valueWords('wants_children', 'yes')).toBe('Want kids');
    expect(valueWords('monogamy_stance', 'monogamous')).toBe('One person');
    expect(valueWords('religion', 'not religious')).toBe('Not religious');
    expect(valueWords('max_distance_km', '25')).toBe('25 km');
    expect(valueWords('age_range_sought', '20-27')).toBe('20 to 27');
  });

  it('leaves what the person typed exactly as typed', () => {
    expect(valueWords('diet', 'I eat everything')).toBe('I eat everything');
    expect(valueWords('interest', 'humourous')).toBe('humourous');
    expect(valueWords('dealbreaker', 'Someone who is not disciplined')).toBe('Someone who is not disciplined');
  });

  it('is what GET /v1/knowledge says, through the route', async () => {
    await tenantSession(me, (c) => commit(c, me, {
      predicate: 'wants_children', objectText: 'yes', objectValue: 'yes', stance: 'asserted', originClass: 'owner',
      sourceQuote: 'Do you want children? yes', sourceEpisodeIds: [], extractorModel: 'interview', extractorVersion: '0', promptVersion: '0',
    }));
    const r = await (await knowledgeRoutes.request('/v1/knowledge', { headers: { Authorization: `Bearer ${me.token}` } })).json() as
      { knows: { predicate: string; label: string; value: string }[] };
    expect(r.knows.find((f) => f.predicate === 'wants_children')).toMatchObject({ label: 'Kids', value: 'Want kids' });
  });
});
