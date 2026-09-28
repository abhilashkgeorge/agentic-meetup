/**
 * What the reveal says about a person: only what they chose to show.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-28, item 3 of the list):
 *   - "reveal tags must use only shareable, non-hidden facts";
 *   - "don't take a first name from chat (ask for it on a screen instead)".
 *
 * WHAT WAS WRONG, both found writing docs/END-TO-END.md (section 15.2):
 *   - The reveal's up-to-eight tags came straight from the matching row
 *     (match_profile.attribute_tags), which is built from EVERY live fact: chat-learned
 *     ones the person never shared (match-only), ones they hid (private), and words on
 *     a private topic. The card and "How you appear" already used shareable facts only.
 *   - The name on the reveal was the first word of `full_name`, which only the chat
 *     extractor ever wrote: no screen asked for a name. And a rebuild kept any name it
 *     had once written ("never overwrite a name with nothing"), so a name could not be
 *     taken back. Measured 2026-09-28: no real profile carried a name (the extractor
 *     sends no structured value, so the rebuild skipped it), 5,008 practice ones did.
 *
 * WHAT IS PINNED HERE, through the real routes and the real roles:
 *   - the reveal's tags are the shareable ones with no private-topic word;
 *   - a first name is refused from every writer but the setup and edit screens, a name
 *     heard in chat never becomes the shown name, and a stale one is cleared;
 *   - the name typed on "What should people call you?" is the shown one, first word
 *     only, a phone number or a handle is refused, and declining is an answer;
 *   - "fix the message-history endpoint": it answered for ANY pair the caller was in --
 *     before their turn, after a no or expiry, after a block -- with the other person's
 *     first name and account id. Now only an introduced pair not kept apart; anything
 *     else is a 404 carrying neither.
 *
 * Negative controls, run 2026-09-28, each restored byte-identical:
 *   - otherOf back on the raw attribute_tags        -> "tags" fails (pottery, salsa show)
 *   - revealOf without the mayRepeat filter         -> "tags" fails (temple visits shows)
 *   - commit without the screen-only refusal        -> "heard in chat" fails
 *   - the rebuild's display name back on coalesce   -> "heard in chat" fails (stale name kept)
 *   - the rebuild without its writer check          -> "heard in chat" fails (planted row shows)
 *   - the history route without its seat check      -> "only a conversation" fails (her turn)
 *   - the history route without apart()             -> "only a conversation" fails (blocked)
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const { pool, closeMatchPool, tenantSession } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { messageRoutes } = await import('../src/api/messages.js');
const { commit } = await import('../src/memory/facts.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string; token: string }
async function person(label: string, tags: string[] = []): Promise<P> {
  const tag = `rp-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  // Out of the pool, with an intent of its own: no round anywhere can meet these people.
  await owner.query(`INSERT INTO match_profile (user_id, tenant_id, in_pool, intent, age, traits, attribute_tags)
                     VALUES ($1,$2,false,$3,29,'{}',$4)`, [userId, tenantId, [tag], tags]);
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

/** One fact, through the real write path, as the named writer. */
const fact = (who: P, predicate: string, text: string, opts: {
  value?: unknown; disclosure?: 'public' | 'matchable_only' | 'private'; writer?: string;
} = {}) => tenantSession(who, (c) => commit(c, who, {
  predicate, objectText: text, ...(opts.value !== undefined ? { objectValue: opts.value } : {}),
  stance: 'asserted', originClass: 'owner', sourceQuote: text, sourceEpisodeIds: [],
  ...(opts.disclosure ? { disclosure: opts.disclosure } : {}),
  extractorModel: opts.writer ?? 'gemini-3.5-flash-lite', extractorVersion: '1', promptVersion: 't',
}));

