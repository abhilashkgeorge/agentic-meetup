/**
 * Turning "who could you not stand?" into a rule the database can join on.
 *
 * WHY THIS QUESTION EARNS ITS SCREEN. A dealbreaker removes somebody from
 * consideration, so one of them does more work than ten preferences. Two answers can
 * write one: a narrowed Who's-fine row on a core card, which the person ticked
 * themselves, and this sentence, which is the only one a model reads -- which is why
 * the mapping below is the careful part. And people are specific about
 * what they cannot stand and vague about what they want: "what are you looking for?"
 * returns "someone kind and funny", which is true of everybody and excludes nobody,
 * while "who could you not stand?" returns "someone who won't stop talking about
 * crypto" -- which is a person, described.
 *
 * THE SENTENCE IS KEPT WHATEVER HAPPENS, as the person's own record of what they said
 * -- and only that. It is a `matchable_only` fact: no agent may volunteer it, no brief
 * quotes it, and nobody else ever reads it. (This header used to say it went "into the
 * dossier, where their agent can use it in conversation". It never did: the dossier is
 * public facts only, and agent conversations are off by default.) The mapping below is
 * best-effort: a rule is stored only when the words land cleanly on one of the FIVE
 * CORE CARDS. When they do not -- and often they will not, because people say true
 * things no card represents -- the sentence is kept and nothing is filtered.
 *
 * THREE RULES IN CODE, because a prompt line is not a guard:
 *
 *   1. Only the five core card fields. Kids, one person or open, smoking, drinking,
 *      food: the fields every person in the pool has been asked. A rule on anything
 *      else (drugs, exercise, intent) is a filter on a field nobody is asked, which
 *      passes almost everybody as unknown and removes the few who happened to say.
 *   2. Frequencies close UPWARD. Excluding a level excludes every more frequent level:
 *      somebody who cannot be with an occasional smoker cannot be with a daily one.
 *      The old few-shot taught "someone who smokes" as {often, sometimes}, so daily
 *      smokers passed "no smokers".
 *   3. Never every value. A reading that excludes everybody is a misreading.
 */
import { z } from 'zod';
import { decideModel, llm, modelFor } from '../llm/index.js';
import { FREQUENCY, MATCHABLE_PREDICATES } from '@clone/shared';
import type { ModelRef } from '../llm/caps.js';
import type { Question } from '../llm/port.js';
import { CORE_PREDICATES } from './questions.js';

/**
 * What a sentence may be mapped onto: the matchable fields that are also a core card.
 *
 * Filtered here rather than by trimming MATCHABLE_PREDICATES, so the shared list keeps
 * describing what the matcher CAN test and this file alone decides what a sentence may
 * write. The model is only shown these, and `finish` refuses anything else whatever
 * the model answers.
 */
export const MAPPABLE: readonly { name: string; values: readonly string[] }[] =
  MATCHABLE_PREDICATES.filter((p) => CORE_PREDICATES.includes(p.name));

const FREQ: readonly string[] = FREQUENCY;

/**
 * Excluding one level of a frequency excludes every more frequent level.
 *
 * `never` is not a level of doing the thing, it is not doing it, so it closes nothing:
 * "I couldn't be with someone who doesn't drink" excludes `never` and only `never`.
 * Every other excluded level pulls in everything above it. Returned in catalogue
 * order, so the stored rule does not depend on the order the model listed things in.
 */
export function closeUpward(predicate: string, excludes: readonly string[]): string[] {
  const field = MAPPABLE.find((p) => p.name === predicate);
  if (!field || field.values.join() !== FREQ.join()) return [...excludes];
  const levels = excludes.map((v) => FREQ.indexOf(v)).filter((i) => i > 0);
  const from = levels.length ? Math.min(...levels) : FREQ.length;
  return FREQ.filter((v, i) => i >= from || (v === 'never' && excludes.includes('never')));
}

/**
 * The last word on any mapping, from either path: a core card field, values that
 * field actually has, closed upward, and never all of them.
 */
function finish(
  predicate: string | null | undefined,
  excludes: readonly string[],
  because: string,
  costUsd: number,
): DealbreakerMapping {
  const field = MAPPABLE.find((p) => p.name === predicate);
  if (!field) {
    return { predicate: null, excludes: [], because: predicate ? `${predicate} is not a card` : because, costUsd };
  }
  // Values the field does not have are dropped rather than trusted. A model naming a
  // value that is not in the list is a model guessing, and this is a rule that
  // removes people.
  const allowed = new Set(field.values);
  const closed = closeUpward(field.name, excludes.filter((v) => allowed.has(v)));
  if (!closed.length) return { predicate: null, excludes: [], because, costUsd };
  // EVERY VALUE IS NOT A RULE. A reading that refuses all of them is "I could not be
  // with anybody", which is a misreading rather than a preference, and storing it
  // would empty the pool.
  if (closed.length === field.values.length) {
    return { predicate: null, excludes: [], because: 'it excluded every value, which cannot be right', costUsd };
  }
  return { predicate: field.name, excludes: closed, because, costUsd };
}

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

Only map what is actually there. "Someone who smokes" is smoking: exclude rarely, sometimes, often, daily. "Someone boring" is not a field and must return null — a filter invented from a vague sentence removes real people for no reason.

Prefer null over a loose fit. A filter written here removes people from somebody's pool, and a wrong one is invisible: the person simply never sees anybody it removed, and never finds out why.

Use only the values listed for the field. Never invent one.

