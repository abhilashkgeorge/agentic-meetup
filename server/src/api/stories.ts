/**
 * The stories: a few open questions whose answers give a person's agent something true
 * to say. See onboarding/stories.ts. No model call on either route.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { resolveCtx, Unauthorized } from '../auth.js';
import { tenantSession } from '../db/client.js';
import { log } from '../log.js';
import { STORY_IDS, STORY_MAX, STORY_MIN, readStories, saveStory } from '../onboarding/stories.js';

async function ctxOr401(c: { req: { header: (k: string) => string | undefined } }) {
  try {
    return { ctx: await resolveCtx(c.req.header('authorization')), res: null } as const;
  } catch (err) {
    if (err instanceof Unauthorized) return { ctx: null, res: 'unauthorized' } as const;
    throw err;
  }
}

const Body = z.object({ id: z.string().min(1).max(64), text: z.string().max(2000) });

export const storyRoutes = new Hono()
  /** Every story, with this person's answer or null. */
  .get('/v1/stories', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const stories = await tenantSession(ctx, (db) => readStories(db, ctx.userId));
    return c.json({ stories, min: STORY_MIN, max: STORY_MAX });
  })

  /** Answer one, or answer it again. */
  .post('/v1/stories', async (c) => {
    const { ctx, res } = await ctxOr401(c);
    if (!ctx) return c.json({ error: res }, 401);
    const body = Body.safeParse(await c.req.json().catch(() => null));
    if (!body.success || !STORY_IDS.has(body.data.id)) return c.json({ error: 'bad request' }, 400);
    const text = body.data.text.trim();
    if (text.length < STORY_MIN) return c.json({ error: 'too_short', min: STORY_MIN }, 400);
    if (text.length > STORY_MAX) return c.json({ error: 'too_long', max: STORY_MAX }, 400);
    const out = await tenantSession(ctx, (db) => saveStory(db, ctx, body.data.id, text));
    log.info({ userId: ctx.userId, story: body.data.id, replaced: out.replaced }, 'story saved');
    return c.json({ ok: true, factId: out.factId });
  });
