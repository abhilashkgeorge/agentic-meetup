/**
 * The wants no question fits, most people first -- and never one person's sentence.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-28): "keep a list of wants that didn't match any
 * question, sorted by how often they come up, so I know which situation questions to add
 * next." Settings promises "Nobody else has ever seen what your clone knows about you",
 * so a want only one person has is shown as its topic words, and one two or more people
 * share is shown whole (matching/want-gaps.ts, 0072).
 *
 * WHAT IS PINNED HERE:
 *   - two ways of saying the same want count as one, by different PEOPLE (the same person
 *     twice counts once), most people first;
 *   - wants a question covers, and private topics, are left out;
 *   - a want one person has never leaves as their sentence -- only its topic words;
 *   - the route: the reviewer only, real people only (a test fixture's want is not
 *     counted).
 *
 * Negative controls, run by hand:
 *   - wantGaps showing every want whole          -> "never one person's sentence" fails
 *   - counting sentences instead of people       -> "counts people" fails
 *   - 0072 without the real-people filter        -> "real people only" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return { ...real, decideModel: () => null,
    llm: { ...real.llm, complete: async () => { throw new Error('no model'); }, decide: async () => { throw new Error('no model'); } } };
});

const { env } = await import('../src/env.js');
const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { commit } = await import('../src/memory/facts.js');
const { adminRoutes } = await import('../src/api/admin.js');
const { normalizeWant, wantGaps } = await import('../src/matching/want-gaps.js');
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

describe('the list', () => {
  const rows = [
    { user_id: 'a', text: 'Someone who enjoys theatre. A saver, not an impulse spender. Wants kids.' },
    { user_id: 'b', text: 'Enjoys theatre.' },
    { user_id: 'b', text: 'Enjoys theatre!' },
    { user_id: 'c', text: 'Loves stand-up comedy and late-night jazz bars' },
  ];

  it('counts people, not sentences, for one want said two ways -- most people first', () => {
    expect(normalizeWant('Someone who enjoys theatre')).toBe(normalizeWant('Enjoys theatre.'));
    const g = wantGaps(rows);
    expect(g.wants[0]).toEqual({ want: 'enjoys theatre', topic: ['theatre'], people: 2 });
    expect(g.topics.find((t) => t.word === 'theatre')?.people, 'the same person twice counted twice').toBe(2);
  });

  it('leaves out wants a question covers, and private topics', () => {
    const all = JSON.stringify(wantGaps(rows));
    expect(all).not.toMatch(/saver|impulse/);
    expect(all).not.toMatch(/kids/);
  });

  it('never shows one person’s sentence -- only what it is about', () => {
    const g = wantGaps(rows);
    const solo = g.wants.find((w) => w.people === 1)!;
    expect(solo.want).toBeNull();
    expect(solo.topic).toEqual(expect.arrayContaining(['stand-up', 'comedy', 'jazz', 'bars']));
    expect(JSON.stringify(g), 'one person’s sentence left whole').not.toContain('Loves stand-up comedy');
    expect(JSON.stringify(g)).not.toContain('stand-up comedy and');
  });
});

interface P { tenantId: string; userId: string; token: string }
async function person(label: string, kind: 'real' | 'fixture', wants?: string): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`wg-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const email = kind === 'fixture' ? `wg-${Math.random()}@example.test` : `${tenantId}@device.local`;
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, email]);
  const userId = u.rows[0]!.id;
  await owner.query(`INSERT INTO match_profile (user_id, tenant_id, in_pool, intent) VALUES ($1,$2,false,$3)`, [userId, tenantId, [`wg-${tenantId}`]]);
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  const p = { tenantId, userId, token: mintToken(sessionId) };
  if (wants) {
    await tenantSession(p, (db) => commit(db, p, {
      predicate: 'seeking', objectText: wants, stance: 'asserted', originClass: 'owner', sourceQuote: wants,
      sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }));
  }
  return p;
}

describe('the route', () => {
  it('is the reviewer’s only, and counts real people only', async () => {
    // A word nobody else in any test uses, so the counts are this scene's alone.
    const word = `zorbing${Math.floor(Math.random() * 1e9)}`;
    const rev = await person('rev', 'real');
    await person('one', 'real', `Someone into ${word}`);
    await person('two', 'real', `Into ${word}`);
    await person('fix', 'fixture', `Into ${word}`);
    const plain = await person('plain', 'real');

    expect((await adminRoutes.request('/v1/admin/unmatched-wants', { headers: { Authorization: `Bearer ${plain.token}` } })).status).toBe(404);
    const saved = env.ADMIN_USER_IDS;
    env.ADMIN_USER_IDS = rev.userId;
    try {
      const res = await adminRoutes.request('/v1/admin/unmatched-wants', { headers: { Authorization: `Bearer ${rev.token}` } });
      expect(res.status).toBe(200);
      const g = (await res.json()) as { wants: { want: string | null; people: number }[]; topics: { word: string; people: number }[] };
      expect(g.topics.find((t) => t.word === word)?.people, 'a test fixture was counted as a person').toBe(2);
      expect(g.wants.find((w) => w.want === `into ${word}`)?.people).toBe(2);
    } finally {
      env.ADMIN_USER_IDS = saved;
    }
  });
});
