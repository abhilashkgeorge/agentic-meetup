/**
 * Photos, and the only question that really matters about them: who can see one.
 *
 * A dating photo is the thing that identifies somebody in the street. It is also the
 * reveal itself -- showing it early would quietly undo the asymmetry the whole
 * introduction is built on, where whichever side receives more matches decides first
 * and alone. So the rule lives in the database, and the interesting cases here are all
 * the ones where somebody must see NOTHING.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import sharp from 'sharp';
import { pool, tenantSession, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import * as photos from '../src/photos/store.js';
import { decide } from '../src/matching/orchestrator.js';
import * as messages from '../src/messaging/store.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
let a = { tenantId: '', userId: '' };
let b = { tenantId: '', userId: '' };
let pairId = '';

async function person(label: string) {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`${label}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `${label}-${Math.random()}@example.test`]);
  return { tenantId, userId: u.rows[0]!.id };
}

/** A real JPEG with GPS in it, so the stripping is tested against the actual thing. */
function photoWithLocation(shade: number): Promise<Buffer> {
  return sharp({
    create: { width: 900, height: 1200, channels: 3, background: { r: shade, g: 90, b: 140 } },
  })
    .withExif({
      IFD0: { Make: 'TestPhone', Model: 'X' },
      GPS: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' },
    })
    .jpeg()
    .toBuffer();
}

/** Upload one, as that person. */
async function upload(who: { tenantId: string; userId: string }, shade = 120) {
  const bytes = await photoWithLocation(shade);
  return tenantSession(who, (c) => photos.add(c, who, bytes));
}

beforeAll(async () => {
  a = await person('shot');
  b = await person('seen');
});

