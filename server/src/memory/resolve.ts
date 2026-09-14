/**
 * P2 — conflict resolution for MULTI-VALUED predicates only.
 *
 * Single-valued predicates never reach here: the partial unique index decides them,
 * deterministically, at $0. This pass exists solely for the cases a database
 * constraint cannot express -- can you hold two interests at once (yes), two
 * allergies (yes), but is "vegetarian" still true once "eats fish" arrives (ask).
 *
 * THE CONTRACT THAT MAKES THIS SAFE. Two numbered lists go in; two lists of INTEGER
 * INDICES come out. The model can never author replacement text for a stored fact.
 * That is what structurally eliminates the confabulated merge -- a model splicing an
 * old street onto a new city to produce an address present nowhere in the input, in
 * 3 of 3 runs. If it cannot write, it cannot invent.
 *
 * NEVER ON THE BATCH API. Batches expire at 24h. On Batch, the clone would keep saying
 * "London" for up to a day after the person moved to Berlin -- and forever if the
 * batch expired and nothing resubmitted. Nightly regeneration on Batch: correct.
 * Supersession on Batch: product-breaking.
 */
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { llm, modelFor } from '../llm/index.js';
import { modelIdOf } from '../llm/caps.js';
import type { FactCandidate } from './facts.js';

export const RESOLVE_PROMPT_VERSION = '2026-09-09.resolve.1';

const Resolution = z.object({
  /** Indices into EXISTING that say the same thing as a new candidate. */
  duplicate_ids: z.array(z.number()),
  /** Indices into EXISTING that the new information makes FALSE. */
  contradicted_ids: z.array(z.number()),
  /** Indices into EXISTING that merely deserve a question, not a retraction. */
  uncertain_ids: z.array(z.number()),
});

export const RESOLVE_PROMPT = `You are reconciling what is already known about a person against something they just said.

You will be given two numbered lists: EXISTING (facts already recorded) and NEW (what they just said).

Return three lists of INTEGERS, referring to positions in EXISTING. Never return text.

- duplicate_ids: EXISTING entries that say the same thing as something in NEW. These get merged, not duplicated.
- contradicted_ids: EXISTING entries that the NEW information makes FALSE.
- uncertain_ids: EXISTING entries that MIGHT be affected but where you are not sure. These become a question for the person, not a change.

## When to put something in contradicted_ids

Only when the new information explicitly establishes that the old entry stopped being true. "I'm vegan now" contradicts "eats fish". "I quit" contradicts a current employer.

## When NOT to

Prefer uncertain_ids, or neither, in every one of these:

- Adding is not replacing. A new interest does not retract an old one. Someone can like both bouldering and film photography.
- A single incident is not a change of state. Eating a prawn curry does not retract a shellfish allergy; that is uncertain_ids at most.
- A hedge is not a decision. "I might go vegetarian" contradicts nothing.
- Someone else's opinion is not the person's own statement.
- The past tense is not a change. Talking about a former employer does not contradict the current one.
- Silence is not evidence. An EXISTING entry that simply was not mentioned is untouched.
- Never weaken a durable fact — an allergy, a medical condition, a hard constraint — on one anecdote. That is what uncertain_ids is for.

When you cannot decide, choose uncertain_ids. Asking the person is cheap. Retracting something true is not.

Return empty lists when nothing matches. That is the common case and it is a good answer.`;

export interface ResolveInput {
  tenantId: string;
  userId: string;
  existing: { id: string; predicate: string; objectText: string }[];
  candidates: FactCandidate[];
}

export interface ResolveOutput {
  duplicateIds: string[];
  contradictedIds: string[];
  uncertainIds: string[];
  costUsd: number;
  model: string;
}

const EMPTY = { duplicateIds: [], contradictedIds: [], uncertainIds: [] };

export async function resolveConflicts(input: ResolveInput): Promise<ResolveOutput> {
  if (!input.existing.length || !input.candidates.length) {
    return { ...EMPTY, costUsd: 0, model: '' };
  }

  const model = modelFor('resolve');
  const existingList = input.existing
    .map((e, i) => `${i}. ${e.predicate}: ${e.objectText}`)
    .join('\n');
  const newList = input.candidates
    .map((c, i) => `${i}. ${c.predicate}: ${c.objectText}`)
    .join('\n');

  const res = await llm.complete(
    {
      task: 'resolve',
      instructions: RESOLVE_PROMPT,
      messages: [{ role: 'user', content: `## EXISTING\n${existingList}\n\n## NEW\n${newList}` }],
      tenantId: input.tenantId,
      userId: input.userId,
      outputSchema: Resolution,
      outputSchemaName: 'resolution',
      cache: [{ scope: 'instructions', ttl: '5m' }],
      maxOutputTokens: 1024,
      // Quality here IS the product: this is the ~50%-failure subset. Worth thinking.
      thinking: true,
      effort: 'medium',
    },
    model,
  );

  const parsed = Resolution.safeParse(res.parsed);
  if (!parsed.success) {
    // Structured output failed. Change nothing -- a wrong retraction is far more
    // expensive than a missed one, because the person never sees what was removed.
    return { ...EMPTY, costUsd: res.usage.costUsd, model: modelIdOf(model) };
  }

  // Indices are validated against the list we sent. An out-of-range index is a model
  // error, not an instruction, and is dropped rather than clamped.
  const pick = (idx: number[]): string[] =>
    idx
      .filter((i) => Number.isInteger(i) && i >= 0 && i < input.existing.length)
      .map((i) => input.existing[i]!.id);

  return {
    duplicateIds: pick(parsed.data.duplicate_ids),
    contradictedIds: pick(parsed.data.contradicted_ids),
    uncertainIds: pick(parsed.data.uncertain_ids),
    costUsd: res.usage.costUsd,
    model: modelIdOf(model),
  };
}

/** Multi-valued candidates only. Single-valued ones are the index's job. */
export async function multiValuedExisting(
  c: PoolClient,
  userId: string,
  candidates: FactCandidate[],
): Promise<{ id: string; predicate: string; objectText: string }[]> {
  const predicates = [...new Set(candidates.map((x) => x.predicate))];
  if (!predicates.length) return [];
  const { rows } = await c.query<{ id: string; predicate: string; object_text: string }>(
    `SELECT f.id, f.predicate, f.object_text
       FROM facts f JOIN predicates p ON p.name = f.predicate
      WHERE f.user_id = $1 AND f.status = 'active' AND f.valid_to IS NULL
        AND p.cardinality = 'multi' AND f.predicate = ANY($2)
      ORDER BY f.recorded_at DESC
      LIMIT 40`,
    [userId, predicates],
  );
  return rows.map((r) => ({ id: r.id, predicate: r.predicate, objectText: r.object_text }));
}
