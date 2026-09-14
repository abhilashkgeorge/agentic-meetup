/**
 * Photos: the bytes, and what is done to them on the way in.
 *
 * EVERY UPLOAD IS RE-ENCODED, and that is the security model rather than a nicety:
 *
 *   EXIF GOES.   A phone photo carries the GPS coordinates of where it was taken.
 *                Somebody's bedroom, to six decimal places, handed to a stranger
 *                before they have met. sharp drops all metadata unless asked to keep
 *                it, and `.rotate()` bakes the orientation in first so the picture
 *                still comes out the right way up.
 *   PAYLOADS GO. A file can be a valid JPEG and a valid archive at once, and can
 *                carry a script in a comment segment. Decoding to raw pixels and
 *                writing a fresh JPEG destroys anything that was not a picture --
 *                which no amount of checking the first four bytes can do.
 *   BOMBS STOP.  A 200-megapixel PNG that compresses to 40KB will otherwise take the
 *                process down. The pixel limit refuses it before decoding.
 *
 * The files sit on disk under a directory, named by id, with no extension guessing
 * and no user-supplied filename anywhere near the path. They are never served from a
 * static route -- see the endpoint.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { PoolClient } from 'pg';
import { env } from '../env.js';

/** What a person may have. More than six is a portfolio, not a profile. */
export const MAX_PHOTOS = 6;

/** Bigger than any phone photo needs to be after the client resizes it. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** A decompression-bomb guard: refuse before decoding, not after. */
const MAX_PIXELS = 40_000_000;

/** Long edge. Enough for a full-screen photo on a dense phone, and no more. */
const FULL_EDGE = 1440;
const THUMB_EDGE = 400;

export type Size = 'full' | 'thumb';

export interface StoredPhoto {
  id: string;
  slot: number;
  width: number;
  height: number;
  /** Taken down by a reviewer. Only ever true on the owner's own listing. */
  hidden?: boolean;
}

export class BadImage extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadImage';
  }
}

const dirFor = (userId: string) => join(env.PHOTO_DIR, userId);
const fileFor = (userId: string, photoId: string, size: Size) =>
  join(dirFor(userId), `${photoId}.${size}.jpg`);

/**
 * Decode, strip, resize, re-encode. Returns the two files to write.
 *
 * JPEG out, always, whatever came in. One format on disk means one decoder path when
 * serving, and the serving path is the one a stranger can reach.
 */
async function process(input: Buffer): Promise<{
  full: Buffer; thumb: Buffer; width: number; height: number;
}> {
  let meta;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    throw new BadImage('that file is not an image we can read');
  }
  if (!meta.width || !meta.height) throw new BadImage('that file is not an image we can read');
  if (!['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff'].includes(meta.format ?? '')) {
    throw new BadImage('use a JPEG, PNG or WebP');
  }

  // .rotate() with no argument applies the EXIF orientation and then forgets it. Doing
  // it any other way produces the sideways-photo bug every app has shipped once.
  const base = () => sharp(input, { limitInputPixels: MAX_PIXELS }).rotate();

  const full = await base()
    .resize(FULL_EDGE, FULL_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const thumb = await base()
    .resize(THUMB_EDGE, THUMB_EDGE, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();

  return { full: full.data, thumb, width: full.info.width, height: full.info.height };
}

/**
 * Add one photo. Returns null when the person is already at the limit.
 *
 * The row is written first and the files second. A failure in between leaves a row
 * pointing at nothing, which the serving endpoint treats as a missing photo. The other
 * order would leave a file nothing knows about -- and files nobody can account for are
 * how a deletion request quietly fails.
 */
export async function add(
  c: PoolClient,
  ctx: { tenantId: string; userId: string },
  input: Buffer,
): Promise<StoredPhoto | null> {
  if (input.byteLength > MAX_UPLOAD_BYTES) throw new BadImage('that picture is too big');

  const { rows: taken } = await c.query<{ position: number }>(
    'SELECT position FROM photos WHERE user_id = $1 ORDER BY position', [ctx.userId]);
  if (taken.length >= MAX_PHOTOS) return null;

  // First free slot, so deleting the second of three and adding one fills the hole
  // rather than leaving a gap the unique index would later trip over.
  const used = new Set(taken.map((t) => t.position));
  let slot = 0;
  while (used.has(slot)) slot++;

  const { full, thumb, width, height } = await process(input);
  const sha256 = createHash('sha256').update(full).digest('hex');

  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO photos (tenant_id, user_id, position, width, height, bytes, sha256)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [ctx.tenantId, ctx.userId, slot, width, height, full.byteLength, sha256],
  );
  const id = rows[0]!.id;

  await mkdir(dirFor(ctx.userId), { recursive: true });
  await writeFile(fileFor(ctx.userId, id, 'full'), full);
  await writeFile(fileFor(ctx.userId, id, 'thumb'), thumb);

  return { id, slot, width, height };
}

