/**
 * TIER 0. Append-only, immutable, never edited.
 *
 * This is the system of record, the recovery path from a bad LLM extraction, and the
 * only real exit path from any engine we ever adopt. Nothing in the write path is
 * permitted to UPDATE or DELETE a row here.
 */
import type { PoolClient } from 'pg';

export interface EpisodeInput {
  tenantId: string;
  userId: string;
  sessionId: string;
  turnId: string;
  role: 'user' | 'assistant';
  source: 'text' | 'voice';
  rawText: string;
  asrConfidence?: number | undefined;
  asrLowConfSpans?: unknown;
  occurredAt: Date;
}

export interface Episode extends EpisodeInput {
  id: string;
  turnIndex: number;
}

/**
 * Idempotent on (user_id, turn_id): a client reconnect can never spawn a second LLM
 * call. Returns null when this turn was already recorded, which the WS handler turns
 * into a `turn.replayed` event instead of a second generation.
 */
export async function append(c: PoolClient, e: EpisodeInput): Promise<Episode | null> {
  const { rows } = await c.query<{ id: string; turn_index: number }>(
    `INSERT INTO episodes (tenant_id, user_id, session_id, turn_id, turn_index,
                           role, source, raw_text, asr_confidence, asr_low_conf_spans,
                           occurred_at)
     SELECT $1, $2, $3, $4,
            COALESCE((SELECT MAX(turn_index) + 1 FROM episodes
                       WHERE user_id = $2 AND session_id = $3), 0),
            $5, $6, $7, $8, $9, $10
     ON CONFLICT (user_id, turn_id) DO NOTHING
     RETURNING id, turn_index`,
    [
      e.tenantId, e.userId, e.sessionId, e.turnId, e.role, e.source, e.rawText,
      e.asrConfidence ?? null, e.asrLowConfSpans ?? null, e.occurredAt,
    ],
  );

  const row = rows[0];
  return row ? { ...e, id: row.id, turnIndex: row.turn_index } : null;
}

export async function findByTurnId(
  c: PoolClient,
  userId: string,
  turnId: string,
): Promise<{ id: string; rawText: string; role: string } | null> {
  const { rows } = await c.query<{ id: string; raw_text: string; role: string }>(
    `SELECT id, raw_text, role FROM episodes WHERE user_id = $1 AND turn_id = $2`,
    [userId, turnId],
  );
  const r = rows[0];
  return r ? { id: r.id, rawText: r.raw_text, role: r.role } : null;
}

/**
 * Recent turns for the in-session conversation window.
 *
 * `excludeTurnId` matters: the caller appends the user's message BEFORE assembling
 * context, so without it the current message comes back here AND is appended again as
 * the prompt's final user turn. The model then sees it twice and answers as though
 * the person repeated themselves.
 */
export async function recentTurns(
  c: PoolClient,
  userId: string,
  sessionId: string,
  limit = 20,
  excludeTurnId?: string,
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const { rows } = await c.query<{ role: 'user' | 'assistant'; raw_text: string }>(
    `SELECT role, raw_text FROM episodes
      WHERE user_id = $1 AND session_id = $2
        AND ($4::uuid IS NULL OR turn_id <> $4)
      ORDER BY turn_index DESC LIMIT $3`,
    [userId, sessionId, limit, excludeTurnId ?? null],
  );
  return rows.reverse().map((r) => ({ role: r.role, content: r.raw_text }));
}

/**
 * Embeddings are written asynchronously, after the reply is already streaming --
 * a memory side effect must never block or fail the user's turn.
 *
 * embedding_model and embedding_version are written together and are NOT optional:
 * vectors from different models are not comparable, and a migration without them is
 * undetectable.
 */
export async function setEmbedding(
  c: PoolClient,
  episodeId: string,
  userId: string,
  vector: number[],
  model: string,
  version: number,
): Promise<void> {
  await c.query(
    `UPDATE episodes SET embedding = $3::halfvec, embedding_model = $4, embedding_version = $5
      WHERE id = $1 AND user_id = $2`,
    [episodeId, userId, JSON.stringify(vector), model, version],
  );
}
