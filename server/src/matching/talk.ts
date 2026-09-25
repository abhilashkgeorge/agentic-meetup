/**
 * The agents talk: two people's agents meet, ask each other things, notice what the two
 * people share, and come back with a first-date idea -- every word about a person being
 * that person's own.
 *
 * WHY THIS EXISTS (the founder, 2026-09-24). He wanted the agents to talk to each other
 * -- "more fun" -- and asked the right question about it: if everybody answers the same
 * questions, a filter does the matching, so agent-to-agent talk only means something if
 * it does what no filter can. Two things a filter cannot do: see that "Nandi Hills at
 * sunrise" and "I cycle out of the city on weekends" are the same love of early
 * mornings outdoors, and plan a first date both people would say yes to. That is the
 * job here. Deciding who meets stays with the cards and the filter (candidates.ts);
 * nothing in this file changes who is met or in what order.
 *
 * WHY A PROMPT IS NOT THE GUARD. The conversations this revives (rendezvous.ts, off
 * since 2026-09-23) told the model "Only say things you were actually told about your
 * person. Never invent a detail to keep it going." -- and one of them invented a
 * comedy-writer life that reached a real user's card. A model with little to say fills
 * the silence. So the model here WRITES NOTHING ABOUT ANYBODY. It chooses:
 *   - which question from the fixed bank an agent asks (answer-sheet.ts SHEET),
 *   - which of its OWN person's numbered sentences an agent answers with, or that it
 *     does not know,
 *   - a reaction from a fixed list,
 *   - pairs of sentences, one from each side, that show something the two share,
 *   - one short date idea, citing one sentence from each side.
 * Every sentence shown is looked up from the number, verbatim; a number out of range, a
 * number from the wrong person's list, an unknown question or reaction is dropped by
 * code (checkTalk). The only words the model writes are the date idea, and code refuses
 * one that talks about a person at all (safeIdea).
 *
 * WHAT IT SEES: each side's sentences that already pass the quote check -- public,
 * found word for word in something the person typed, never the interview, never a core
 * value (brief.ts loadQuotes) -- and nothing else. A practice profile's sentences are
 * its template lines, marked practice all the way to the screen.
 *
 * WHAT IT COSTS: one small structured call per pair, under the round's meter, on the
 * starter's budget. A call that fails, or returns less than two answers worth showing,
 * leaves the pair with the answer-sheet exchange, which costs nothing (answer-sheet.ts).
 * The round never fails because of this. AGENT_TALK=off switches it off.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { llm, modelFor } from '../llm/index.js';
import { log } from '../log.js';
import { mayRepeat, type TalkLine, type TalkView } from './brief.js';
import { SHEET, SHEET_SOURCES } from './answer-sheet.js';

/** Whether the agents talk. Read at call time, so a test or an operator can flip it. */
export const talkOn = (): boolean => (process.env.AGENT_TALK ?? 'on') !== 'off';

/** The kinds of sentence the agents may use: the same as an answer sheet's. */
export const TALK_SOURCES = SHEET_SOURCES;

/** At most this many sentences a side, most recent first. */
export const TALK_SENTENCES = 20;

/** At most this many lines in one talk. */
export const MAX_LINES = 12;

/**
 * THE REACTIONS: fixed, and about what was just said, never about anybody. "Same here!"
 * is not one of them -- it is a claim about the speaker's person that no number backs.
 */
export const REACTIONS: Readonly<Record<string, string>> = {
  nice: 'Oh, nice.',
  love: 'Love that.',
  ha: 'Ha!',
  fair: 'Fair enough.',
};

/** One sentence a side may use: its words, and whether it is a practice template. */
export interface TalkSentence { text: string; practice?: boolean }

/**
 * A talk, before anybody reads it: sides 'a' (the round's starter) and 'b'. `talkFor`
 * turns it into what one reader sees.
 */
export interface Talk {
  lines: { by: 'a' | 'b'; kind: TalkLine['kind']; text: string; q?: string; practice?: boolean }[];
  shared: { a: string; b: string; practice?: boolean }[];
  date: { idea: string; a: string; b: string; practice?: boolean } | null;
}

// ── what the model returns ──────────────────────────────────────────────────

/**
 * No field is nullable, on purpose: "nothing here" is 0 or '', which every provider's
 * structured output can say. The Gemini adapter used to turn a nullable field into a
 * required one (fixed in adapters/google.ts); this shape does not depend on that.
 */
export const TalkOut = z.object({
  lines: z.array(z.object({
    by: z.enum(['A', 'B']),
    kind: z.enum(['ask', 'answer', 'dont_know', 'react']),
    question: z.string(),
    sentence: z.number().int(),
    reaction: z.string(),
  })),
  shared: z.array(z.object({ a: z.number().int(), b: z.number().int() })),
  date: z.array(z.object({ idea: z.string(), a: z.number().int(), b: z.number().int() })),
});

