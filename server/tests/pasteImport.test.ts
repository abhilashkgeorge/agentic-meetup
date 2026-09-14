/**
 * Paste-back import. The model is stubbed so this runs with no key and no cost.
 *
 * The property under test is not "does it extract things" -- it is that imported
 * content is never believed until the person confirms it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({ parsed: { facts: [], unsure: [] } as unknown }));

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'anthropic:claude-sonnet-5',
  llm: {
    complete: async () => ({
      text: '', parsed: stub.parsed,
      usage: {
        inputTokens: 2000, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 400,
        reasoningTokens: 0, provider: 'anthropic', modelId: 'claude-sonnet-5',
        costUsd: 0.008, latencyMs: 1200,
      },
    }),
  },
}));

const { pool, tenantSession } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { importPastedText, pendingConfirmation, confirmStagedFact, rejectStagedFact, reviewable } =
  await import('../src/memory/pasteImport.js');
const { commit, currentState, history } = await import('../src/memory/facts.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
let ctx = { tenantId: '', userId: '' };

const fact = (predicate: string, object_text: string, over = {}) => ({
  predicate, object_text, source_span: `they said ${object_text}`,
  valid_from: '', ...over,
});

beforeAll(async () => {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`paste-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `paste-${Date.now()}@example.test`]);
  ctx = { tenantId, userId: u.rows[0]!.id };
});

beforeEach(async () => {
  await owner.query('DELETE FROM facts WHERE user_id = $1', [ctx.userId]);
  await owner.query('DELETE FROM memory_audit WHERE user_id = $1', [ctx.userId]);
});

afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
  await owner.end();
  await pool.end();
});

describe('imported content is never believed on arrival', () => {
  it('stages everything, asserts nothing', async () => {
    stub.parsed = { facts: [fact('works_at', 'Acme'), fact('lives_in', 'Berlin')], unsure: [] };
    const r = await tenantSession(ctx, (c) => importPastedText(c, ctx, 'blah', 'assistant'));
    expect(r.staged).toBe(2);

    // The load-bearing assertion. An assistant's summary is the weakest possible
    // evidence about a person, and nothing here has been checked with them yet.
    const active = await tenantSession(ctx, (c) => currentState(c, ctx.userId));
    expect(active).toHaveLength(0);
  });

  it('stages self-description too, not just assistant output', async () => {
    // Prose written about yourself in one sitting is still a claim.
    stub.parsed = { facts: [fact('lives_in', 'Lisbon')], unsure: [] };
    await tenantSession(ctx, (c) => importPastedText(c, ctx, 'I live in Lisbon', 'self'));
    expect(await tenantSession(ctx, (c) => currentState(c, ctx.userId))).toHaveLength(0);
  });

  it('cannot silently overwrite a fact the user actually asserted', async () => {
    await tenantSession(ctx, (c) =>
      commit(c, ctx, {
        predicate: 'lives_in', objectText: 'London', stance: 'asserted',
        sourceQuote: 'I live in London', sourceEpisodeIds: [], originClass: 'owner',
        extractorModel: 'test', extractorVersion: '0', promptVersion: '0',
      }),
    );
    // A stale assistant summary claiming a different city must not win.
    stub.parsed = { facts: [fact('lives_in', 'Berlin')], unsure: [] };
    await tenantSession(ctx, (c) => importPastedText(c, ctx, 'blah', 'assistant'));

    const active = await tenantSession(ctx, (c) => currentState(c, ctx.userId, ['lives_in']));
    expect(active).toHaveLength(1);
    expect(active[0]?.objectText).toBe('London');
  });

  it('records provenance the user will recognise', async () => {
    stub.parsed = { facts: [fact('works_at', 'Acme')], unsure: [] };
    await tenantSession(ctx, (c) => importPastedText(c, ctx, 'blah', 'assistant'));
    const { rows } = await owner.query<{ origin_class: string; stance: string; source_quote: string }>(
      'SELECT origin_class, stance, source_quote FROM facts WHERE user_id = $1', [ctx.userId]);
    expect(rows[0]?.origin_class).toBe('untrusted');
    expect(rows[0]?.stance).toBe('reported');
    expect(rows[0]?.source_quote).toContain('Acme');
  });
});

describe('lazy promotion in conversation', () => {
  it('offers one at a time, never a wall', async () => {
    stub.parsed = { facts: [fact('works_at', 'Acme'), fact('lives_in', 'Berlin'), fact('interest', 'chess')], unsure: [] };
    await tenantSession(ctx, (c) => importPastedText(c, ctx, 'blah', 'assistant'));
    const pending = await tenantSession(ctx, (c) => pendingConfirmation(c, ctx.userId));
    expect(pending).toHaveLength(1);
  });

  it('confirming runs the fact through the real gates, including supersession', async () => {
    await tenantSession(ctx, (c) =>
      commit(c, ctx, {
        predicate: 'lives_in', objectText: 'London', stance: 'asserted',
        sourceQuote: 'seed', sourceEpisodeIds: [], originClass: 'owner',
        extractorModel: 'test', extractorVersion: '0', promptVersion: '0',
      }),
    );
    stub.parsed = { facts: [fact('lives_in', 'Berlin')], unsure: [] };
    await tenantSession(ctx, (c) => importPastedText(c, ctx, 'blah', 'assistant'));

    const [staged] = await tenantSession(ctx, (c) => pendingConfirmation(c, ctx.userId));
    const r = await tenantSession(ctx, (c) => confirmStagedFact(c, ctx, staged!.id));
    expect(r.confirmed).toBe(true);

    // Confirmation is a first-party assertion, so the unique index retires London.
    const active = await tenantSession(ctx, (c) => currentState(c, ctx.userId, ['lives_in']));
    expect(active).toHaveLength(1);
    expect(active[0]?.objectText).toBe('Berlin');

    const lineage = await tenantSession(ctx, (c) => history(c, ctx.userId, 'lives_in'));
    expect(lineage.find((f) => f.objectText === 'London')?.status).toBe('superseded');
    // The untrusted original is retracted, not mutated: the audit trail must show a
    // claim was ratified, not that trust was edited in place.
    expect(lineage.filter((f) => f.status === 'retracted')).toHaveLength(1);
  });

  it('rejecting keeps the row as evidence of what the import got wrong', async () => {
    stub.parsed = { facts: [fact('works_at', 'Globex')], unsure: [] };
    await tenantSession(ctx, (c) => importPastedText(c, ctx, 'blah', 'assistant'));
    const [staged] = await tenantSession(ctx, (c) => pendingConfirmation(c, ctx.userId));
    await tenantSession(ctx, (c) => rejectStagedFact(c, ctx.userId, staged!.id));

    expect(await tenantSession(ctx, (c) => pendingConfirmation(c, ctx.userId))).toHaveLength(0);
    const { rows } = await owner.query('SELECT status FROM facts WHERE user_id = $1', [ctx.userId]);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { status: string }).status).toBe('retracted');
  });
});

describe('degradation', () => {
  it('empty input is a no-op, not an error', async () => {
    const r = await tenantSession(ctx, (c) => importPastedText(c, ctx, '   ', 'self'));
    expect(r).toEqual({ staged: 0, rejected: 0, questions: 0, costUsd: 0, model: '' });
  });

  it('predicates outside the vocabulary are rejected, not invented', async () => {
    stub.parsed = { facts: [fact('favourite_sandwich', 'reuben'), fact('lives_in', 'Berlin')], unsure: [] };
    const r = await tenantSession(ctx, (c) => importPastedText(c, ctx, 'blah', 'assistant'));
    expect(r.rejected).toBe(1);
    expect(r.staged).toBe(1);
  });
});

/**
 * Regression, found in dogfooding. The imported profile contained:
 *
 *   "Your marital status -- you mentioned sending a 'best photo' feature to 'my
 *    wife,' which implies you're married, but you haven't stated it directly."
 *
 * The importer stored relationship_status='married'. It set the uncertainty flag
 * correctly and then nothing downstream did anything with it, so the row sat in the
 * staged pool indistinguishable from a fact the person had actually given. The user
 * is not married.
 *
 * The fix is structural rather than a stronger flag: guesses go to a different
 * destination, so there is no row that could leak into a prompt, a profile rebuild
 * or an export. This test holds that separation.
 */
