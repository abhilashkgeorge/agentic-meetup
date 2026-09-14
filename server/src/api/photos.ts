/**
 * The photo endpoints.
 *
 * THE BYTES ARE NEVER AT A PUBLIC ADDRESS. Every leak of dating photos has the same
 * shape: the file sits on a CDN behind an unguessable URL, and unguessable turns out
 * to mean "guessed, or shared, or logged, or left in a screenshot". So there is no
 * static route and no signed link. Each request for a picture is authenticated, and
 * the database is asked the same question the reveal asks: is it this person's turn.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { resolveCtx, Unauthorized } from '../auth.js';
import { tenantSession } from '../db/client.js';
import * as photos from '../photos/store.js';
import { log } from '../log.js';

async function ctxOr401(c: { req: { header: (k: string) => string | undefined } }) {
  try {
    return { ctx: await resolveCtx(c.req.header('authorization')), res: null } as const;
  } catch (err) {
    if (err instanceof Unauthorized) return { ctx: null, res: 'unauthorized' } as const;
    throw err;
  }
}

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export const photoRoutes = new Hono()
  /** Your own, with the slots they sit in. */
  .get('/v1/photos', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const list = await tenantSession(ctx, (db) => photos.mine(db, ctx.userId));
    // Their own id comes back too: the serving route is keyed on the OWNER as well as
    // the photo, because an id alone must never be the thing that grants access -- so
    // even a screen showing your own pictures needs to know who you are.
    return c.json({ me: ctx.userId, photos: list, max: photos.MAX_PHOTOS });
  })

  /**
   * Somebody else's.
   *
   * Returns an empty list both for "they have no photos" and for "you are not allowed
   * to see them yet", so the two cannot be told apart -- otherwise this endpoint
   * answers "does this person exist and are they matched with me", which is a question
   * no stranger should be able to ask.
   */
  .get('/v1/photos/of/:userId', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const owner = c.req.param('userId');
    if (!isUuid(owner)) return c.json({ photos: [] });
    const list = await tenantSession(ctx, (db) => photos.visibleTo(db, owner, ctx.userId));
    return c.json({ photos: list });
  })

  /**
   * The bytes.
   *
   * `?size=thumb` for a list, full otherwise. The owner's id is in the path as well as
   * the photo's, so the permission check is made against a person rather than against
   * a row the caller named -- an id alone must never be the thing that grants access.
   */
  .get('/v1/photos/:userId/:photoId', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const owner = c.req.param('userId');
    const photoId = c.req.param('photoId');
    if (!isUuid(owner) || !isUuid(photoId)) return c.body(null, 404);

    const allowed = await tenantSession(ctx, (db) => photos.visibleTo(db, owner, ctx.userId));
    if (!allowed.some((p) => p.id === photoId)) return c.body(null, 404);

    const size = c.req.query('size') === 'thumb' ? 'thumb' : 'full';
    const bytes = await photos.read(owner, photoId, size);
    if (!bytes) return c.body(null, 404);

    return c.body(new Uint8Array(bytes), 200, {
      'content-type': 'image/jpeg',
      // Private, because it is. A shared cache holding somebody's face keyed only by
      // URL would hand it to the next person who asked for that URL.
      'cache-control': 'private, max-age=86400',
      'content-length': String(bytes.byteLength),
      // The bytes are a JPEG whatever the extension says; stop a browser guessing
      // otherwise and executing what it guessed.
      'x-content-type-options': 'nosniff',
    });
  })

  /** Add one. Multipart, one file, re-encoded on the way in. */
  .post('/v1/photos', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    // TWO SHAPES ACCEPTED, because the two callers genuinely differ.
    //
    // The phone sends the raw bytes with an image content type: React Native's file
    // object is not a Blob, and the fetch in current Expo refuses it outright --
    // "Unsupported FormDataPart implementation" -- so there is no multipart the phone
    // can build without a shim. Everything else (curl, the end-to-end run) sends a
    // normal multipart form, which is what a person would reach for by hand.
    const type = c.req.header('content-type') ?? '';
    let buf: Buffer;

    if (type.startsWith('image/')) {
      buf = Buffer.from(await c.req.arrayBuffer());
    } else {
      const body = await c.req.parseBody().catch(() => null);
      const file = body?.photo;
      if (!(file instanceof File)) {
        return c.json({
          error: 'bad request',
          message: 'Send the picture as the body, or attach it as "photo".',
        }, 400);
      }
      buf = Buffer.from(await file.arrayBuffer());
    }

    if (buf.byteLength > photos.MAX_UPLOAD_BYTES) {
      return c.json({ error: 'too big', message: 'That picture is too big.' }, 413);
    }
    try {
      const added = await tenantSession(ctx, (db) => photos.add(db, ctx, buf));
      if (!added) {
        return c.json({
          error: 'full',
          message: `You can have ${photos.MAX_PHOTOS} photos. Remove one first.`,
        }, 409);
      }
      log.info({ userId: ctx.userId, photoId: added.id }, 'photo added');
      return c.json(added, 201);
    } catch (err) {
      if (err instanceof photos.BadImage) {
        return c.json({ error: 'bad image', message: err.message }, 400);
      }
      throw err;
    }
  })

  .delete('/v1/photos/:photoId', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const photoId = c.req.param('photoId');
    if (!isUuid(photoId)) return c.json({ error: 'not found' }, 404);

    const gone = await tenantSession(ctx, (db) => photos.remove(db, ctx.userId, photoId));
    return gone ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404);
  })

  /** The order they are shown in. First is the one a list shows. */
  .post('/v1/photos/order', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);

    const body = z.object({ ids: z.array(z.string().uuid()).max(photos.MAX_PHOTOS) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);

    await tenantSession(ctx, (db) => photos.reorder(db, ctx.userId, body.data.ids));
    const list = await tenantSession(ctx, (db) => photos.mine(db, ctx.userId));
    return c.json({ photos: list });
  });