If they named several things and only one maps, map that one.`;

// ── the typed path ───────────────────────────────────────────────────────────
//
// THE SAME JOB, ASKED AS QUESTIONS INSTEAD OF AS A PARAGRAPH.
//
// The prose version below asks one model to pick a field AND the values to exclude
// AND explain itself, and returns a flat answer with no measure of how sure it was.
// That is the wrong shape for a rule that removes people and is written from a model's
// reading rather than a tick the person made: a mapping the model half-believed is
// indistinguishable from one it was certain about, and a wrong one is invisible --
// the person simply never sees anybody it removed, and never finds out why.
//
// A System One model answers a map of closed questions with a probability each, in one
// round trip. So this asks, all at once:
//
//   one CHOICE   which field is this sentence about, or none of them
//   one NOUL per value   would they refuse somebody who is <value>?
//
// About twenty-five questions (five fields), one request, output free. Both thresholds are deliberately
// high and asymmetric to the cost of being wrong: a rule that is not written costs a
// filter the person can add later, and a rule that is written wrongly costs them
// people they will never know existed. Their own docs put it the same way -- raise
// the threshold when a false positive is expensive.

/** How sure the model must be about the FIELD before any rule is written. */
const FIELD_MIN = 0.6;
/** How sure it must be that a particular value is one they would refuse. */
const VALUE_MIN = 0.7;
/** The option that means "this sentence is not about any field we match on". */
const NO_FIELD = 'none_of_these';

/** `predicate` and a value, as one question id. Reversed when the answers come back. */
const valueId = (predicate: string, value: string) =>
  `v__${predicate}__${value}`.replace(/[^A-Za-z0-9_]/g, '_');

export async function mapDealbreakerTyped(
  ctx: { tenantId: string; userId: string },
  sentence: string,
  model: ModelRef,
): Promise<DealbreakerMapping> {
  const questions: Record<string, Question> = {
    field: {
      kind: 'choice',
      instructions:
        'Which single field is this person describing someone they could not spend ' +
        'time with? Choose none_of_these unless the sentence is plainly about one of them.',
      options: {
        ...Object.fromEntries(
          MAPPABLE.map((p) => [
            p.name,
            `${p.name.replace(/_/g, ' ')} — one of: ${p.values.join(', ')}`,
          ]),
        ),
        [NO_FIELD]:
          'The sentence is about something else entirely, or is too vague to be any ' +
          'of these. Most sentences are this.',
      },
    },
  };
  for (const p of MAPPABLE) {
    for (const v of p.values) {
      questions[valueId(p.name, v)] = {
        kind: 'noul',
        instructions:
          `They are saying they could not spend time with somebody whose ` +
          `${p.name.replace(/_/g, ' ')} is "${v.replace(/_/g, ' ')}".`,
        when: {
          true: 'The sentence rules out exactly this kind of person.',
          false: 'The sentence says nothing about this, or does not rule it out.',
        },
      };
    }
  }

  const res = await llm.decide(
    { state: sentence, questions, tenantId: ctx.tenantId, userId: ctx.userId },
    model,
  );
  const costUsd = res.usage.costUsd;

  const field = res.answers.field;
  if (!field || field.kind !== 'choice') {
    return { predicate: null, excludes: [], because: 'no field answer came back', costUsd };
  }
  if (field.choice === NO_FIELD || !field.choice) {
    return { predicate: null, excludes: [], because: 'not about a field we match on', costUsd };
  }
  if (field.confidence < FIELD_MIN) {
    return {
      predicate: null, excludes: [],
      because: `unsure which field (${field.choice} at ${field.confidence.toFixed(2)})`,
      costUsd,
    };
  }

  const chosen = MAPPABLE.find((p) => p.name === field.choice);
  if (!chosen) return { predicate: null, excludes: [], because: 'unknown field', costUsd };

  // Only the chosen field's values, and only the ones it is confident about. The
  // nouls for every other field were answered too and are deliberately ignored: a
  // sentence is about one thing, and letting a stray high probability on an unrelated
  // field write a second rule is how one answer quietly becomes two filters.
  const excludes = chosen.values.filter((v) => {
    const a = res.answers[valueId(chosen.name, v)];
    return a?.kind === 'noul' && a.p >= VALUE_MIN;
  });

  if (!excludes.length) return { predicate: null, excludes: [], because: 'no value was clear', costUsd };

  // Closed upward and checked against "every value" in `finish`, after the closing: a
  // model sure only about `rarely` still means every smoker, and a closing that reaches
  // every value is caught there rather than stored.
  return finish(chosen.name, excludes, `${chosen.name} at ${field.confidence.toFixed(2)}`, costUsd);
}

/**
 * Map one sentence. Returns `predicate: null` when nothing fits, which is the common
 * case and not a failure.
 *
 * Goes through the typed model when one is configured (see `mapDealbreakerTyped`) and
 * through the prose model otherwise, so turning the experiment off is one empty
 * environment variable and the behaviour returns exactly to what it was.
 */
export async function mapDealbreaker(
  ctx: { tenantId: string; userId: string },
  sentence: string,
): Promise<DealbreakerMapping> {
  const typed = decideModel();
  if (typed) return mapDealbreakerTyped(ctx, sentence, typed);

  const fields = MAPPABLE
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

  // A core card field, values it has, closed upward, never all of them -- whatever the
  // model said. See `finish`.
  return finish(parsed.data.predicate, parsed.data.excludes, parsed.data.because, res.usage.costUsd);
}
