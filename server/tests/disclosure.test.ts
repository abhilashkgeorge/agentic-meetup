/**
 * What an agent may say about its human to a stranger.
 *
 * THE BUG THIS EXISTS FOR. `facts.disclosure` shipped with a safe default of
 * `matchable_only` and nothing ever moved a fact off it. `buildDossier` filters on
 * `disclosure = 'public'`, so every agent walked into every rendezvous holding
 * NOTHING -- and the first real run came back `passed: true`, two of three runs both
 * saying yes. They were agreeing about nobody at all.
 *
 * A default that is safe and never changes is not a safe default, it is a disabled
 * feature. These tests pin both halves: enough is public for an agent to have a
 * conversation, and the things that would be an incident are not.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { defaultDisclosure, NEVER_PUBLIC, PUBLIC_BY_DEFAULT } from '@clone/shared';
import { pool, tenantSession, matchmakerSession, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { commit } from '../src/memory/facts.js';
import { buildDossier } from '../src/matching/rendezvous.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
let ctx = { tenantId: '', userId: '' };

const fact = (predicate: string, objectText: string) =>
  tenantSession(ctx, (c) =>
    commit(c, ctx, {
      predicate, objectText, stance: 'asserted', sourceQuote: `I ${objectText}`,
      sourceEpisodeIds: [], originClass: 'owner', extractorModel: 't',
      extractorVersion: '0', promptVersion: '0',
    }),
  );

beforeAll(async () => {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`disc-${Math.random()}`]);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [t.rows[0]!.id, `disc-${Math.random()}@example.test`]);
  ctx = { tenantId: t.rows[0]!.id, userId: u.rows[0]!.id };
});

afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

describe('the default', () => {
  it('lets an agent talk about the things a dating profile is made of', () => {
    for (const p of ['interest', 'works_in', 'lives_in', 'relationship_intent',
                     'media_taste', 'value', 'diet', 'pet', 'prompt_answer']) {
      expect(defaultDisclosure(p), p).toBe('public');
    }
  });

  it('never volunteers the things that would be an incident', () => {
    // Not a filter in a prompt. An agent handed somebody's whole memory will repeat
    // all of it to a stranger, and asking it not to is not a control.
    for (const p of ['medical_condition', 'allergy', 'religion', 'politics',
                     'ethnicity', 'works_at', 'full_name', 'relationship_status']) {
      expect(defaultDisclosure(p), p).toBe('matchable_only');
    }
  });

  it('has no predicate in both lists', () => {
    const both = [...PUBLIC_BY_DEFAULT].filter((p) => NEVER_PUBLIC.has(p));
    expect(both, `contradictory: ${both.join(', ')}`).toEqual([]);
  });
});

describe('a dossier', () => {
  it('carries the public facts and not the rest', async () => {
    await fact('interest', 'rock climbing');
    await fact('works_in', 'software');
    await fact('religion', 'hindu');
    await fact('medical_condition', 'asthma');

    const dossier = await matchmakerSession((c) => buildDossier(c, ctx.userId));

    // The thing that was broken: it is not empty.
    expect(dossier.length).toBeGreaterThan(10);
    expect(dossier).toContain('rock climbing');
    expect(dossier).toContain('software');

    // The thing that must stay broken.
    expect(dossier).not.toContain('hindu');
    expect(dossier).not.toContain('asthma');
  });

  it('is enforced by the database, not by the query', async () => {
    // The matchmaker's policy allows only public rows, so even a query that forgot to
    // filter cannot see the rest. A filter in one query is a filter the next query
    // does not have.
    const rows = await matchmakerSession((c) =>
      c.query<{ predicate: string }>(
        'SELECT predicate FROM facts WHERE user_id = $1', [ctx.userId]),
    );
    expect(rows.rows.map((r) => r.predicate).sort())
      .toEqual(['interest', 'works_in']);
  });
});
