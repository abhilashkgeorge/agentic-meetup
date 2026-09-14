/**
 * Turning "who could you not stand?" into a rule the database can join on.
 *
 * WHY THIS QUESTION EARNS ITS SCREEN. Everything else in the onboarding adds points; a
 * dealbreaker is the only kind of answer allowed to remove somebody from consideration,
 * so one of them does more work than ten preferences. And people are specific about
 * what they cannot stand and vague about what they want: "what are you looking for?"
 * returns "someone kind and funny", which is true of everybody and excludes nobody,
 * while "who could you not stand?" returns "someone who won't stop talking about
 * crypto" -- which is a person, described.
 *
 * THE SENTENCE IS KEPT WHATEVER HAPPENS. The mapping below is best-effort: a rule is
 * stored only when the words land cleanly on a predicate this system actually matches
 * on. When they do not -- and often they will not, because people say true things that
 * no column represents -- the sentence still goes into the dossier, where their agent
 * can use it in conversation. A sentence that cannot be filtered on is not a wasted
 * answer.
 */
import { z } from 'zod';
import { llm, modelFor } from '../llm/index.js';
import { MATCHABLE_PREDICATES } from '@clone/shared';

const Mapped = z.object({
  /** The predicate this is about, or null when nothing fits. */
  predicate: z.string().nullable(),
  /**
   * The values they could NOT accept. Stored as a `not_in` rule, so it excludes those
   * and leaves everyone else -- including people who never said.
   */
  excludes: z.array(z.string()),
  /** Why this mapping, in a few words. Kept for the audit trail, never shown. */
  because: z.string(),
});

export interface DealbreakerMapping {
  predicate: string | null;
  excludes: string[];
  because: string;
  costUsd: number;
}

const PROMPT = `Somebody has been asked what kind of person they could not imagine spending time with. Turn their answer into a filter, if and only if it maps cleanly onto one of the fields below.

FIELDS AND THEIR VALUES:
{{FIELDS}}

Return the field name and the values that should be EXCLUDED.

Rules:

Only map what is actually there. "Someone who smokes" is smoking: exclude often, sometimes. "Someone boring" is not a field and must return null — a filter invented from a vague sentence removes real people for no reason.

Prefer null over a loose fit. This is the only answer in the whole product allowed to delete people from somebody's pool, and a wrong one is invisible: the person simply never sees anybody it removed, and never finds out why.

Use only the values listed for the field. Never invent one.

If they named several things and only one maps, map that one.`;

/**
 * Map one sentence. Returns `predicate: null` when nothing fits, which is the common
 * case and not a failure.
 */
export async function mapDealbreaker(
  ctx: { tenantId: string; userId: string },
  sentence: string,
): Promise<DealbreakerMapping> {
  const fields = MATCHABLE_PREDICATES
    .map((p) => `- ${p.name}: ${p.values.join(', ')}`)
    .join('\n');

  const res = await llm.complete(
    {
      task: 'extract',
      instructions: PROMPT.replace('{{FIELDS}}', fields),
      messages: [{ role: 'user', content: sentence }],
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      outputSchema: Mapped,
      outputSchemaName: 'dealbreaker',
      maxOutputTokens: 512,
      thinking: false,
    },
    modelFor('extract'),
  );

  const parsed = Mapped.safeParse(res.parsed);
  if (!parsed.success) {
    return { predicate: null, excludes: [], because: 'could not read', costUsd: res.usage.costUsd };
  }

  const field = MATCHABLE_PREDICATES.find((p) => p.name === parsed.data.predicate);
  if (!field) {
    return { predicate: null, excludes: [], because: parsed.data.because, costUsd: res.usage.costUsd };
  }

  // Values the field does not have are dropped rather than trusted. A model naming a
  // value that is not in the list is a model guessing, and this is the one rule that
  // removes people.
  const allowed = new Set(field.values);
  const excludes = parsed.data.excludes.filter((v) => allowed.has(v));

  return {
    predicate: excludes.length ? field.name : null,
    excludes,
    because: parsed.data.because,
    costUsd: res.usage.costUsd,
  };
}