describe('a guess is a question, never a fact', () => {
  it('routes unsure items to the question queue and writes no fact for them', async () => {
    stub.parsed = {
      facts: [fact('lives_in', 'Bangalore')],
      unsure: [
        {
          topic: 'marital status',
          source_span: "which implies you're married, but you haven't stated it directly",
          question: 'Are you married?',
        },
      ],
    };

    const r = await tenantSession(ctx, (c) =>
      importPastedText(c, ctx, 'a profile from their assistant', 'assistant'),
    );
    expect(r.staged).toBe(1);
    expect(r.questions).toBe(1);

    // Nothing at all in `facts` -- not staged, not retracted, not a row.
    const rows = await owner.query(
      `SELECT id FROM facts WHERE user_id = $1 AND predicate = 'relationship_status'`,
      [ctx.userId],
    );
    expect(rows.rowCount).toBe(0);

    const qs = await owner.query<{ kind: string; clarifying_question: string; fact_a_id: string | null }>(
      `SELECT kind, clarifying_question, fact_a_id FROM fact_conflicts WHERE user_id = $1`,
      [ctx.userId],
    );
    expect(qs.rows).toHaveLength(1);
    expect(qs.rows[0]!.kind).toBe('gap');
    expect(qs.rows[0]!.fact_a_id).toBeNull();
    expect(qs.rows[0]!.clarifying_question).toBe('Are you married?');
  });

  it('does not re-ask the same question on a second import', async () => {
    const unsure = [{ topic: 'marital status', source_span: 'x', question: 'Are you married?' }];
    stub.parsed = { facts: [], unsure };
    await tenantSession(ctx, (c) => importPastedText(c, ctx, 'first paste', 'assistant'));

    stub.parsed = { facts: [], unsure };
    const second = await tenantSession(ctx, (c) =>
      importPastedText(c, ctx, 'same profile pasted again', 'assistant'),
    );
    // Pasting twice is normal behaviour. Asking twice is not.
    expect(second.questions).toBe(0);

    const qs = await owner.query(
      `SELECT 1 FROM fact_conflicts WHERE user_id = $1 AND clarifying_question = 'Are you married?'`,
      [ctx.userId],
    );
    expect(qs.rowCount).toBe(1);
  });
});

