/**
 * Stories: a few open questions, answered in the person's own words, so their agent
 * has something true to talk about.
 *
 * WHY (the founder, 2026-09-24). He asked for agents that talk to each other -- "more
 * fun" -- and for the talk to mean something no filter can do. The agents that used to
 * talk made things up; the one on a real user's card invented a comedy-writer life,
 * and the evidence was that it had almost nothing real to say (9 facts, 1 episode). A
 * prompt line forbidding invention was already there and did not stop it. What does is
 * material: "Agents make things up when they have nothing real to say", so onboarding
 * asks for some. Every answer is a sentence the person typed, stored so the ordinary
 * quote check -- found word for word in something they typed -- passes for it, and the
 * agents' talk (matching/talk.ts) may only ever repeat such sentences.
 *
 * WHAT A SAVE WRITES, and nothing else: one user-role episode holding the words, and
 * one `prompt_answer` fact whose source_quote is those same words, tagged with the
 * story's id. Not the 'interview' extractor -- a brief never quotes that one, because
 * the interview writes "Question? value" strings; these are sentences. No model call.
 * A second answer to the same story retires the first (status 'superseded', kept, as
 * every other change of mind is kept); nothing is deleted.
 */
import type { PoolClient } from 'pg';
import * as episodes from '../memory/episodes.js';
import { commit } from '../memory/facts.js';
import { contactDetail } from '@clone/shared';
import { namesCoreValue } from '../matching/brief.js';

export interface Story {
  id: string;
  /** The question, as the screen asks it. */
  text: string;
  /** One short line under it, or null. */
  hint: string | null;
  /**
   * Only the person and their agent ever see the answer: it is what they WANT, checked
   * against other people's sentences (matching/wants.ts), and never quoted to anybody.
   */
  forYou?: boolean;
}

/**
 * THE FIVE. Things two people could actually talk about, and the last one is the date
 * itself -- the agents' date idea (talk.ts) is built from what both people said here.
 * None of them asks about the five cards; an answer that names one anyway is kept but
 * never repeated to anybody (namesCoreValue), and the screen says so.
 */
export const STORIES: readonly Story[] = [
  { id: 'story-sunday', text: 'What does a perfect Sunday look like?', hint: 'Morning to night, roughly.' },
  { id: 'story-hours', text: 'What could you talk about for hours?', hint: null },
  { id: 'story-trip', text: 'Your best trip so far, or the next one?', hint: 'Where, and what made it.' },
  { id: 'story-lately', text: 'What are you into lately?', hint: 'Shows, music, books, food, a hobby.' },
  { id: 'story-date', text: 'Plan a first date you would love.', hint: 'Where, when, what you would do.' },
  // THE ONE THAT IS NOT SAID TO ANYBODY. A want, stored as `seeking` and match-only:
  // never quoted, never in a talk. Each sentence of it is checked against the other
  // person's own sentences, and the card shows the want beside their quote (wants.ts).
  {
    id: 'story-want', text: 'What would you love in someone?', forYou: true,
    hint: 'Only you see this. Your agent looks for it in what people say about themselves.',
  },
];
export const STORY_IDS: ReadonlySet<string> = new Set(STORIES.map((s) => s.id));

/**
 * The same bounds a quote has (brief.ts loadQuotes): under twelve characters is not a
 * sentence anybody can be quoted by, and over three hundred is not one either.
 */
export const STORY_MIN = 12;
export const STORY_MAX = 300;

export interface StoryAnswer {
  factId: string;
  text: string;
  /** It names one of the private cards, so no agent will ever repeat it. */
  private: boolean;
  /** It holds a phone number, email, handle, link or address: never repeated either. */
  contact: boolean;
}

