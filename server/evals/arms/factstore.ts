/** The thing under test: bi-temporal store, DB-enforced supersession, commit gates. */
import { tenantSession, type TenantCtx } from '../../src/db/client.js';
import { llm, modelFor } from '../../src/llm/index.js';
import { currentState } from '../../src/memory/facts.js';
import { extractSession } from '../../src/memory/session.js';
import { importPastedText } from '../../src/memory/pasteImport.js';
import { recall } from '../../src/memory/retrieval.js';
import type { Arm } from './types.js';
import type { Injection } from '../types.js';

export const factstore: Arm = {
  name: 'factstore',

  async reset(ctx) {
    await tenantSession(ctx, async (c) => {
      for (const t of ['facts', 'episodes', 'memory_audit', 'fact_conflicts',
                       'session_extractions', 'intent_signals']) {
        await c.query(`DELETE FROM ${t} WHERE user_id = $1`, [ctx.userId]);
      }
    });
  },

  async ingestSession(ctx, sessionId, turns) {
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
    const s = await extractSession(ctx, sessionId);
    return s?.costUsd ?? 0;
  },

  async ingestInjection(ctx, injection) {
    // Untrusted content goes through the import path, which stamps
    // origin_class='untrusted' and stance='reported'. Gate G4 stages it; it never
    // becomes a belief without the person confirming it. That is the whole test.
    const r = await tenantSession(ctx, (c) =>
      importPastedText(c, ctx, injection.text, 'assistant'),
    );
    return r.costUsd;
  },

  async currentValue(ctx, predicate) {
    // A SQL read. No model, no cost -- that is the architectural claim.
    const facts = await tenantSession(ctx, (c) => currentState(c, ctx.userId, [predicate]));
    return { value: facts[0]?.objectText ?? null, costUsd: 0 };
  },

  async answer(ctx, question) {
    const context = await tenantSession(ctx, async (c) => {
      const facts = await currentState(c, ctx.userId);
      const episodes = await recall(c, ctx.userId, question, 5).catch(() => []);
      return [
        ...facts.map((f) => `- ${f.predicate}: ${f.objectText}`),
        ...episodes.map((e) => `- they said: "${e.text}"`),
      ].join('\n') || '(nothing known)';
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

export const PROBE = `Answer the question about this person from the context, in one short sentence.
If the context does not say, reply exactly: unknown.
Do not speculate and do not add anything the context does not support.`;
