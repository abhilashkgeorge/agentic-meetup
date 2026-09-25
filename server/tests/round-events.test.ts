/**
 * What the town hears while a round runs, and when.
 *
 * The order is the choreography: queued, then one `met` per person the agent will
 * visit (all before anything else, because the pairs are claimed by then), then
 * `talking` and `decided` for each in turn, then `done`. Every `agent` is a
 * per-viewer ref, never an id; nothing in any frame is a name -- and, since
 * 2026-09-23, nothing in any frame is a verdict: `decided` used to carry how the
 * agents got on, drawn as a tick or a cross over two heads.
 *
 * THE DURABILITY ASSERTION is the reason the write moved inside the loop: when the
 * `decided` frame for the first pair arrives, that pair's row already says so in the
 * database -- the event is sent after the write, not from a batch at the end. The
 * fake socket reads the row the instant the frame lands. Negative control: send the
 * frame before writePair and this races to 'running'.
 *
 * The model is stubbed exactly as in labels.test.ts.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'google:gemini-3.5-flash-lite',
  // Off, as it is by default. Without it every round's jevFileScore threw vitest's
  // "no decideModel export" and the orchestrator's catch swallowed it, so a zero call
  // count here passed partly through an error. brief-code-only.test.ts guards the
  // real default.
  decideModel: () => null,
  llm: {
    complete: async (req: { outputSchema?: unknown; outputSchemaName?: string }) => {
      stub.calls++;
      const usage = {
        inputTokens: 500, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 60,
        reasoningTokens: 0, provider: 'google', modelId: 'flash-lite', costUsd: 0.0001, latencyMs: 100,
      };
      if (!req.outputSchema) return { text: 'a message', parsed: null, usage };
      if (req.outputSchemaName === 'brief') return { text: '', parsed: { headline: 'Two people', pairs: [], questions: [] }, usage };
      if (req.outputSchemaName === 'file_verdict') return { text: '', parsed: { concern: 'c', score: 0.4 }, usage };
      return { text: '', parsed: { verdict: 'yes', learned: ['a', 'b', 'c'], concern: 'x' }, usage };
    },
  },
}));

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const { enqueueRound, runOneQueuedRound } = await import('../src/matching/rounds.js');
const { agentRef } = await import('../src/matching/world.js');
const hub = await import('../src/messaging/hub.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 180_000 });

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string }
async function person(label: string, over: Record<string, unknown> = {}): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`re-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `re-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: ['long_term'],
    in_pool: true, is_synthetic: false, sees_synthetic: false, display_name: label, ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map((k) => cols[k]));
  const ctx = { tenantId, userId };
  // One public fact each, so the file scorer has something to read.
  await tenantSession(ctx, (c) => commit(c, ctx, {
    predicate: 'interest', objectText: `thing-${label}`, objectValue: `thing-${label}`,
    stance: 'asserted', originClass: 'owner', sourceQuote: 'x', sourceEpisodeIds: [],
    extractorModel: 't', extractorVersion: '0', promptVersion: '0',
  }));
  return ctx;
}

describe('a round, as the town hears it', () => {
  it('announces every meeting first, then each talk and verdict, then done -- by ref, and the row agrees', async () => {
    const tag = `re-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const them = await person('them', { intent: [tag] });

    const frames: Array<Record<string, unknown>> = [];
    const rowAtDecided: Array<Promise<string>> = [];
    hub.join(me.userId, {
      readyState: 1,
      send: (t: string) => {
        const f = JSON.parse(t) as Record<string, unknown>;
        frames.push(f);
        // The instant the frame lands, what does the row say?
        if (f.type === 'round.decided') {
          rowAtDecided.push(owner.query<{ status: string }>(
            'SELECT status FROM rendezvous WHERE id = $1', [f.rendezvousId]).then((r) => r.rows[0]!.status));
        }
      },
    } as never);

    const round = await enqueueRound(me);
    expect(frames).toEqual([{ type: 'round.queued', roundId: round.id }]);

    expect(await runOneQueuedRound(round.id)).toBe(true);

    const types = frames.map((f) => f.type);
    expect(types).toEqual(['round.queued', 'round.met', 'round.talking', 'round.decided', 'round.done']);

    const ref = agentRef(me.userId, them.userId);
    for (const f of frames.filter((f) => 'agent' in f)) {
      expect(f.agent).toBe(ref);
      expect(f.agent).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(JSON.stringify(frames)).not.toContain(them.userId);
    expect(JSON.stringify(frames)).not.toContain('"name"');
    // "They met", and not a word about how it went -- whatever a model would have said.
    const decided = frames.find((f) => f.type === 'round.decided');
    expect(decided).not.toHaveProperty('agreement');
    expect(JSON.stringify(frames)).not.toMatch(/got_on|unsure|did_not_click|could_not_tell/);
    expect(frames.at(-1)).toMatchObject({ type: 'round.done', roundId: round.id, met: 1, error: null });

    // Durable before it was announced.
    expect(await Promise.all(rowAtDecided)).toEqual(['decided']);
    // And the whole choreography cost nothing: no conversation, no file score, no
    // model-written brief.
    expect(stub.calls).toBe(0);
  });
});