/** Somebody's own photos. */
export async function mine(c: PoolClient, userId: string): Promise<StoredPhoto[]> {
  const { rows } = await c.query<{
    id: string; position: number; width: number; height: number; hidden: boolean;
  }>(
    `SELECT id, position, width, height, (hidden_at IS NOT NULL) AS hidden
       FROM photos WHERE user_id = $1 ORDER BY position`,
    [userId],
  );
  // The owner is TOLD when one of theirs has been taken down. Silently continuing to
  // show somebody their own hidden photograph, while nobody else can see it, is the
  // kind of quiet dishonesty that makes people distrust everything else on the
  // screen -- and they cannot appeal a decision they were never shown.
  return rows.map((r) => ({
    id: r.id, slot: r.position, width: r.width, height: r.height, hidden: r.hidden,
  }));
}

/**
 * Somebody else's, if this viewer is allowed them yet.
 *
 * The rule lives in the database (migration 0032) and mirrors the reveal exactly: a
 * photo IS the reveal, and showing it early would undo the asymmetry the introduction
 * is built on. An empty list is also the answer for "no permission", so the two cases
 * cannot be told apart from outside.
 */
export async function visibleTo(
  c: PoolClient,
  owner: string,
  viewer: string,
): Promise<StoredPhoto[]> {
  const { rows } = await c.query<{ id: string; slot: number; width: number; height: number }>(
    'SELECT id, slot, width, height FROM visible_photos($1, $2)', [owner, viewer],
  );
  return rows;
}

/** The bytes, or null. Callers must have checked permission BEFORE getting here. */
export async function read(
  userId: string,
  photoId: string,
  size: Size,
): Promise<Buffer | null> {
  try {
    return await readFile(fileFor(userId, photoId, size));
  } catch {
    // A row whose file is gone reads as a missing photo. Better a gap in a profile
    // than a 500 on a screen somebody is scrolling.
    return null;
  }
}

export async function remove(c: PoolClient, userId: string, photoId: string): Promise<boolean> {
  const { rowCount } = await c.query(
    'DELETE FROM photos WHERE id = $1 AND user_id = $2', [photoId, userId]);
  if (!rowCount) return false;
  await rm(fileFor(userId, photoId, 'full'), { force: true });
  await rm(fileFor(userId, photoId, 'thumb'), { force: true });
  return true;
}

/**
 * Reorder. The order arrives as a list of ids; anything not named keeps its place at
 * the end.
 *
 * The unique constraint is DEFERRED for the transaction, so the halfway states -- where
 * two photos briefly claim slot 1 -- are allowed and only the committed order has to
 * be valid. Without that this needs a scratch range to shuffle through, and there is
 * no scratch range inside six slots.
 */
export async function reorder(c: PoolClient, userId: string, ids: string[]): Promise<void> {
  const { rows } = await c.query<{ id: string }>(
    'SELECT id FROM photos WHERE user_id = $1 ORDER BY position', [userId]);
  const known = new Set(rows.map((r) => r.id));
  const ordered = [...ids.filter((id) => known.has(id)),
                   ...rows.map((r) => r.id).filter((id) => !ids.includes(id))];

  await c.query('SET CONSTRAINTS photos_user_position DEFERRED');
  for (const [i, id] of ordered.entries()) {
    await c.query('UPDATE photos SET position = $3 WHERE id = $1 AND user_id = $2',
      [id, userId, i]);
  }
}

/** Everything on disk for one person. Called by erasure; the rows go with the account. */
export async function removeAllFiles(userId: string): Promise<void> {
  await rm(dirFor(userId), { recursive: true, force: true });
}

/**
 * Take somebody's photographs down.
 *
 * A MODERATION ACTION, NOT A DELETE, and the difference is the point. The files stay
 * on disk and the rows stay in the table: the photograph is evidence of whatever the
 * report was about, and destroying it to resolve a complaint about it is the one
 * thing a reviewer must not be able to do by accident. `visible_photos` (0039) stops
 * serving it the moment `hidden_at` is set, to every viewer including the owner's
 * existing matches.
 *
 * Runs on the matchmaker session because a reviewer is not the owner, and the owner's
 * own tenant session is the only thing that can normally see these rows.
 */
export async function hide(userId: string, reason: string): Promise<number> {
  const { matchmakerSession } = await import('../db/client.js');
  return matchmakerSession(async (c) => {
    const { rowCount } = await c.query(
      `UPDATE photos SET hidden_at = now(), hidden_reason = $2
        WHERE user_id = $1 AND hidden_at IS NULL`,
      [userId, reason.slice(0, 500)],
    );
    return rowCount ?? 0;
  });
}

/**
 * Put them back.
 *
 * Reversibility is what makes hiding a decision somebody will take quickly, and a
 * report that sits unactioned for a day because the reviewer was afraid of being
 * wrong is the failure this whole path exists to avoid.
 */
export async function unhide(userId: string): Promise<number> {
  const { matchmakerSession } = await import('../db/client.js');
  return matchmakerSession(async (c) => {
    const { rowCount } = await c.query(
      `UPDATE photos SET hidden_at = NULL, hidden_reason = ''
        WHERE user_id = $1 AND hidden_at IS NOT NULL`,
      [userId],
    );
    return rowCount ?? 0;
  });
}
