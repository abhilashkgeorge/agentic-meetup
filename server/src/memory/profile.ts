/**
 * P4 — TIER 2, the core profile. The block inlined verbatim on every turn.
 *
 * SELECTION IS SQL. THE MODEL ONLY PHRASES. What gets into the profile is decided by
 * a deterministic ordering over observed signals; the model is handed the winners and
 * asked to write them as prose. It never chooses what the person is.
 *
 * PROMOTION IS BY RECALL, NOT BY CONFIDENCE. `retrieval_count` and
 * `used_in_reply_count` are free, observed and self-correcting. A model's own
 * write-time confidence is the weakest signal available and is deliberately unused.
 * A fact graduates because it kept being useful.
 */
import type { PoolClient } from 'pg';
import { llm, modelFor } from '../llm/index.js';
import { modelIdOf } from '../llm/caps.js';
import { log } from '../log.js';

export const PROFILE_PROMPT_VERSION = '2026-09-09.profile.1';

/** Hard ceiling. Asserted in CI: this block is on every prompt, so it is pure cost. */
export const CORE_TOKEN_BUDGET = 1500;
const CHARS_PER_TOKEN = 4;

/** G5: a rebuild that drops more than this share of prior entries is rejected. */
const MAX_PRIOR_ENTRY_LOSS = 0.25;

export type BlockName = 'identity' | 'situation' | 'preferences' | 'open_threads';

/**
 * Gates G2 and G3, enforced in the query rather than in a prompt.
 *
 * G3 — origin: `untrusted` and `system` are excluded STRUCTURALLY, before the prompt
 * is assembled. Not down-weighted, not annotated: absent. A passive "unverified" tag
 * was measured leaking at 0.52-0.77 while structural exclusion leaked at 0.00, and
 * models leak 35-50% of sensitive content even when explicitly told not to. Filtering
 * rows beats instructing a model, every time.
 *
 * G2 — corroboration: a SOFT fact seen once, from a single episode, may be active but
 * may not enter the always-inlined block. Durable facts are exempt; someone stating an
 * allergy once should not need to repeat themselves.
 */
