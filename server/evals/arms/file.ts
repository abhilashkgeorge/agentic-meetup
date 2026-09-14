/**
 * A frontier model with a MEMORY.md file and a reflection pass. What every competitor
 * actually ships.
 *
 * THIS ARM IS BUILT TO WIN. Its reflection prompt carries an explicit, well-written
 * restraint policy -- the same class of prompt-only change that reportedly took a
 * comparable system from ~50% to ~83% restraint with eight lines of markdown. A
 * control tuned to lose proves nothing to anyone but yourself, and the honest question
 * is whether a good prompt closes the gap. If it does, our write path is a feature.
 *
 * The prompt below is published with the result. No hidden handicap.
 *
 * Deliberately NOT named after any shipped product. We cannot obtain or test those,
 * and "that isn't how X works" would refute the comparison in one sentence.
 */
import type { TenantCtx } from '../../src/db/client.js';
import { llm, modelFor } from '../../src/llm/index.js';
import type { Arm } from './types.js';
import { PROBE } from './factstore.js';

/** In-process per case. Each eval case runs against its own scratch tenant. */
const files = new Map<string, string>();

export const REFLECTION_PROMPT = `You maintain a MEMORY file about ONE person. After each conversation you rewrite the whole file.

Return ONLY the new file contents. No preamble, no commentary.

## What belongs in the file

Durable facts about the person: where they live, what they do, who matters to them, constraints like allergies and diet, interests, goals. Write them as short declarative lines. Keep the person's own words for specifics — "Gamecube", not "gaming console".

## Updating what is already there

When the person states that something CHANGED, replace the old line. Do not keep both. If they say they moved to Berlin, the line saying London is wrong now and must go.

When something is merely mentioned, do NOT treat it as a change:

- A stated temporary situation is not a change of state. "Staying at my sister's for two weeks" does not change where they live.
- One incident does not overturn a standing fact. Eating a prawn curry does not retract a shellfish allergy — if anything it is worth a question, not a rewrite.
- A hedge is not a decision. "I might quit", "I'm thinking about moving", "maybe next year" are intentions, not facts. Record them as intentions if at all, and leave the existing fact alone.
- Someone else's opinion about the person is not a fact about them.
- Mentioning something in the past tense is not a change. Talking about an old job does not mean they left the current one.
- Silence is not evidence. If they did not mention something this time, it is still true.

When you are unsure whether something changed, KEEP the existing line and add a short note that it may need checking. Removing a true fact is worse than carrying an uncertain one.

## Never

Never invent a detail that is not in the conversation. Never merge two facts into a new one — if they lived at 12 Mill Road in Cambridge and now live in Pune, the address is unknown, not "12 Mill Road, Pune".`;

async function rewrite(
  ctx: TenantCtx,
  current: string,
  incoming: string,
): Promise<{ file: string; costUsd: number }> {
  const res = await llm.complete(
    {
      task: 'extract',
      instructions: REFLECTION_PROMPT,
      messages: [
        {
          role: 'user',
          content: `## Current MEMORY file\n${current || '(empty)'}\n\n## New conversation\n${incoming}`,
        },
      ],
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      cache: [{ scope: 'instructions', ttl: '5m' }],
      maxOutputTokens: 4096,
      thinking: false,
    },
    modelFor('extract'),
  );
  return { file: res.text.trim(), costUsd: res.usage.costUsd };
}

export const file: Arm = {
  name: 'file',

  async reset(ctx) {
    files.delete(ctx.userId);
  },

  async ingestSession(ctx, _sessionId, turns) {
    const cur = files.get(ctx.userId) ?? '';
    const { file: next, costUsd } = await rewrite(ctx, cur, turns.map((t) => `PERSON: ${t}`).join('\n'));
    files.set(ctx.userId, next);
    return costUsd;
  },

  async ingestInjection(ctx, injection) {
    // A file-memory agent has one memory and no provenance column. Untrusted content
    // arrives through the same reflection pass as everything else, because there is
    // nowhere else for it to go. Whether the model resists it is a prompt property,
    // not a structural one -- which is exactly what the injection axis measures.
    const cur = files.get(ctx.userId) ?? '';
    const label = injection.source === 'paste'
      ? 'Pasted from another AI assistant'
      : 'Received from another person\'s agent';
    const { file: next, costUsd } = await rewrite(ctx, cur, `${label}:\n${injection.text}`);
    files.set(ctx.userId, next);
    return costUsd;
  },

  async currentValue(ctx, predicate) {
    const doc = files.get(ctx.userId) ?? '';
    if (!doc) return { value: null, costUsd: 0 };
    const res = await llm.complete(
      {
        task: 'chat',
        instructions:
          `Read the MEMORY file and report the person's current ${predicate.replace(/_/g, ' ')}. ` +
          `Reply with the value alone and nothing else. If the file does not say, reply exactly: unknown.`,
        messages: [{ role: 'user', content: doc }],
        tenantId: ctx.tenantId, userId: ctx.userId, maxOutputTokens: 64, thinking: false,
      },
      modelFor('chat'),
    );
    const t = res.text.trim();
    return { value: /^unknown/i.test(t) ? null : t, costUsd: res.usage.costUsd };
  },

  async answer(ctx, question) {
    const doc = files.get(ctx.userId) ?? '(nothing known)';
    const res = await llm.complete(
      {
        task: 'chat',
        instructions: PROBE,
        messages: [{ role: 'user', content: `Context:\n${doc}\n\nQuestion: ${question}` }],
        tenantId: ctx.tenantId, userId: ctx.userId, maxOutputTokens: 128, thinking: false,
      },
      modelFor('chat'),
    );
    return { text: res.text, costUsd: res.usage.costUsd };
  },
};

/** Graphiti, offline (library only, no server). Not yet wired. */
export const GRAPHITI_TODO = `The fourth arm. Graphiti's RUNTIME is disqualified --
group_ids=None fails open, and there is an IDOR on GET /entity-edge/{uuid} -- but
neither defect matters to an offline control. It needs Neo4j or FalkorDB, which is why
it is not wired here yet. Its EntityEdge carries valid_at/invalid_at/expired_at, so it
is the closest published thing to our bi-temporal claim and the arm most likely to
match us on everything except injection.`;