/** A pair whose cards are written, `first` deciding first. */
async function pair(first: P, second: P): Promise<string> {
  const [lo, hi] = first.userId < second.userId ? [first, second] : [second, first];
  const r = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover, answer_by)
     VALUES ($1,$2,$3,$4,0,'decided',$5, now() + interval '3 days') RETURNING id`,
    [lo.userId, hi.userId, lo.tenantId, hi.tenantId, first.userId]);
  const id = r.rows[0]!.id;
  for (const who of [first, second]) {
    await owner.query(`INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, overlap_quotes, concern, questions)
                       VALUES ($1,$2,'h','{"v":2,"shared":[],"work":[],"quotes":[]}','','[]')`, [id, who.userId]);
  }
  return id;
}

const H = (p: P) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' });
const reveal = async (viewer: P, id: string) =>
  (await (await datingRoutes.request(`/v1/matches/${id}`, { headers: H(viewer) })).json()) as Record<string, unknown>;
const share = (who: P, id: string) =>
  datingRoutes.request(`/v1/matches/${id}/decide`, { method: 'POST', headers: H(who), body: JSON.stringify({ yes: true }) });
const essential = (who: P, predicate: string, value: unknown) =>
  datingRoutes.request('/v1/essentials', { method: 'POST', headers: H(who), body: JSON.stringify({ predicate, value }) });
/** The pool's list of what setup should still ask -- and a rebuild of the profile. */
const need = async (who: P) =>
  ((await (await datingRoutes.request('/v1/pool', { headers: H(who) })).json()) as { need: string[] }).need;
const shownName = async (who: P) =>
  (await owner.query<{ n: string | null }>('SELECT display_name AS n FROM match_profile WHERE user_id = $1', [who.userId])).rows[0]!.n;

describe('the reveal shows only what the person chose to show', () => {
  it('tags: shareable facts only, and no word on a private topic', async () => {
    const tags = ['interest:climbing', 'interest:pottery', 'interest:salsa', 'interest:temple_visits', 'works_in:design'];
    const meera = await person('meera', tags);
    const arjun = await person('arjun');
    await fact(meera, 'interest', 'climbing', { value: 'climbing', disclosure: 'public' });
    await fact(meera, 'interest', 'pottery', { value: 'pottery', disclosure: 'matchable_only' });   // learned in chat
    await fact(meera, 'interest', 'salsa', { value: 'salsa', disclosure: 'private' });             // she hid it
    await fact(meera, 'interest', 'temple visits', { value: 'temple_visits', disclosure: 'public' }); // a faith word
    await fact(meera, 'works_in', 'design', { value: 'design', disclosure: 'public' });
    const id = await pair(meera, arjun);
    expect((await share(meera, id)).status).toBe(200);

    const r = await reveal(arjun, id);
    expect(r.waiting).toBe(false);
    expect(r.tags, 'a tag she never shared, hid, or that names her faith').toEqual(['climbing', 'design']);
  });
});

describe('the name another person sees comes from a screen, never from chat', () => {
  it('a name heard in chat is refused or ignored, and a stale one is cleared', async () => {
    const rahul = await person('rahul');
    // What the extractor would write from "I'm Rahul Sharma, by the way".
    expect((await fact(rahul, 'full_name', 'Rahul Sharma', { value: 'Rahul Sharma' })).outcome).not.toBe('rejected');
    // The screen-only kind, from every writer that is not a screen.
    for (const writer of ['gemini-3.5-flash-lite', 'user-confirmed', 'paste']) {
      const r = await fact(rahul, 'first_name', 'Rahul', { writer });
      expect(r.outcome, `${writer} wrote a first name`).toBe('rejected');
    }
    // A name the old rule wrote, and a row that went round `commit` (a restored dump).
    await owner.query(`UPDATE match_profile SET display_name = 'Rahul' WHERE user_id = $1`, [rahul.userId]);
    await owner.query(
      `INSERT INTO facts (tenant_id, user_id, subject_entity_id, predicate, is_single_valued, object_text, object_value,
                          status, origin_class, stance, source_quote, source_episode_ids, extractor_model,
                          extractor_version, prompt_version, disclosure)
       VALUES ($1,$2,$2,'first_name',true,'Rahul','null','active','owner','asserted','Rahul','{}',
               'gemini-3.5-flash-lite','1','t','matchable_only')`, [rahul.tenantId, rahul.userId]);

    expect(await need(rahul), 'the name is not taken from chat, so setup must still ask it').toContain('first_name');
    expect(await shownName(rahul), 'a name from chat, or kept from before, is the shown name').toBeNull();
  });

  it('the name typed on "What should people call you?" is the one shown, first word only', async () => {
    const meera = await person('meera2');
    const arjun = await person('arjun2');
    expect(await need(meera)).toContain('first_name');

    for (const bad of ['98450 12345', '@meera', 'm33ra']) {
      const res = await essential(meera, 'first_name', bad);
      expect(res.status, `"${bad}" was taken as a name`).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_name', message: 'Just your first name, in letters.' });
    }
    expect((await essential(meera, 'first_name', '  Meera Rao ')).status).toBe(200);
    expect(await shownName(meera)).toBe('Meera');
    const { rows } = await owner.query<{ object_text: string }>(
      `SELECT object_text FROM facts WHERE user_id = $1 AND predicate = 'first_name' AND valid_to IS NULL`, [meera.userId]);
    expect(rows.map((r) => r.object_text), 'what she reads back is what they see').toEqual(['Meera']);
    expect(await need(meera)).not.toContain('first_name');

    // And the reveal says it, once she has shared.
    const id = await pair(meera, arjun);
    expect((await share(meera, id)).status).toBe(200);
    expect((await reveal(arjun, id)).name).toBe('Meera');
  });

  it('declining is an answer: not asked again, and nothing shown', async () => {
    const quiet = await person('quiet');
    expect((await essential(quiet, 'first_name', null)).status).toBe(200);
    expect(await need(quiet)).not.toContain('first_name');
    expect(await shownName(quiet)).toBeNull();
  });
});

describe('the message history answers only for a conversation', () => {
  it('an introduced pair, not kept apart; anything else is a 404 with no name and no id', async () => {
    const asha = await person('asha');
    await owner.query(`UPDATE match_profile SET display_name = 'Asha' WHERE user_id = $1`, [asha.userId]);
    const seats: Record<string, { who: P; id: string }> = {};
    for (const [label, status] of [['her turn', 'decided'], ['after a no', 'lapsed'], ['ran out', 'expired'],
                                   ['blocked', 'introduced'], ['talking', 'introduced']] as const) {
      const who = await person(`h-${label.replace(/ /g, '-')}`);
      const id = await pair(asha, who);
      await owner.query('UPDATE rendezvous SET status = $2 WHERE id = $1', [id, status]);
      seats[label] = { who, id };
    }
    await owner.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2)', [asha.userId, seats.blocked!.who.userId]);

    for (const label of ['her turn', 'after a no', 'ran out', 'blocked']) {
      const { who, id } = seats[label]!;
      const res = await messageRoutes.request(`/v1/conversations/${id}/messages`, { headers: H(who) });
      const text = await res.text();
      expect(res.status, `${label}: the history answered`).toBe(404);
      expect(text, `${label}: her name or id came back`).not.toMatch(new RegExp(`Asha|${asha.userId}`));
    }
    const { who, id } = seats.talking!;
    const res = await messageRoutes.request(`/v1/conversations/${id}/messages`, { headers: H(who) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ otherId: asha.userId, name: 'Asha', messages: [] });
  });
});
