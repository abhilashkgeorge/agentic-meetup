/**
 * "Yes, that's right" never wipes a card answer, or takes somebody out of the pool
 * (memory/card-guard.ts; the founder, 2026-09-29; docs 15.3 item 16).
 *
 * WHAT WAS WRONG: confirming a sentence the clone heard about a card field re-committed
 * the words over the card. "Socially" -- which the drinking card cannot read -- replaced
 * "Sometimes" with nothing; a place named without a map point replaced the point, and the
 * person's profile lost its location, which is what keeps them in the pool.
 *
 * WHAT IS PINNED, through the real confirm route:
 *   - words the card cannot read leave the card's answer as it was, and say so;
 *   - a place without a map point leaves the point, and the rebuilt profile keeps it;
 *   - words the card CAN read still change it: that is what the Yes is for.
 *
 * Negative control, run by hand and recorded in the commit: confirmStagedFact without the
 * guard -> the first two fail.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const { knowledgeRoutes } = await import('../src/api/profile.js');
const { rebuildMatchProfile } = await import('../src/matching/profile.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
let me: { tenantId: string; userId: string; token: string };

async function fact(predicate: string, objectText: string, objectValue: unknown, untrusted: boolean): Promise<string> {
  const r = await tenantSession(me, (c) => commit(c, me, {
    predicate, objectText, ...(objectValue === undefined ? {} : { objectValue }),
    stance: 'asserted', originClass: untrusted ? 'untrusted' : 'owner', sourceQuote: objectText, sourceEpisodeIds: [],
    extractorModel: untrusted ? 'test-extractor' : 'direct', extractorVersion: '0', promptVersion: '0',
  }));
  return r.factId!;
}
const active = async (predicate: string) => (await owner.query<{ object_text: string; object_value: unknown }>(
  `SELECT object_text, object_value FROM facts
    WHERE user_id = $1 AND predicate = $2 AND status = 'active' AND valid_to IS NULL`, [me.userId, predicate])).rows;
const confirm = async (factId: string) => (await (await knowledgeRoutes.request('/v1/knowledge/confirm', {
  method: 'POST', headers: { Authorization: `Bearer ${me.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ factId, verdict: 'yes' }),
})).json()) as { ok: boolean; message: string; keptCard?: boolean };

beforeAll(async () => {
  const tag = `ck-${Date.now()}-${Math.random()}`;
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

describe('"Yes, that\'s right" on something the clone heard about a card', () => {
  it('leaves the card\'s answer when the card cannot read the words, and says so', async () => {
    await fact('drinking', 'Sometimes', 'sometimes', false);
    const heard = await fact('drinking', 'socially', undefined, true);
    const r = await confirm(heard);
    expect((await active('drinking')).map((f) => f.object_value), 'the drinking card was wiped').toEqual(['sometimes']);
    expect(r.keptCard).toBe(true);
    expect(r.message).toBe('Your card answer stays: Sometimes. If it has changed, change it on the card.');
  });

  it('leaves the map point when the place has none, and the profile keeps it', async () => {
    await fact('lives_in', 'Bengaluru', { city: 'Bengaluru', lat: 12.97, lon: 77.59, precision_km: 20 }, false);
    const heard = await fact('lives_in', 'Indiranagar', undefined, true);
    const r = await confirm(heard);
    const now = await active('lives_in');
    expect(now.map((f) => (f.object_value as { lat?: number } | null)?.lat), 'the map point was wiped').toEqual([12.97]);
    expect(r.keptCard).toBe(true);
    await tenantSession(me, (c) => rebuildMatchProfile(c, me));
    const { rows } = await owner.query<{ lat: number | null }>('SELECT lat FROM match_profile WHERE user_id = $1', [me.userId]);
    expect(rows[0]?.lat, 'the profile lost its location').not.toBeNull();
  });

  it('still changes the card when the card can read the words', async () => {
    const heard = await fact('drinking', 'never', undefined, true);
    const r = await confirm(heard);
    expect(r.keptCard).toBeUndefined();
    expect((await active('drinking')).map((f) => f.object_value)).toEqual(['never']);
  });
});