const INSTRUCTIONS = `You script a short, warm first chat between two dating agents, A and B. Each agent speaks for one person, using ONLY that person's own numbered sentences.

You never write a sentence about a person. You choose:
- "ask": an agent asks the other a question. Put the question's id in "question".
- "answer": an agent answers the question just asked with ONE sentence from ITS OWN person's list. Put that sentence's number in "sentence". Both agents may answer the same question.
- "dont_know": an agent has no sentence that answers the question. Use it rather than stretch a sentence to fit.
- "react": a short reaction to what the other agent just said. Put the reaction's id in "reaction".
Use 0 for "sentence" and "" for "question" or "reaction" when they do not apply.

Then:
- "shared": up to 2 pairs of sentence numbers, one from A's list and one from B's, that show something the two people genuinely have in common -- especially when they say it in different words. Leave it empty if nothing is really shared.
- "date": at most one first-date idea both people would enjoy, built on one sentence from each list ("a" and "b" are those numbers). The idea is under 12 words, says what to do and where, and never mentions either person: no he, she, they, I, you, no names, nothing about kids, faith, politics, smoking, drinking or diet. Example: "Sunrise walk in Cubbon Park, then filter coffee".

Keep it to 6-12 lines. Ask what brings out what the two have in common. Never repeat a sentence.`;

// ── checking what came back ─────────────────────────────────────────────────

const PERSON = /\b(i|me|my|mine|we|us|our|ours|you|your|yours|he|him|his|she|her|hers|they|them|their|theirs|both)\b/i;
const CLAIM = /\b(loves?|likes?|enjoys?|hates?|prefers?|adores?|fan of|into)\b/i;

/**
 * WORDS THAT JUDGE A PAIR. Nothing the agents' talk shows a person may say how well two
 * people fit (the founder: no score, no verdict -- OkCupid 2014, the number changes
 * behaviour more than it predicts it). Every fixed line the talk can say is written
 * without them (tests/talk-verdicts.test.ts), and the date idea -- the one thing a model
 * writes -- is refused when it uses one. Ambiguous words ("match", "chemistry") are
 * refused too: a date idea can do without them.
 */
export const VERDICT = /\b(match(es|ed|ing)?|compatib\w*|chemistry|clicks?|clicked|soul ?mates?|perfect (pair|couple|fit)|great fit|good fit|meant to be|made for each other|scores?|percent|red flags?|green flags?|deal ?breakers?|verdict|get on|got on|worth it)\b|%/i;

/**
 * THE DATE IDEA STATES NOTHING NOT IN THEIR OWN WORDS (the founder, 2026-09-25). Every
 * content word of it must come from one of the two sentences it is built on -- the ones
 * the card shows beside it -- or from this list: plain words for going out, and the
 * city's public places. Nothing here is a fact about anybody; "salsa", "pottery", "a
 * rooftop bar" are, when neither person said them.
 */
const DATE_WORDS = new Set([
  // what two people might do
  'walk', 'stroll', 'hike', 'trek', 'ride', 'cycle', 'drive', 'run', 'swim', 'picnic', 'visit',
  'explore', 'class', 'workshop', 'show', 'gig', 'concert', 'market', 'museum', 'gallery',
  'bookshop', 'bookstore', 'library', 'park', 'lake', 'garden', 'cafe', 'café', 'bakery',
  'darshini', 'beach', 'hill', 'hills', 'view', 'viewpoint', 'spot', 'place', 'trip', 'tour',
  'play', 'game', 'games', 'board', 'quiz', 'cook', 'cooking', 'bake', 'baking', 'tasting', 'try',
  'film', 'movie', 'cinema', 'screening', 'stars', 'stargazing', 'shopping', 'flea', 'art',
  'music', 'live', 'dance', 'food', 'street', 'stall', 'stalls', 'meal', 'eat', 'together',
  'breakfast', 'brunch', 'lunch', 'dinner', 'snack', 'snacks', 'dessert', 'coffee', 'filter',
  'chai', 'tea', 'dosa', 'idli', 'juice', 'ice', 'cream', 'sweets',
  // when
  'sunrise', 'sunset', 'morning', 'evening', 'night', 'afternoon', 'noon', 'weekend', 'day',
  'saturday', 'sunday', 'early', 'late', 'slow', 'quiet', 'long', 'short', 'easy', 'little',
  'small', 'local', 'old', 'new', 'first', 'next', 'followed', 'afterwards', 'city', 'town',
  // the city's public places
  'bengaluru', 'bangalore', 'cubbon', 'lalbagh', 'ulsoor', 'nandi', 'hebbal', 'sankey',
  'bannerghatta', 'turahalli', 'church', 'commercial', 'road', 'palace', 'koramangala',
  'indiranagar', 'jayanagar', 'whitefield', 'malleshwaram', 'basavanagudi', 'rajajinagar',
  'yelahanka', 'jp', 'nagar', 'btm', 'hsr', 'layout', 'mg', 'frazer', 'sadashivanagar',
]);
const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'then', 'at', 'in', 'on', 'to', 'of', 'for', 'with', 'by',
  'near', 'around', 'out', 'up', 'over', 'after', 'before', 'from', 'into', 'some', 'plus',
  'off', 'down', 'along', 'across', 'through', 'via', 'its', 'one', 'two', 'maybe',
]);
const stem = (w: string): string => {
  let s = w.toLowerCase();
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith('es')) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s')) s = s.slice(0, -1);
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
};
const words = (t: string): string[] => t.toLowerCase().match(/[\p{L}]+/gu) ?? [];
const DATE_STEMS = new Set([...DATE_WORDS].map(stem));

