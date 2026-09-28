/**
 * Nobody's photos or name reach anyone until THAT person has said yes to them.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-28):
 *   - the first mover sees only the words card and the other's character -- no photos,
 *     no name; their button is "Yes, share my profile with them", and that yes is the
 *     permission;
 *   - then the second person sees the first mover's photos and card, and taps "Yes,
 *     share mine back" or "Not for me";
 *   - only after that second yes does the first mover see the second person's photos;
 *     then chat opens;
 *   - enforced in the database photo rule and in the server's decide route.
 *
 * WHAT WAS WRONG: the photo rule (0032) and the reveal opened the other person's photos
 * and name to the first mover the moment the cards existed, before that person had done
 * anything; the decide route accepted an answer from either side at any time.
 *
 * WHAT IS PINNED HERE, through the real routes and the real SQL functions:
 *   - before any yes, neither side sees the other's photos or name, and the second
 *     person cannot answer ("not your turn");
 *   - the first mover's yes opens THEIR profile and photos to the other -- and only theirs;
 *   - the second yes opens the second person's to the first, and introduces them;
 *   - a no, or three days of silence, closes everything that was opened;
 *   - the card says which wait it is: you shared, or they shared with you.
 *
 * Negative controls, run 2026-09-28, each restored byte-identical:
 *   - the photo rule with "OR the viewer is the first mover" put back -> "before any
 *     yes" fails (applied to the test database by hand, then re-applied from 0073)
 *   - the decide route and decide() without the turn check      -> "not your turn" fails
 *   - the reveal route with the first-mover exception put back   -> "before any yes" fails
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const { pool, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { decide: decideDirect } = await import('../src/matching/orchestrator.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string; token: string; name: string }
async function person(name: string): Promise<P> {
  const tag = `cf-${name}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  // Out of the pool, with a tag of its own: no round anywhere can meet these people.
  await owner.query(`INSERT INTO match_profile (user_id, tenant_id, in_pool, intent, display_name, age, traits)
                     VALUES ($1,$2,false,$3,$4,29,'{"lives_in":"Bangalore"}')`, [userId, tenantId, [tag], name]);
  await owner.query(`INSERT INTO photos (tenant_id, user_id, position, width, height, bytes, sha256)
                     VALUES ($1,$2,0,300,400,1000,'x')`, [tenantId, userId]);
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId), name };
}

/** A pair whose cards are written: open, three days on the clock, `first` decides first. */
async function pair(first: P, second: P): Promise<string> {
  const [lo, hi] = first.userId < second.userId ? [first, second] : [second, first];
  const r = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover, answer_by)
     VALUES ($1,$2,$3,$4,0,'decided',$5, now() + interval '3 days') RETURNING id`,
    [lo.userId, hi.userId, lo.tenantId, hi.tenantId, first.userId]);
  const id = r.rows[0]!.id;
  for (const who of [first, second]) {
    await owner.query(`INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, overlap_quotes, concern, questions)
                       VALUES ($1,$2,'Here for something long-term · 29','{"v":2,"shared":[],"work":[],"quotes":[]}','','[]')`,
      [id, who.userId]);
  }
  return id;
}

const H = (p: P) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' });
const sees = async (viewer: P, owner_: P) =>
  (await owner.query<{ v: boolean }>('SELECT photos_visible_to($1, $2) AS v', [owner_.userId, viewer.userId])).rows[0]!.v;
const reveal = async (viewer: P, id: string) => {
  const res = await datingRoutes.request(`/v1/matches/${id}`, { headers: H(viewer) });
  return { status: res.status, body: res.status === 200 ? (await res.json()) as Record<string, unknown> : null };
};
const decide = (who: P, id: string, yes: boolean) =>
  datingRoutes.request(`/v1/matches/${id}/decide`, { method: 'POST', headers: H(who), body: JSON.stringify({ yes }) });
const card = async (viewer: P, id: string) => {
  const res = await datingRoutes.request('/v1/matches', { headers: H(viewer) });
  const { matches } = (await res.json()) as { matches: Record<string, unknown>[] };
  return matches.find((m) => m.id === id);
};

describe('consent first: nothing of a person shows until they say yes to you', () => {
  it('before any yes: no photos and no name either way, and the second person cannot answer', async () => {
    const arjun = await person('Arjun');
    const meera = await person('Meera');
    const id = await pair(meera, arjun);   // Meera decides first

    expect(await sees(meera, arjun), 'the first mover saw photos of someone who had not said yes').toBe(false);
    expect(await sees(arjun, meera)).toBe(false);
    for (const viewer of [meera, arjun]) {
      const r = await reveal(viewer, id);
      expect(r.status).toBe(200);
      expect(r.body!.waiting, `${viewer.name} got a profile nobody shared`).toBe(true);
      expect(JSON.stringify(r.body)).not.toMatch(/Arjun|Meera|userId/);
    }
    expect((await reveal(meera, id)).body!.message).toBe('Their photos and name show only after they share them. You decide first, on the card.');

    const early = await decide(arjun, id, true);
    expect(early.status, 'the second person answered before the first had shared').toBe(409);
    expect(await early.json()).toEqual({ error: 'not_your_turn' });
    // And the write itself refuses, whatever calls it -- not only the route.
    expect(await decideDirect(arjun.userId, id, true)).toEqual({ introduced: false });
    const { rows } = await owner.query('SELECT 1 FROM rendezvous_briefs WHERE rendezvous_id = $1 AND human_says_yes IS NOT NULL', [id]);
    expect(rows, 'an out-of-turn answer was written').toHaveLength(0);
  });

  it('the first yes shares the first mover only; the second yes shares back and introduces', async () => {
    const arjun = await person('Arjun');
    const meera = await person('Meera');
    const id = await pair(meera, arjun);

    expect((await decide(meera, id, true)).status).toBe(200);          // "Yes, share my profile with them"
    expect(await sees(arjun, meera), 'her yes did not show him her photos').toBe(true);
    expect(await sees(meera, arjun), 'her yes showed her HIS photos').toBe(false);
    const his = await reveal(arjun, id);
    expect(his.body).toMatchObject({ waiting: false, name: 'Meera', introduced: false, youAnswered: false });
    const hers = await reveal(meera, id);
    expect(hers.body).toMatchObject({ waiting: true, message: 'They see your profile now. Theirs shows here if they share it back.' });
    expect(await card(meera, id)).toMatchObject({ youShared: true, sharedWithYou: false, waitingOnYou: false });
    expect(await card(arjun, id)).toMatchObject({ youShared: false, sharedWithYou: true, waitingOnYou: true });
    expect((await decide(meera, id, true)).status, 'answered twice').toBe(409);

    const back = await decide(arjun, id, true);                          // "Yes, share mine back"
    expect(await back.json()).toEqual({ ok: true, introduced: true });
    expect(await sees(meera, arjun), 'his yes did not show her his photos').toBe(true);
    expect((await reveal(meera, id)).body).toMatchObject({ waiting: false, name: 'Arjun', introduced: true });
  });

  it('a no, or three days of silence, closes what was opened', async () => {
    const arjun = await person('Arjun');
    const meera = await person('Meera');
    const said = await pair(meera, arjun);
    await decide(meera, said, true);
    await decide(arjun, said, false);                                    // "Not for me"
    expect(await sees(arjun, meera), 'he still sees her photos after saying no').toBe(false);
    expect((await reveal(arjun, said)).status).toBe(404);

    const rohan = await person('Rohan');
    const quiet = await pair(meera, rohan);
    await decide(meera, quiet, true);
    expect(await sees(rohan, meera)).toBe(true);
    await owner.query(`UPDATE rendezvous SET answer_by = now() - interval '1 minute' WHERE id = $1`, [quiet]);
    await reveal(meera, quiet);                                          // expireDue runs on read
    expect(await sees(rohan, meera), 'photos stayed open after the card expired').toBe(false);
  });
});
