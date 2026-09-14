/**
 * End-to-end P1: transcript -> extraction -> commit -> supersession + conflicts.
 * The model is stubbed, so this runs in CI with no API key and no cost, and it
 * tests OUR pipeline rather than the model's mood.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({ parsed: { facts: [], possibly_false: [], intents: [] } as unknown }));

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'anthropic:claude-sonnet-5',
  llm: {
    complete: async () => ({
      text: '',
      parsed: stub.parsed,
      usage: {
        inputTokens: 1000, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 200,
        reasoningTokens: 0, provider: 'anthropic', modelId: 'claude-sonnet-5',
        costUsd: 0.004, latencyMs: 900,
      },
    }),
  },
}));

const { pool, tenantSession } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { extractSession } = await import('../src/memory/session.js');
const { commit, currentState, history } = await import('../src/memory/facts.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
let ctx = { tenantId: '', userId: '' };
const sessionId = '11111111-1111-1111-1111-111111111111';

async function addTurn(role: 'user' | 'assistant', text: string, idx: number) {
  await tenantSession(ctx, (c) =>
    c.query(
      `INSERT INTO episodes (tenant_id, user_id, session_id, turn_id, turn_index,
                             role, source, raw_text, occurred_at, ingested_at)
       VALUES ($1,$2,$3,gen_random_uuid(),$4,$5,'text',$6,now(),now())`,
      [ctx.tenantId, ctx.userId, sessionId, idx, role, text],
    ),
  );
}

beforeAll(async () => {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`sess-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `sess-${Date.now()}@example.test`]);
  ctx = { tenantId, userId: u.rows[0]!.id };
});

beforeEach(async () => {
  for (const t of ['facts', 'episodes', 'memory_audit', 'fact_conflicts',
                   'session_extractions', 'intent_signals']) {
    await owner.query(`DELETE FROM ${t} WHERE user_id = $1`, [ctx.userId]);
  }
});

afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
  await owner.end();
  await pool.end();
});

describe('session extraction', () => {
  it('turns a transcript into facts', async () => {
    await addTurn('user', 'I just started at Acme as a staff engineer. Moved to Berlin for it.', 0);
    await addTurn('assistant', 'Congratulations.', 1);

    stub.parsed = {
      facts: [
        { predicate: 'works_at', object_text: 'Acme', stance: 'asserted',
          hedge_span: '', source_quote: 'I just started at Acme', valid_from: '' },
        { predicate: 'lives_in', object_text: 'Berlin', stance: 'asserted',
          hedge_span: '', source_quote: 'Moved to Berlin for it', valid_from: '' },
      ],
      possibly_false: [],
      intents: [],
    };

    const s = await extractSession(ctx, sessionId);
    expect(s?.asserted).toBe(2);

    const facts = await tenantSession(ctx, (c) => currentState(c, ctx.userId));
    expect(facts.map((f) => f.objectText).sort()).toEqual(['Acme', 'Berlin']);
  });

  it('is idempotent — re-running with no new turns does nothing', async () => {
    await addTurn('user', 'I live in London.', 0);
    stub.parsed = {
      facts: [{ predicate: 'lives_in', object_text: 'London', stance: 'asserted',
                hedge_span: '', source_quote: 'I live in London', valid_from: '' }],
      possibly_false: [],
      intents: [],
    };
    expect(await extractSession(ctx, sessionId)).not.toBeNull();
    // Without this guard the sweeper would re-extract and re-charge every 60s.
    expect(await extractSession(ctx, sessionId)).toBeNull();
  });

  it('supersedes through the real commit path when the person moves', async () => {
    await tenantSession(ctx, (c) =>
      commit(c, ctx, {
        predicate: 'lives_in', objectText: 'London', stance: 'asserted',
        sourceQuote: 'seed', sourceEpisodeIds: [], originClass: 'owner',
        extractorModel: 'seed', extractorVersion: '0', promptVersion: '0',
      }),
    );
    await addTurn('user', "I've moved to Berlin.", 0);
    stub.parsed = {
      facts: [{ predicate: 'lives_in', object_text: 'Berlin', stance: 'asserted',
                hedge_span: '', source_quote: "I've moved to Berlin", valid_from: '' }],
      possibly_false: [],
      intents: [],
    };

    const s = await extractSession(ctx, sessionId);
    expect(s?.superseded).toBe(1);

    const lineage = await tenantSession(ctx, (c) => history(c, ctx.userId, 'lives_in'));
    expect(lineage).toHaveLength(2);
    expect(lineage.filter((f) => f.status === 'active')).toHaveLength(1);
  });

  it('a hedged statement is staged, and the old fact survives', async () => {
    await tenantSession(ctx, (c) =>
      commit(c, ctx, {
        predicate: 'works_at', objectText: 'Acme', stance: 'asserted',
        sourceQuote: 'seed', sourceEpisodeIds: [], originClass: 'owner',
        extractorModel: 'seed', extractorVersion: '0', promptVersion: '0',
      }),
    );
    await addTurn('user', 'I might quit and join Globex.', 0);
    stub.parsed = {
      facts: [{ predicate: 'works_at', object_text: 'Globex', stance: 'hypothetical',
                hedge_span: 'I might', source_quote: 'I might quit and join Globex',
                valid_from: '' }],
      possibly_false: [],
      intents: [],
    };

    const s = await extractSession(ctx, sessionId);
    expect(s?.staged).toBe(1);
    expect(s?.superseded).toBe(0);

    const active = await tenantSession(ctx, (c) => currentState(c, ctx.userId, ['works_at']));
    expect(active[0]?.objectText).toBe('Acme');
  });

  it('records what the person wanted the clone for, without a second model call', async () => {
    await addTurn('user', 'Been thinking about whether to leave my job.', 0);
    stub.parsed = {
      facts: [],
      possibly_false: [],
      // Rides along on the extraction call we already pay for.
      intents: [{ intent: 'advice', confidence: 0.8 }, { intent: 'introspection', confidence: 0.6 }],
    };
    await extractSession(ctx, sessionId);

    const { rows } = await owner.query<{ intent: string; confidence: number }>(
      'SELECT intent, confidence FROM intent_signals WHERE user_id = $1 ORDER BY intent',
      [ctx.userId],
    );
    expect(rows.map((r) => r.intent)).toEqual(['advice', 'introspection']);
    expect(rows[0]?.confidence).toBeCloseTo(0.8, 5);
  });

  it('raises a question instead of retracting, and does not nag', async () => {
    await tenantSession(ctx, (c) =>
      commit(c, ctx, {
        predicate: 'allergy', objectText: 'shellfish', stance: 'asserted',
        sourceQuote: 'seed', sourceEpisodeIds: [], originClass: 'owner',
        extractorModel: 'seed', extractorVersion: '0', promptVersion: '0',
      }),
    );
    await addTurn('user', 'Had a great prawn curry last night.', 0);
    stub.parsed = {
      facts: [],
      possibly_false: [{ predicate: 'allergy', current_value: 'shellfish',
                         why: 'They described eating prawns.' }],
      intents: [],
    };

    const s = await extractSession(ctx, sessionId);
    expect(s?.conflicts).toBe(1);

    // The fact is NOT retracted on one anecdote. It becomes a question.
    const active = await tenantSession(ctx, (c) => currentState(c, ctx.userId, ['allergy']));
    expect(active).toHaveLength(1);

    const { rows } = await owner.query<{ clarifying_question: string }>(
      'SELECT clarifying_question FROM fact_conflicts WHERE user_id = $1', [ctx.userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.clarifying_question).toContain('shellfish');

    // A second session raising the same conflict must not queue a duplicate.
    await addTurn('user', 'Prawns again today.', 1);
    await extractSession(ctx, sessionId);
    const after = await owner.query('SELECT 1 FROM fact_conflicts WHERE user_id = $1', [ctx.userId]);
    expect(after.rowCount).toBe(1);
  });
});