/** The idea's words that neither sentence nor the plain list accounts for. Pure. */
export function ungrounded(idea: string, sentences: readonly string[]): string[] {
  const theirs = new Set(sentences.flatMap(words).map(stem));
  return words(idea).filter((w) => !STOP.has(w) && !DATE_STEMS.has(stem(w)) && !theirs.has(stem(w)));
}

/**
 * A date idea may be shown only if it is a suggestion, not a statement about somebody:
 * short, no person in it, no claim verb, nothing that names a private card, and no
 * contact detail or street address (mayRepeat).
 */
export function safeIdea(raw: string): string | null {
  const idea = raw.replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
  if (idea.length < 8 || idea.length > 80) return null;
  if (idea.split(' ').length > 14) return null;
  if (PERSON.test(idea) || CLAIM.test(idea) || VERDICT.test(idea) || !mayRepeat(idea)) return null;
  if (/["“”]/.test(idea)) return null;
  return idea;
}

/**
 * THE ONLY READER OF WHAT THE MODEL RETURNED. Pure. Keeps a line only when every
 * pointer in it is valid for the side speaking, and builds every word shown from the
 * bank, the fixed reactions, or the side's own sentence list -- never from the reply.
 * Null when fewer than two answers survive: not a talk worth showing.
 */
export function checkTalk(
  parsed: unknown,
  a: readonly TalkSentence[],
  b: readonly TalkSentence[],
): Talk | null {
  const p = TalkOut.safeParse(parsed);
  if (!p.success) return null;
  const listOf = (by: 'a' | 'b') => (by === 'a' ? a : b);
  const bankById = new Map(SHEET.map((q) => [q.id, q]));

  const lines: Talk['lines'] = [];
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const askedIds = new Set<string>();
  let open: { answered: Set<'a' | 'b'> } | null = null;

  for (const l of p.data.lines) {
    if (lines.length >= MAX_LINES) break;
    const by = l.by === 'A' ? 'a' : 'b';
    if (l.kind === 'ask') {
      const q = bankById.get(l.question);
      if (!q || askedIds.has(q.id)) continue;
      askedIds.add(q.id);
      lines.push({ by, kind: 'ask', text: q.ask, q: q.short });
      open = { answered: new Set() };
      continue;
    }
    if (l.kind === 'answer' || l.kind === 'dont_know') {
      if (!open || open.answered.has(by)) continue;
      if (l.kind === 'dont_know') {
        lines.push({ by, kind: 'dunno', text: "I don't know." });
        open.answered.add(by);
        continue;
      }
      const list = listOf(by);
      const used = by === 'a' ? usedA : usedB;
      const i = l.sentence - 1;                 // numbered from 1 in the prompt
      if (i < 0 || i >= list.length || used.has(i)) continue;
      used.add(i);
      const s = list[i]!;
      lines.push({ by, kind: 'say', text: s.text, ...(s.practice ? { practice: true } : {}) });
      open.answered.add(by);
      continue;
    }
    // A reaction answers the OTHER side's words, once.
    const said = REACTIONS[l.reaction];
    const last = lines[lines.length - 1];
    if (said && last && last.kind === 'say' && last.by !== by) lines.push({ by, kind: 'react', text: said });
  }

  // A question nobody answered says nothing: drop it.
  const kept = lines.filter((l, i) => l.kind !== 'ask' || ['say', 'dunno'].includes(lines[i + 1]?.kind ?? ''));
  if (kept.filter((l) => l.kind === 'say').length < 2) return null;

  const pick = (list: readonly TalkSentence[], n: number) => (n >= 1 && n <= list.length ? list[n - 1]! : null);
  const shared: Talk['shared'] = [];
  const seen = new Set<string>();
  for (const s of p.data.shared) {
    const sa = pick(a, s.a);
    const sb = pick(b, s.b);
    if (!sa || !sb || seen.has(`${s.a}:${s.b}`) || shared.length >= 2) continue;
    seen.add(`${s.a}:${s.b}`);
    shared.push({ a: sa.text, b: sb.text, ...(sa.practice || sb.practice ? { practice: true } : {}) });
  }

  let date: Talk['date'] = null;
  const d = p.data.date[0];
  if (d) {
    const idea = safeIdea(d.idea);
    const sa = pick(a, d.a);
    const sb = pick(b, d.b);
    // And nothing in it that is not in the two sentences it is built on.
    if (idea && sa && sb && ungrounded(idea, [sa.text, sb.text]).length === 0) {
      date = { idea, a: sa.text, b: sb.text, ...(sa.practice || sb.practice ? { practice: true } : {}) };
    }
  }
  return { lines: kept, shared, date };
}

/** One reader's view: their side is 'you', the other 'them'. */
export function talkFor(t: Talk | null, reader: 'a' | 'b'): TalkView | null {
  if (!t) return null;
  const who = (by: 'a' | 'b'): TalkLine['who'] => (by === reader ? 'you' : 'them');
  const mineOf = (x: { a: string; b: string }) => (reader === 'a' ? x.a : x.b);
  const theirsOf = (x: { a: string; b: string }) => (reader === 'a' ? x.b : x.a);
  return {
    lines: t.lines.map(({ by, ...l }) => ({ ...l, who: who(by) })),
    shared: t.shared.map((s) => ({ mine: mineOf(s), theirs: theirsOf(s), ...(s.practice ? { practice: true } : {}) })),
    date: t.date
      ? { idea: t.date.idea, mine: mineOf(t.date), theirs: theirsOf(t.date), ...(t.date.practice ? { practice: true } : {}) }
      : null,
  };
}

// ── the call ────────────────────────────────────────────────────────────────

const numbered = (list: readonly TalkSentence[]) => list.map((s, i) => `${i + 1}. ${s.text}`).join('\n');

/**
 * One talk between two sides, or null. Must run under an open meter (the round's):
 * the call is counted against whoever sent the agent out. Never throws.
 */
export async function agentTalk(
  who: { tenantId: string; userId: string },
  a: readonly TalkSentence[],
  b: readonly TalkSentence[],
): Promise<{ talk: Talk | null; costUsd: number }> {
  // Nothing to say on one side is nothing to talk about: no call.
  if (!a.length || !b.length) return { talk: null, costUsd: 0 };
  try {
    const questions = SHEET.map((q) => `${q.id}: ${q.ask}`).join('\n');
    const reactions = Object.entries(REACTIONS).map(([id, t]) => `${id}: ${t}`).join('\n');
    const res = await llm.complete(
      {
        task: 'extract',
        instructions: INSTRUCTIONS,
        messages: [{
          role: 'user',
          content: `QUESTIONS\n${questions}\n\nREACTIONS\n${reactions}\n\nA'S SENTENCES\n${numbered(a)}\n\nB'S SENTENCES\n${numbered(b)}`,
        }],
        tenantId: who.tenantId,
        userId: who.userId,
        outputSchema: TalkOut,
        outputSchemaName: 'agent_talk',
        maxOutputTokens: 1500,
        thinking: false,
      },
      modelFor('extract'),
    );
    const talk = checkTalk(res.parsed, a, b);
    log.info({ userId: who.userId, lines: talk?.lines.length ?? 0, shared: talk?.shared.length ?? 0,
               date: Boolean(talk?.date) }, 'agents talked');
    return { talk, costUsd: res.usage.costUsd };
  } catch (err) {
    log.warn({ err, userId: who.userId }, 'agents did not talk; the answer sheets stand in');
    return { talk: null, costUsd: 0 };
  }
}

/**
 * A practice profile's sentences: the "Things they have said" lines of its dossier,
 * which synthetic.ts writes from templates. Marked practice, filtered like any quote.
 */
export async function practiceSentences(c: PoolClient, userId: string): Promise<TalkSentence[]> {
  const { rows } = await c.query<{ synthetic_dossier: string | null }>(
    'SELECT synthetic_dossier FROM match_profile WHERE user_id = $1 AND is_synthetic', [userId]);
  const dossier = rows[0]?.synthetic_dossier ?? '';
  const said = dossier.split('Things they have said:')[1] ?? '';
  return said.split('\n')
    .map((l) => /^-\s*"(.+)"\s*$/.exec(l.trim())?.[1]?.trim() ?? '')
    .filter((t) => t.length >= 12 && t.length <= 300 && mayRepeat(t))
    .slice(0, TALK_SENTENCES)
    .map((text) => ({ text, practice: true }));
}
