/**
 * P1 -- fact extraction. ONE call per SESSION, not per turn.
 *
 * That is the single largest cost decision in the memory layer. A per-turn review
 * fork replaying ~20k tokens costs $9,000-36,000/month at 1k DAU; session-end
 * extraction costs ~$170. It is also BETTER, not merely cheaper: the model sees the
 * whole exchange, which is what you need to judge stance, hedging and event time.
 *
 * The cost of session-level extraction is that a fact learned at turn 2 is not in
 * the store at turn 3. That is free to mitigate -- the conversation history already
 * carries it within the session.
 *
 * This prompt has its OWN cached prefix, deliberately separate from chat's. Tool and
 * schema changes invalidate the cache, and this is the prompt we iterate on most; if
 * it shared chat's prefix, every extractor tweak would cold-start every user.
 */
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { CORE_PREDICATES, INTENTS, OPEN_PREDICATES } from '@clone/shared';
import { llm, modelFor } from '../llm/index.js';
import { modelIdOf } from '../llm/caps.js';
import type { FactCandidate } from './facts.js';
import { TAPPED_PREDICATES } from '../onboarding/questions.js';

/** Bumped on any change below. Recorded on every fact, so a bad prompt is findable
 *  and reversible after the fact rather than merely regrettable. */
export const PROMPT_VERSION = '2026-09-09.2';
export const EXTRACTOR_VERSION = '1';

/** Kept inside Anthropic's grammar subset: no recursion, no min/max, no minLength,
 *  no external $ref. Empty strings rather than optionals, for the same reason. */
const Extraction = z.object({
  facts: z.array(
    z.object({
      predicate: z.string(),
      object_text: z.string(),
      stance: z.enum(['asserted', 'hedged', 'hypothetical', 'reported', 'negated']),
      hedge_span: z.string(),
      source_quote: z.string(),
      valid_from: z.string(),
    }),
  ),
  possibly_false: z.array(
    z.object({ predicate: z.string(), current_value: z.string(), why: z.string() }),
  ),
  /** What the person seemed to want the clone FOR. Aggregated across users to decide
   *  which cluster gets recruited when discovery is switched on. Not shown to anyone. */
  intents: z.array(
    z.object({
      intent: z.enum(INTENTS),
      confidence: z.number(),
    }),
  ),
});
export type Extraction = z.infer<typeof Extraction>;

const VOCAB = CORE_PREDICATES.map(
  (p) => `  ${p.name} (${p.cardinality}, ${p.durability})`,
).join('\n');

/**
 * THE STABLE PREFIX. Byte-identical across every user and every session.
 * Nothing volatile may enter it -- no date, no name, no session id. One changed
 * byte invalidates the cache for everyone, and a cache miss is silent.
 */
export const EXTRACTION_PROMPT = `You extract durable facts about ONE person from a transcript of them talking to their AI clone.

## Predicates

Use only these. "single" means the person can have only one at a time; "multi" means several can be true at once. "hard" means it does not change on a whim; "soft" means it can drift.

${VOCAB}

If something matters but fits none of them, use the open tier with a free-text object: ${OPEN_PREDICATES.join(', ')}.

## Rules

NEVER generalise the object. "Gamecube" stays "Gamecube", not "gaming console". "three screenplays" stays "three", not "several". Record what they said, in their words.

Write facts as declarative statements about the person, not as instructions to yourself. "Prefers concise answers" — yes. "Always answer concisely" — no. Imperative phrasing gets re-read as a directive in a later session and can override what the person is asking for right now.

Set valid_from ONLY when they state or clearly imply a time ("since March", "last year", "when I moved"). Leave it empty otherwise. Do NOT hallucinate or infer dates from unrelated events. An empty valid_from is correct and common.

Set stance honestly, and put the hedge itself in hedge_span, verbatim:
- asserted: they stated it as true now. "I work at Acme."
- hedged: they softened it. "I think I'm probably moving." -> hedge_span: "I think", "probably"
- hypothetical: it has not happened. "I might quit." -> hedge_span: "I might"
- reported: someone else's claim about them. "My sister says I'm stubborn."
- negated: they denied it. "I don't drink."
Only "asserted" becomes something the clone will state as fact. Getting this wrong turns an idle remark into a confident belief, so when in doubt choose the weaker stance.

A temporary situation is not a change of state. "Staying at my sister's for two weeks" is not a new lives_in. "I had the prawn curry" does not retract a shellfish allergy. Extract those as topic/did, if at all.

## The second question

After extracting, look at the person's CURRENT KNOWN FACTS below and ask: is anything there now FALSE, given what they just said? List those in possibly_false, with the reason.

Be conservative. Only list something when this transcript gives explicit evidence it stopped being true — not because they failed to mention it, and not because something similar came up. Silence is not evidence. A single anecdote does not overturn a "hard" fact.

## What they wanted this for

Separately, note what this person seemed to want the clone FOR in this session. Pick from: ${INTENTS.join(', ')}.

Judge it from what they did, not from what the clone said back. Several can apply. Give a confidence between 0 and 1, and be willing to be uncertain — a low-confidence guess is more useful here than silence, because these are aggregated and never shown to the person or acted on individually. Return an empty list if the session gives you nothing to go on.

Return only what the transcript supports. An empty list is a good answer when nothing durable was said.

## Worked examples

Deliberately NOT drawn from the eval corpus. Few-shot examples that mirror the test
cases would leak the answers and turn the matrix into a memorisation check.

PERSON: "Finally did it — handed in my notice at the clinic, I start at Riverside Hospital on the 3rd."
-> works_at / "Riverside Hospital" / asserted / valid_from empty (the 3rd of which month is not stated)
-> possibly_false: works_at "the clinic" — they said they resigned.

PERSON: "I'm house-sitting in Galway for a month while my sister's away."
-> topic / "house-sitting in Galway for a month" / asserted
-> NOT lives_in. A stated temporary stay is not a change of residence.

PERSON: "I've been toying with the idea of doing a PhD, maybe in Utrecht."
-> goal / "doing a PhD" / hypothetical / hedge_span "toying with the idea"
-> NOT lives_in Utrecht, and not a goal they hold firmly. The hedge is the fact.

PERSON: "Cheese doesn't agree with me, never has."
-> dietary_restriction / "cheese doesn't agree with me" / asserted
-> Verbatim. Do not upgrade this to "lactose intolerant" — that is a diagnosis they did not make.

PERSON: "Had the tasting menu at that place my ex used to love."
-> did / "had the tasting menu" / asserted
-> Nothing about relationship_status. "ex" in a reminiscence is not a status change,
   and mentioning a person is not a fact about the speaker.

PERSON: "Work's been heavy lately."
-> nothing. Too vague to name an employer, a role, or a feeling that will still be
   true next week. An empty list is the correct answer here.

PERSON: "My brother keeps saying I'm a workaholic."
-> topic / "brother says they are a workaholic" / reported
-> Someone else's characterisation. Never asserted.`;

