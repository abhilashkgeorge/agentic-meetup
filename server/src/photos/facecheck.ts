/**
 * The photo-check worker. Copied in shape from matching/rounds.ts.
 *
 * The app queues a row and two frames; this claims one row at a time (matchmaker
 * session, SKIP LOCKED), reads the frames and the person's photos, asks the model
 * (photos/face.ts) with NO transaction open, writes a verdict, and deletes both
 * frames in a finally -- pass, fail or crash. Nothing but the verdict, a score and
 * the photo ids compared is kept.
 *
 * Liveness, cheap and said so: the first frame faces the camera, the second has the
 * head turned, and the two must be the same person. It stops a photo held up to the
 * lens; it does not stop a video. The badge therefore says "checked", never
 * "verified".
 */
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { matchmakerSession, tenantSession } from '../db/client.js';
import { env } from '../env.js';
import { log } from '../log.js';
import { notify } from '../matching/world.js';
import { award } from '../points/ledger.js';
import { MATCH_MIN, readFaces, similarity } from './face.js';
import { checkDir, framePath, pathFor } from './store.js';

export type CheckResult = 'match' | 'no_match' | 'no_face' | 'not_live' | 'no_photos' | 'error';

const FRONT_MAX_YAW = 15;
const TURNED_MIN_YAW = 20;
const RUNNING_STALE_MS = 5 * 60_000;
const PENDING_STALE_MS = 10 * 60_000;

/** The verdict for one check. Pure apart from the model and the files. */
async function judge(userId: string, checkId: string, photoIds: string[]): Promise<{ result: CheckResult; score: number | null }> {
  if (!photoIds.length) return { result: 'no_photos', score: null };
  const a = await readFaces(await readFile(framePath(userId, checkId, 'a')));
  const b = await readFaces(await readFile(framePath(userId, checkId, 'b')));
  if (a.length !== 1 || b.length !== 1) return { result: 'no_face', score: null };
  const front = a[0]!; const turned = b[0]!;
  if (Math.abs(front.yaw) >= FRONT_MAX_YAW || Math.abs(turned.yaw) < TURNED_MIN_YAW) return { result: 'not_live', score: null };
  if ((await similarity(front.embedding, turned.embedding)) < MATCH_MIN) return { result: 'not_live', score: null };

  let best = 0;
  let facesInPhotos = 0;
  for (const id of photoIds) {
    const faces = await readFaces(await readFile(pathFor(userId, id, 'full')));
    facesInPhotos += faces.length;
    for (const f of faces) best = Math.max(best, await similarity(front.embedding, f.embedding));
  }
  if (!facesInPhotos) return { result: 'no_face', score: null };
  return { result: best >= MATCH_MIN ? 'match' : 'no_match', score: best };
}

/**
 * Claim one queued check and run it. Returns whether there was one. `only` lets a
 * test run the row it queued and no other (several suites share one queue).
 */
export async function runOneQueuedCheck(only?: string): Promise<boolean> {
  const claimed = await matchmakerSession(async (c) => {
    const { rows } = await c.query<{ id: string; user_id: string; tenant_id: string }>(
      `UPDATE photo_checks SET status = 'running', started_at = now()
        WHERE id = (SELECT id FROM photo_checks
                     WHERE status = 'queued' AND ($1::uuid IS NULL OR id = $1)
                     ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, user_id, tenant_id`,
      [only ?? null],
    );
    return rows[0] ?? null;
  });
  if (!claimed) return false;
  const { id, user_id: userId, tenant_id: tenantId } = claimed;

  let result: CheckResult = 'error';
  let score: number | null = null;
  let error: string | null = null;
  let photoIds: string[] = [];
  try {
    photoIds = (await matchmakerSession(async (c) => (await c.query<{ id: string }>(
      'SELECT id FROM photos WHERE user_id = $1 AND hidden_at IS NULL ORDER BY position', [userId])).rows)).map((r) => r.id);
    ({ result, score } = await judge(userId, id, photoIds));
  } catch (err) {
    error = (err as Error).message ?? 'check failed';
    log.error({ err, checkId: id }, 'photo check failed');
  } finally {
    // The frames go whatever happened. This is the promise the consent copy makes.
    await rm(framePath(userId, id, 'a'), { force: true });
    await rm(framePath(userId, id, 'b'), { force: true });
  }

  await matchmakerSession((c) => c.query(
    `UPDATE photo_checks
        SET status = $2, result = $3, score = $4, photo_ids = $5::uuid[], error = $6, finished_at = now()
      WHERE id = $1`,
    [id, result === 'error' ? 'failed' : 'done', result, score, photoIds, error],
  ));
  // Once, ever: the ledger's key sees to it however many times they pass.
  if (result === 'match') await tenantSession({ tenantId, userId }, (db) => award(db, { tenantId, userId }, 'photos_checked', 'self'));
  notify(userId, { type: 'photos.checked', result });
  return true;
}

/** Rows a crash or an abandoned phone left behind. */
export async function reapStale(): Promise<number> {
  const { rowCount } = await matchmakerSession((c) => c.query(
    `UPDATE photo_checks SET status = 'failed', result = 'error', finished_at = now(),
            error = CASE WHEN status = 'running' THEN 'orphaned by restart' ELSE 'abandoned' END
      WHERE (status = 'running' AND started_at < now() - ($1::int * interval '1 millisecond'))
         OR (status IN ('pending', 'queued') AND requested_at < now() - ($2::int * interval '1 millisecond'))`,
    [RUNNING_STALE_MS, PENDING_STALE_MS],
  ));
  return rowCount ?? 0;
}

/** Any frame older than the pending window, under anybody's check dir, is gone. */
export async function sweepOrphanFrames(): Promise<number> {
  let removed = 0;
  let users: string[] = [];
  try { users = await readdir(env.PHOTO_DIR); } catch { return 0; }
  const cutoff = Date.now() - PENDING_STALE_MS;
  for (const u of users) {
    const dir = checkDir(u);
    let frames: string[] = [];
    try { frames = await readdir(dir); } catch { continue; }
    for (const f of frames) {
      const p = join(dir, f);
      try {
        if ((await stat(p)).mtimeMs < cutoff) { await rm(p, { force: true }); removed++; }
      } catch { /* gone already */ }
    }
  }
  return removed;
}

let ticks = 0;
/** One tick of the worker. Safe on a timer; at most one check per tick. */
export async function faceCheckTick(): Promise<void> {
  await reapStale();
  if (ticks++ % 60 === 0) await sweepOrphanFrames();
  await runOneQueuedCheck();
}