beforeEach(async () => {
  const both = [a.userId, b.userId];
  await owner.query('DELETE FROM photos WHERE user_id = ANY($1)', [both]);
  await owner.query(
    'DELETE FROM blocks WHERE blocker_id = ANY($1) OR blocked_id = ANY($1)', [both]);
  await owner.query(
    'DELETE FROM rendezvous WHERE user_a = ANY($1) OR user_b = ANY($1)', [both]);
  for (const who of [a, b]) await photos.removeAllFiles(who.userId);

  // A pair the agents passed, briefs written, nobody has answered yet. `first_mover`
  // is the lower id, matching what the orchestrator writes.
  const [lo, hi] = a.userId < b.userId ? [a, b] : [b, a];
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, status, first_mover,
                             runs_done, both_yes, decided_at)
     VALUES ($1,$2,$3,$4,'decided',$5,5,4,now()) RETURNING id`,
    [lo.userId, hi.userId, lo.tenantId, hi.tenantId, lo.userId]);
  pairId = rows[0]!.id;
  for (const who of [a, b]) {
    await owner.query(
      `INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, concern)
       VALUES ($1,$2,'someone','something')`, [pairId, who.userId]);
  }
});

afterAll(async () => {
  for (const who of [a, b]) await photos.removeAllFiles(who.userId);
  for (const t of made) await owner.query('DELETE FROM tenants WHERE id = $1', [t]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('what happens to a picture on the way in', () => {
  it('keeps the photograph and throws the location away', async () => {
    // A phone photo carries where it was taken, to six decimal places. Handing that to
    // a stranger before you have met them is the worst thing this app could do with a
    // file, and it is the default behaviour of every camera.
    const original = await photoWithLocation(30);
    expect((await sharp(original).metadata()).exif, 'the fixture really does carry EXIF')
      .toBeDefined();

    const added = await tenantSession(a, (c) => photos.add(c, a, original));
    const stored = await photos.read(a.userId, added!.id, 'full');
    const meta = await sharp(stored!).metadata();

    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBeGreaterThan(100);
  });

  it('refuses a file that is not a picture', async () => {
    // Checking the first four bytes is not enough, and is not what this does: the file
    // is decoded, and anything that is not an image fails to decode.
    const notAnImage = Buffer.from('MZ '.repeat(500), 'binary');
    await expect(tenantSession(a, (c) => photos.add(c, a, notAnImage)))
      .rejects.toThrow(photos.BadImage);
  });

  it('makes a small one too, so a list does not pull six full photos', async () => {
    const added = await upload(a);
    const full = await photos.read(a.userId, added!.id, 'full');
    const thumb = await photos.read(a.userId, added!.id, 'thumb');
    expect(thumb!.byteLength).toBeLessThan(full!.byteLength);
  });

  it('stops at six', async () => {
    for (let i = 0; i < photos.MAX_PHOTOS; i++) {
      expect(await upload(a, 20 + i * 30), `photo ${i}`).not.toBeNull();
    }
    expect(await upload(a, 250)).toBeNull();
  });
});

describe('who can see them', () => {
  it('you can always see your own', async () => {
    await upload(a);
    expect(await tenantSession(a, (c) => photos.visibleTo(c, a.userId, a.userId)))
      .toHaveLength(1);
  });

  it('a stranger sees nothing', async () => {
    await upload(a);
    const stranger = await person('stranger');
    const seen = await tenantSession(stranger, (c) =>
      photos.visibleTo(c, a.userId, stranger.userId));
    // The same answer as "this person has no photos", so the endpoint cannot be used
    // to find out whether somebody exists.
    expect(seen).toEqual([]);
  });

  it('the second mover cannot see them before the first has said yes', async () => {
    // The photo IS the reveal. Arriving early, it would undo the order that stops one
    // side being buried -- using the part people actually look at.
    const [first, second] = a.userId < b.userId ? [a, b] : [b, a];
    await upload(first, 60);
    const early = await tenantSession(second, (c) =>
      photos.visibleTo(c, first.userId, second.userId));
    expect(early).toEqual([]);
  });

  it('the first mover cannot either -- not until the other has said yes to them', async () => {
    // CONSENT FIRST (the founder, 2026-09-28): nobody's photos reach anyone until THAT
    // person has said yes to them. The first mover decides on the words card alone.
    const [first, second] = a.userId < b.userId ? [a, b] : [b, a];
    await upload(second, 200);
    expect(await tenantSession(first, (c) => photos.visibleTo(c, second.userId, first.userId)),
      'the first mover saw photos of someone who had not said yes').toEqual([]);
    // Their own yes shares THEIR photos, not the other's.
    await decide(first.userId, pairId, true);
    expect(await tenantSession(first, (c) => photos.visibleTo(c, second.userId, first.userId))).toEqual([]);
    // The other's yes back is what shows them.
    await decide(second.userId, pairId, true);
    expect(await tenantSession(first, (c) => photos.visibleTo(c, second.userId, first.userId))).toHaveLength(1);
  });

  it('and the second mover can once the first says yes', async () => {
    const [first, second] = a.userId < b.userId ? [a, b] : [b, a];
    await upload(first, 60);
    await decide(first.userId, pairId, true);
    const seen = await tenantSession(second, (c) =>
      photos.visibleTo(c, first.userId, second.userId));
    expect(seen).toHaveLength(1);
  });

  it('blocking takes them back, both ways', async () => {
    const [first, second] = a.userId < b.userId ? [a, b] : [b, a];
    await upload(first, 60);
    await upload(second, 200);
    await decide(first.userId, pairId, true);
    await decide(second.userId, pairId, true);
    expect(await tenantSession(second, (c) =>
      photos.visibleTo(c, first.userId, second.userId))).toHaveLength(1);

    await tenantSession(second, (c) => messages.block(c, second.userId, first.userId));

    expect(await tenantSession(second, (c) =>
      photos.visibleTo(c, first.userId, second.userId))).toEqual([]);
    expect(await tenantSession(first, (c) =>
      photos.visibleTo(c, second.userId, first.userId))).toEqual([]);
  });

  it('somebody who was passed on cannot keep looking', async () => {
    // A no ends it. Their pictures are not a souvenir.
    const [first, second] = a.userId < b.userId ? [a, b] : [b, a];
    await upload(first, 60);
    await decide(first.userId, pairId, false);
    const seen = await tenantSession(second, (c) =>
      photos.visibleTo(c, first.userId, second.userId));
    expect(seen).toEqual([]);
  });
});

describe('order', () => {
  it('moving one to the front does not collide with what was there', async () => {
    // `position` is unique per person, so a naive update trips over the row already
    // holding the slot. Two passes through a scratch range, or this fails.
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await upload(a, 40 + i * 50))!.id);

    await tenantSession(a, (c) => photos.reorder(c, a.userId, [ids[2]!, ids[0]!, ids[1]!]));

    const after = await tenantSession(a, (c) => photos.mine(c, a.userId));
    expect(after.map((p) => p.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(after.map((p) => p.slot)).toEqual([0, 1, 2]);
  });

  it('deleting the middle one leaves the rest usable', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await upload(a, 40 + i * 50))!.id);

    await tenantSession(a, (c) => photos.remove(c, a.userId, ids[1]!));
    // The freed slot is reused rather than left as a hole the unique index trips on.
    expect(await upload(a, 250)).not.toBeNull();
    expect(await tenantSession(a, (c) => photos.mine(c, a.userId))).toHaveLength(3);
  });

  it('the file goes when the row does', async () => {
    const added = await upload(a);
    await tenantSession(a, (c) => photos.remove(c, a.userId, added!.id));
    expect(await photos.read(a.userId, added!.id, 'full')).toBeNull();
    expect(await photos.read(a.userId, added!.id, 'thumb')).toBeNull();
  });
});
