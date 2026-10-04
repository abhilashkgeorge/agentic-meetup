/**
 * Somebody who has not built a character is shown as what they said they are.
 *
 * WHAT WAS WRONG (the Pixel, 2026-10-04, two test people on the test database): a woman
 * who skipped the character builder walked Cubbon Park as a man, and the man beside her
 * as a woman. A real person with no saved look gets one from a seed (looks/store.ts), and
 * the seed drew the figure -- man or woman -- like every other part: about half of the
 * people who skip the builder were shown, in the town, the park and on their cards until
 * a photo, as the other sex. "This is you in the square, and all anyone sees of you."
 *
 * WHAT IS PINNED: with no saved look, a woman's default is the woman's figure and a man's
 * the man's -- through looksFor (the town, the park, the cards) and GET /v1/look (where
 * the builder starts) -- and everything else is drawn as before; nonbinary or not said,
 * the figure is drawn as before; a saved look is untouched.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - looksFor without the gender read -> "the figure for what they said" fails;
 *   - starterLookFor ignoring `figure` -> the same, and "where the builder starts".
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { starterLookFor } from '@clone/shared';
import { env } from '../src/env.js';
import { closeMatchPool, matchmakerSession, pool } from '../src/db/client.js';
import { lookSeed, looksFor } from '../src/looks/store.js';
import { lookRoutes } from '../src/api/look.js';
import { mintToken, newSessionId } from '../src/tokens.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

/** A person who said what they are, kept out of every pool (an intent of their own). */
async function person(gender: string | null): Promise<{ userId: string; token: string }> {
  const tag = `look-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  await owner.query(
    `INSERT INTO match_profile (user_id, tenant_id, gender, in_pool, is_synthetic, intent)
     VALUES ($1,$2,$3,false,false,$4)`, [userId, tenantId, gender, [`look-own-${userId}`]]);
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { userId, token: mintToken(sessionId) };
}

const shown = async (userId: string) =>
  (await matchmakerSession((db) => looksFor(db, [userId]))).get(userId)!;
const builderStart = async (token: string) =>
  ((await (await lookRoutes.request('/v1/look', { headers: { Authorization: `Bearer ${token}` } })).json()) as
    { saved: boolean; look: { figure: number } });

describe('a person with no character yet', () => {
  it('is shown as the figure for what they said: a woman as a woman, a man as a man -- the rest drawn as before', async () => {
    // Enough people that the seed alone would have drawn the other figure for some.
    let drawnOther = 0;
    for (let i = 0; i < 6; i++) {
      for (const [gender, figure] of [['woman', 1], ['man', 0]] as const) {
        const p = await person(gender);
        const look = await shown(p.userId);
        expect(look.figure, `${gender} shown on the wrong figure`).toBe(figure);
        if (starterLookFor(lookSeed(p.userId)).figure !== figure) drawnOther++;
        expect(look).toEqual(starterLookFor(lookSeed(p.userId), figure));
        const start = await builderStart(p.token);
        expect(start.saved).toBe(false);
        expect(start.look.figure, 'the builder starts on the wrong figure').toBe(figure);
      }
    }
    expect(drawnOther, 'the seed drew the right figure every time: nothing was checked').toBeGreaterThan(0);
  });

  it('not said, or neither: the figure is drawn, as before', async () => {
    for (const gender of [null, 'nonbinary']) {
      const p = await person(gender);
      expect(await shown(p.userId)).toEqual(starterLookFor(lookSeed(p.userId)));
    }
  });

  it('a saved look is theirs, whatever the default would be', async () => {
    const p = await person('woman');
    const mine = { ...starterLookFor(lookSeed(p.userId), 0) };
    await owner.query('INSERT INTO looks (user_id, tenant_id, look) SELECT $1, tenant_id, $2 FROM app_users WHERE id = $1',
      [p.userId, mine]);
    expect((await shown(p.userId)).figure).toBe(0);
  });
});
