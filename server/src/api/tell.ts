/**
 * "Tell it one true thing."
 *
 * The first sixty seconds. Somebody types one sentence about themselves and the clone
 * can immediately speak in their voice -- that gap, between typing and being
 * represented, is the whole first impression.
 *
 * It runs extraction SYNCHRONOUSLY, which nothing else here does. Normally facts are
 * extracted when a session goes idle, which is right for a conversation and useless
 * for onboarding: nobody waits five minutes on a setup screen to find out whether
 * anything happened. One sentence is a cheap enough call to pay for inline.
 *
 * The facts are owner-origin and asserted, because the person typed them about
 * themselves in their own app. That is the strongest provenance in the system, and it
 * is the difference between this and the paste-back import, where somebody else's
 * summary arrives untrusted and has to be confirmed.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { resolveCtx, Unauthorized } from '../auth.js';
import { tenantSession } from '../db/client.js';
import { BudgetExceeded, metered } from '../metering.js';
import { extractSessionFacts } from '../memory/extract.js';
import { commit, currentState } from '../memory/facts.js';
import * as episodes from '../memory/episodes.js';
import { log } from '../log.js';
import { ensureSheet } from '../matching/answer-sheet.js';

const Body = z.object({
  text: z.string().min(2).max(2000),
  sessionId: z.string().uuid(),
});

export const tellRoutes = new Hono().post('/v1/tell', async (c) => {
  let ctx;
  try {
    ctx = await resolveCtx(c.req.header('authorization'));
  } catch (err) {
    if (err instanceof Unauthorized) return c.json({ error: 'unauthorized' }, 401);
    throw err;
  }

  const body = Body.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'bad request' }, 400);
  const { text, sessionId } = body.data;

  // Stored as an episode first. If extraction finds nothing, the sentence is still
  // kept and the nightly pass can have another go -- losing what someone typed
  // because one model call came back empty would be the worse failure.
  const stored = await tenantSession(ctx, (db) =>
    episodes.append(db, {
      tenantId: ctx.tenantId, userId: ctx.userId, sessionId,
      turnId: crypto.randomUUID(), role: 'user', source: 'text',
      rawText: text, occurredAt: new Date(),
    }),
  );

  const known = await tenantSession(ctx, async (db) => {
    const live = await currentState(db, ctx.userId);
    return live.map((f) => ({ predicate: f.predicate, objectText: f.objectText }));
  });

  // Outside a transaction: a model call with an open transaction holds the xmin
  // horizon, and bloat is how this database fails.
  //
  // The meter checks the budget before the call and records what it actually cost
  // after, per call and with real token counts -- replacing a hand-written row of
  // zeroes that could never be reconciled against an invoice. A SETUP step: counted
  // apart from the day's ten (metering.ts, 0075), so setting up never uses the calls
  // a first round or a chat needs.
  let out;
  try {
    out = await metered(ctx, 'extract', () => extractSessionFacts(
      { transcript: [{ role: 'user', content: text }], currentFacts: known, tenantId: ctx.tenantId, userId: ctx.userId },
      stored ? [stored.id] : [],
    ), { setup: true });
  } catch (err) {
    if (err instanceof BudgetExceeded) return c.json({ error: 'budget_exceeded' }, 429);
    throw err;
  }

  // LEARNED IS WHAT IT NOW BELIEVES. A staged fact is not that: on a field the person
  // taps (a card, a basic) a sentence only proposes, and waits for a Yes on the You
  // screen -- so it is counted apart and said apart, not reported as learned.
  const { learned, toConfirm } = await tenantSession(ctx, async (db) => {
    let n = 0;
    let staged = 0;
    for (const cand of out.candidates) {
      const r = await commit(db, ctx, cand);
      if (r.outcome === 'staged') staged++;
      else if (r.outcome !== 'rejected') n++;
    }
    return { learned: n, toConfirm: staged };
  });

  log.info({ userId: ctx.userId, learned, toConfirm }, 'told');
  // Something new about them may be an answer another agent will ask for. Only when
  // something was actually learned; a no-op when no sentence it could point at changed.
  if (learned > 0) await ensureSheet(ctx, { setup: true });
  return c.json({
    learned,
    toConfirm,
    facts: out.candidates.map((f) => ({
      label: f.predicate.replace(/_/g, ' '),
      value: f.objectText,
    })),
    message: toConfirm
      ? `${learned ? `Got it. ${learned} thing${learned === 1 ? '' : 's'} learned, and ` : 'Got it. '}${toConfirm} to check on the You screen before it changes an answer you gave.`
      : learned
      ? `Got it. ${learned} thing${learned === 1 ? '' : 's'} learned.`
      // NOT "nothing solid in that". The extractor returns what is NEW, so a sentence
      // it already knows produces nothing -- and the first thing somebody typed, which
      // was almost word for word the example on the screen, came back telling them it
      // was not solid enough. A person cannot tell the difference between "too vague"
      // and "already known", so the message must not claim to know which it was.
      : 'Nothing new in that one — tell me something I might not know yet.',
  });
});
