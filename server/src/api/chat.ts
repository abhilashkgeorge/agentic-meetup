/**
 * The chat turn. Stateless: every turn is an independent request, nothing sticky,
 * so replicas scale and rolling deploys work.
 *
 * Resume the TURN, not the token stream. The client generates turnId; the server
 * persists the assistant message as it completes and a reconnect re-fetches by id.
 * Buffering chunks in process memory would require sticky routing, which is
 * container-per-user through the back door.
 */
import type { WebSocket } from 'ws';
import { ClientMessage, HEARTBEAT_MS, type ServerEvent } from '@clone/shared';
import { tenantSession, type TenantCtx } from '../db/client.js';
import { llm, modelFor } from '../llm/index.js';
import { UnsupportedCapability } from '../llm/caps.js';
import type { Message, Usage } from '../llm/port.js';
import { BudgetExceeded, checkBudget, record } from '../metering.js';
import * as episodes from '../memory/episodes.js';
import { factsTouchedBy, markRetrieved, recall } from '../memory/retrieval.js';
import { coreProfileText, voiceText } from '../memory/profile.js';
import { currentState } from '../memory/facts.js';
import { embed, embeddingsAvailable } from '../llm/embeddings.js';
import { env } from '../env.js';
import { log } from '../log.js';
import * as hub from '../messaging/hub.js';
import * as messages from '../messaging/store.js';

/**
 * The stable prefix. NOTHING volatile may appear here -- no date, no user name, no
 * session id. Any byte change invalidates the cache for every user, and a cache miss
 * is silent: it shows up only on the invoice.
 */
const SYSTEM_PROMPT = `You are this person's clone: an agent that knows them and speaks with their voice and judgement.

You are given recalled fragments of things they have actually said, verbatim. Treat them as evidence, not as script.

Recompute the person's current state from the fragments. Do not simply answer from them. When two fragments disagree, the later one usually reflects the present, but say so rather than asserting silently.

Never invent a detail about them that is not in the fragments. If you do not know something about them, say you do not know and ask.

Speak plainly, in their register. No preamble, no hedging, no restating the question.`;

function send(ws: WebSocket, ev: ServerEvent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ev));
}

function buildMessages(
  recent: { role: 'user' | 'assistant'; content: string }[],
  recalled: { text: string; occurredAt: Date }[],
  userText: string,
  profile: string,
  voice: string,
  live: { predicate: string; objectText: string }[],
): Message[] {
  // Placement matters: recalled fragments go AFTER the conversation history and
  // immediately before the user's message, because they change every turn and are
  // structurally uncacheable. Anything volatile placed earlier would invalidate the
  // cached prefix behind it.
  const core = profile
    ? [{ role: 'user' as const, content: `What you know about them:\n${profile}` }]
    : [];
  // Style, framed as an instruction rather than as information. Placed after the
  // facts so the last thing before the question is how to sound.
  const style = voice
    ? [{
        role: 'user' as const,
        content:
          `How they write, based on their real messages. Match this — their words, ` +
          `their length, their habits. Do not tidy them up:\n${voice}`,
      }]
    : [];
  // Last word on what is true, and deliberately uncacheable. Placed after the cached
  // profile so that where the two disagree, the fresh read is what the model reads
  // last. Cheap: these are short strings and a few dozen rows.
  const truth = live.length
    ? [{
        role: 'user' as const,
        content:
          `What is true about them RIGHT NOW. Where this disagrees with anything above, ` +
          `this wins — the text above is a summary that may be out of date:\n` +
          live.map((f) => `- ${f.predicate.replace(/_/g, ' ')}: ${f.objectText}`).join('\n'),
      }]
    : [];
  const fragments = recalled.length
    ? [
        {
          role: 'user' as const,
          content:
            `Fragments recalled from things they said before:\n` +
            recalled
              .map((r) => `- (${r.occurredAt.toISOString().slice(0, 10)}) ${r.text}`)
              .join('\n'),
        },
      ]
    : [];
  return [...core, ...style, ...recent, ...truth, ...fragments, { role: 'user', content: userText }];
}

