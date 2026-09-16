/**
 * Right to erasure, and right to portability. W6.
 *
 * BI-TEMPORAL INVALIDATION IS NOT ERASURE. `valid_to` means a fact stopped being TRUE,
 * not that it was forgotten -- the row is still there and still readable. Erasure is a
 * separate path that actually removes rows, and conflating the two would be a
 * compliance failure hiding behind a correct-looking schema.
 *
 * The design target is a documented failure in a comparable system: a delete that
 * "performs shallow deletion, leaves orphaned edges and entities, causing silent graph
 * corruption". Hence the verification step -- an erasure that does not prove itself is
 * not an erasure.
 */
import type { PoolClient } from 'pg';
import { adminSession, eraseSession, tenantSession, type TenantCtx } from '../db/client.js';
import { removeAllFiles } from '../photos/store.js';
import { log } from '../log.js';

/**
 * Every table holding user rows.
 *
 * This comment used to say "adding a table means adding it HERE too", and then five
 * tables were added without it. A comment is not a mechanism, so a test reads the
 * catalogue and fails on any table this list misses.
 *
 * That test then missed four itself. It looked for a column named `user_id`, and
 * messages, blocks, reports and rendezvous name theirs `sender_id`, `blocker_id`,
 * `reporter_id` and `user_a`. A mechanism that depends on a naming convention is a
 * convention. It now follows FOREIGN KEYS to `app_users` instead, which is what
 * "holds a user row" actually means.
 *
 * Order matters where foreign keys do: children before parents.
 */
export const USER_TABLES = [
  'photos', 'question_answers', 'match_profile', 'preferences', 'predicate_status',
  'self_tests', 'device_sessions', 'rounds',
  'facts', 'episodes', 'memory_audit', 'fact_conflicts', 'session_extractions',
  'intent_signals', 'core_profile', 'directives', 'llm_calls', 'tenant_budget',
] as const;

/**
 * Tables the APPLICATION may not delete from, and the eraser must.
 *
 * `consents` is append-only from `clone_app` by design (0042): a consent record the
 * relying party can edit or remove is not evidence of anything. That rule and this
 * erasure are both correct and they collide -- the delete loop above runs on a tenant
 * session, which is the application, and it was refused the moment the revoke landed.
 *
 * So the record goes, and the eraser is what removes it. Consent goes at all because
 * keeping proof that somebody agreed to be remembered, after they have asked to be
 * forgotten, is the wrong way round.
 */
const ERASER_ONLY = ['consents'] as const;

/**
 * The tables a conversation lives in, which the list above cannot describe.
 *
 * Two things are different about them. They are not keyed on `user_id` -- a message
 * has a `sender_id`, a block has two ends, a rendezvous has a `user_a` and a `user_b`
 * -- so the check that reads the catalogue looking for a `user_id` column walked
 * straight past all four. And they are not tenant-scoped: a conversation deliberately
 * spans the boundary, so there is no tenant session that can see both halves of one.
 *
 * Hence an admin session, and an explicit list.
 */
const SHARED_TABLES = [
  // Before the rendezvous, because a brief written FOR them survives in a conversation
  // whose other half is somebody else's, and cascade order is not a thing to trust
  // when the row being removed is the point of the exercise.
  { table: 'rendezvous_briefs', columns: ['for_user'] },
  // Deleting the rendezvous cascades to its runs, its briefs and every message in it,
  // including the other person's. That is correct rather than collateral: a
  // conversation with one participant erased is not a conversation, and leaving the
  // surviving half would leave somebody talking to a person who no longer exists.
  { table: 'rendezvous', columns: ['user_a', 'user_b'] },
  // Belt and braces. Nothing should remain after the cascade above; if anything does,
  // it is this person's words and it goes.
  { table: 'messages', columns: ['sender_id'] },
  { table: 'blocks', columns: ['blocker_id', 'blocked_id'] },
  // Reports FILED BY them are not deleted, only un-named. See eraseUser.
  { table: 'reports', columns: ['reported_id'] },
] as const;

