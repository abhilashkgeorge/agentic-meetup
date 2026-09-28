/**
 * The after-date check-in asks only about what was shown, pays the same whatever is
 * answered, and lets nothing cross to the other side but one mutual bit.
 *
 * Negative controls, run by hand and recorded in the commit: feed the generator
 * `traits`/`attribute_tags` unfiltered -> a question about religion appears; drop the
 * `NOT EXISTS ... = 'no'` clause from confirmations_of -> the 'age: no' check-in still
 * counts; change identity_flags' `>= 2` to `>= 1` -> one 'no' flags.
 *
 * MET_ASK_AFTER_HOURS=0 so "did you meet" is due at once (the env knob exists for
 * walking the flow on a desk; here it is set before the module loads).
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

process.env.MET_ASK_AFTER_HOURS = '0';
const { pool, closeMatchPool, tenantSession, matchmakerSession } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { adminRoutes } = await import('../src/api/admin.js');
const { balance } = await import('../src/points/ledger.js');
const { checkinQuestions } = await import('../src/checkin/questions.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string; token: string }
async function person(label: string, over: Record<string, unknown> = {}): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`ci-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `ci-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 31, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: ['long_term'],
    in_pool: true, is_synthetic: false, sees_synthetic: true, display_name: label,
    traits: JSON.stringify({ lives_in: 'Bangalore' }),
    attribute_tags: ['interest:climbing', 'works_in:ai', 'religion:jain', 'interest:cooking', 'interest:chess'],
    ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map((k) => cols[k]));
  // The tags a reveal may show are the ones backed by a fact the person made shareable
  // (2026-09-28: publicTags, never the matching row's raw list). religion:jain has no
  // such fact, so it never reaches the reveal whatever the row holds.
  for (const [predicate, value] of [['interest', 'climbing'], ['works_in', 'ai'], ['interest', 'cooking'], ['interest', 'chess']]) {
    await tenantSession({ tenantId, userId }, (c) => commit(c, { tenantId, userId }, {
      predicate: predicate!, objectText: value!, objectValue: value, stance: 'asserted', originClass: 'owner',
      sourceQuote: value!, sourceEpisodeIds: [], disclosure: 'public',
      extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }));
  }
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

async function introduced(a: P, b: P): Promise<string> {
  const [lo, hi] = a.userId < b.userId ? [a, b] : [b, a];
  const r = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover, introduced_at)
     VALUES ($1,$2,$3,$4,5,'introduced',$1, now() - interval '1 hour') RETURNING id`,
    [lo.userId, hi.userId, lo.tenantId, hi.tenantId]);
  for (const who of [a, b]) {
    await owner.query(
      `INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, concern, human_says_yes, decided_at)
       VALUES ($1,$2,'h','c',true, now())`, [r.rows[0]!.id, who.userId]);
  }
  return r.rows[0]!.id;
}

const H = (me: P) => ({ Authorization: `Bearer ${me.token}`, 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.13' });
const getCheckin = async (me: P, id: string) => (await datingRoutes.request(`/v1/matches/${id}/checkin`, { headers: H(me) })).json() as Promise<{
  state: string; met: boolean | null; practice: boolean; again: boolean;
  questions: { key: string; text: string; identity: boolean }[]; whyNot: string[];
}>;
const post = (me: P, id: string, body: unknown) =>
  datingRoutes.request(`/v1/matches/${id}/checkin`, { method: 'POST', headers: H(me), body: JSON.stringify(body) });
const met = (me: P, id: string, yes: boolean) =>
  datingRoutes.request(`/v1/matches/${id}/met`, { method: 'POST', headers: H(me), body: JSON.stringify({ yes }) });

describe('the questions', () => {
  it('come only from the reveal: never a fact the reveal did not show', async () => {
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'] });
    const them = await person('them');
    // Two things the other person has that a check-in must never ask about: a
    // never-public fact, and a fact that is not on the reveal.
    await tenantSession(them, (c) => commit(c, them, {
      predicate: 'religion', objectText: 'Jain', objectValue: 'jain', stance: 'asserted', originClass: 'owner',
      sourceQuote: 'x', sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }));
    await tenantSession(them, (c) => commit(c, them, {
      predicate: 'works_at', objectText: 'Infosys', objectValue: 'infosys', stance: 'asserted', originClass: 'owner',
      sourceQuote: 'x', sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }));
    const id = await introduced(me, them);

    expect((await getCheckin(me, id)).state).toBe('ask_met');
    expect((await met(me, id, true)).status).toBe(200);
    const q = await getCheckin(me, id);
    expect(q.state).toBe('ask');
    expect(q.met).toBe(true);
    const keys = q.questions.map((x) => x.key);
    // No photos were visible, so no photos question; age, name, city, then two tags.
    expect(keys).toEqual(['age', 'name', 'city', 'tag:climbing', 'tag:ai']);
    const text = q.questions.map((x) => x.text).join(' ');
    expect(text).toContain('31');
    expect(text).toContain('them');
    expect(text).toContain('Bangalore');
    expect(text.toLowerCase()).not.toMatch(/jain|religion|infosys/);
    expect(q.questions.filter((x) => x.identity).map((x) => x.key)).toEqual(['age', 'name', 'city']);
  });

  it('are shaped by what was shown, and nothing else', () => {
    const qs = checkinQuestions({ name: 'Someone', age: null, livesIn: null, tags: ['interest:x', 'religion:y', 'works_in:z', 'interest:w'], photosVisible: true });
    // 'Someone' is the placeholder, not a name; no age, no city; the odd tag is skipped; two tags max.
    expect(qs.map((q) => q.key)).toEqual(['photos', 'tag:x', 'tag:z']);
    expect(checkinQuestions({ name: 'A', age: 20, livesIn: 'B', tags: [], photosVisible: false }).length).toBe(3);
  });
});

describe('the answers', () => {
  it('are checked against the questions, paid once, and the only thing that crosses is a mutual yes', async () => {
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'] });
    const them = await person('them');
    const id = await introduced(me, them);
    expect((await post(me, id, { answers: {}, feltSafe: true, seeAgain: true })).status).toBe(409);  // met first
    await met(me, id, true); await met(them, id, true);

    const bad = await post(me, id, { answers: { age: 'yes', name: 'yes', city: 'yes', 'tag:religion': 'no' }, feltSafe: true, seeAgain: true });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'unknown_question', key: 'tag:religion' });
    const missing = await post(me, id, { answers: { age: 'yes', city: 'yes' }, feltSafe: true, seeAgain: true });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'missing_answer', key: 'name' });

    const ok = await post(me, id, { answers: { age: 'yes', name: 'yes', city: 'unsure' }, feltSafe: true, seeAgain: true });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, awarded: 50, again: false });   // they have not answered yet
    expect((await post(me, id, { answers: { age: 'yes', name: 'yes', city: 'yes' }, feltSafe: true, seeAgain: true })).status).toBe(404);
    expect((await getCheckin(me, id)).state).toBe('done');

    // The other side never sees my row.
    const seen = await tenantSession(them, (db) => db.query('SELECT * FROM date_checkins WHERE rendezvous_id = $1', [id]));
    expect(seen.rows).toEqual([]);

    // Their yes makes it mutual, for both.
    const theirs = await post(them, id, { answers: { age: 'no', name: 'yes', city: 'yes' }, feltSafe: false, seeAgain: true });
    expect(await theirs.json()).toEqual({ ok: true, awarded: 50, again: true });
    expect((await getCheckin(me, id)).again).toBe(true);
    await tenantSession(me, async (db) => expect(await balance(db, me.userId)).toBe(60));   // 10 for met + 50
  });

  it('pay the same when they did not meet, and nothing for a practice pair', async () => {
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'] });
    const them = await person('them');
    const ghost = await person('ghost', { is_synthetic: true });
    const real = await introduced(me, them);
    const fake = await introduced(me, ghost);
    await met(me, real, false);
    const q = await getCheckin(me, real);
    expect(q.state).toBe('ask');
    expect(q.met).toBe(false);
    expect(q.whyNot).toContain('plans_fell_through');
    expect(await (await post(me, real, { whyNot: 'plans_fell_through' })).json()).toEqual({ ok: true, awarded: 50, again: false });
    const { rows } = await owner.query('SELECT met, answers, felt_safe, see_again FROM date_checkins WHERE rendezvous_id = $1', [real]);
    expect(rows[0]).toEqual({ met: false, answers: { why_not: 'plans_fell_through' }, felt_safe: null, see_again: null });

    await met(me, fake, true);
    expect(await (await post(me, fake, { answers: { age: 'yes', name: 'yes', city: 'yes' }, feltSafe: true, seeAgain: null })).json())
      .toEqual({ ok: true, awarded: 0, again: false });
  });
});

describe('what leaves the table', () => {
  it('confirmations count clean check-ins for entitled viewers; flags need two, and the desk only', async () => {
    const x = await person('x');
    const a = await person('a', { gender: 'man', seeking_gender: ['woman'] });
    const b = await person('b', { gender: 'man', seeking_gender: ['woman'] });
    const c = await person('c', { gender: 'man', seeking_gender: ['woman'] });
    const xa = await introduced(x, a); const xb = await introduced(x, b);
    await met(a, xa, true); await met(b, xb, true);
    await post(a, xa, { answers: { age: 'yes', name: 'yes', city: 'yes' }, feltSafe: true, seeAgain: null });
    const conf = (me: P) => tenantSession(me, async (db) => (await db.query<{ n: number }>('SELECT confirmations_of($1, $2) AS n', [x.userId, me.userId])).rows[0]!.n);
    expect(await conf(a)).toBe(1);
    expect(await conf(c), 'not entitled: the reveal rule excludes c').toBe(0);
    await post(b, xb, { answers: { age: 'no', name: 'yes', city: 'yes' }, feltSafe: true, seeAgain: null });
    expect(await conf(a), 'a no on an identity question does not confirm').toBe(1);

    // The desk: one 'no' on age is not a flag; two distinct people are.
    const flagged = () => matchmakerSession(async (db) =>
      (await db.query<{ about_user: string; no_age: number }>('SELECT about_user, no_age FROM identity_flags()')).rows.filter((r) => r.about_user === x.userId));
    expect(await flagged()).toEqual([]);
    const d = await person('d', { gender: 'man', seeking_gender: ['woman'] });
    const xd = await introduced(x, d);
    await met(d, xd, true);
    await post(d, xd, { answers: { age: 'no', name: 'yes', city: 'yes' }, feltSafe: true, seeAgain: null });
    expect(await flagged()).toEqual([{ about_user: x.userId, no_age: 2 }]);
    // Not the app's to call, and not a non-admin's to read.
    await expect(tenantSession(a, (db) => db.query('SELECT * FROM identity_flags()'))).rejects.toThrow(/permission denied/);
    expect((await adminRoutes.request('/v1/admin/flags', { headers: H(a) })).status).toBe(404);
  });
});