export function attachChat(ws: WebSocket, ctx: TenantCtx): void {
  const heartbeat = setInterval(() => send(ws, { type: 'heartbeat' }), HEARTBEAT_MS);
  // Registered so the other half of a conversation can be reached. A person may have
  // several devices open, so this is a set per user rather than one socket -- missing
  // that produces the bug where reading on a laptop leaves it unread on a phone.
  hub.join(ctx.userId, ws);
  ws.on('close', () => {
    clearInterval(heartbeat);
    hub.leave(ctx.userId, ws);
  });

  ws.on('message', (data) => {
    void handle(ws, ctx, data.toString()).catch((err: unknown) => {
      log.error({ err, userId: ctx.userId }, 'chat turn failed');
      send(ws, {
        type: 'error',
        code: 'internal',
        message: 'turn failed',
        retryable: true,
      });
    });
  });
}

/**
 * One question at a time, and only once. Nagging is worse than not asking: a clone
 * that interrogates you every session is a clone you stop talking to.
 */
async function askPendingConflict(ws: WebSocket, ctx: TenantCtx): Promise<void> {
  const q = await tenantSession(ctx, async (c) => {
    const { rows } = await c.query<{ id: string; clarifying_question: string }>(
      `SELECT id, clarifying_question FROM fact_conflicts
        WHERE user_id = $1 AND status = 'open'
        ORDER BY detected_at LIMIT 1`,
      [ctx.userId],
    );
    const row = rows[0];
    if (!row) return null;
    await c.query(
      `UPDATE fact_conflicts SET status = 'asked', asked_at = now() WHERE id = $1`,
      [row.id],
    );
    return row;
  });

  if (q) {
    send(ws, { type: 'conflict.question', conflictId: q.id, question: q.clarifying_question });
  }
}

/** The two people in a conversation, and which one is not the caller. */
async function participants(
  ctx: TenantCtx,
  rendezvousId: string,
): Promise<{ otherId: string; introduced: boolean } | null> {
  return tenantSession(ctx, async (c) => {
    const { rows } = await c.query<{ user_a: string; user_b: string; status: string }>(
      `SELECT user_a, user_b, status FROM rendezvous WHERE id = $1`,
      [rendezvousId],
    );
    const r = rows[0];
    if (!r) return null;
    if (r.user_a !== ctx.userId && r.user_b !== ctx.userId) return null;
    return {
      otherId: r.user_a === ctx.userId ? r.user_b : r.user_a,
      introduced: r.status === 'introduced',
    };
  });
}

const wire = (m: messages.Message) => ({
  id: m.id,
  rendezvousId: m.rendezvousId,
  senderId: m.senderId,
  text: m.body,
  sentAt: m.sentAt.toISOString(),
  seq: m.seq,
  deliveredAt: m.deliveredAt?.toISOString() ?? null,
  readAt: m.readAt?.toISOString() ?? null,
});

async function handleDm(
  ws: WebSocket,
  ctx: TenantCtx,
  msg: Extract<ClientMessage, { type: `dm.${string}` }>,
): Promise<void> {
  const pair = await participants(ctx, msg.rendezvousId);
  // Not a conversation this person is in. Answered identically to one that does not
  // exist, so a stranger cannot probe for valid ids.
  if (!pair) return;

  if (msg.type === 'dm.typing') {
    // Not persisted. A typing indicator that survives a reload is a lie.
    hub.pushTo(pair.otherId, {
      type: 'dm.typing', rendezvousId: msg.rendezvousId, typing: msg.typing,
    });
    return;
  }

  if (msg.type === 'dm.read') {
    const ids = await tenantSession(ctx, (c) =>
      messages.markRead(c, msg.rendezvousId, ctx.userId),
    );
    if (!ids.length) return;
    // The receipt goes to the SENDER of those messages, which is the other person.
    hub.pushTo(pair.otherId, {
      type: 'dm.receipt', rendezvousId: msg.rendezvousId, messageIds: ids, state: 'read',
    });
    return;
  }

  if (!pair.introduced) {
    send(ws, { type: 'dm.rejected', messageId: msg.messageId, reason: 'not introduced yet' });
    return;
  }

  let result;
  try {
    result = await tenantSession(ctx, (c) =>
      messages.send(c, {
        id: msg.messageId,
        rendezvousId: msg.rendezvousId,
        senderId: ctx.userId,
        recipientId: pair.otherId,
        body: msg.text,
      }),
    );
  } catch (err) {
    if (err instanceof messages.Blocked) {
      // The sender is told their message did not go. The blocked person is never told
      // they are blocked, which is why this is the only place either side learns
      // anything -- and it says nothing about the other person's action.
      send(ws, { type: 'dm.rejected', messageId: msg.messageId, reason: 'cannot send' });
      return;
    }
    throw err;
  }

  // Echoed to the sender too, so their optimistic bubble gets the server's sequence
  // and timestamp rather than keeping the ones the phone guessed.
  send(ws, { type: 'dm.message', message: wire(result.message) });

  if (!result.fresh) return; // a retry; the recipient already has it

  const online = hub.pushTo(pair.otherId, {
    type: 'dm.message', message: wire(result.message),
  });

  if (online) {
    const ids = await tenantSession(ctx, (c) =>
      messages.markDelivered(c, msg.rendezvousId, pair.otherId),
    );
    if (ids.length) {
      hub.pushTo(ctx.userId, {
        type: 'dm.receipt', rendezvousId: msg.rendezvousId, messageIds: ids, state: 'delivered',
      });
    }
  }
  // Offline: no receipt, and a push notification is what wakes them. Marking it
  // delivered here would show two ticks for a message nobody has received.
}