/**
 * Every table erasure actually clears, whichever session does it. The coverage test
 * checks this against the foreign keys in the catalogue, so a new table that
 * references `app_users` and is not here fails the build.
 */
export const ERASED_TABLES: readonly string[] = [
  ...USER_TABLES, ...ERASER_ONLY, ...SHARED_TABLES.map((t) => t.table),
];

export interface ErasureResult {
  deleted: Record<string, number>;
  verified: boolean;
  remaining: string[];
}

export async function eraseUser(ctx: TenantCtx): Promise<ErasureResult> {
  // THE LOG IS WRITTEN BY THE ERASER, not by the application role.
  //
  // `erasure_log` carries no row-level security -- it cannot, since it outlives the
  // user it describes -- and it used to be granted to `clone_app`, which meant
  // anything running as the application could read who had deleted their account.
  // 0039 revokes that and hands the table to `clone_eraser`, the role that already
  // exists to verify erasures and is BYPASSRLS by design.
  const logId = await eraseSession(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      'INSERT INTO erasure_log (tenant_id, user_id) VALUES ($1,$2) RETURNING id',
      [ctx.tenantId, ctx.userId],
    );
    return rows[0]!.id;
  });

  const deleted: Record<string, number> = {};
  await tenantSession(ctx, async (c) => {
    for (const t of USER_TABLES) {
      const r = await c.query(`DELETE FROM ${t} WHERE user_id = $1`, [ctx.userId]);
      deleted[t] = r.rowCount ?? 0;
    }
  });

  // Their pictures, off the disk. Deleting only the rows would leave the photographs
  // themselves sitting in a directory -- which is not an erasure, it is a lost index.
  await removeAllFiles(ctx.userId);

  // Conversations. The erasure connection, because no tenant session can see both
  // sides of one -- a rendezvous spans two tenants deliberately.
  await eraseSession(async (c) => {
    // A report keeps its substance and loses its author: the safety signal about the
    // OTHER person is not this person's to withdraw, and three reports from three
    // people is the pattern that matters. Same shape as a spent invite -- "reported on
    // this date, by nobody we can name".
    const anon = await c.query(
      'UPDATE reports SET reporter_id = NULL WHERE reporter_id = $1', [ctx.userId]);
    deleted['reports (author removed)'] = anon.rowCount ?? 0;

    for (const { table, columns } of SHARED_TABLES) {
      const where = columns.map((col) => `${col} = $1`).join(' OR ');
      const r = await c.query(`DELETE FROM ${table} WHERE ${where}`, [ctx.userId]);
      deleted[table] = r.rowCount ?? 0;
    }

    for (const t of ERASER_ONLY) {
      const r = await c.query(`DELETE FROM ${t} WHERE user_id = $1`, [ctx.userId]);
      deleted[t] = r.rowCount ?? 0;
    }

    // Any half-finished sign-in for their number.
    //
    // Keyed on the phone hash rather than on user_id, so the coverage test -- which
    // looks for foreign keys to app_users -- cannot see this table and would never
    // have told us it was missed. Read the hash from the account BEFORE the account
    // row is deleted at the end of the verify block, or there is nothing to match on.
    //
    // Note what this means: erasing an account frees its number for a new signup,
    // because the hash that identified the person goes with them. That is the right
    // way round for somebody asking to be forgotten, and it is worth knowing that
    // erasure is therefore a way out of a ban.
    const chall = await c.query(
      `DELETE FROM phone_challenges
        WHERE phone_hmac = (SELECT phone_hmac FROM app_users WHERE id = $1)`,
      [ctx.userId],
    );
    deleted['phone_challenges'] = chall.rowCount ?? 0;
  });

  // VERIFY. An erasure that does not prove itself is not an erasure.
  //
  // This runs on the BYPASSRLS connection, and that is the whole point. It used to run
  // as the app role with no tenant context, which meant every policy compared against
  // a NULL tenant and matched nothing: the verifier counted zero rows in every table
  // whether or not the delete had worked, and `verified: true` was a constant. A
  // check that cannot fail is not a check. Row-level security hiding a row and a
  // delete removing it produce the same number, so the verifier must be the one thing
  // in the system that security does not apply to.
  const remaining: string[] = [];
  await eraseSession(async (c) => {
    for (const t of [...USER_TABLES, ...ERASER_ONLY]) {
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*) AS n FROM ${t} WHERE user_id = $1`, [ctx.userId],
      );
      if (Number(rows[0]?.n ?? 0) > 0) remaining.push(t);
    }
    for (const { table, columns } of [...SHARED_TABLES,
                                      { table: 'reports', columns: ['reporter_id'] }]) {
      const where = columns.map((col) => `${col} = $1`).join(' OR ');
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*) AS n FROM ${table} WHERE ${where}`, [ctx.userId],
      );
      if (Number(rows[0]?.n ?? 0) > 0) remaining.push(table);
    }
    // The account row itself goes last, so a partial failure leaves something to retry.
    if (!remaining.length) await c.query('DELETE FROM app_users WHERE id = $1', [ctx.userId]);
  });

  const verified = remaining.length === 0;
  await eraseSession((c) =>
    c.query(
      `UPDATE erasure_log SET completed_at = now(), deleted_counts = $2, verified = $3,
                              notes = $4
        WHERE id = $1`,
      [logId, JSON.stringify(deleted), verified,
       verified ? null : `rows remained in: ${remaining.join(', ')}`],
    ),
  );

  if (!verified) log.error({ userId: ctx.userId, remaining }, 'ERASURE INCOMPLETE');
  return { deleted, verified, remaining };
}

