/**
 * "How you appear" asks "Hide this?" under a sentence naming where somebody works,
 * studied or lives.
 *
 * WHAT THE FOUNDER ASKED FOR (build list item 14): flag sentences naming a company, a
 * college or a building, and ask "Hide this?".
 *
 * WHAT WAS WRONG: the contact-detail block stops numbers, handles and street addresses,
 * and HOW-IT-WORKS said plainly "Not caught: a company or building named in words".
 * "I lead the payments team at Razorpay" went on a card as it was.
 *
 * WHAT IS PINNED HERE: the detector finds each kind in sentences people actually type,
 * and leaves alone the ones that only look similar -- a product ("Google Maps"), a
 * park, a street, "a startup" -- so the question keeps meaning something; and the
 * appearance route marks each sentence it lists, quotes and the agent's answers alike.
 * A suggestion only: nothing is hidden by it.
 *
 * Negative controls, run by hand:
 *   - namesPlace without the building patterns       -> "building" fails
 *   - the route not marking quotes                   -> "marks what it lists" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return { ...real, decideModel: () => null,
    llm: { ...real.llm, complete: async () => { throw new Error('no model'); }, decide: async () => { throw new Error('no model'); } } };
});

const { namesPlace } = await import('@clone/shared');
const { env } = await import('../src/env.js');
const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { commit } = await import('../src/memory/facts.js');
const episodes = await import('../src/memory/episodes.js');
const { meRoutes } = await import('../src/api/me.js');
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

describe('namesPlace', () => {
  it.each([
    ['I lead the payments team at Razorpay', 'company'],
    ['i work at google', 'company'],
    ['I work for Acme Technologies', 'company'],
    ['The Amazon office has great coffee', 'company'],
    ['Studied at IIT Madras', 'college'],
    ['Went to Christ University for my masters', 'college'],
    ["St. Joseph's College was fun", 'college'],
    ['I live in Prestige Shantiniketan', 'building'],
    ['Our office is in Manyata Tech Park', 'building'],
    ['We moved into Lakeview Towers', 'building'],
  ])('asks about "%s": %s', (sentence, kind) => {
    expect(namesPlace(sentence)).toBe(kind);
  });

  it.each([
    'I love Google Maps',
    'I walk in Cubbon Park before work',
    'I love walking down Brigade Road',
    'I work at a startup',
    'Filter coffee is the best part of my morning',
    'I cycle out of the city most weekends',
  ])('leaves "%s" alone', (sentence) => {
    expect(namesPlace(sentence)).toBeNull();
  });
});

interface P { tenantId: string; userId: string; token: string }
async function person(): Promise<P> {
  const tag = `id-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  await owner.query(`INSERT INTO match_profile (user_id, tenant_id, in_pool, intent) VALUES ($1,$2,false,$3)`, [userId, tenantId, [tag]]);
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}
const says = async (p: P, sentence: string) => tenantSession(p, async (db) => {
  await episodes.append(db, {
    tenantId: p.tenantId, userId: p.userId, sessionId: crypto.randomUUID(), turnId: crypto.randomUUID(),
    role: 'user', source: 'text', rawText: sentence, occurredAt: new Date(),
  });
  await commit(db, p, {
    predicate: 'did', objectText: sentence.slice(0, 40), stance: 'asserted', originClass: 'owner', sourceQuote: sentence,
    sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
  });
});

describe('How you appear', () => {
  it('marks what it lists: the sentence naming a company asks, the other does not', async () => {
    const me = await person();
    await says(me, 'I lead the payments team at Razorpay');
    await says(me, 'I cycle out of the city most weekends');
    const res = await meRoutes.request('/v1/me/appearance', { headers: { Authorization: `Bearer ${me.token}` } });
    expect(res.status).toBe(200);
    const look = (await res.json()) as { quotes: { text: string; names: string | null; hidden: boolean }[] };
    const by = Object.fromEntries(look.quotes.map((q) => [q.text, q.names]));
    expect(by['I lead the payments team at Razorpay']).toBe('company');
    expect(by['I cycle out of the city most weekends']).toBeNull();
    // Asked, never hidden for them.
    expect(look.quotes.every((q) => !q.hidden)).toBe(true);
  });
});
