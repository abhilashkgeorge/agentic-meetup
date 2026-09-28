/**
 * A closed phone is woken for the four moments that cannot wait, and for nothing else.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-28, item 4): "push notifications for 'your
 * turn', 'introduced', new message, and 'fades today'".
 *
 * WHAT WAS WRONG: every event went down the app's socket and was lost when the app was
 * closed; only one waiting card shows at a time, so a second could run out its three
 * days unseen (docs/END-TO-END.md 15.3).
 *
 * WHAT IS PINNED HERE. The sender is stubbed (push/send.ts): nothing leaves this machine.
 *   - a phone registers its token for the person signed in; the same phone signing in
 *     as somebody else moves it; sign-out drops it; no other role can read the table;
 *   - a new card wakes whoever decides first; the first mover's yes wakes the other
 *     ("shared"); the second yes wakes the first mover ("introduced"); the person who
 *     tapped is never woken for their own tap;
 *   - "fades today" goes once per card, only to the person whose turn it is, never to
 *     a practice profile;
 *   - a burst of messages is one buzz; the lock screen never carries a name;
 *   - a message to somebody offline wakes them (SOURCE SHAPE for the socket path: driving
 *     chat.ts needs a live websocket pair, and the rule is one line -- comments stripped).
 *
 * Negative controls, run 2026-09-28, each restored byte-identical:
 *   - claim_push_token not moving the token (the DELETE line out of 0076, applied to the
 *     test database by hand and re-applied)  -> "moves to the new account" fails
 *   - decide() without its 'shared' wake       -> "the first yes wakes the other" fails
 *   - warnFading without the fade_warned_at test -> "once per card" fails
 *   - wake without the message quiet time        -> "one buzz" fails
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const sent = vi.hoisted(() => [] as { userId: string; kind: string; to: string[]; title: string; data: Record<string, string> }[]);
vi.mock('../src/push/send.js', () => ({
  deliver: async (pushes: { to: string; title: string; data: Record<string, string> }[], meta: { userId: string; kind: string }) => {
    sent.push({ userId: meta.userId, kind: meta.kind, to: pushes.map((p) => p.to), title: pushes[0]!.title, data: pushes[0]!.data });
    return pushes.map((p) => (p.to.includes('Dead') ? 'dead' : 'ok'));
  },
}));
vi.hoisted(() => {
  const DEFAULTED = ['RENDEZVOUS_RUNS', 'ROUND_CANDIDATES', 'DECIDE_MODEL', 'WEEKLY_REAL_EXPOSURE', 'AGENT_TALK',
                     'SYNTHETIC_AUTO_YES'];
  const original = process.loadEnvFile;
  const strip = () => { for (const k of DEFAULTED) delete process.env[k]; };
  process.loadEnvFile = ((...args: Parameters<typeof process.loadEnvFile>) => {
    try { original.apply(process, args); } finally { strip(); }
  }) as typeof process.loadEnvFile;
  strip();
  process.env.AGENT_TALK = 'off';
});
vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return { ...real, decideModel: () => null, llm: { ...real.llm, complete: async () => { throw new Error('no model call here'); } } };
});

const { env } = await import('../src/env.js');
const { pool, closeMatchPool } = await import('../src/db/client.js');
const { pushRoutes } = await import('../src/api/push.js');
const { decide, runRound } = await import('../src/matching/orchestrator.js');
const { wake, warnFading, PUSH_WORDS } = await import('../src/push/index.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 60_000 });
beforeEach(() => { sent.length = 0; });
afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string; token: string; device: string }
let n = 0;
async function person(label: string, over: Record<string, unknown> = {}): Promise<P> {
  const tag = `push-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: [tag], in_pool: false, is_synthetic: false, ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map((k) => cols[k]));
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
                     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  const device = `ExponentPushToken[test${Date.now()}x${n++}abcdef]`;
  return { tenantId, userId, token: mintToken(sessionId), device };
}
const H = (p: P) => ({ Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' });
const register = (p: P, device = p.device) =>
  pushRoutes.request('/v1/push/token', { method: 'POST', headers: H(p), body: JSON.stringify({ token: device, platform: 'android' }) });
const tokensOf = async (p: P) =>
  (await owner.query<{ token: string }>('SELECT token FROM push_tokens WHERE user_id = $1', [p.userId])).rows.map((r) => r.token);
/** An open card, `first` deciding first, with `hours` left on the clock. */
async function card(first: P, second: P, hours = 72, opts: { firstSaid?: boolean } = {}): Promise<string> {
  const [lo, hi] = first.userId < second.userId ? [first, second] : [second, first];
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover, answer_by)
     VALUES ($1,$2,$3,$4,0,'decided',$5, now() + make_interval(hours => $6)) RETURNING id`,
    [lo.userId, hi.userId, lo.tenantId, hi.tenantId, first.userId, hours]);
  for (const who of [first, second]) {
    await owner.query(`INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, concern, human_says_yes)
                       VALUES ($1,$2,'h','c',$3)`, [rows[0]!.id, who.userId, who === first && opts.firstSaid ? true : null]);
  }
  return rows[0]!.id;
}
const kindsFor = (p: P) => sent.filter((s) => s.userId === p.userId).map((s) => s.kind);

describe('a phone\'s token', () => {
  it('is kept for the person signed in, moves to the new account on the same phone, and goes at sign-out', async () => {
    const a = await person('a');
    const b = await person('b');
    expect((await register(a)).status).toBe(200);
    expect(await tokensOf(a)).toEqual([a.device]);
    expect((await register(b, a.device)).status, 'the same phone, now signed in as b').toBe(200);
    expect(await tokensOf(a), 'a\'s matches would wake b\'s lock screen').toEqual([]);
    expect(await tokensOf(b)).toEqual([a.device]);
    const drop = await pushRoutes.request('/v1/push/token', { method: 'DELETE', headers: H(b), body: JSON.stringify({ token: a.device }) });
    expect(drop.status).toBe(200);
    expect(await tokensOf(b)).toEqual([]);
    expect((await register(a, 'not-a-token')).status).toBe(400);
  });

  it('is readable by no role but the app\'s own rows', async () => {
    for (const role of ['clone_match', 'clone_matchmaker', 'clone_door', 'clone_discovery']) {
      const { rows } = await owner.query<{ ok: boolean }>("SELECT has_table_privilege($1, 'push_tokens', 'SELECT') AS ok", [role]);
      expect(rows[0]!.ok, role).toBe(false);
    }
  });
});

describe('the moments that wake a phone', () => {
  it('a new card wakes whoever decides first', async () => {
    const tag = `push-round-${Date.now()}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag], in_pool: true });
    const her = await person('her', { intent: [tag], in_pool: true });
    await register(me); await register(her);
    const r = await runRound(me.userId);
    expect(r.metAll).toEqual([her.userId]);
    const { rows } = await owner.query<{ first_mover: string; id: string }>(
      'SELECT id, first_mover FROM rendezvous WHERE (user_a = $1 AND user_b = $2) OR (user_a = $2 AND user_b = $1)', [me.userId, her.userId]);
    const first = rows[0]!.first_mover === me.userId ? me : her;
    const second = first === me ? her : me;
    await vi.waitFor(() => expect(kindsFor(first)).toEqual(['turn']));
    expect(kindsFor(second)).toEqual([]);
    expect(sent.find((s) => s.userId === first.userId)!.data).toEqual({ kind: 'turn', rendezvousId: rows[0]!.id });
  });

  it('the first yes wakes the other; the second yes wakes the first; nobody is woken for their own tap', async () => {
    const meera = await person('meera');
    const arjun = await person('arjun', { gender: 'man' });
    await register(meera); await register(arjun);
    const id = await card(meera, arjun);
    await decide(meera.userId, id, true);
    await vi.waitFor(() => expect(kindsFor(arjun)).toEqual(['shared']));
    expect(kindsFor(meera)).toEqual([]);
    await decide(arjun.userId, id, true);
    await vi.waitFor(() => expect(kindsFor(meera)).toEqual(['introduced']));
    expect(kindsFor(arjun), 'woken for his own tap').toEqual(['shared']);
  });

  it('a no wakes nobody', async () => {
    const x = await person('x');
    const y = await person('y', { gender: 'man' });
    await register(x); await register(y);
    const id = await card(x, y, 72, { firstSaid: true });
    await decide(y.userId, id, false);
    await new Promise((r) => setTimeout(r, 200));
    expect(sent).toEqual([]);
  });
});

