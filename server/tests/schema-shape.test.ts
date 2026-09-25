/**
 * The shape of the schema, as a production database and not a scratch one.
 *
 * WHAT WAS FOUND, looking at the live database in a GUI: 96 relations. 64 of them
 * are the hash partitions of `facts` and `episodes` -- deliberate, documented in
 * 0001/0002, locked in 0035 -- and 32 are real tables. Of the 32, one had never been
 * written by anything (`directives`), and three global tables carried write grants
 * for the application role that nothing had decided on: 0000's ALTER DEFAULT
 * PRIVILEGES hands clone_app all four privileges on every table unless a migration
 * takes them back, and for `schema_migrations`, `predicates` and `invites` none had.
 *
 * Every assertion here is against the live catalogue, as the roles the server
 * actually connects with, because the grants are the thing and a grant cannot be
 * read from source.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { env } from '../src/env.js';
import { USER_TABLES } from '../src/memory/erasure.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
afterAll(() => owner.end());

const can = async (role: string, priv: string, table: string) =>
  (await owner.query<{ ok: boolean }>(
    'SELECT has_table_privilege($1, $2, $3) AS ok', [role, table, priv])).rows[0]!.ok;

describe('every table is either the app\'s, or explicitly not', () => {
  it('has row-level security on every table that carries a user or tenant column', async () => {
    const { rows } = await owner.query<{ relname: string }>(`
      SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
         AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
         AND EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND NOT a.attisdropped
                        AND a.attname IN ('user_id', 'tenant_id'))`);
    // The eraser's own log is owner/eraser-only (0040) and has no app grant at all;
    // that is the one table allowed to answer to a user column without a policy.
    expect(rows.map((r) => r.relname).sort()).toEqual(['erasure_log']);
    expect(await can('clone_app', 'SELECT', 'erasure_log')).toBe(false);
  });

  it('has a partition count that matches the migration, and none reachable by name', async () => {
    const { rows } = await owner.query<{ parent: string; n: string }>(`
      SELECT p.relname AS parent, count(*) AS n
        FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
       WHERE c.relkind = 'r' GROUP BY p.relname ORDER BY p.relname`);
    expect(rows.map((r) => [r.parent, Number(r.n)])).toEqual([['episodes', 32], ['facts', 32]]);
    // clone_door and clone_discovery (0066) read episodes through the parent only.
    for (const role of ['clone_app', 'clone_match', 'clone_matchmaker', 'clone_door', 'clone_discovery']) {
      expect(await can(role, 'SELECT', 'facts_p0'), `${role} on facts_p0`).toBe(false);
      expect(await can(role, 'SELECT', 'episodes_p0'), `${role} on episodes_p0`).toBe(false);
    }
  });
});

describe('the table nothing ever wrote', () => {
  it('is gone, from the database and from the erasure list', async () => {
    const { rows } = await owner.query(`SELECT to_regclass('public.directives') AS r`);
    expect(rows[0]!.r).toBeNull();
    expect((USER_TABLES as readonly string[]).includes('directives')).toBe(false);
  });
});

describe('global tables the application only reads, or never touches', () => {
  it('will not let the app role rewrite the migration ledger', async () => {
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      expect(await can('clone_app', priv, 'schema_migrations'), priv).toBe(false);
    }
  });

  it('lets the app and the matcher read the predicate dictionary but not change it', async () => {
    expect(await can('clone_app', 'SELECT', 'predicates')).toBe(true);
    expect(await can('clone_match', 'SELECT', 'predicates')).toBe(true);
    for (const priv of ['INSERT', 'UPDATE', 'DELETE']) {
      expect(await can('clone_app', priv, 'predicates'), priv).toBe(false);
    }
  });

  it('lets the app role claim, reserve and mint invites, but never delete one', async () => {
    // adminSession is clone_app without a tenant context, not the owner pool, and
    // invites has no RLS on purpose: a code is claimed before its claimant has a
    // tenant. The first draft of 0053 revoked everything and eight tests said so.
    for (const priv of ['SELECT', 'INSERT', 'UPDATE']) {
      expect(await can('clone_app', priv, 'invites'), priv).toBe(true);
    }
    expect(await can('clone_app', 'DELETE', 'invites')).toBe(false);
    for (const role of ['clone_match', 'clone_matchmaker']) {
      expect(await can(role, 'SELECT', 'invites'), role).toBe(false);
    }
  });
});