/**
 * Regression: an import must not become an interrogation.
 *
 * The design says facts are ratified in conversation, never through a confirm/reject
 * wall. Gate 0010 then made an untrusted fact unable to go active at all -- correct,
 * and it produced the wall by accident: forty low-stakes claims, queued one at a
 * time, asking whether it is really true that you are interested in chess.
 *
 * The split is by `durability`, which the predicate table already carried. Hard facts
 * are expensive to get wrong and there are few of them; soft facts are cheap and there
 * are many. Only the first kind earns a question.
 */
describe('importing does not produce a queue of questions', () => {
  it('offers hard facts one at a time and leaves soft ones out of that queue', async () => {
    stub.parsed = {
      facts: [
        fact('lives_in', 'Bangalore'),      // hard  -> asked
        fact('works_at', 'Wifidabba'),      // hard  -> asked
        fact('interest', 'chess'),          // soft  -> bulk
        fact('interest', 'One Piece'),      // soft  -> bulk
        fact('owns', 'an RTX 3060'),        // soft  -> bulk
      ],
      unsure: [],
    };
    await tenantSession(ctx, (c) => importPastedText(c, ctx, 'a profile', 'assistant'));

    const asked = await tenantSession(ctx, (c) => pendingConfirmation(c, ctx.userId, 50));
    const pile = await tenantSession(ctx, (c) => reviewable(c, ctx.userId));

    expect(asked.map((f) => f.predicate).sort()).toEqual(['lives_in', 'works_at']);
    expect(pile.map((f) => f.predicate).sort()).toEqual(['interest', 'interest', 'owns']);
    // The whole point: the many cheap ones never enter the one-at-a-time queue.
    expect(asked.some((f) => f.predicate === 'interest')).toBe(false);
  });

  it('a bulk keep believes them, and a strike-out drops them', async () => {
    stub.parsed = {
      facts: [fact('interest', 'chess'), fact('interest', 'bad guess')],
      unsure: [],
    };
    await tenantSession(ctx, (c) => importPastedText(c, ctx, 'a profile', 'assistant'));

    const pile = await tenantSession(ctx, (c) => reviewable(c, ctx.userId));
    const wrong = pile.find((f) => f.objectText === 'bad guess')!;

    await tenantSession(ctx, async (c) => {
      for (const f of pile) {
        if (f.id === wrong.id) await rejectStagedFact(c, ctx.userId, f.id);
        else await confirmStagedFact(c, ctx, f.id);
      }
    });

    const live = await tenantSession(ctx, (c) => currentState(c, ctx.userId, ['interest']));
    expect(live.map((f) => f.objectText)).toContain('chess');
    expect(live.map((f) => f.objectText)).not.toContain('bad guess');
    // Kept facts are re-committed as first-party, which is what lets them go active
    // at all -- 0010 forbids an untrusted row from ever being believed.
    expect(await tenantSession(ctx, (c) => reviewable(c, ctx.userId))).toHaveLength(0);
  });
});