async function handle(ws: WebSocket, ctx: TenantCtx, raw: string): Promise<void> {
  const parsed = ClientMessage.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    send(ws, { type: 'error', code: 'internal', message: 'malformed message', retryable: false });
    return;
  }
  const msg = parsed.data;

  if (msg.type === 'hello') {
    // Surface one pending clarifying question on connect. The conflicts queue is
    // the primary quality mechanism in this design -- it is the only thing that
    // turns a wrong belief into a resolvable event rather than a silent error --
    // so it has to actually reach the user, not just sit in a table.
    await askPendingConflict(ws, ctx);
    return;
  }
  // Messaging between two matched people rides the same socket as the conversation
  // with your own clone. A second connection would need its own auth, reconnect and
  // offline queue -- three copies of the hard parts for nothing.
  if (msg.type === 'dm.send' || msg.type === 'dm.read' || msg.type === 'dm.typing') {
    await handleDm(ws, ctx, msg);
    return;
  }

  if (msg.type !== 'turn') return;

  // --- Phase 1: read + validate. Short transaction, closed before any LLM call. ---
  const prep = await tenantSession(ctx, async (c) => {
    const existing = await episodes.findByTurnId(c, ctx.userId, msg.turnId);
    if (existing) return { replay: existing.rawText } as const;

    await checkBudget(c, ctx.tenantId, ctx.userId);

    const stored = await episodes.append(c, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      sessionId: msg.sessionId,
      turnId: msg.turnId,
      role: 'user',
      source: msg.source,
      rawText: msg.text,
      asrConfidence: msg.asrConfidence,
      asrLowConfSpans: msg.asrLowConfSpans,
      occurredAt: new Date(),
    });

    // Both exclude the turn being answered. It is already in episodes (appended
    // above, for idempotency), and including it would put the user's own message in
    // the prompt twice -- once as history, once as the question.
    const recent = await episodes.recentTurns(c, ctx.userId, msg.sessionId, 20, msg.turnId);
    const recalled = await recall(c, ctx.userId, msg.text, 5, stored?.id);
    // TIER 2. Rebuilt on cadence, so it is stable across a session -- which is what
    // makes it worth a cache breakpoint later.
    const profile = await coreProfileText(c, ctx.userId);
    const voice = await voiceText(c, ctx.userId);
    // TIER 1, read live. The core profile above is a CACHE -- it rebuilds on cadence,
    // so a fact that changed a minute ago is not in it, and the clone confidently
    // states the old value until the next rebuild. That is the single failure this
    // product claims to have solved, so the current state is read on every turn and
    // placed after the cached block, where it wins.
    const live = await currentState(c, ctx.userId);
    // The promotion signal. Facts the turn is actually about, counted -- so P4 orders
    // the core profile by observed usefulness rather than by a model's write-time
    // confidence, which is the weakest signal available and is deliberately unused.
    await markRetrieved(c, ctx.userId, await factsTouchedBy(c, ctx.userId, msg.text));
    return {
      replay: null, userEpisodeId: stored?.id ?? null, recent, recalled, profile, voice,
      live: live.map((f) => ({ predicate: f.predicate, objectText: f.objectText })),
    } as const;
  }).catch((err: unknown) => {
    if (err instanceof BudgetExceeded) {
      send(ws, {
        type: 'error',
        code: 'budget_exceeded',
        message: `You have hit today's ${err.kind === 'daily_turns' ? 'turn' : 'spend'} limit.`,
        retryable: false,
      });
      return null;
    }
    throw err;
  });

  if (!prep) return;

  if (prep.replay !== null) {
    // Already answered. Never regenerate: that is a second charge for one turn.
    send(ws, { type: 'turn.replayed', turnId: msg.turnId, text: prep.replay });
    return;
  }

  send(ws, { type: 'turn.accepted', turnId: msg.turnId });

  // --- Phase 2: the model call. NO transaction is open here, by design. ---
  // A held-open xmin horizon measures 14x dead tuples and -35% dequeue throughput;
  // bloat is how this database fails, not throughput.
  const model = modelFor('chat');
  let text = '';
  let usage: Usage | null = null;

  try {
    for await (const ev of llm.stream(
      {
        task: 'chat',
        instructions: SYSTEM_PROMPT,
        messages: buildMessages(prep.recent, prep.recalled, msg.text, prep.profile, prep.voice, prep.live),
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        // One breakpoint in W1: the shared prefix only. The per-user core profile
        // and history breakpoints arrive with Tier 2 in W4 -- and only once we have
        // measured median session length, because at a 1-turn session a 5-minute
        // TTL is a 25% surcharge, not a saving.
        cache: [{ scope: 'instructions', ttl: '5m' }],
        maxOutputTokens: 2048,
        thinking: false,
      },
      model,
    )) {
      if (ev.type === 'text.delta') {
        text += ev.text;
        send(ws, { type: 'text.delta', turnId: msg.turnId, text: ev.text });
      } else if (ev.type === 'usage.final') {
        usage = ev.usage;
      } else if (ev.type === 'error') {
        send(ws, {
          type: 'error',
          code: 'internal',
          message: ev.message,
          retryable: ev.retryable,
        });
        return;
      }
    }
  } catch (err) {
    if (err instanceof UnsupportedCapability) {
      // Rule 2 firing. A routed model cannot express something we asked for -- a
      // config problem, not a user problem. Loud on purpose.
      log.error({ err, model }, 'routed model cannot express the request');
      send(ws, {
        type: 'error',
        code: 'unsupported_capability',
        message: err.message,
        retryable: false,
      });
      return;
    }
    throw err;
  }

  // --- Phase 3: persist + meter. New short transaction. ---
  const assistantTurnId = crypto.randomUUID();
  const assistantEpisodeId = await tenantSession(ctx, async (c) => {
    const stored = await episodes.append(c, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      sessionId: msg.sessionId,
      turnId: assistantTurnId,
      role: 'assistant',
      source: 'text',
      rawText: text,
      occurredAt: new Date(),
    });
    if (usage) await record(c, ctx.tenantId, ctx.userId, 'chat', usage);
    return stored?.id ?? null;
  });

  send(ws, { type: 'turn.done', turnId: msg.turnId, text });

  // --- Phase 4: embed, after the reply is delivered. ---
  // A memory side effect must never block or fail the user's turn (Hermes' rule,
  // learned from a production incident: "stop retrying memory calls... continue
  // with your reply to the user").
  void embedPair(ctx, [
    [prep.userEpisodeId, msg.text],
    [assistantEpisodeId, text],
  ]).catch((err: unknown) => log.warn({ err }, 'embedding failed; will be retried by sweeper'));
}

async function embedPair(ctx: TenantCtx, pairs: [string | null, string][]): Promise<void> {
  if (!embeddingsAvailable()) return;
  const todo = pairs.filter((p): p is [string, string] => p[0] !== null && p[1].length > 0);
  if (!todo.length) return;
  const vectors = await embed(todo.map(([, t]) => t));
  await tenantSession(ctx, async (c) => {
    for (let i = 0; i < todo.length; i++) {
      const v = vectors[i];
      const id = todo[i]?.[0];
      if (v && id) {
        await episodes.setEmbedding(c, id, ctx.userId, v, env.EMBEDDING_MODEL, env.EMBEDDING_VERSION);
      }
    }
  });
}
