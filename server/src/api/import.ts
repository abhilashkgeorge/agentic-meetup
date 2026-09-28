import { Hono } from 'hono';
import { z } from 'zod';
import {
  CHAT_EXPORT_GUIDE, CHAT_MAX_CHARS, PASTE_BACK_PROMPT, PASTE_MAX_CHARS, SELF_DESCRIBE_PROMPT,
  type ImportPromptsResponse,
} from '@clone/shared';
import { resolveCtx, Unauthorized } from '../auth.js';
import { tenantSession } from '../db/client.js';
import { BudgetExceeded, metered } from '../metering.js';
import { importPastedText } from '../memory/pasteImport.js';
import { extractVoice, saveVoice } from '../memory/chatImport.js';
import { log } from '../log.js';

const ChatBody = z.object({
  /** The user's own messages, already separated on the device. Never the whole chat. */
  messages: z.array(z.string().min(1).max(4000)).min(20).max(2000),
});

const Body = z.object({
  text: z.string().min(1).max(PASTE_MAX_CHARS),
  source: z.enum(['assistant', 'self']),
});

export const importRoutes = new Hono()
  /**
   * Served rather than compiled into the app, so the wording can be tuned without a
   * store release. The prompt is the part most likely to need iteration -- what a
   * given assistant will actually enumerate is a prompt-level behaviour that can
   * change under us at any time.
   */
  .get('/v1/import/prompt', (c) => {
    // Annotated, so a field that changes shape here fails the build rather than the
    // phone. This endpoint is why: chatGuide became an object and nothing noticed
    // until React refused to render it on a device.
    const body: ImportPromptsResponse = {
      assistantPrompt: PASTE_BACK_PROMPT,
      selfPrompt: SELF_DESCRIBE_PROMPT,
      maxChars: PASTE_MAX_CHARS,
      // The client must present self-description as an equal option, not a fallback.
      note: 'Paste what your assistant says, or just write it yourself. Either is fine.',
      chatGuide: CHAT_EXPORT_GUIDE,
      chatMaxChars: CHAT_MAX_CHARS,
    };
    return c.json(body);
  })

  .post('/v1/import/paste', async (c) => {
    let ctx;
    try {
      ctx = await resolveCtx(c.req.header('authorization'));
    } catch (err) {
      if (err instanceof Unauthorized) return c.json({ error: 'unauthorized' }, 401);
      throw err;
    }

    const parsed = Body.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad request' }, 400);

    // Import is a large extraction call, so it goes through the same budget gate as
    // any other spend. A user pasting their life story repeatedly is a real cost.
    //
    // The model call and the writes share one transaction here, unlike the chat path:
    // an import is a single bounded call, not a stream, and the facts are worthless
    // without it. Still short -- if this ever grows, split it like chat.ts does. The
    // meter is handed that same transaction so it does not take a second connection.
    let result;
    try {
      result = await tenantSession(ctx, (db) =>
        metered(ctx, 'extract', () => importPastedText(db, ctx, parsed.data.text, parsed.data.source), { db, setup: true }));
    } catch (err) {
      if (err instanceof BudgetExceeded) return c.json({ error: 'budget_exceeded' }, 429);
      throw err;
    }

    log.info({ userId: ctx.userId, ...result }, 'paste import');

    // The counts are split because the difference is the point, and the person has
    // to be told it: things their assistant STATED are held for checking, things it
    // GUESSED were not kept at all and become questions.
    const parts: string[] = [];
    if (result.staged > 0) parts.push(`${result.staged} things to check with you`);
    if (result.questions > 0) parts.push(`${result.questions} it wasn't sure about, so I'll ask`);

    return c.json({
      staged: result.staged,
      rejected: result.rejected,
      questions: result.questions,
      // Deliberately no confirm/reject list in the response. Facts are ratified one
      // at a time in conversation; handing the client 200 items invites the intake
      // wall this design exists to avoid.
      message: parts.length
        ? `Got it — ${parts.join(', and ')}.`
        : 'Nothing concrete enough to keep. Tell me about yourself instead?',
    });
  });

/**
 * Voice import. The device sends the user's OWN messages, already separated.
 *
 * There used to be a /speakers endpoint here that took the whole export so the server
 * could list who was in it. That meant uploading a friend's entire chat history to
 * answer a question the phone could answer by itself. It is gone.
 */
export const chatImportRoutes = new Hono()
  .post('/v1/import/chat', async (c) => {
    let ctx;
    try {
      ctx = await resolveCtx(c.req.header('authorization'));
    } catch (err) {
      if (err instanceof Unauthorized) return c.json({ error: 'unauthorized' }, 401);
      throw err;
    }
    const body = ChatBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad request' }, 400);
    const { messages } = body.data;

    let voice;
    try {
      voice = await metered(ctx, 'extract', () => extractVoice(ctx, messages), { setup: true });
    } catch (err) {
      if (err instanceof BudgetExceeded) return c.json({ error: 'budget_exceeded' }, 429);
      throw err;
    }
    if (!voice) {
      return c.json({
        error: 'not enough messages',
        message: 'Pick a longer chat — we need at least 20 of your own messages.',
      }, 400);
    }

    await tenantSession(ctx, (db) => saveVoice(db, ctx, voice));

    log.info({ userId: ctx.userId, messagesUsed: voice.messagesUsed }, 'voice learned');
    // Only the derived style is kept. The transcript is not stored, and neither is
    // anything the other person wrote.
    return c.json({
      style: voice.style, habits: voice.habits, never: voice.never,
      messagesUsed: voice.messagesUsed,
    });
  });
