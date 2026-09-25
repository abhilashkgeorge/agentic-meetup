/**
 * Database access, and the discipline that keeps RLS honest.
 *
 * THE FOOTGUN: behind a transaction-mode pooler (PgBouncer / Supavisor / RDS Proxy),
 * a plain `SET app.tenant_id` persists for the life of the pooled backend, and the
 * NEXT client to grab that connection inherits the previous tenant's context. It is
 * the single most common way teams accidentally break tenant isolation -- and it is
 * structurally identical to the `user_id="default"` fallback that disqualified
 * Hermes Agent from being our engine.
 *
 * So tenant context is ONLY ever stamped with `set_config(..., true)` -- the `true`
 * means transaction-LOCAL -- inside an explicit transaction, in exactly one function.
 * There is no other way to open a session against tenant data in this codebase.
 */
import { Pool, type PoolClient } from 'pg';
import { env } from '../env.js';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Kills a connection that a pooler has silently dropped, rather than failing a turn.
  keepAlive: true,
});

export interface TenantCtx {
  tenantId: string;
  userId: string;
}

/**
 * The ONLY way to touch tenant data. Opens a transaction, stamps the RLS context
 * transaction-locally, commits or rolls back as one unit.
 *
 * NEVER hold one of these open across an LLM call. A held-open xmin horizon measures
 * 14x dead tuples, 15x table size and -35% dequeue throughput -- bloat, not
 * throughput, is how this database fails. Read, close, call the model, reopen.
 */