/**
 * Article 20 portability. Every prior design in this project built erasure and forgot
 * export -- same regulation, same clock.
 *
 * Includes the full supersession lineage, not just current beliefs: what the system
 * used to think about someone is as much their data as what it thinks now, and the
 * lineage is the only place the difference is visible.
 */
export async function exportUser(c: PoolClient, userId: string): Promise<Record<string, unknown>> {
  const q = async (sql: string) => (await c.query(sql, [userId])).rows;
  return {
    exportedAt: new Date().toISOString(),
    facts: await q(
      `SELECT predicate, object_text, status, stance, hedge_span, source_quote,
              valid_from, valid_to, recorded_at, invalidated_at, corroboration_count,
              origin_class, supersedes_id, superseded_by_id
         FROM facts WHERE user_id = $1 ORDER BY recorded_at`),
    episodes: await q(
      `SELECT session_id, turn_index, role, source, raw_text, occurred_at
         FROM episodes WHERE user_id = $1 ORDER BY session_id, turn_index`),
    coreProfile: await q(
      'SELECT block_name, content, rebuilt_at FROM core_profile WHERE user_id = $1'),
    directives: await q(
      'SELECT text, valid_from, valid_to, active FROM directives WHERE user_id = $1'),
    conflicts: await q(
      `SELECT kind, clarifying_question, status, detected_at, resolved_at, resolution
         FROM fact_conflicts WHERE user_id = $1 ORDER BY detected_at`),
    // Their own messages only. The other person's half of a conversation is that
    // person's data, and exporting it here would be a way to take a copy of somebody
    // else's words home with you.
    messages: await q(
      `SELECT rendezvous_id, body, sent_at, delivered_at, read_at, redacted_at
         FROM messages WHERE sender_id = $1 ORDER BY rendezvous_id, seq`),
    // What it cost to run their agent. Theirs to see.
    usage: await q(
      `SELECT task, model, input_tokens, output_tokens, cost_usd, at
         FROM llm_calls WHERE user_id = $1 ORDER BY at`),
  };
}
