/**
 * Episodic recall over Tier 0.
 *
 * In W1 this IS the product: the verbatim-episode RAG control. It is also the
 * permanent fallback. Published measurements have verbatim RAG matching full context
 * (47.2% vs 49.8%, p=0.34) and agent self-memory LOSING to basic retrieval (42% vs
 * 47%) -- so the fact store must be additive over a baseline that stands alone, never
 * load-bearing beneath it. Gate G0 in W3 compares the two, and if the fact store does
 * not win, we ship this and delete the write path.
 *
 * Hybrid by design. Nearest-neighbour returns the MOST SIMILAR fact, not the
 * CURRENTLY TRUE one -- a system that retrieves the most recently stated preference
 * would return exactly the pre-evolution distractor. Vector search is for episodic
 * recall; current state is a SQL query over the fact store (Tier 1, W2).
 */
import type { PoolClient } from 'pg';
import { embed, embeddingsAvailable } from '../llm/embeddings.js';
import { env } from '../env.js';

export interface Recalled {
  id: string;
  text: string;
  occurredAt: Date;
  score: number;
}

const RRF_K = 60;

/**
 * Reciprocal rank fusion across the vector and FTS channels.
 *
 * RRF blends the two CHANNELS only. It is deliberately not the primary fusion for
 * the index itself: index-time key merging (embedding raw text || extracted facts)
 * measured 0.732 vs 0.618 for retrieval-time rank fusion.
 */
export async function recall(
  c: PoolClient,
  userId: string,
  query: string,
  limit = 5,
  /** The turn being answered. It was already written to episodes, and returning it
   *  here would present the user's own message back to them as something they said
   *  before -- which reads as the clone accusing them of repeating themselves. */
  excludeEpisodeId?: string,
): Promise<Recalled[]> {
  // No embeddings configured -- Anthropic has no embeddings endpoint, so an
  // all-Anthropic routing lands here. Full-text alone is a weaker recall channel but
  // it is a working one, and losing the turn over a missing optional capability
  // would be a far worse trade.
  if (!embeddingsAvailable()) return lexicalOnly(c, userId, query, limit, excludeEpisodeId);

  // With an approximate index the RLS predicate is applied AFTER the scan, so a
  // selective policy can return too few neighbours. relaxed_order makes pgvector
  // keep scanning until it has enough that survive the filter.
  await c.query(`SET LOCAL hnsw.iterative_scan = relaxed_order`);

  let vector: number[] | undefined;
  try {
    [vector] = await embed([query]);
  } catch {
    // The provider is configured but unreachable or rejecting. Same trade.
    return lexicalOnly(c, userId, query, limit, excludeEpisodeId);
  }
  if (!vector) return lexicalOnly(c, userId, query, limit, excludeEpisodeId);

  const { rows } = await c.query<{
    id: string;
    raw_text: string;
    occurred_at: Date;
    score: string;
  }>(
    `WITH vec AS (
       SELECT id, raw_text, occurred_at,
              ROW_NUMBER() OVER (ORDER BY embedding <=> $2::halfvec) AS rank
         FROM episodes
        WHERE user_id = $1 AND embedding IS NOT NULL
          AND ($7::uuid IS NULL OR id <> $7)
        ORDER BY embedding <=> $2::halfvec
        LIMIT $3
     ),
     lex AS (
       SELECT id, raw_text, occurred_at,
              ROW_NUMBER() OVER (
                ORDER BY ts_rank_cd(fts, websearch_to_tsquery('english', $4)) DESC
              ) AS rank
         FROM episodes
        WHERE user_id = $1 AND fts @@ websearch_to_tsquery('english', $4)
          AND ($7::uuid IS NULL OR id <> $7)
        ORDER BY ts_rank_cd(fts, websearch_to_tsquery('english', $4)) DESC
        LIMIT $3
     )
     SELECT COALESCE(v.id, l.id)                   AS id,
            COALESCE(v.raw_text, l.raw_text)       AS raw_text,
            COALESCE(v.occurred_at, l.occurred_at) AS occurred_at,
            (COALESCE(1.0 / ($5 + v.rank), 0)
           + COALESCE(1.0 / ($5 + l.rank), 0))     AS score
       FROM vec v
       FULL OUTER JOIN lex l ON v.id = l.id
      ORDER BY score DESC
      LIMIT $6`,
    [userId, JSON.stringify(vector), limit * 4, query, RRF_K, limit, excludeEpisodeId ?? null],
  );

  return rows.map((r) => ({
    id: r.id,
    text: r.raw_text,
    occurredAt: r.occurred_at,
    score: Number(r.score),
  }));
}