export interface ExtractInput {
  transcript: { role: 'user' | 'assistant'; content: string }[];
  currentFacts: { predicate: string; objectText: string }[];
  tenantId: string;
  userId: string;
}

export interface ExtractOutput {
  candidates: FactCandidate[];
  possiblyFalse: Extraction['possibly_false'];
  intents: Extraction['intents'];
  costUsd: number;
  model: string;
}

/**
 * `valid_from` is world time, and models return prose for it constantly -- "about six
 * years ago", "last spring". `new Date()` turns those into Invalid Date, which passes
 * a truthiness check and is then rejected by Postgres, taking the whole extraction
 * down. Unparseable means unknown, which is exactly what the prompt says an empty
 * value means.
 */
function parseWorldTime(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function extractSessionFacts(
  input: ExtractInput,
  sourceEpisodeIds: string[],
): Promise<ExtractOutput> {
  const model = modelFor('extract');

  const known = input.currentFacts.length
    ? input.currentFacts.map((f) => `- ${f.predicate}: ${f.objectText}`).join('\n')
    : '(nothing known yet)';

  const transcript = input.transcript
    .map((t) => `${t.role === 'user' ? 'PERSON' : 'CLONE'}: ${t.content}`)
    .join('\n');

  const res = await llm.complete(
    {
      task: 'extract',
      instructions: EXTRACTION_PROMPT,
      messages: [
        { role: 'user', content: `## Current known facts\n${known}\n\n## Transcript\n${transcript}` },
      ],
      tenantId: input.tenantId,
      userId: input.userId,
      outputSchema: Extraction,
      outputSchemaName: 'extraction',
      // One breakpoint, on the shared prefix. The per-user block below it changes
      // every session and is not worth a breakpoint.
      cache: [{ scope: 'instructions', ttl: '5m' }],
      maxOutputTokens: 4096,
      thinking: false,
    },
    model,
  );

  const parsed = Extraction.safeParse(res.parsed);
  if (!parsed.success) {
    // Structured output failed. Return nothing rather than guessing: a wrong fact is
    // far more expensive than a missing one, because it will be stated confidently.
    return {
      candidates: [], possiblyFalse: [], intents: [],
      costUsd: res.usage.costUsd, model: modelIdOf(model),
    };
  }

  const candidates: FactCandidate[] = parsed.data.facts.map((f) => ({
    predicate: f.predicate,
    objectText: f.object_text,
    validFrom: parseWorldTime(f.valid_from),
    stance: f.stance,
    hedgeSpan: f.hedge_span || undefined,
    sourceQuote: f.source_quote,
    sourceEpisodeIds,
    // The person said it about themselves -- but ON A FIELD THEY TAP, a sentence is a
    // proposal, not an answer. 'untrusted' stages it (facts.ts passesStanceGate): it
    // cannot supersede the card or the basic, and waits for a Yes. Everywhere else the
    // person's own words are 'owner', as before. See TAPPED_PREDICATES for what went
    // wrong. (Facts from anywhere else entirely -- another user's agent -- are
    // 'untrusted' too.)
    originClass: TAPPED_PREDICATES.has(f.predicate) ? 'untrusted' : 'owner',
    // LEARNED IS NOT SHARED (the founder, 2026-09-25). What the clone picks up in chat
    // or "tell" is the person's, and their agent may use it for matching -- but it is
    // never quoted on a card or said in the agents' talk until they tap "OK to share"
    // on "How you appear". So it starts match-only. Only answers they wrote on purpose
    // for sharing -- the five set questions (stories.ts), and a question of the day they
    // save and share -- start shareable. A tapped field keeps its own default: it is
    // never quoted either way.
    ...(TAPPED_PREDICATES.has(f.predicate) ? {} : { disclosure: 'matchable_only' as const }),
    extractorModel: modelIdOf(model),
    extractorVersion: EXTRACTOR_VERSION,
    promptVersion: PROMPT_VERSION,
  }));

  return {
    candidates,
    possiblyFalse: parsed.data.possibly_false,
    intents: parsed.data.intents,
    costUsd: res.usage.costUsd,
    model: modelIdOf(model),
  };
}
