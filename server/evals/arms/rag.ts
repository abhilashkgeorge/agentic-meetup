/**
 * Verbatim episodes, hybrid recall, NO write path.
 *
 * A strong baseline, not a punching bag: published measurements have verbatim RAG
 * matching full context and beating agent self-memory. If this wins, our write path
 * is a net negative and the fallback in ARCHITECTURE.md:793 is the product.
 */
import { tenantSession, type TenantCtx } from '../../src/db/client.js';
import { llm, modelFor } from '../../src/llm/index.js';
import { recall } from '../../src/memory/retrieval.js';
import type { Arm } from './types.js';
import { PROBE } from './factstore.js';

async function store(ctx: TenantCtx, sessionId: string, turns: string[]): Promise<void> {
  await tenantSession(ctx, async (c) => {
    for (let i = 0; i < turns.length; i++) {
      await c.query(
        `INSERT INTO episodes (tenant_id, user_id, session_id, turn_id, turn_index,
                               role, source, raw_text, occurred_at, ingested_at)
         VALUES ($1,$2,$3,gen_random_uuid(),$4,'user','text',$5,now(),now())`,
        [ctx.tenantId, ctx.userId, sessionId, i, turns[i]],
      );
    }
  });
}

export const rag: Arm = {
  name: 'rag',

  async reset(ctx) {
    await tenantSession(ctx, (c) =>
      c.query('DELETE FROM episodes WHERE user_id = $1', [ctx.userId]),
    );
  },

  async ingestSession(ctx, sessionId, turns) {
    await store(ctx, sessionId, turns);
    return 0; // no write-path model call at all -- that is the point of this arm
  },

  async ingestInjection(ctx, injection) {
    // No provenance model. Untrusted text becomes an episode like any other, and is
    // retrievable like any other. This is the expected failure.
    await store(ctx, `00000000-0000-0000-0000-0000000000${'01'}`, [injection.text]);
    return 0;
  },

  async currentValue(ctx, predicate) {
    // No structured beliefs, so every read is a retrieval plus a model call.
    const r = await this.answer(ctx, `What is the person's current ${predicate.replace(/_/g, ' ')}?`);
    return { value: /unknown/i.test(r.text) ? null : r.text, costUsd: r.costUsd };
  },

  async answer(ctx, question) {
    const context = await tenantSession(ctx, async (c) => {
      const episodes = await recall(c, ctx.userId, question, 8).catch(() => []);
      return episodes.map((e) => `- they said: "${e.text}"`).join('\n') || '(nothing known)';
    });
    const res = await llm.complete(
      {
        task: 'chat',
        instructions: PROBE,
        messages: [{ role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` }],
        tenantId: ctx.tenantId, userId: ctx.userId, maxOutputTokens: 128, thinking: false,
      },
      modelFor('chat'),
    );
    return { text: res.text, costUsd: res.usage.costUsd };
  },
};
