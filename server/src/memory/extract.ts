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
import { PRIVATE_TOPICS, type FactCandidate } from './facts.js';
import { TAPPED_PREDICATES } from '../onboarding/questions.js';
import { learnedDisclosure } from '../matching/brief.js';

/** Bumped on any change below. Recorded on every fact, so a bad prompt is findable
 *  and reversible after the fact rather than merely regrettable. */
export const PROMPT_VERSION = '2026-09-28.2';
export const EXTRACTOR_VERSION = '1';

/** "none", or the private topic a sentence is about (facts.ts PRIVATE_TOPICS). */
export const TOPIC_VALUES = ['none', ...PRIVATE_TOPICS] as const;

/**
 * THE PRIVATE-TOPIC RULE, one text for every prompt that learns sentences (this one and
 * pasteImport.ts), so the two can never judge differently. Judged by meaning, because
 * the word list behind it (brief.ts namesCoreValue) only knows the phrasings somebody
 * thought of; see facts.ts PRIVATE_TOPICS for what went wrong.
 */
export const PRIVATE_TOPIC_RULE = `For every fact, set private_topic to the private topic that the sentence it came from is ABOUT, or "none". Anything on these topics is never repeated to anybody, so judge the meaning, not the words, and name the topic even when the sentence only touches it in passing:
- relationships: past or present relationships and dating history -- engagements, marriages, divorces, exes, break-ups, being left, being single again. "I called off an engagement", "we split last spring", "my ex and I still talk", "two people have left me over my work".
- children: having, wanting or not wanting children; pregnancy.
- family: who they live with; parents, siblings and how close they are.
- faith: religion, prayer, caste or community.
- politics: parties, voting, political views.
- health: illness, conditions, therapy, medication, allergies, disability.
- substances: drinking, smoking, drugs, being sober.
- diet: what they eat or will not eat, fasting.
It is about the person's own life, not a subject they like: "I read about the history of royal marriages" is "none"; "I cook for my parents every Sunday" is "family".`;

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
      private_topic: z.enum(TOPIC_VALUES),
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

/**
 * What is READ back: the same, except that a fact without a private_topic reads "none".
 * The model is sent the field as required (above), so a provider keeping to the schema
 * always fills it; this is for a reply that drops it, and for stubs written before it
 * existed. "none" is not "public": the word list (brief.ts namesCoreValue) still stands
 * behind every sentence, and a learned one still starts match-only.
 */
const ExtractionRead = Extraction.extend({
  facts: z.array(Extraction.shape.facts.element.extend({
    private_topic: z.enum(TOPIC_VALUES).catch('none'),
  })),
});

const VOCAB = CORE_PREDICATES.map(
  (p) => `  ${p.name} (${p.cardinality}, ${p.durability})`,
).join('\n');

/**
 * THE STABLE PREFIX. Byte-identical across every user and every session.
 * Nothing volatile may enter it -- no date, no name, no session id. One changed
 * byte invalidates the cache for everyone, and a cache miss is silent.
 */
export const EXTRACTION_PROMPT = `You extract durable facts about ONE person from what they typed to their AI clone. Only their own lines are here: the clone's replies are left out on purpose, because nothing the clone said is a fact about the person.

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

## Private topics

${PRIVATE_TOPIC_RULE}

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
-> did / "had the tasting menu" / asserted / private_topic "relationships"
-> Nothing about relationship_status. "ex" in a reminiscence is not a status change,
   and mentioning a person is not a fact about the speaker -- but the sentence still
   tells a stranger there was an ex, so its private topic is relationships.

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

  // THE PERSON'S OWN WORDS, NEVER THE CLONE'S (the founder, 2026-09-28). The clone's
  // replies used to go in as CLONE lines, and a reply in the first person -- "I do
  // stand-up every Friday" -- could come back as a fact about the person, then as
  // their "own" sentence. Filtered here, where every caller passes through, so no
  // caller can hand the model a reply. The cost is context: a bare "yes" to the clone's
  // question now teaches nothing -- the tapped cards ask the fields that matter.
  const said = input.transcript.filter((t) => t.role === 'user');
  if (!said.length) {
    return { candidates: [], possiblyFalse: [], intents: [], costUsd: 0, model: modelIdOf(model) };
  }
  const transcript = said.map((t) => `PERSON: ${t.content}`).join('\n');

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

  const parsed = ExtractionRead.safeParse(res.parsed);
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
    // save and share -- start shareable. A tapped field that nothing ever quotes keeps
    // its own default; the rule and why live in brief.ts learnedDisclosure.
    ...learnedDisclosure(f.predicate),
    // A PRIVATE TOPIC, JUDGED NOW, BY MEANING: commit() keeps it match-only for good,
    // whatever the kind, and "OK to share" refuses it (facts.ts PRIVATE_TOPICS).
    ...(f.private_topic !== 'none' ? { privateTopic: f.private_topic } : {}),
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
