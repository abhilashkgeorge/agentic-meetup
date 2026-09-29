/**
 * Import a block of text the user pasted -- either their assistant's description of
 * them, or their own self-description -- and turn it into staged facts.
 *
 * Nothing here is asserted. Everything arrives as origin_class='untrusted' and
 * stance='reported', which means the commit gates land it as `staged`. That is the
 * point: a write is not a belief commit, and another system's flattering summary is
 * the weakest possible evidence about a person.
 *
 * Facts are promoted LAZILY, in conversation ("you mentioned you work at Acme --
 * still true?"), never through a confirm/reject wall at signup. A 200-item intake
 * form is the fastest way to lose the user on the screen that was supposed to make
 * the product feel effortless.
 */
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { CORE_PREDICATES, OPEN_PREDICATES, PASTE_MAX_CHARS, type PasteSource } from '@clone/shared';
import { llm, modelFor } from '../llm/index.js';
import { modelIdOf } from '../llm/caps.js';
import { commit, type FactCandidate } from './facts.js';
import { EXTRACTOR_VERSION } from './extract.js';
import { TAPPED_PREDICATES } from '../onboarding/questions.js';
import { learnedDisclosure } from '../matching/brief.js';
import { cardItWouldWipe } from './card-guard.js';

export const PASTE_PROMPT_VERSION = '2026-09-09.paste.2';

const VOCAB = CORE_PREDICATES.map((p) => `  ${p.name} (${p.cardinality})`).join('\n');

const Imported = z.object({
  /** Only what the text plainly states. Anything less certain goes in `unsure`. */
  facts: z.array(
    z.object({
      predicate: z.string(),
      object_text: z.string(),
      /** The span of the pasted text this came from. Provenance, and the thing the
       *  user is shown when asked to confirm it later. */
      source_span: z.string(),
      valid_from: z.string(),
    }),
  ),
  /**
   * Everything the source guessed at, hedged, inferred, or said outright it did not
   * know. Two separate arrays rather than one array with a confidence flag: a flag
   * invites the reader to keep the row and discount it, and the whole failure this
   * replaces was a flag being carried correctly and then ignored. Different
   * destination, not different metadata.
   */
  unsure: z.array(
    z.object({
      /** What the guess was about, for the log. Never stored as a value. */
      topic: z.string(),
      source_span: z.string(),
      /** Asked in the person's own words, in conversation. */
      question: z.string(),
    }),
  ),
});

/**
 * Separate prompt from session extraction, and a separate cached prefix.
 *
 * The input is not a conversation -- it is a third party's prose summary of a person.
 * Assistant summaries generalise ("works in tech"), flatter, and infer. This prompt
 * exists mainly to resist that.
 */
export const IMPORT_PROMPT = `You are reading a block of text that describes ONE person. It was either written by an AI assistant that person uses, or written by the person themselves. Extract durable facts about them.

## Predicates

Use only these:

${VOCAB}

For anything that matters but fits none of them, use the open tier: ${OPEN_PREDICATES.join(', ')}.

## Rules

NEVER generalise. If the text says "Gamecube", the object is "Gamecube", not "gaming console". If it says "works at Acme as a staff engineer", record the employer and the title separately and verbatim. A summary that has already generalised something ("works in technology") is too vague to be a fact -- skip it rather than inventing specificity it does not have.

Extract only what the text actually says. This is somebody else's description of a person and it will contain flattery, inference and padding. "Thoughtful and curious" is not a fact. "Reads two or three books a month" is.

Set valid_from ONLY when the text states a time. Leave it empty otherwise. Do not infer dates.

## The one rule that matters

A guess is NEVER a fact. Not a flagged fact, not a low-confidence fact -- not a fact.

Put an item in \`unsure\` instead of \`facts\` whenever ANY of these is true:
- the source hedges: "I think", "seems to", "may", "probably", "likely", "appears"
- the source presents it as inference: "which implies", "suggests", "based on"
- the source says the person did not state it: "you haven't told me", "I don't know"
- the item sits under a heading about what the source is unsure of or has guessed
- it is marked (unsure) or (inferred)
- you are not certain the text actually says it

Worked example, because this is the failure that made the rule. Given:

  "Your marital status -- you mentioned sending a 'best photo' feature to 'my wife,'
   which implies you're married, but you haven't stated it directly."

WRONG: facts += { predicate: "relationship_status", object_text: "married" }
RIGHT: unsure += { topic: "marital status", question: "Are you married?" }

The sentence says plainly that the person never stated it. Storing "married" invents
a fact about someone's life from a turn of phrase. Being asked a question you have
already answered is a small annoyance. Being told what your marital status is, wrongly,
is not.

Write each \`question\` the way a person would ask it out loud -- short, direct, one
thing: "Are you married?", "Which city do you live in now?", "Do you still work at
Acme?". Not "Please confirm your marital status."

source_span must be the sentence or clause the fact came from, copied verbatim. It is shown to the person later when they are asked to confirm the fact, so it must be recognisable to them.

Return empty lists rather than padding. A short accurate list is worth far more than a long speculative one -- everything here will be checked with the person before it is believed.`;

