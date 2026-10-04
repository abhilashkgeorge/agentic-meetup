/**
 * Two phones that do not exist, doing everything a real pair would.
 *
 * WHY A SCRIPT AND NOT A TEST. The unit tests call the functions; this calls the
 * SERVER -- real HTTP, real WebSockets, real row-level security, the same routes the
 * app hits. Almost every bug found in this system so far lived in the seam between
 * two things that each worked: a policy that refused a write the code assumed, a gate
 * that waited on a state only the other side could produce, a socket that closed when
 * the screen it belonged to went away. None of those are visible from inside a
 * function.
 *
 * It runs against a server that is already up, creates its own two people, and deletes
 * them at the end. Nothing it touches belongs to anybody.
 */
import { Pool } from 'pg';
import WebSocket from 'ws';
import sharp from 'sharp';
import { env } from '../src/env.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:8000';
const WS_BASE = BASE.replace(/^http/, 'ws');
const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

let failures = 0;
const pass = (what: string) => console.log(`  ok    ${what}`);
const fail = (what: string, detail?: unknown) => {
  failures++;
  console.log(`  FAIL  ${what}${detail === undefined ? '' : `\n        ${JSON.stringify(detail)}`}`);
};
const check = (cond: boolean, what: string, detail?: unknown) =>
  cond ? pass(what) : fail(what, detail);
const step = (title: string) => console.log(`\n${title}`);

