/**
 * The conversation is a discovery, or it is nothing.
 *
 * WHAT WAS WRONG. Both agents were handed the other person's ENTIRE dossier before the
 * first word, so five "conversations" were five probes on top of full disclosure and
 * could learn nothing a file-versus-file score did not already know. The assessor was
 * then asked what it learned "beyond their summary" -- a document it was never given.
 * And the dossier itself prepended prose rendered from facts with no disclosure filter,
 * while its own header promised a structural exclusion.
 *
 * Every test here captures what the model was actually sent, because that is the only
 * place any of this can be checked.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({
  /** Every request the adapter saw, so a test can read what each agent was told. */
  requests: [] as { instructions?: string; messages: { role: string; content: string }[]; outputSchemaName?: string }[],
}));

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'google:gemini-3.5-flash-lite',
  llm: {
    complete: async (req: {
      instructions?: string; messages: { role: string; content: string }[];
      outputSchema?: unknown; outputSchemaName?: string;
    }) => {
      stub.requests.push(req);
      const usage = {
        inputTokens: 500, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 60,
        reasoningTokens: 0, provider: 'google', modelId: 'flash-lite',
        costUsd: 0.0001, latencyMs: 100,
      };
      if (!req.outputSchema) return { text: 'a message', parsed: null, usage };
      if (req.outputSchemaName === 'brief') {
        return { text: '', parsed: { headline: 'h', pairs: [], questions: [] }, usage };
      }
      if (req.outputSchemaName === 'file_verdict') {
        return { text: '', parsed: { concern: 'c', score: 0.5 }, usage };
      }
      return { text: '', parsed: { verdict: 'yes', learned: ['a', 'b', 'c'], concern: 'x' }, usage };
    },
  },
}));

const { pool, tenantSession, matchmakerSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const { buildDossier, publicTags, pickConcern, converse } = await import('../src/matching/rendezvous.js');
const { rebuildMatchProfile } = await import('../src/matching/profile.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 120_000 });
beforeEach(() => { stub.requests = []; });

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

type Ctx = { tenantId: string; userId: string };

async function person(label: string): Promise<Ctx> {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`dsc-${label}-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `dsc-${label}-${Date.now()}-${Math.random()}@example.test`]);
  return { tenantId, userId: u.rows[0]!.id };
}

const say = (ctx: Ctx, predicate: string, text: string, disclosure?: 'public' | 'private') =>
  tenantSession(ctx, async (c) => {
    await commit(c, ctx, {
      predicate, objectText: text, objectValue: text,
      stance: 'asserted', originClass: 'owner', sourceQuote: text,
      sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    });
    if (disclosure) {
      await c.query('UPDATE facts SET disclosure = $3 WHERE user_id = $1 AND predicate = $2',
        [ctx.userId, predicate, disclosure]);
    }
  });

describe('the dossier', () => {
  it('carries public facts and NOT private ones, and no unfiltered prose', async () => {
    const p = await person('dossier');
    await say(p, 'interest', 'climbing', 'public');
    await say(p, 'religion', 'quaker', 'private');
    // A rendered prose block that mentions the private fact, the way promotableFacts
    // used to produce one. This is what leaked.
    await owner.query(
      `INSERT INTO core_profile
         (tenant_id, user_id, block_name, content, token_count, rendering_model, source_fact_ids)
       VALUES ($1,$2,'situation','A quaker who climbs at weekends.', 8, 'test', '{}')`,
      [p.tenantId, p.userId]);

    const dossier = await matchmakerSession((c) => buildDossier(c, p.userId));
    expect(dossier).toContain('climbing');
    expect(dossier).not.toContain('quaker');
    expect(dossier).not.toContain('weekends');
  });
});

describe('what the other agent is told', () => {
  it('is the public tags, filtered by disclosure, not the file', async () => {
    const p = await person('tags');
    await say(p, 'interest', 'climbing', 'public');
    await say(p, 'religion_importance', 'high', 'private');
    await tenantSession(p, (c) => rebuildMatchProfile(c, p));
    const tags = await matchmakerSession((c) => publicTags(c, p.userId));
    expect(tags).toContain('interest:climbing');
    expect(tags.some((t) => t.startsWith('religion_importance'))).toBe(false);
  });

  it('never includes the dossier in the prober prompt, and does include the tags', async () => {
    const a = { userId: crypto.randomUUID(), tenantId: crypto.randomUUID(),
      dossier: 'SECRET-A-DOSSIER climbs and works in software', voice: '', tags: ['interest:climbing'] };
    const b = { userId: crypto.randomUUID(), tenantId: crypto.randomUUID(),
      dossier: 'SECRET-B-DOSSIER pottery and a cat', voice: '', tags: ['interest:pottery'] };
    await converse(a, b, 1);

    const probes = stub.requests.filter((r) => !r.outputSchemaName);
    expect(probes.length).toBeGreaterThan(0);
    for (const r of probes) {
      const text = r.messages.map((m) => m.content).join('\n');
      // Its OWN dossier, yes. The other's, never.
      const mine = text.includes('SECRET-A-DOSSIER') ? 'A' : 'B';
      expect(text).not.toContain(mine === 'A' ? 'SECRET-B-DOSSIER' : 'SECRET-A-DOSSIER');
      expect(text).toContain(mine === 'A' ? 'pottery' : 'climbing');
    }
  });

  it('tells the assessor what was public, and no longer cites a summary it lacks', async () => {
    const a = { userId: crypto.randomUUID(), tenantId: crypto.randomUUID(),
      dossier: 'A', voice: '', tags: ['interest:climbing'] };
    const b = { userId: crypto.randomUUID(), tenantId: crypto.randomUUID(),
      dossier: 'B', voice: '', tags: ['interest:pottery'] };
    await converse(a, b, 1);
    const judges = stub.requests.filter((r) => r.outputSchemaName === 'verdict');
    expect(judges.length).toBe(2);
    for (const r of judges) {
      expect(r.instructions ?? '').not.toContain('their summary');
      const text = r.messages.map((m) => m.content).join('\n');
      expect(text).toContain('already public about the other person');
    }
  });
});

describe('the concern the human sees', () => {
  it('is the one the runs kept coming back to, not the last', () => {
    const picked = pickConcern([
      'They seem to work every weekend and never switch off.',
      'Hard to tell if they would ever leave the city.',
      'They work every single weekend and seem unable to switch off from it.',
      'Weekends are always work for them; switching off looks hard.',
      'Not sure they like dogs.',                                   // last, and a one-off
    ]);
    expect(picked.toLowerCase()).toContain('weekend');
    expect(picked).not.toContain('dogs');
  });

  it('falls back to the last one when nothing repeats', () => {
    expect(pickConcern(['alpha beta gamma', 'delta epsilon zeta', 'eta theta iota']))
      .toBe('eta theta iota');
  });

  it('ignores blanks', () => {
    expect(pickConcern(['', '  ', 'only this one'])).toBe('only this one');
    expect(pickConcern([])).toBe('');
  });
});