export interface ImportResult {
  staged: number;
  rejected: number;
  /** Things the source guessed at. Queued as questions, stored as nothing. */
  questions: number;
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

export async function importPastedText(
  c: PoolClient,
  ctx: { tenantId: string; userId: string },
  text: string,
  source: PasteSource,
): Promise<ImportResult> {
  const trimmed = text.trim().slice(0, PASTE_MAX_CHARS);
  if (!trimmed) return { staged: 0, rejected: 0, questions: 0, costUsd: 0, model: '' };

  const model = modelFor('extract');
  const res = await llm.complete(
    {
      task: 'extract',
      instructions: IMPORT_PROMPT,
      messages: [{ role: 'user', content: trimmed }],
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      outputSchema: Imported,
      outputSchemaName: 'imported',
      cache: [{ scope: 'instructions', ttl: '5m' }],
      maxOutputTokens: 8192,
      thinking: false,
    },
    model,
  );

  const parsed = Imported.safeParse(res.parsed);
  if (!parsed.success) {
    return {
      staged: 0, rejected: 0, questions: 0,
      costUsd: res.usage.costUsd, model: modelIdOf(model),
    };
  }

  let staged = 0;
  let rejected = 0;
  for (const f of parsed.data.facts) {
    const cand: FactCandidate = {
      predicate: f.predicate,
      objectText: f.object_text,
      validFrom: parseWorldTime(f.valid_from),
      // Everything imported is REPORTED, never asserted -- gate G4 therefore stages
      // it. Even the user's own self-description: prose written about yourself in one
      // sitting is a claim, and it gets confirmed in conversation like any other.
      stance: 'reported',
      sourceQuote: f.source_span,
      sourceEpisodeIds: [],
      // 'untrusted' regardless of source. A user's assistant is not this user, and
      // gate G3 will exclude untrusted facts from prompt assembly structurally.
      originClass: 'untrusted',
      // Learned, not shared: match-only until "OK to share" (brief.ts learnedDisclosure).
      ...learnedDisclosure(f.predicate),
      extractorModel: modelIdOf(model),
      extractorVersion: EXTRACTOR_VERSION,
      promptVersion: `${PASTE_PROMPT_VERSION}:${source}`,
    };
    const r = await commit(c, ctx, cand);
    if (r.outcome === 'rejected') rejected++;
    else staged++;
  }

  // Guesses become questions the clone asks in conversation. Nothing about them is
  // written to `facts`, so there is no row to leak into a prompt, a profile rebuild
  // or an export -- which is the difference between this and a confidence flag.
  let questions = 0;
  for (const u of parsed.data.unsure) {
    const q = u.question.trim();
    if (!q) continue;
    const r = await c.query(
      `INSERT INTO fact_conflicts (tenant_id, user_id, fact_a_id, kind, clarifying_question)
       VALUES ($1,$2,NULL,'gap',$3)
       ON CONFLICT DO NOTHING`,
      [ctx.tenantId, ctx.userId, q],
    );
    if (r.rowCount) questions++;
  }

  return { staged, rejected, questions, costUsd: res.usage.costUsd, model: modelIdOf(model) };
}

/** One staged claim, as a person is shown it. */
export interface StagedFact {
  id: string;
  predicate: string;
  objectText: string;
  sourceQuote: string;
}

/**
 * Staged facts, split by whether being wrong about them actually costs anything.
 *
 * The original design said "confirm lazily in conversation, never a wall". Then gate
 * 0010 made an untrusted fact unable to go active under any circumstances -- correct,
 * and it turned every import into exactly the wall it forbade: 40 low-stakes claims
 * queued up one at a time, asking whether it is really true that you are interested
 * in chess.
 *
 * The split is by `durability`, which the predicate table already carries:
 *
 *   HARD   lives_in, works_at, relationship_status, allergy, has_children...
 *          Single-valued, stated confidently, and expensive to get wrong. Worth one
 *          question each, and there are only ever a handful.
 *
 *   SOFT   interest, topic, owns, did, goal...
 *          Additive and cheap. Being wrong about one costs a raised eyebrow. These
 *          are reviewed in BULK -- shown as a list, rejected by exception, accepted
 *          with one tap.
 *
 * Nothing here weakens the provenance rule. Both paths still end at
 * `confirmStagedFact`, which re-commits as first-party. What changes is how many
 * times a person has to be asked.
 */
export async function pendingConfirmation(
  c: PoolClient,
  userId: string,
  limit = 1,
): Promise<StagedFact[]> {
  const { rows } = await c.query<StagedRow>(
    `SELECT f.id, f.predicate, f.object_text, f.source_quote
       FROM facts f
       JOIN predicates p ON p.name = f.predicate
      WHERE f.user_id = $1 AND f.status = 'staged' AND f.origin_class = 'untrusted'
        AND (p.durability = 'hard' OR f.predicate = ANY($3))
      ORDER BY f.recorded_at
      LIMIT $2`,
    // A TAPPED field is asked about on its own even when its predicate is 'soft':
    // smoking, drinking and distance are soft, and the pile below is kept unless the
    // person strikes it out -- one "keep the rest" would turn a sentence into a card
    // answer every other person's rule is then tested against.
    [userId, limit, [...TAPPED_PREDICATES]],
  );
  return rows.map(toStaged);
}

/** The bulk pile: everything cheap enough to accept without being asked one by one. */
export async function reviewable(
  c: PoolClient,
  userId: string,
  limit = 200,
): Promise<StagedFact[]> {
  const { rows } = await c.query<StagedRow>(
    `SELECT f.id, f.predicate, f.object_text, f.source_quote
       FROM facts f
       JOIN predicates p ON p.name = f.predicate
      WHERE f.user_id = $1 AND f.status = 'staged' AND f.origin_class = 'untrusted'
        AND p.durability = 'soft' AND NOT (f.predicate = ANY($3))
      ORDER BY f.predicate, f.recorded_at
      LIMIT $2`,
    [userId, limit, [...TAPPED_PREDICATES]],
  );
  return rows.map(toStaged);
}

interface StagedRow {
  id: string;
  predicate: string;
  object_text: string;
  source_quote: string;
}

const toStaged = (r: StagedRow): StagedFact => ({
  id: r.id,
  predicate: r.predicate,
  objectText: r.object_text,
  sourceQuote: r.source_quote,
});

export async function confirmStagedFact(
  c: PoolClient,
  ctx: { tenantId: string; userId: string },
  factId: string,
): Promise<{ confirmed: boolean; cardKept?: string }> {
  const { rows } = await c.query<{
    predicate: string; object_text: string; source_quote: string; valid_from: Date | null;
  }>(
    `SELECT predicate, object_text, source_quote, valid_from FROM facts
      WHERE id = $1 AND user_id = $2 AND status = 'staged'`,
    [factId, ctx.userId],
  );
  const row = rows[0];
  if (!row) return { confirmed: false };

  // NEVER OVER A CARD ANSWER IT CANNOT READ (card-guard.ts): the card stays, the words go.
  const cardKept = await cardItWouldWipe(c, ctx.userId, row.predicate, row.object_text);
  if (cardKept !== null) {
    await rejectStagedFact(c, ctx.userId, factId);
    return { confirmed: false, cardKept };
  }

  await c.query(
    `UPDATE facts SET status = 'retracted', invalidated_at = now()
      WHERE id = $1 AND user_id = $2`,
    [factId, ctx.userId],
  );

  await commit(c, ctx, {
    predicate: row.predicate,
    objectText: row.object_text,
    validFrom: row.valid_from,
    stance: 'asserted',
    sourceQuote: row.source_quote,
    sourceEpisodeIds: [],
    originClass: 'owner',
    // "Yes, that's true" is not "OK to share": a confirmed import stays match-only, the
    // work field, exercise and sleep included (brief.ts learnedDisclosure).
    ...learnedDisclosure(row.predicate),
    extractorModel: 'user-confirmed',
    extractorVersion: EXTRACTOR_VERSION,
    promptVersion: PASTE_PROMPT_VERSION,
  });

  return { confirmed: true };
}

/** The user rejected it. Keep the row as evidence of what the import got wrong. */
export async function rejectStagedFact(
  c: PoolClient,
  userId: string,
  factId: string,
): Promise<void> {
  await c.query(
    `UPDATE facts SET status = 'retracted', invalidated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'staged'`,
    [factId, userId],
  );
}