/** Every story with the person's current answer, or null. Their own rows only. */
export async function readStories(
  c: PoolClient, userId: string,
): Promise<(Story & { answer: StoryAnswer | null })[]> {
  // The want is the person's current `seeking` sentence, wherever it came from -- this
  // screen or something chat heard -- because that is what the check reads.
  const { rows: seeking } = await c.query<{ id: string; object_text: string }>(
    `SELECT id, object_text FROM facts
      WHERE user_id = $1 AND predicate = 'seeking' AND status = 'active' AND valid_to IS NULL
      ORDER BY recorded_at DESC LIMIT 1`, [userId]);
  const { rows } = await c.query<{ id: string; prompt: string; source_quote: string }>(
    `SELECT id, object_value->>'prompt' AS prompt, source_quote FROM facts
      WHERE user_id = $1 AND predicate = 'prompt_answer' AND status = 'active'
        AND valid_to IS NULL AND object_value ? 'prompt'
      ORDER BY recorded_at DESC`,
    [userId]);
  const byStory = new Map<string, StoryAnswer>();
  for (const r of rows) {
    if (!byStory.has(r.prompt)) {
      byStory.set(r.prompt, {
        factId: r.id, text: r.source_quote,
        private: namesCoreValue(r.source_quote), contact: contactDetail(r.source_quote) !== null,
      });
    }
  }
  const want = seeking[0]
    ? { factId: seeking[0].id, text: seeking[0].object_text, private: false, contact: false }
    : null;
  return STORIES.map((s) => ({ ...s, answer: s.forYou ? want : byStory.get(s.id) ?? null }));
}

/**
 * Save one answer. The caller has checked the id and the length.
 *
 * Runs in the caller's transaction, so the episode, the fact and the retirement of the
 * old answer land together or not at all.
 */
export async function saveStory(
  c: PoolClient,
  ctx: { tenantId: string; userId: string },
  storyId: string,
  text: string,
): Promise<{ factId: string; replaced: number }> {
  return saveOwnSentence(c, ctx, storyId, text, STORIES.find((s) => s.id === storyId)?.forYou === true);
}

/**
 * One sentence the person typed in answer to something we asked -- a story, or the
 * question of the day (`sheet:<question id>`, matching/unknowns.ts) -- kept so the quote
 * check accepts it: a user-role episode with the words, and a fact whose source_quote is
 * those same words, tagged with what it answers. A new answer to the same thing retires
 * the old one (kept, never deleted). `want` stores it as a match-only `seeking` instead.
 */
export async function saveOwnSentence(
  c: PoolClient,
  ctx: { tenantId: string; userId: string },
  prompt: string,
  text: string,
  want = false,
): Promise<{ factId: string; replaced: number }> {
  const storyId = prompt;
  const words = text.trim();
  // What makes the sentence verifiable: the person typed it. The quote check looks for
  // the fact's source_quote inside a user-role episode, word for word.
  const ep = await episodes.append(c, {
    tenantId: ctx.tenantId, userId: ctx.userId, sessionId: crypto.randomUUID(),
    turnId: crypto.randomUUID(), role: 'user', source: 'text', rawText: words, occurredAt: new Date(),
  });
  // The want is `seeking`, single-valued, so a new one supersedes the old by itself --
  // and match-only, so it is never read by the matchmaker, quoted, or talked about.
  const r = await commit(c, ctx, {
    predicate: want ? 'seeking' : 'prompt_answer', objectText: words, objectValue: { prompt: storyId },
    stance: 'asserted', originClass: 'owner', sourceQuote: words,
    sourceEpisodeIds: ep ? [ep.id] : [],
    extractorModel: 'story', extractorVersion: '1', promptVersion: '1',
    ...(want ? { disclosure: 'matchable_only' as const } : {}),
  });
  if (!r.factId) throw new Error(`story not saved: ${r.reason ?? r.outcome}`);

  // The old answer to the same story steps aside -- kept, never deleted, the way a
  // single-valued fact is superseded (facts.ts).
  const { rows } = await c.query<{ id: string; object_text: string }>(
    `UPDATE facts
        SET status = 'superseded', valid_to = now(), invalidated_at = now(), superseded_by_id = $3
      WHERE user_id = $1 AND predicate = 'prompt_answer' AND status = 'active' AND valid_to IS NULL
        AND object_value->>'prompt' = $2 AND id <> $3
      RETURNING id, object_text`,
    [ctx.userId, storyId, r.factId]);
  for (const old of rows) {
    await c.query(
      `INSERT INTO memory_audit (tenant_id, user_id, fact_id, op, before, after, actor)
       VALUES ($1,$2,$3,'supersede',$4,$5,'owner')`,
      [ctx.tenantId, ctx.userId, old.id, JSON.stringify({ objectText: old.object_text }),
       JSON.stringify({ supersededBy: r.factId, story: storyId })]);
  }
  return { factId: r.factId, replaced: rows.length };
}