export async function tenantSession<T>(
  ctx: TenantCtx,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true),
              set_config('app.user_id',   $2, true)`,
      [ctx.tenantId, ctx.userId],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * No tenant context. Because `clone_app` is NOSUPERUSER NOBYPASSRLS, this is NOT a
 * privilege escalation -- policies still apply, they simply evaluate against an unset
 * context and therefore match nothing on tenant-scoped tables. Use it only where
 * cross-tenant reads are genuinely the job:
 *
 *   - `dueSessions()`   the extraction sweeper, which by definition spans users
 *   - `src/db/stats.ts` founder-facing aggregates
 *   - `evals/runner.ts` scratch tenants
 *
 * Authentication does NOT use this -- see `authLookup()` below.
 */
export async function adminSession<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Resolve one user by id before any tenant context exists.
 *
 * Names the exact row it wants via `app.auth_lookup_id`, which the
 * `app_users_auth_lookup` policy (migration 0004) matches. Transaction-local, so it
 * cannot leak to the next borrower of the pooled connection, and it cannot enumerate:
 * the caller must already hold the id.
 */
export async function authLookup<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.auth_lookup_id', $1, true)`, [userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The matching pool. Reads ACROSS tenants, and is allowed to because it can see
 * almost nothing: match_profile (ages, tags, coordinates) and dealbreaker preference
 * rows. No facts, no episodes, no core_profile, no sentence anybody wrote.
 *
 * Falls back to the app connection when MATCH_DATABASE_URL is unset, which is wrong
 * for production and obvious in development -- the candidate query simply returns
 * nothing, because the app role cannot see other tenants' rows. That is the correct
 * failure: silent, total, and impossible to mistake for working.
 */
const matchPool = new Pool({
  connectionString: env.MATCH_DATABASE_URL ?? env.DATABASE_URL,
  max: 4,
});

export async function matchSession<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await matchPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Create the first user of a brand-new tenant.
 *
 * Names the tenant via `app.provisioning_tenant_id`, which the
 * `app_users_provisioning` policy (migration 0005) matches. Transaction-local, so it
 * cannot leak to the next borrower of the pooled connection, and it cannot target a
 * tenant the caller did not just create.
 */
export async function provisioningSession<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.provisioning_tenant_id', $1, true)`, [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Background-job discovery. Reads ACROSS tenants, as `clone_discovery` (0066).
 *
 * WHY THIS EXISTS. `adminSession` runs as clone_app, which is NOSUPERUSER NOBYPASSRLS
 * -- correct everywhere else, and fatal here. With no tenant context every RLS policy
 * evaluates NULL and returns zero rows, so the extraction sweeper and the nightly
 * consolidator were reading an empty database and silently doing nothing. The agent
 * could never learn.
 *
 * NOT THE OWNER ANY MORE. It used to connect as `clone`, a superuser, which ignores
 * every grant and policy. `clone_discovery` can read, across tenants, exactly the
 * columns the sweeper, the consolidator and /stats name -- episodes' ids and times but
 * not their text -- so the rule below is the database's, not a comment's.
 *
 * STRICT RULE: metadata only -- ids, counts, timestamps. Never message text, never
 * fact content. Discovery decides WHICH user to process; the work itself then runs
 * inside tenantSession under that user's own policies.
 */
let _discoveryPool: Pool | undefined;
function roleUrl(name: 'DOOR_DATABASE_URL' | 'DISCOVERY_DATABASE_URL'): string {
  const url = env[name];
  // No fallback, on purpose: the owner is a superuser and the app role cannot see
  // what these need, so either would be wrong -- one silently.
  if (!url) throw new Error(`${name} is not set. It has its own role (migration 0066); see .env.example.`);
  return url;
}
export async function discoverySession<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  _discoveryPool ??= new Pool({
    connectionString: roleUrl('DISCOVERY_DATABASE_URL'),
    max: 2,
    // Background work waits politely rather than for ever. Nothing here is on a
    // person's critical path, so failing and retrying next tick beats queueing.
    connectionTimeoutMillis: 10_000,
  });
  const client = await _discoveryPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Phone verification, as `clone_door` (0066) -- the owner until then, a superuser.
 *
 * `phone_challenges` is revoked from `clone_app` in 0045, so the ordinary pool cannot
 * see it at all -- which is the point: the role that serves every request should not
 * be able to read a table of code hashes. The boundary is therefore the connection
 * rather than a policy, because a challenge exists BEFORE there is an account and
 * there is no tenant to compare a policy against. `clone_door` can touch that table,
 * and read an account's id and tenant by its number, and nothing else in the database.
 *
 * Unlike `discoverySession` this opens a real transaction: the verify path increments
 * an attempt counter and consumes a ticket, and those two must not be separable by a
 * crash or by another request arriving in between.
 *
 * STRICT RULE, the same shape as discovery's: hashes, counts and timestamps only.
 * Nothing in this table is readable as a phone number or a code, and nothing that
 * belongs to a signed-in person is read through here -- once a challenge resolves to
 * a user, the work moves to `tenantSession` under that user's own policies.
 */
let _phonePool: Pool | undefined;
export async function phoneSession<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  // ITS OWN POOL, NOT THE DISCOVERY ONE.
  //
  // These are unauthenticated request-path queries. Sharing the two-connection
  // discovery pool meant a flood of sign-in attempts could hold both connections and
  // stop the background memory pipeline entirely -- a denial of service against the
  // part of the product that is not even exposed.
  //
  // `connectionTimeoutMillis` matters as much as the split. Without it an acquisition
  // queues for ever, so a flood does not fail, it accumulates: every request parks a
  // promise and the process runs out of memory rather than shedding load. Three
  // seconds and then an error the route turns into a 503.
  _phonePool ??= new Pool({
    connectionString: roleUrl('DOOR_DATABASE_URL'),
    max: 4,
    connectionTimeoutMillis: 3_000,
  });
  const client = await _phonePool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The matchmaker. The only session that can read two people at once.
 *
 * It is NOT a bypass: `clone_matchmaker` is NOSUPERUSER NOBYPASSRLS, and its policies
 * (migration 0028) let it read facts marked `disclosure = 'public'` and nothing else.
 * That makes the public-only rule structural rather than a filter in one query that a
 * later caller can forget. It also holds the transcripts, which no app session can
 * read at all.
 */
const matchmakerPool = new Pool({
  connectionString: env.MATCHMAKER_DATABASE_URL ?? env.DATABASE_URL,
  max: 4,
});

export async function matchmakerSession<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await matchmakerPool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The erasure connection. The ONLY role in the system with BYPASSRLS, which everywhere
 * else would be the bug 0000_roles exists to prevent.
 *
 * It is the requirement here. Erasure ends by counting what is left, and that count is
 * worthless run through row-level security: a policy that hides the rows produces the
 * same zero as a delete that removed them. The previous verifier ran as `clone_app`
 * with no tenant context, so every count was zero and `verified` was a constant true.
 *
 * Unlike `matchPool`, this does NOT fall back to the app connection. A fallback here
 * would restore exactly the bug -- a verification that passes by being blind.
 */
let _erasePool: Pool | undefined;

export function erasePool(): Pool {
  if (!env.ERASE_DATABASE_URL) {
    throw new Error(
      'ERASE_DATABASE_URL is not set. Erasure needs the clone_eraser connection to '
      + 'verify itself, and must not run without it.',
    );
  }
  _erasePool ??= new Pool({ connectionString: env.ERASE_DATABASE_URL, max: 2 });
  return _erasePool;
}

export async function eraseSession<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await erasePool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closeMatchPool(): Promise<void> {
  await matchPool.end();
  await matchmakerPool.end();
  await _erasePool?.end();
  _erasePool = undefined;
}

export async function close(): Promise<void> {
  await _discoveryPool?.end();
  _discoveryPool = undefined;
  await _phonePool?.end();
  _phonePool = undefined;
  await pool.end();
}