describe('"a card fades today"', () => {
  it('goes once per card, only to the person whose turn it is, never to a practice profile', async () => {
    const mine = await person('fm1'); const theirs = await person('fm2', { gender: 'man' });
    const later = await person('fm3'); const other = await person('fm4', { gender: 'man' });
    const practice = await person('fm5', { is_synthetic: true }); const real = await person('fm6', { gender: 'man' });
    for (const p of [mine, theirs, later, other, practice, real]) await register(p);
    await card(mine, theirs, 12);                         // mine's turn, 12 hours left
    await card(later, other, 48);                         // two days left: not yet
    await card(real, practice, 12, { firstSaid: true });  // the practice profile's turn now
    await warnFading();
    expect(kindsFor(mine)).toEqual(['fades']);
    expect(kindsFor(theirs), 'woken for a card that is not their turn').toEqual([]);
    expect(kindsFor(later)).toEqual([]);
    expect(kindsFor(practice)).toEqual([]);
    sent.length = 0;
    await warnFading();
    expect(kindsFor(mine), 'warned twice for one card').toEqual([]);
  });
});

describe('what a push says, and how often', () => {
  it('a burst of messages is one buzz, and a dead token is forgotten', async () => {
    const p = await person('burst');
    await register(p);
    await register(p, 'ExponentPushToken[DeadDeadDeadDead]');
    const conversation = crypto.randomUUID();
    await wake(p.userId, 'message', conversation);
    await wake(p.userId, 'message', conversation);
    expect(kindsFor(p)).toEqual(['message']);
    expect(await tokensOf(p)).toEqual([p.device]);
  });

  it('never carries a name or anybody\'s words: fixed lines, one per kind', () => {
    expect(Object.keys(PUSH_WORDS).sort()).toEqual(['fades', 'introduced', 'message', 'shared', 'turn']);
    for (const w of Object.values(PUSH_WORDS)) expect(`${w.title} ${w.body}`).not.toMatch(/\$\{|%s/);
  });

  it('a message to somebody offline wakes them', () => {
    const said = (rel: string) => readFileSync(join(import.meta.dirname, '..', rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(said('src/api/chat.ts')).toContain("if (!online) void wake(pair.otherId, 'message', msg.rendezvousId);");
    expect(said('src/api/date-idea.ts')).toContain("void wake(found.otherId, 'message', id.data)");
  });
});