/** Full-text recall, used when vector search is unavailable. */
async function lexicalOnly(
  c: PoolClient,
  userId: string,
  query: string,
  limit: number,
  excludeEpisodeId?: string,
): Promise<Recalled[]> {
  const { rows } = await c.query<{
    id: string; raw_text: string; occurred_at: Date; score: string;
  }>(
    `SELECT id, raw_text, occurred_at,
            ts_rank_cd(fts, websearch_to_tsquery('english', $2)) AS score
       FROM episodes
      WHERE user_id = $1 AND fts @@ websearch_to_tsquery('english', $2)
        AND ($4::uuid IS NULL OR id <> $4)
      ORDER BY score DESC
      LIMIT $3`,
    [userId, query, limit, excludeEpisodeId ?? null],
  );
  return rows.map((r) => ({
    id: r.id, text: r.raw_text, occurredAt: r.occurred_at, score: Number(r.score),
  }));
}

/**
 * Record that these facts were retrieved. This is the promotion signal P4 orders by --
 * observed usefulness, not a model's write-time confidence, which is the weakest
 * signal available and is deliberately unused.
 */
export async function markRetrieved(
  c: PoolClient,
  userId: string,
  factIds: string[],
): Promise<void> {
  if (!factIds.length) return;
  await c.query(
    `UPDATE facts SET retrieval_count = retrieval_count + 1, last_retrieved_at = now()
      WHERE user_id = $1 AND id = ANY($2)`,
    [userId, factIds],
  );
}

/** Episodes still missing a vector, or carrying one from a superseded model. */
export async function pendingEmbeddings(
  c: PoolClient,
  userId: string,
  limit = 50,
): Promise<{ id: string; rawText: string }[]> {
  const { rows } = await c.query<{ id: string; raw_text: string }>(
    `SELECT id, raw_text FROM episodes
      WHERE user_id = $1
        AND (embedding IS NULL
             OR embedding_model <> $2
             OR embedding_version <> $3)
      ORDER BY ingested_at
      LIMIT $4`,
    [userId, env.EMBEDDING_MODEL, env.EMBEDDING_VERSION, limit],
  );
  return rows.map((r) => ({ id: r.id, rawText: r.raw_text }));
}

/**
 * Which facts this turn is actually about.
 *
 * `currentState` returns everything and is what the prompt is built from -- correct,
 * because the whole point is that the clone never states a stale value. But
 * "everything, every turn" is useless as a usefulness signal: if every fact is marked
 * retrieved on every turn, `retrieval_count` orders nothing and P4's promotion-by-
 * recall degrades to promotion-by-age.
 *
 * So relevance is measured separately from truth. This is the query whose hits get
 * counted, and it is deliberately a cheap lexical match: a user has tens of facts,
 * not millions, and an embedding call per turn to rank forty rows would cost more
 * than it could possibly be worth.
 */
export async function factsTouchedBy(
  c: PoolClient,
  userId: string,
  text: string,
): Promise<string[]> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu);
  if (!words?.length) return [];

  // Deduplicated and capped: a long message otherwise builds a query of a hundred
  // terms that matches every fact and re-creates the problem this avoids. Joined with
  // an explicit OR -- plainto_tsquery ANDs everything and would only ever match a
  // fact containing the whole sentence.
  const terms = Array.from(new Set(words)).slice(0, 24).join(' | ');

  const { rows } = await c.query<{ id: string }>(
    `SELECT id FROM facts
      WHERE user_id = $1 AND status = 'active' AND valid_to IS NULL
        AND to_tsvector('simple', predicate || ' ' || object_text)
            @@ to_tsquery('simple', $2)
      LIMIT 20`,
    // Safe to interpolate as a tsquery: the regex above admits only letters and
    // digits, so no tsquery operator can survive into `terms`.
    [userId, terms],
  );
  return rows.map((r) => r.id);
}
