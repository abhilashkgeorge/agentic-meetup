/**
 * The photo check keeps a verdict and nothing else, pays once, and the badge means
 * "every photo you can see was in the last pass".
 *
 * The model is stubbed: `readFaces` answers from a script in the order the worker
 * asks (front frame, turned frame, then each photo), `similarity` is a dial. Nothing
 * here loads TensorFlow.
 *
 * Negative controls, run by hand and recorded in the commit: remove the `finally`
 * that deletes the frames -> "frames are gone even when the model throws" fails;
 * drop the `NOT (p.id = ANY (k.photo_ids))` clause from photos_checked -> the
 * "adding a photo takes the badge off" step fails.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { mkdir, readdir, writeFile, rm } from 'node:fs/promises';
import sharp from 'sharp';

const stub = vi.hoisted(() => ({
  faces: [] as Array<Array<{ embedding: number[]; yaw: number }> | Error>,
  sim: 0.9,
}));
vi.mock('../src/photos/face.js', () => ({
  faceCheckEnabled: () => true,
  MATCH_MIN: 0.5,
  readFaces: async () => {
    const next = stub.faces.shift();
    if (next instanceof Error) throw next;
    return next ?? [];
  },
  similarity: async () => stub.sim,
}));

process.env.FACE_CHECK = 'tfjs-node';
const { pool, closeMatchPool, tenantSession } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { runOneQueuedCheck } = await import('../src/photos/facecheck.js');
const photos = await import('../src/photos/store.js');
const { verifyRoutes } = await import('../src/api/verify.js');
const { balance } = await import('../src/points/ledger.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
const dirs: string[] = [];
vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string; token: string }
async function person(label: string): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`pc-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `pc-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  await owner.query(
    `INSERT INTO match_profile (user_id, tenant_id, age, gender, seeking_gender, lat, lon, max_distance_km, intent, in_pool, is_synthetic, sees_synthetic, display_name)
     VALUES ($1,$2,30,'woman',ARRAY['man'],12.97,77.59,50,ARRAY['long_term'],true,false,true,$3)`, [userId, tenantId, label]);
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  dirs.push(photos.checkDir(userId).replace(/\/_check$/, ''));
  return { tenantId, userId, token: mintToken(sessionId) };
}

/** A photo row with a file behind it (any bytes: the model is stubbed). */
async function photo(me: P, position: number): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO photos (tenant_id, user_id, position, width, height, bytes, sha256)
     VALUES ($1,$2,$3,10,10,3,'x') RETURNING id`, [me.tenantId, me.userId, position]);
  const id = rows[0]!.id;
  await mkdir(photos.checkDir(me.userId), { recursive: true });
  await writeFile(photos.pathFor(me.userId, id, 'full'), Buffer.from('photo'));
  return id;
}

/** A queued check with both frames on disk, the way the routes leave it. */
async function queued(me: P): Promise<string> {
  const id = await tenantSession(me, async (db) => (await db.query<{ id: string }>(
    `INSERT INTO photo_checks (tenant_id, user_id, status) VALUES ($1, $2, 'queued') RETURNING id`, [me.tenantId, me.userId])).rows[0]!.id);
  await mkdir(photos.checkDir(me.userId), { recursive: true });
  await writeFile(photos.framePath(me.userId, id, 'a'), Buffer.from('a'));
  await writeFile(photos.framePath(me.userId, id, 'b'), Buffer.from('b'));
  return id;
}

const frames = async (me: P) => (await readdir(photos.checkDir(me.userId)).catch(() => [] as string[])).filter((f) => f.endsWith('.jpg'));
const row = async (id: string) => (await owner.query<{ status: string; result: string | null; photo_ids: string[]; score: number | null }>(
  'SELECT status, result, photo_ids, score FROM photo_checks WHERE id = $1', [id])).rows[0]!;
const face = (yaw: number) => [{ embedding: [1, 0], yaw }];

describe('the worker', () => {
  it('passes a matching pair, keeps only the verdict, pays once', async () => {
    const me = await person('me');
    const p1 = await photo(me, 0);
    const id = await queued(me);
    stub.faces = [face(2), face(30), face(0)];   // front, turned, the photo
    stub.sim = 0.8;
    expect(await runOneQueuedCheck(id)).toBe(true);
    expect(await row(id)).toEqual({ status: 'done', result: 'match', photo_ids: [p1], score: 0.8 });
    expect(await frames(me)).toEqual([]);
    await tenantSession(me, async (db) => expect(await balance(db, me.userId)).toBe(30));
    // A second pass is not a second payment.
    const again = await queued(me);
    stub.faces = [face(2), face(30), face(0)];
    await runOneQueuedCheck(again);
    await tenantSession(me, async (db) => expect(await balance(db, me.userId)).toBe(30));
  });

  it('names each way a check can fail, and never keeps the frames', async () => {
    const me = await person('me');
    const none = await queued(me);
    stub.faces = [];
    await runOneQueuedCheck(none);
    expect((await row(none)).result).toBe('no_photos');
    expect(await frames(me)).toEqual([]);

    await photo(me, 0);
    const twoFaces = await queued(me);
    stub.faces = [[...face(0), ...face(0)], face(30), face(0)];
    await runOneQueuedCheck(twoFaces);
    expect((await row(twoFaces)).result).toBe('no_face');

    const notTurned = await queued(me);
    stub.faces = [face(2), face(5), face(0)];
    await runOneQueuedCheck(notTurned);
    expect((await row(notTurned)).result).toBe('not_live');

    const stranger = await queued(me);
    stub.faces = [face(2), face(30), face(0)];
    stub.sim = 0.2;
    await runOneQueuedCheck(stranger);
    // 0.2 fails the front/turned check first: two frames of different people is not live.
    expect((await row(stranger)).result).toBe('not_live');

    const broken = await queued(me);
    stub.faces = [new Error('model down')];
    await runOneQueuedCheck(broken);
    expect(await row(broken)).toMatchObject({ status: 'failed', result: 'error' });
    expect(await frames(me), 'frames are gone even when the model throws').toEqual([]);
    stub.sim = 0.9;
  });
});

describe('the badge', () => {
  it('is true for whoever may see the photos, and only while every photo was in the last pass', async () => {
    const me = await person('me');
    const them = await person('them');
    const nobody = await person('nobody');
    const [lo, hi] = me.userId < them.userId ? [me, them] : [them, me];
    const { rows: [rz] } = await owner.query<{ id: string }>(
      `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover, introduced_at)
       VALUES ($1,$2,$3,$4,5,'introduced',$1, now()) RETURNING id`, [lo.userId, hi.userId, lo.tenantId, hi.tenantId]);
    // Introduced means both said yes -- and since 0073 (consent first) it is each
    // person's own yes that shows their photos, so the fixture carries both.
    for (const who of [me, them]) {
      await owner.query(`INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, concern, human_says_yes, decided_at)
                         VALUES ($1,$2,'h','',true, now())`, [rz!.id, who.userId]);
    }
    const checked = (viewer: P) => tenantSession(viewer, async (db) =>
      (await db.query<{ v: boolean }>('SELECT photos_checked($1, $2) AS v', [me.userId, viewer.userId])).rows[0]!.v);

    await photo(me, 0);
    expect(await checked(them), 'no check yet').toBe(false);
    const first = await queued(me);
    stub.faces = [face(2), face(30), face(0)];
    await runOneQueuedCheck(first);
    expect(await checked(them)).toBe(true);
    expect(await checked(me), 'you may always ask about yourself').toBe(true);
    expect(await checked(nobody), 'the reveal rule excludes a stranger').toBe(false);

    await photo(me, 1);
    expect(await checked(them), 'a new photo takes the badge off').toBe(false);
    const second = await queued(me);
    stub.faces = [face(2), face(30), face(0), face(0)];
    await runOneQueuedCheck(second);
    expect(await checked(them)).toBe(true);
  });
});

describe('the routes', () => {
  it('take two frames, refuse a second check while one is open, and report the state', async () => {
    const me = await person('me');
    await photo(me, 0);
    const H = { Authorization: `Bearer ${me.token}`, 'x-forwarded-for': '203.0.113.14' };
    const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#888' } }).jpeg().toBuffer();
    const post = (path: string) => verifyRoutes.request(path, {
      method: 'POST', headers: { ...H, 'content-type': 'image/jpeg' }, body: new Uint8Array(jpeg),
    });
    const get = async () => (await verifyRoutes.request('/v1/photos/verify', { headers: H })).json() as Promise<{ status: string; result: string | null; covers: boolean }>;

    expect((await get()).status).toBe('none');
    const first = await post('/v1/photos/verify');
    expect(first.status).toBe(202);
    const { checkId } = await first.json() as { checkId: string };
    expect((await post('/v1/photos/verify')).status).toBe(409);
    expect(await frames(me)).toEqual([`${checkId}.a.jpg`]);
    expect((await get()).status).toBe('pending');

    const second = await post(`/v1/photos/verify/${checkId}`);
    expect(second.status).toBe(202);
    expect((await get()).status).toBe('queued');
    expect((await frames(me)).sort()).toEqual([`${checkId}.a.jpg`, `${checkId}.b.jpg`]);

    stub.faces = [face(2), face(30), face(0)];
    expect(await runOneQueuedCheck(checkId)).toBe(true);
    expect(await get()).toMatchObject({ status: 'done', result: 'match', covers: true });
    expect(await frames(me)).toEqual([]);
    // Not an image: refused before anything is written.
    const junk = await verifyRoutes.request('/v1/photos/verify', { method: 'POST', headers: { ...H, 'content-type': 'image/jpeg' }, body: 'nope' });
    expect(junk.status).toBe(400);
  });
});