async function api<T>(
  path: string, token: string | null, init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

const post = <T>(path: string, token: string | null, body: unknown) =>
  api<T>(path, token, { method: 'POST', body: JSON.stringify(body) });

/** One fake phone: a credential, a socket, and everything the socket was told. */
class Phone {
  token = '';
  userId = '';
  ws: WebSocket | null = null;
  inbox: Record<string, unknown>[] = [];

  constructor(readonly name: string) {}

  async signUp(): Promise<void> {
    const { body } = await post<{ token: string }>('/v1/auth/device', null, { label: this.name });
    if (!body?.token) throw new Error(`${this.name}: no token — is ALLOW_DEVICE_SIGNUP=true?`);
    this.token = body.token;
  }

  essential(predicate: string, value: unknown) {
    return post('/v1/essentials', this.token, { predicate, value });
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_BASE}/v1/chat`, ['bearer', this.token]);
      this.ws = ws;
      ws.on('message', (raw) => this.inbox.push(JSON.parse(String(raw))));
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'hello', sessionId: crypto.randomUUID(), lastSeenTurnId: null }));
        resolve();
      });
      ws.on('error', reject);
    });
  }

  /** Upload one picture, the way the phone does: multipart, one file. */
  async upload(bytes: Buffer, name = 'photo.jpg'): Promise<{ status: number; body: any }> {
    const form = new FormData();
    form.append('photo', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), name);
    const res = await fetch(`${BASE}/v1/photos`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}` },
      body: form,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  send(msg: unknown) { this.ws?.send(JSON.stringify(msg)); }
  close() { this.ws?.close(); this.ws = null; }

  /** Wait for an event of a given type, or give up. Sockets are not synchronous. */
  async waitFor(
    type: string, matches: (e: Record<string, unknown>) => boolean = () => true, ms = 4000,
  ): Promise<Record<string, unknown> | null> {
    const until = Date.now() + ms;
    for (;;) {
      const found = this.inbox.find((e) => e.type === type && matches(e));
      if (found) return found;
      if (Date.now() > until) return null;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  seen(type: string): Record<string, unknown>[] {
    return this.inbox.filter((e) => e.type === type);
  }
}

const a = new Phone('alpha-e2e');
const b = new Phone('beta-e2e');
let conversation = '';

try {
  // ───────────────────────────────────────────────────────── sign up
  step('1. two phones install the app');
  await a.signUp();
  await b.signUp();
  check(Boolean(a.token && b.token && a.token !== b.token), 'each gets its own credential');

  const unauth = await api('/v1/conversations', null);
  check(unauth.status === 401, 'no credential, no conversations', unauth.status);

  const wrong = await api('/v1/conversations', 'not-a-token');
  check(wrong.status === 401, 'a forged credential is refused', wrong.status);

  // ───────────────────────────────────────────────────── onboarding
  const stranger0 = new Phone('nosy-e2e');
  await stranger0.signUp();

  step('2. onboarding — everything an agent cannot go out without');
  // Consent, the five essentials, and the five core cards: the whole pool condition
  // (matching/profile.ts). This helper used to post the essentials alone. Consent and
  // then the cards each became a condition without it learning, so both phones stayed
  // out of the pool and every round below stopped at "agent is not ready to go out
  // yet". The cards come from the server's own list, so a renamed card cannot strand
  // it again; each is "Prefer not to say" and "Anyone is fine", which writes no rule.
  const { CORE } = await import('../src/onboarding/questions.js');
  const essentials = async (p: Phone, gender: string, seeking: string, year: number) => {
    const owed = await api<{ required: { document: string; version: string }[] }>('/v1/consent', p.token);
    await post('/v1/consent', p.token, {
      accept: owed.body.required.map(({ document, version }) => ({ document, version })),
    });
    await p.essential('gender', gender);
    await p.essential('seeking_gender', seeking);
    await p.essential('birth_date', String(year));
    await p.essential('lives_in', 'Bangalore');
    await p.essential('relationship_intent', 'long_term');
    for (const questionId of CORE) {
      const r = await post('/v1/interview/answer', p.token, { questionId, values: [], whoFine: { anyone: true } });
      if (r.status !== 200) fail(`${p.name}: card ${questionId} refused`, r.body);
    }
  };
  await essentials(a, 'man', 'woman', 1994);
  await essentials(b, 'woman', 'man', 1996);

  const poolA = await api<{ inPool: boolean; missing: string[] }>('/v1/pool', a.token);
  check(poolA.body.inPool === true, 'the agent is allowed out once everything is answered',
    poolA.body.missing);

  // Half an answer is no answer: the agent stays in until every one is known.
  const half = new Phone('half-e2e');
  await half.signUp();
  await half.essential('gender', 'woman');
  await half.essential('lives_in', 'Bangalore');
  const poolHalf = await api<{ inPool: boolean; missing: string[] }>('/v1/pool', half.token);
  check(poolHalf.body.inPool === false, 'four out of five is the same as none',
    poolHalf.body.missing);
  await api('/v1/me?confirm=delete-everything', half.token, { method: 'DELETE' }).catch(() => {});

  // Things worth talking about, so the pair is not two blank profiles.
  for (const i of ['climbing', 'cooking', 'live music']) await a.essential('interest', i);
  for (const i of ['climbing', 'cooking', 'pottery']) await b.essential('interest', i);
  await a.essential('works_in', 'software');
  await b.essential('works_in', 'design');

  // ─────────────────────────────────────────── they can see each other
  step('3. the filters');
  const ids = await owner.query<{ user_id: string }>(
    'SELECT user_id FROM match_profile WHERE user_id = ANY($1::uuid[]) AND in_pool',
    [[await userIdOf(a), await userIdOf(b)]],
  );
  check(ids.rowCount === 2, 'both are in the pool');

  // ───────────────────────────────────────────────────────── photos
  step('4. photos');
  const withGps = await sharp({
    create: { width: 900, height: 1200, channels: 3, background: { r: 40, g: 110, b: 160 } },
  })
    // Cast because sharp's `Exif` type names only IFD0/IFD1/IFD2/IFD3 and not GPS,
    // while libvips writes the GPS block perfectly well -- and a GPS block is exactly
    // what this check needs the upload path to strip. The runtime behaviour is the
    // assertion; the type is just behind its own library.
    .withExif({
      IFD0: { Make: 'TestPhone' },
      GPS: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' },
    } as unknown as Parameters<ReturnType<typeof sharp>["withExif"]>[0])
    .jpeg()
    .toBuffer();

  const up = await a.upload(withGps);
  check(up.status === 201 && Boolean(up.body?.id), 'a picture uploads', up.status);
  await b.upload(withGps);

  const mine = await api<{ me: string; photos: { id: string }[] }>('/v1/photos', a.token);
  check(mine.body.photos.length === 1, 'and shows up as theirs');

  const photoId = mine.body.photos[0]!.id;
  const own = await fetch(`${BASE}/v1/photos/${await userIdOf(a)}/${photoId}`, {
    headers: { authorization: `Bearer ${a.token}` },
  });
  const ownBytes = Buffer.from(await own.arrayBuffer());
  check(own.status === 200 && ownBytes.byteLength > 1000, 'the owner can fetch the bytes',
    own.status);
  check((await sharp(ownBytes).metadata()).exif === undefined,
    'and the location it was taken at is gone');

  const noAuth = await fetch(`${BASE}/v1/photos/${await userIdOf(a)}/${photoId}`);
  check(noAuth.status === 401, 'the bytes are not at a public address', noAuth.status);

  const notAnImage = await a.upload(Buffer.from('MZ'.repeat(800), 'binary'));
  check(notAnImage.status === 400, 'a file that is not a picture is refused',
    notAnImage.status);

  const strangerSees = await api<{ photos: unknown[] }>(
    `/v1/photos/of/${await userIdOf(a)}`, stranger0.token);
  check(strangerSees.body.photos.length === 0, 'a stranger sees none of them');
  const strangerBytes = await fetch(`${BASE}/v1/photos/${await userIdOf(a)}/${photoId}`, {
    headers: { authorization: `Bearer ${stranger0.token}` },
  });
  check(strangerBytes.status === 404, 'and cannot fetch one by id either',
    strangerBytes.status);

  // ────────────────────────────────────── the agents meet, the briefs land
  step('5. the agents meet');
  const met = await runRoundFor(a);
  check(Boolean(met.rendezvousId), 'a rendezvous exists', met);
  conversation = met.rendezvousId;
  check(met.briefs === 2, 'both people got a brief', met);

  const matchesA = await api<{ matches: { id: string; waitingOnYou: boolean; headline: string }[] }>(
    '/v1/matches', a.token);
  check(matchesA.body.matches.length === 1, 'the match shows up on the first phone',
    matchesA.body.matches.length);
  check(Boolean(matchesA.body.matches[0]?.headline), 'the card says something about them',
    matchesA.body.matches[0]);

  // ───────────────────────────────────────────── the reveal, in order
  // SINCE 2026-09-28 nobody sees a name or a photo before the other person shares them:
  // the first mover decides on the card alone, and a yes shares their profile with the
  // second, whose yes shares theirs back (docs/end-to-end/09-deciding.md). This step
  // still asserted the old order -- the first mover looking first -- until 2026-10-04.
  step('6. the reveal — each decides on the card; a yes shares your profile');
  const firstMover = await owner.query<{ first_mover: string }>(
    'SELECT first_mover FROM rendezvous WHERE id = $1', [conversation]);
  const firstId = firstMover.rows[0]!.first_mover;
  const [first, second] = (await userIdOf(a)) === firstId ? [a, b] : [b, a];

  const early = await api<{ waiting: boolean }>(`/v1/matches/${conversation}`, second.token);
  check(early.body.waiting === true, 'the second person cannot see them yet', early.body);

  const firstLook = await api<{ waiting: boolean; name?: string }>(
    `/v1/matches/${conversation}`, first.token);
  check(firstLook.body.waiting === true && !firstLook.body.name,
    'the first mover decides on the card: no name yet', firstLook.body);

  const secondSees = await api<{ photos: unknown[] }>(
    `/v1/photos/of/${await userIdOf(first)}`, second.token);
  check(secondSees.body.photos.length === 0,
    'the second person cannot see their photos yet either', secondSees.body);

  const firstSees = await api<{ photos: unknown[] }>(
    `/v1/photos/of/${await userIdOf(second)}`, first.token);
  check(firstSees.body.photos.length === 0, 'and the first mover cannot see theirs', firstSees.body);

  const stranger = stranger0;
  const peek = await api(`/v1/matches/${conversation}`, stranger.token);
  check(peek.status === 404, 'a stranger holding the id sees nothing', peek.status);
  const peekMsgs = await api<{ messages?: unknown[] }>(
    `/v1/conversations/${conversation}/messages`, stranger.token);
  check(peekMsgs.status === 404 && !peekMsgs.body.messages, 'and no messages either', peekMsgs.body);

  // ──────────────────────────────────────── nobody can write yet
  step('7. no messages before both have said yes');
  await first.connect();
  await second.connect();
  const early1 = crypto.randomUUID();
  first.send({ type: 'dm.send', messageId: early1, rendezvousId: conversation, text: 'hello?' });
  const rejected = await first.waitFor('dm.rejected', (e) => e.messageId === early1);
  check(Boolean(rejected), 'the send is refused', rejected);
  check(second.seen('dm.message').length === 0, 'and the other person is never shown it');

  // ────────────────────────────────────────────── both say yes
  step('8. both say yes');
  const yes1 = await post<{ introduced: boolean }>(
    `/v1/matches/${conversation}/decide`, first.token, { yes: true });
  check(yes1.body.introduced === false, 'one yes is not an introduction', yes1.body);

  const nowVisible = await api<{ waiting: boolean; name: string }>(
    `/v1/matches/${conversation}`, second.token);
  check(nowVisible.body.waiting === false, 'now the second person can look', nowVisible.body);
  const sharedOneWay = await api<{ photos: unknown[] }>(
    `/v1/photos/of/${await userIdOf(second)}`, first.token);
  check(sharedOneWay.body.photos.length === 0, 'but the first mover still cannot see theirs', sharedOneWay.body);

  const yes2 = await post<{ introduced: boolean }>(
    `/v1/matches/${conversation}/decide`, second.token, { yes: true });
  check(yes2.body.introduced === true, 'two yeses open the conversation', yes2.body);

  const nowSees = await api<{ photos: unknown[] }>(
    `/v1/photos/of/${await userIdOf(first)}`, second.token);
  check(nowSees.body.photos.length === 1, 'and now the second person can see their photos');
  const backAgain = await api<{ photos: unknown[] }>(
    `/v1/photos/of/${await userIdOf(second)}`, first.token);
  check(backAgain.body.photos.length === 1, 'and the first mover theirs', backAgain.body);

  const convs = await api<{ conversations: { id: string; name: string; photoId: string | null }[] }>(
    '/v1/conversations', a.token);
  check(convs.body.conversations[0]?.id === conversation, 'it appears in the inbox');
  check(Boolean(convs.body.conversations[0]?.name), 'with a name, not a uuid',
    convs.body.conversations[0]);
  check(Boolean(convs.body.conversations[0]?.photoId), 'and a face');

  // ────────────────────────────────────────────────── the chat
  step('9. the chat');
  a.inbox = []; b.inbox = [];
  const m1 = crypto.randomUUID();
  a.send({ type: 'dm.send', messageId: m1, rendezvousId: conversation, text: 'hey — climbing where?' });

  const echo = await a.waitFor('dm.message', (e) => (e.message as { id: string }).id === m1);
  check(Boolean(echo), 'the sender gets it back with a sequence number', echo);
  const arrived = await b.waitFor('dm.message', (e) => (e.message as { id: string }).id === m1);
  check(Boolean(arrived), 'the other phone receives it');
  check((arrived?.message as { text: string })?.text === 'hey — climbing where?',
    'with the right words');

  const delivered = await a.waitFor('dm.receipt',
    (e) => e.state === 'delivered' && (e.messageIds as string[]).includes(m1));
  check(Boolean(delivered), 'and the sender is told it was delivered');

  b.send({ type: 'dm.read', rendezvousId: conversation });
  const read = await a.waitFor('dm.receipt',
    (e) => e.state === 'read' && (e.messageIds as string[]).includes(m1));
  check(Boolean(read), 'and told when it was read');

  b.send({ type: 'dm.typing', rendezvousId: conversation, typing: true });
  const typing = await a.waitFor('dm.typing', (e) => e.typing === true);
  check(Boolean(typing), 'typing shows on the other side');

  // The retry case. Same id, because the phone generated it.
  const before = (await api<{ messages: unknown[] }>(
    `/v1/conversations/${conversation}/messages`, a.token)).body.messages.length;
  a.send({ type: 'dm.send', messageId: m1, rendezvousId: conversation, text: 'hey — climbing where?' });
  await new Promise((r) => setTimeout(r, 600));
  const after = (await api<{ messages: unknown[] }>(
    `/v1/conversations/${conversation}/messages`, a.token)).body.messages.length;
  check(before === after, 'sending the same message twice writes it once', { before, after });

  // ─────────────────────────────────────────────── offline
  step('10. offline');
  b.close();
  await new Promise((r) => setTimeout(r, 300));
  const m2 = crypto.randomUUID();
  a.inbox = [];
  a.send({ type: 'dm.send', messageId: m2, rendezvousId: conversation, text: 'sent while you were away' });
  await a.waitFor('dm.message', (e) => (e.message as { id: string }).id === m2);
  const noReceipt = a.seen('dm.receipt').some(
    (e) => e.state === 'delivered' && (e.messageIds as string[]).includes(m2));
  check(!noReceipt, 'a message to a phone that is off is not marked delivered');

  b.inbox = [];
  await b.connect();
  const history = await api<{ messages: { id: string }[] }>(
    `/v1/conversations/${conversation}/messages`, b.token);
  check(history.body.messages.some((m) => m.id === m2), 'it is waiting when they come back');

  const unread = await api<{ conversations: { unread: number }[] }>('/v1/conversations', b.token);
  check((unread.body.conversations[0]?.unread ?? 0) > 0, 'and shows as unread',
    unread.body.conversations[0]);

  // ─────────────────────────────────────────────── order
  step('11. order');
  a.inbox = []; b.inbox = [];
  const many = Array.from({ length: 5 }, () => crypto.randomUUID());
  many.forEach((id, i) =>
    a.send({ type: 'dm.send', messageId: id, rendezvousId: conversation, text: `m${i}` }));
  await new Promise((r) => setTimeout(r, 1200));
  const thread = await api<{ messages: { text: string; seq: string }[] }>(
    `/v1/conversations/${conversation}/messages`, b.token);
  const seqs = thread.body.messages.map((m) => Number(m.seq));
  check(seqs.every((s, i) => i === 0 || s > seqs[i - 1]!), 'every message has its own place', seqs);
  check(new Set(seqs).size === seqs.length, 'and no two share one');

  // ─────────────────────────────────────────────── blocking
  step('12. making somebody stop');
  const otherId = (await api<{ conversations: { otherId: string }[] }>(
    '/v1/conversations', b.token)).body.conversations[0]!.otherId;
  await post('/v1/block', b.token, { userId: otherId });

  a.inbox = [];
  const blocked = crypto.randomUUID();
  a.send({ type: 'dm.send', messageId: blocked, rendezvousId: conversation, text: 'still there?' });
  const refused = await a.waitFor('dm.rejected', (e) => e.messageId === blocked);
  check(Boolean(refused), 'the blocked person cannot send', refused);
  check(!(refused?.reason as string)?.includes('block'),
    'and is not told they were blocked', refused?.reason);

  const blockedPhotos = await api<{ photos: unknown[] }>(
    `/v1/photos/of/${await userIdOf(a)}`, b.token);
  check(blockedPhotos.body.photos.length === 0, 'and their photos go with it');

  const goneA = await api<{ conversations: unknown[] }>('/v1/conversations', a.token);
  const goneB = await api<{ conversations: unknown[] }>('/v1/conversations', b.token);
  check(goneA.body.conversations.length === 0, 'the conversation disappears for them');
  check(goneB.body.conversations.length === 0, 'and for the person who blocked');

  // ─────────────────────────────────────────────── erasure
  step('13. deleting an account');
  const aId = await userIdOf(a);
  const unconfirmed = await api('/v1/me', a.token, { method: 'DELETE' });
  check(unconfirmed.status === 400, 'deleting an account needs the intent spelled out',
    unconfirmed.status);

  const erased = await api<{ verified: boolean; remaining: string[] }>(
    '/v1/me?confirm=delete-everything', a.token, { method: 'DELETE' });
  check(erased.body?.verified === true, 'erasure verifies itself', erased.body);

  const leftovers = await owner.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM messages WHERE sender_id = $1)
          + (SELECT count(*) FROM facts WHERE user_id = $1)
          + (SELECT count(*) FROM rendezvous WHERE user_a = $1 OR user_b = $1)
          + (SELECT count(*) FROM blocks WHERE blocker_id = $1 OR blocked_id = $1) AS n`,
    [aId],
  );
  check(Number(leftovers.rows[0]!.n) === 0, 'nothing of theirs is left', leftovers.rows[0]);

  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  check(!existsSync(join(env.PHOTO_DIR, aId)), 'their pictures are off the disk');

  const afterErase = await api('/v1/conversations', a.token);
  check(afterErase.status === 401, 'their credential stops working', afterErase.status);
} catch (err) {
  fail('the run itself threw', err instanceof Error ? err.message : err);
} finally {
  a.close(); b.close();
  await cleanup();
  await owner.end();
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

// ────────────────────────────────────────────────────────────── helpers

async function userIdOf(p: Phone): Promise<string> {
  if (p.userId) return p.userId;
  const sessionId = p.token.split('.')[0];
  const { rows } = await owner.query<{ user_id: string }>(
    'SELECT user_id FROM device_sessions WHERE id = $1', [sessionId]);
  p.userId = rows[0]!.user_id;
  return p.userId;
}

/**
 * Run the agents, and make sure a brief exists either way.
 *
 * The verdict is REAL -- five conversations, counted honestly. But two brand-new
 * profiles usually fail the bar, and this script is testing the plumbing after the
 * verdict rather than the verdict itself, so when the pair lapses the briefs are
 * written anyway and the run says so out loud.
 */
async function runRoundFor(p: Phone): Promise<{ rendezvousId: string; briefs: number; passed: boolean }> {
  const { runRound } = await import('../src/matching/orchestrator.js');
  const { cardFacts, composeBoth, loadQuotes, saveBriefs } = await import('../src/matching/brief.js');
  const { publicTags } = await import('../src/matching/rendezvous.js');
  const { matchmakerSession } = await import('../src/db/client.js');

  const me = await userIdOf(p);
  const result = await runRound(me);
  const { rows } = await owner.query<{ id: string; user_a: string; user_b: string; tenant_a: string; tenant_b: string }>(
    `SELECT id, user_a, user_b, tenant_a, tenant_b FROM rendezvous
      WHERE user_a = $1 OR user_b = $1 ORDER BY created_at DESC LIMIT 1`, [me]);
  const r = rows[0];
  if (!r) throw new Error(`no rendezvous: ${result.skipped ?? 'unknown'}`);

  console.log(`  (agents: ${result.bothYes}/${result.runs} both-yes, passed=${result.passed})`);

  let briefs = Number(
    (await owner.query('SELECT count(*) AS n FROM rendezvous_briefs WHERE rendezvous_id = $1',
      [r.id])).rows[0].n,
  );

  if (briefs < 2) {
    console.log('  (pair did not clear the bar — writing the briefs anyway to test the rest)');
    const x = { userId: r.user_a, tenantId: r.tenant_a };
    const y = { userId: r.user_b, tenantId: r.tenant_b };
    const [qx, qy] = [await loadQuotes(x), await loadQuotes(y)];
    await matchmakerSession(async (c) => {
      const made = composeBoth(
        { card: await cardFacts(c, x.userId), tags: await publicTags(c, x.userId), quotes: qx },
        { card: await cardFacts(c, y.userId), tags: await publicTags(c, y.userId), quotes: qy });
      await saveBriefs(c, r.id, x, y, made);
      await c.query(
        `UPDATE rendezvous SET status = 'decided', decided_at = coalesce(decided_at, now())
          WHERE id = $1`, [r.id]);
    });
    briefs = Number(
      (await owner.query('SELECT count(*) AS n FROM rendezvous_briefs WHERE rendezvous_id = $1',
        [r.id])).rows[0].n,
    );
  }

  return { rendezvousId: r.id, briefs, passed: result.passed };
}

/**
 * Everything this script made, and nothing else.
 *
 * The FILES as well as the rows: deleting a tenant takes the photo rows with it and
 * leaves the pictures on disk, which is the same bug erasure had.
 */
async function cleanup(): Promise<void> {
  const { rows } = await owner.query<{ user_id: string }>(
    `SELECT user_id FROM device_sessions WHERE label LIKE '%-e2e'`,
  );
  const { removeAllFiles } = await import('../src/photos/store.js');
  for (const r of rows) await removeAllFiles(r.user_id);

  await owner.query(
    `DELETE FROM tenants WHERE id IN (
       SELECT tenant_id FROM app_users WHERE email LIKE '%@device.local' AND id IN (
         SELECT user_id FROM device_sessions WHERE label LIKE '%-e2e'))`,
  );
}
