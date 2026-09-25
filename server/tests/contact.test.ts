/**
 * Contact details are never repeated to anybody -- decided by code.
 *
 * WHY (the founder, 2026-09-25): a sentence a person typed can be quoted on a card,
 * given as their agent's answer, or said in the agents' talk. A phone number, email,
 * @handle, link or street address in it would reach a stranger before either person
 * said yes. People swap those themselves, after both say yes. Nothing stopped it
 * before this: a sentence typed in chat with a number in it passed every check.
 *
 * WHAT IS PINNED HERE:
 *   - the detector (shared/src/contact.ts) catches every kind, in the forms people type
 *     in India -- and leaves ordinary sentences with numbers in them alone;
 *   - a sentence holding one never comes out of loadQuotes, the one door every card,
 *     answer sheet and talk reads through, so no model is even shown it;
 *   - a story holding one is saved, flagged, and never quoted.
 *
 * Negative controls, run by hand (2026-09-25):
 *   - loadQuotes without the contactDetail check     -> "never comes out" and "as a
 *     story" fail
 *   - phoneLike taking any four digits as a phone    -> "leaves ordinary sentences" fails
 *   - the spelled-digits pattern removed             -> "catches every kind" fails
 * The last two edit shared/, and the server reads @clone/shared from its BUILT copy
 * (shared/dist): a first run that edited the source without `tsc -b shared` changed
 * nothing, "passed", and proved nothing. They were redone with a rebuild either side.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { contactDetail } from '@clone/shared';

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real,
    decideModel: () => null,
    llm: {
      ...real.llm,
      complete: async () => { throw new Error('no model in this test'); },
      decide: async () => { throw new Error('no model in this test'); },
    },
  };
});

describe('the detector', () => {
  it('catches every kind, in the forms people type', () => {
    const cases: Array<[string, string]> = [
      ['phone', 'Call on 98450 12345 after six'],
      ['phone', 'my number +91-98450-12345'],
      ['phone', 'reach me at 9845012345'],
      ['phone', 'office line 080 2345 6789'],
      ['phone', 'it is nine eight four five zero one two three four five'],
      ['email', 'write to priya.k92@gmail.com'],
      ['email', 'priya at gmail dot com works best'],
      ['email', 'priya [at] outlook [dot] in'],
      ['handle', 'I post my pottery as @priya_pots'],
      ['handle', 'insta: priya.k'],
      ['handle', 'ig - priya_92'],
      ['handle', 'my insta is priyapots'],
      ['handle', 'my snap is priya.k'],
      ['handle', 'insta id is priya'],
      ['link', 'see https://example.org/me'],
      ['link', 'my playlists at www.mixcloud.com/priya'],
      ['link', 't.me/priyapots'],
      ['phone', 'wa.me/919845012345'],
      ['link', 'everything is on linktr.ee/priya'],
      ['invite', 'dm me on insta if you like dogs'],
      ['invite', 'find me on snapchat'],
      ['address', 'I climb at the gym on 12th Main'],
      ['address', 'we live off 3rd Cross in Indiranagar'],
      ['address', 'my flat is on 80 feet road'],
      ['address', 'flat 302, the one with the plants'],
      ['address', '#42, near the temple'],
      ['address', 'pincode 560038 has the best dosa'],
    ];
    for (const [kind, text] of cases) expect(contactDetail(text), text).not.toBeNull();
    // The kind is named, so a screen can say why.
    for (const [kind, text] of cases.filter(([k]) => k !== 'handle' && k !== 'invite')) {
      expect(contactDetail(text), text).toBe(kind);
    }
  });

  it('leaves ordinary sentences with numbers, platforms and places in them alone', () => {
    const fine = [
      'I run 10k every Sunday before 7',
      'I have 2 cats and 1 very opinionated parrot',
      'Moved to Bengaluru in 2019 for work',
      'I love Instagram reels far more than I should',
      'WhatsApp groups are where plans go to die',
      'Top 3 films: Kumbalangi Nights, Drishyam, Lagaan',
      'I read about 30 books a year',
      'Cubbon Park at 6am is the best place in the city',
      'I live in Koramangala and walk everywhere',
      'Call me old-fashioned, but I still write letters',
      'I work 9 to 5 and paint after',
      'We did 400 km on the bikes in two days',
      'Look at the view from Nandi Hills',
      'Dosa at CTR, then a slow walk in Lalbagh',
    ];
    for (const text of fine) expect(contactDetail(text), text).toBeNull();
  });
});

// ── through the one door ────────────────────────────────────────────────────

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const episodes = await import('../src/memory/episodes.js');
const { loadQuotes } = await import('../src/matching/brief.js');
const { SHEET_SOURCES } = await import('../src/matching/answer-sheet.js');
const { storyRoutes } = await import('../src/api/stories.js');
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

type Person = { tenantId: string; userId: string; token: string };
async function person(label: string): Promise<Person> {
  const tag = `ct-${label}-${Date.now()}-${Math.random()}`;
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

describe('a sentence with a contact detail', () => {
  it('never comes out of the one door every card, sheet and talk reads through', async () => {
    const me = await person('door');
    const NUMBER = 'Ping me on 98450 12345 if you want to go trekking';
    const HANDLE = 'I post all my pottery as @priya_pots these days';
    const CLEAN = 'I throw pots on Sundays and give most of them away';
    await tenantSession(me, async (db) => {
      await episodes.append(db, {
        tenantId: me.tenantId, userId: me.userId, sessionId: crypto.randomUUID(), turnId: crypto.randomUUID(),
        role: 'user', source: 'text', rawText: `${NUMBER}. ${HANDLE}. ${CLEAN}.`, occurredAt: new Date(),
      });
      for (const [predicate, q] of [['did', NUMBER], ['interest', HANDLE], ['interest', CLEAN]] as const) {
        await commit(db, me, {
          predicate, objectText: q.slice(0, 40), stance: 'asserted', originClass: 'owner', sourceQuote: q,
          sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
        });
      }
    });
    for (const opts of [{}, { predicates: SHEET_SOURCES, limit: 40 }, { includeHidden: true }]) {
      const texts = (await loadQuotes(me, opts)).map((q) => q.text);
      expect(texts, JSON.stringify(opts)).toContain(CLEAN);
      expect(texts, JSON.stringify(opts)).not.toContain(NUMBER);
      expect(texts, JSON.stringify(opts)).not.toContain(HANDLE);
    }
  });

  it('as a story is saved, flagged, and never quoted', async () => {
    const me = await person('story');
    const MAIL = 'Plan: filter coffee, then write to me at priya.k92@gmail.com';
    const res = await storyRoutes.request('/v1/stories', {
      method: 'POST', headers: { Authorization: `Bearer ${me.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'story-date', text: MAIL }),
    });
    expect(res.status).toBe(200);
    const { stories } = await (await storyRoutes.request('/v1/stories', {
      headers: { Authorization: `Bearer ${me.token}` } })).json() as { stories: { id: string; answer: { contact: boolean } | null }[] };
    expect(stories.find((s) => s.id === 'story-date')?.answer?.contact).toBe(true);
    expect((await loadQuotes(me)).map((q) => q.text)).not.toContain(MAIL);
  });
});