export async function promotableFacts(
  c: PoolClient,
  userId: string,
  limit = 60,
): Promise<{ id: string; predicate: string; objectText: string; durability: string }[]> {
  const { rows } = await c.query<{
    id: string; predicate: string; object_text: string; durability: string;
  }>(
    `SELECT f.id, f.predicate, f.object_text, p.durability
       FROM facts f JOIN predicates p ON p.name = f.predicate
      WHERE f.user_id = $1
        AND f.status = 'active' AND f.valid_to IS NULL
        AND f.origin_class IN ('owner','agent')                       -- G3
        AND f.stance = 'asserted'                                     -- G4
        AND (p.durability = 'hard' OR f.corroboration_count >= 2)     -- G2
      ORDER BY (p.durability = 'hard') DESC,
               f.corroboration_count DESC,
               f.used_in_reply_count DESC,
               f.retrieval_count DESC,
               COALESCE(f.importance, 0) DESC,
               f.recorded_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: r.id, predicate: r.predicate, objectText: r.object_text, durability: r.durability,
  }));
}

const RENDER_PROMPT = `Write a short profile of this person from the facts given.

Four sections, in this order, each a few lines of plain prose:

IDENTITY — who they are: name, where they are from, languages.
SITUATION — where they live, what they do, who is around them, constraints like allergies or diet.
PREFERENCES — what they like, value and avoid.
OPEN_THREADS — what they are working towards or deciding right now.

Rules:

Use ONLY the facts given. Add nothing. If a section has no facts, write a single line saying so.

Write declaratively, about them: "Lives in Berlin", "Allergic to shellfish". Never write instructions to yourself — "always mention Berlin" would be read as an order in a later session and could override what they are actually asking for.

Keep their own words for specifics. "Gamecube", not "gaming console".

Be brief. This text is included in every single conversation, so every wasted line is paid for forever.

Output the four sections separated by a line containing only ---. No headings, no preamble.`;

export interface RebuildResult {
  rebuilt: boolean;
  reason?: string;
  tokens: number;
  costUsd: number;
}

export async function rebuildCoreProfile(
  c: PoolClient,
  ctx: { tenantId: string; userId: string },
): Promise<RebuildResult> {
  const facts = await promotableFacts(c, ctx.userId);
  if (!facts.length) return { rebuilt: false, reason: 'nothing promotable yet', tokens: 0, costUsd: 0 };

  const { rows: prior } = await c.query<{ content: string; source_fact_ids: string[] }>(
    'SELECT content, source_fact_ids FROM core_profile WHERE user_id = $1',
    [ctx.userId],
  );
  const priorFactIds = new Set(prior.flatMap((p) => p.source_fact_ids));

  // G5, the loss rail. Checked BEFORE spending a model call: if this rebuild would
  // drop a quarter of what the profile was built from, something upstream is wrong --
  // a bad extraction, an over-eager retraction -- and the cheapest correct action is
  // to keep the profile we have and say so loudly.
  if (priorFactIds.size > 0) {
    const kept = facts.filter((f) => priorFactIds.has(f.id)).length;
    const lost = 1 - kept / priorFactIds.size;
    if (lost > MAX_PRIOR_ENTRY_LOSS) {
      log.warn(
        { userId: ctx.userId, lost: Number(lost.toFixed(2)), priorCount: priorFactIds.size },
        'G5 loss rail: profile rebuild rejected',
      );
      return {
        rebuilt: false,
        reason: `G5: rebuild would drop ${(lost * 100).toFixed(0)}% of prior entries`,
        tokens: 0, costUsd: 0,
      };
    }
  }

  const res = await llm.complete(
    {
      task: 'render_profile',
      instructions: RENDER_PROMPT,
      messages: [{
        role: 'user',
        content: facts.map((f) => `- ${f.predicate}: ${f.objectText}`).join('\n'),
      }],
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      cache: [{ scope: 'instructions', ttl: '5m' }],
      maxOutputTokens: 1024,
      thinking: false,
    },
    modelFor('render_profile'),
  );

  const blocks: BlockName[] = ['identity', 'situation', 'preferences', 'open_threads'];
  const parts = res.text.split(/^---$/m).map((p) => p.trim());
  const model = modelIdOf(modelFor('render_profile'));
  let tokens = 0;

  for (let i = 0; i < blocks.length; i++) {
    const content = (parts[i] ?? '').slice(0, CORE_TOKEN_BUDGET * CHARS_PER_TOKEN);
    const t = Math.ceil(content.length / CHARS_PER_TOKEN);
    tokens += t;
    await c.query(
      `INSERT INTO core_profile (tenant_id, user_id, block_name, content, token_count,
                                 rendering_model, source_fact_ids, rebuilt_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (tenant_id, user_id, block_name) DO UPDATE
         SET content = EXCLUDED.content, token_count = EXCLUDED.token_count,
             rendering_model = EXCLUDED.rendering_model,
             source_fact_ids = EXCLUDED.source_fact_ids, rebuilt_at = now()`,
      [ctx.tenantId, ctx.userId, blocks[i], content, t, model, facts.map((f) => f.id)],
    );
  }

  return { rebuilt: true, tokens, costUsd: res.usage.costUsd };
}

/**
 * How the person SOUNDS. Kept separate from the facts on purpose: style presented as
 * fact gets stated back at the user ("you write in lowercase"), and facts presented as
 * style get imitated instead of used.
 */
export async function voiceText(c: PoolClient, userId: string): Promise<string> {
  const { rows } = await c.query<{ content: string }>(
    `SELECT content FROM core_profile WHERE user_id = $1 AND block_name = 'voice'`,
    [userId],
  );
  return rows[0]?.content?.trim() ?? '';
}

/** The block inlined on every turn, plus any standing directives. */
export async function coreProfileText(c: PoolClient, userId: string): Promise<string> {
  const { rows } = await c.query<{ block_name: string; content: string }>(
    `SELECT block_name, content FROM core_profile
      WHERE user_id = $1 AND block_name <> 'voice'
      ORDER BY array_position(ARRAY['identity','situation','preferences','open_threads'], block_name)`,
    [userId],
  );
  const { rows: dirs } = await c.query<{ text: string }>(
    'SELECT text FROM directives WHERE user_id = $1 AND active ORDER BY valid_from',
    [userId],
  );

  const profile = rows.filter((r) => r.content.trim()).map((r) => r.content.trim()).join('\n\n');
  const directives = dirs.length
    ? `\n\nThings they have asked you to do:\n${dirs.map((d) => `- ${d.text}`).join('\n')}`
    : '';
  return profile ? profile + directives : '';
}
