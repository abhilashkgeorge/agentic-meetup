/**
 * What a person reads before deciding whether to meet somebody.
 *
 * THE BRIEF IS CODE. NO MODEL WRITES ANY OF IT. It is a fixed template filled from
 * three things that are true by construction, and nothing else:
 *
 *   the facts line   intent, age and area, read from match_profile
 *   shared tags      public interest tags both people carry
 *   their own words  up to two sentences, each found WORD FOR WORD in something the
 *                    person typed themselves
 *
 * plus one line that is the same on every card, and a template opener around a tag
 * or a quote. No concern, no verdict, no number, no headline a model composed.
 *
 * WHAT WAS WRONG. The brief used to be a model call per side: a headline the model
 * wrote about the other person, quotes it picked by index, two questions it wrote,
 * and the conversation assessor's "concern" carried through verbatim. Three separate
 * holes reached real cards:
 *
 *   1. Invented facts. A real user with nine facts and one episode, none of them about
 *      comedy, received two briefs whose concern called him a comedy writer. The
 *      concern was the assessor's reading of a conversation between two agents, and
 *      the only guard against an agent inventing its human was a line in its prompt.
 *   2. The interview's own bookkeeping served as a "quote". Interview answers are
 *      committed with `source_quote = "${question} ${value}"` (api/interview.ts), so
 *      "Children? have_and_done" passed the length filter and was offered to the model
 *      as something the person had said -- and have_and_done says they have children,
 *      which is NEVER_PUBLIC.
 *   3. Core values on the card. Nothing kept smoking, drinking, kids, monogamy or diet
 *      off it; the model was simply asked nicely.
 *
 * WHY THIS SHAPE. A person's own sentence is the one thing on a card that is
 * verifiably theirs, so it has to be CHECKED as theirs: present in a user-role
 * episode, not merely in a `source_quote` an extractor wrote. The rest is the same
 * words for every pair, so the wording can never carry a judgement ("Passes your
 * rules both ways" is on every card or it would say something by its absence). Cost:
 * zero model calls, where it was two per pair.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { findArea, contactDetail } from '@clone/shared';
import { tenantSession } from '../db/client.js';
import { log } from '../log.js';
import { TAPPED_PREDICATES } from '../onboarding/questions.js';
import { isSituationWant } from './want-questions.js';

export interface Quote {
  id: string;
  predicate: string;
  text: string;
  /** When it became true, not when it was recorded. "Two years ago", not "Tuesday". */
  when: string;
  /**
   * Only from `loadQuotes(who, { includeHidden: true })`, for the person's own preview:
   * true when they hid it. A hidden quote never reaches a card -- the default load,
   * which is the only one a brief uses, does not return it at all.
   */
  hidden?: boolean;
}

/**
 * The same words on every card. It is the whole of what the agent claims about fit,
 * and it is true of everybody a round can reach: the candidate query applies every
 * rule in both directions and lets an unanswered field pass (candidates.ts, 0020).
 */
export const BRIEF_LINE = "Passes your rules both ways, on everything they've answered";

/** What a card says when there is nothing code-written to say. */
export const PLAIN_HEADLINE = 'Your agent met someone';

/**
 * The kinds of fact whose sentence may be quoted. An ALLOWLIST, because the failure
 * it prevents is a sentence about kids, faith or smoking reaching a stranger, and a
 * denylist is only as good as the last predicate somebody remembered to add.
 *
 * Deliberately absent: every core value (wants_children, has_children,
 * monogamy_stance, smoking, drinking, diet, dietary_restriction, religion, politics
 * and their _importance), everything in NEVER_PUBLIC, relationship_intent (the facts
 * line carries it in code words; a sentence about it is where "and kids soon" lives),
 * dealbreaker (the interview's free sentence, and a statement about other people),
 * dislikes ("I can't stand smokers" names a rule), and believes / value / goal, which
 * is where faith, politics and children are said in prose.
 *
 * This checks the fact's KIND, not its words. The words are checked too, by
 * namesCoreValue below, because the kind is only the extractor's guess.
 */
export const QUOTABLE: ReadonlySet<string> = new Set([
  'interest', 'did', 'topic', 'media_taste', 'pet', 'prompt_answer',
  'works_in', 'industry', 'exercise_habit', 'sleep_pattern', 'transport',
]);

/**
 * HOW VISIBLE A LEARNED FACT IS -- heard in chat or "tell", or pasted -- both when it
 * is first written and after the person's "Yes, that's right".
 *
 * LEARNED IS NOT SHARED (the founder, 2026-09-25), and a Yes on the You screen means
 * "that is true", not "OK to share" (2026-09-28). So: match-only. Matching may use it;
 * nobody hears it until the person taps "OK to share" on "How you appear".
 *
 * The one exception is a tapped field that nothing ever quotes -- the basics, the five
 * cards, faith, the situation answers. There the field keeps its own default, because
 * no reader repeats it either way. It must not reach a tapped field that IS quotable:
 * work field, exercise and sleep became tapped on 2026-09-28 (34f33cf), and with the old
 * test -- "tapped, so keep the default" -- a confirmed "I work in AI" typed to the clone
 * went public and onto strangers' cards, sheets and the agents' talk. (The talk and the
 * sheets also say goal and dislikes; neither is tapped, so QUOTABLE is the whole test.)
 */
export function learnedDisclosure(predicate: string): { disclosure?: 'matchable_only' } {
  return TAPPED_PREDICATES.has(predicate) && !QUOTABLE.has(predicate) ? {} : { disclosure: 'matchable_only' };
}

/**
 * The kinds of tag a card may name as something you both LIKE.
 *
 * And the one kind it may name as the field you both WORK IN. They are said
 * differently because they are different claims: the card used to print every shared
 * tag as "You both like ...", and works_in comes from the interview's chips (software,
 * finance, law), so two people in the same field read "You both like finance" -- a
 * template sentence that is false about both of them. `pet` is gone for the same
 * reason ("You both like dog" is not what having one means), and no profile in the
 * database carries one.
 *
 * A tag is `predicate:value` straight from match_profile, where `smoking:daily`,
 * `wants_children:have_and_done` and `diet:vegetarian` sit beside `interest:climbing`
 * -- and an invented profile's tags are not filtered by disclosure at all -- so the
 * predicate decides, never the list the tags arrived in. And then the word is checked
 * as well (namesCoreValue): 511 practice profiles carry `interest:whisky`.
 */
export const LIKED: ReadonlySet<string> = new Set(['interest', 'media_taste']);
export const WORK: ReadonlySet<string> = new Set(['works_in']);
export const TAGGABLE: ReadonlySet<string> = new Set([...LIKED, ...WORK]);

/**
 * Word stems that name a core value, or something NEVER_PUBLIC, wherever the
 * extractor filed the sentence that holds them.
 *
 * WHAT WAS WRONG. QUOTABLE and TAGGABLE check the fact's KIND, and the kind is the
 * extractor's guess: it files whole sentences under interest, did and topic. So "I'm
 * vegetarian and love cooking", typed word for word and filed as interest:cooking,
 * passed every check and reached a stranger's card naming a diet; "Picked my daughter
 * up from school", filed under did, says has_children, which is NEVER_PUBLIC; and a
 * practice profile's interest:whisky was printed as "You both like whisky". Found in
 * review of the code-only brief, 2026-09-23; brief-code-only.test.ts plants each one.
 *
 * WHY A WORD LIST. It is code, costs nothing, and runs today, where the model check
 * the spec plans for later does not exist yet. It is FAIL-CLOSED: each stem matches
 * the START of a word, so "smoker", "smoked" and "non-smoker" are all caught -- and so
 * are "winery", "motherboard" and "liberal arts". A false positive hides one sentence
 * or one tag, and the card survives it. A false negative puts somebody's kids or faith
 * in front of a stranger. It is the second line, never the first: the kind is still
 * checked before the words are.
 *
 * Underscores and hyphens are read as spaces first, so an enum value stored raw
 * ("have_and_done", "non-veg") meets the same stems as a sentence does.
 */
const CORE_STEMS = [
  // smoking
  'smok', 'cigar', 'cigg', 'tobacco', 'nicotine', 'hookah', 'beedi', 'bidi\\b',
  'vap(?:e|es|ed|er|ing)\\b',
  // drinking
  'drink', 'drank', 'drunk', 'alcohol', 'booze', 'beers?\\b', 'wines?\\b', 'winery',
  'whisk(?:e?y|ies)\\b', 'scotch', 'vodka', 'rum\\b', 'gin\\b', 'tequila', 'cocktail',
  'liquor', 'brewer', 'pubs?\\b', 'sober', 'teetotal', 'hangover', 'tipsy',
  // kids, family and relationship status (has_children, lives_with, relationship_status)
  'kids?\\b', 'kiddo', 'child', 'sons?\\b', 'daughter', 'bab(?:y|ies)\\b', 'toddler',
  'pregnan', 'parent', 'moms?\\b', 'mum\\b', 'mummy', 'dads?\\b', 'daddy', 'mother',
  'father', 'husband', 'wife\\b', 'wives\\b', 'married', 'marriage', 'divorc', 'widow',
  'separated', 'have and done', 'have and want more',
  // relationship history, however it was filed (relationship_status is NEVER_PUBLIC).
  // The SECOND line: the first is the private topic the extractor names when it learns
  // a sentence (facts.ts PRIVATE_TOPICS), because no list knows every phrasing. Until
  // 2026-09-28 this list had "married" and "divorce" and nothing else, and "I called off
  // an engagement" passed (the clone-brain test found it).
  '(?:was|were|got|been|getting|get) engaged', 'engaged to\\b', 'engagements?\\b', 'fianc',
  'ex\\b', 'exes\\b', 'boyfriend', 'girlfriend', 'break ?ups?\\b', 'broke up', 'split up',
  'called (?:it )?off (?:the |our |my )?(?:wedding|engagement)', 'left me\\b', 'dumped',
  'cheated on', 'heartbr',
  '(?:previous|past|last|former|old|long) relationships?',
  'relationships? (?:ended|broke|fell apart|is over|was over)',
  '(?:ended|ending|end|out of) (?:a |my |our |the )?(?:[a-z0-9]+ ){0,3}relationship',
  // monogamy
  'monogam', 'non monogam', 'polyam', 'poly\\b', 'open relationship', 'open marriage',
  'open to either',
  // diet
  'vegetarian', 'vegan', 'veg\\b', 'non veg', 'eggetarian', 'pescatarian', 'omnivore',
  'eggs?\\b', 'meat', 'beef', 'pork', 'mutton', 'halal', 'kosher', 'jain', 'sattvic',
  'satvik',
  // faith, caste and community
  'gods?\\b', 'goddess', 'church', 'temple', 'mosque', 'gurdwara', 'pray', 'relig', 'faith',
  'spiritual', 'hindu', 'muslim', 'islam', 'christian', 'jesus', 'sikh', 'buddhis', 'parsi',
  'atheis', 'agnostic', 'puja', 'pooja', 'namaz', 'bible', 'quran', 'koran', 'ramadan',
  'caste', 'brahmin', 'dalit',
  // politics
  'politic', 'bjp', 'congress', 'modi\\b', 'left wing', 'right wing', 'liberal',
  'conservative', 'communis', 'socialis', 'feminis', 'election', 'vot(?:e|es|ed|ing)\\b',
  // health and drugs (medical_condition, allergy, drugs)
  'allerg', 'diabet', 'cancer', 'therap', 'depress', 'anxiety', 'adhd', 'autis', 'bipolar',
  'medicat', 'diagnos', 'weed\\b', 'ganja', 'cannabis', 'marijuana', 'drug', 'stoned',
  'rehab',
];
const CORE_WORDS = new RegExp(`\\b(?:${CORE_STEMS.join('|')})`, 'i');

/** Whether a sentence or a tag word may name a core value. True hides it. */
export function namesCoreValue(text: string): boolean {
  return CORE_WORDS.test(text.replace(/[_-]+/g, ' '));
}

/**
 * Whether a person's words may be repeated to somebody else at all: they name no core
 * value, and they hold no contact detail -- no phone number, email, @handle, link or
 * street address (shared/src/contact.ts). People swap those themselves, in chat, after
 * both say yes; before that, no card, answer or talk carries one. Every path that puts
 * a person's words in front of another person asks this.
 */
export function mayRepeat(text: string): boolean {
  return !namesCoreValue(text) && contactDetail(text) === null;
}

/**
 * Somebody's own sentences, verified.
 *
 * A QUOTE MUST BE FOUND, NOT CLAIMED. `source_quote` is whatever the writer of the fact
 * said the person said, and three writers get it wrong in three ways: the interview
 * writes "Question? value"; the chat extractor read the CLONE's turns as well as the
 * person's until 2026-09-28 (it reads only theirs now, extract.ts), so a line the clone
 * made up in the first person ("I do stand-up every Friday") could come back as the
 * person's own -- and facts from before then still carry it; and a model asked for a
 * span can paraphrase. So a fact's sentence is quotable only if it appears word for word --
 * case and runs of whitespace aside -- in an episode with role 'user': something this
 * person typed or said themselves.
 *
 * Plus: public facts only, never the interview's (the "Question? value" strings, and
 * the free sentence which is about other people), only the QUOTABLE kinds, and never
 * a sentence whose words name a core value, and never one holding a contact detail --
 * a phone number, email, @handle, link or street address (mayRepeat). Since every card,
 * answer sheet and talk reads a person's words through here, no model is even shown one.
 *
 * WHY ITS OWN SESSION. The check has to read the person's episodes, and the
 * matchmaker role -- rightly -- cannot see an episode, or any fact that is not public
 * (0028). Rather than widen that role in a migration, this reads as the person, under
 * their own tenant context, the same view they have of themselves; only sentences
 * that passed leave it. An invented profile has no episodes, so nothing of theirs can
 * be verified and they are quoted never -- their sentences were written by a model.
 */
export async function loadQuotes(
  who: { tenantId: string; userId: string },
  /**
   * `includeHidden` is for the person's OWN preview ("How you appear"): it also returns
   * the quotes they hid, flagged, so a hide can be undone. Never for a brief.
   * `predicates` and `limit` are for the answer sheet (answer-sheet.ts), which draws on
   * a few more kinds of sentence than a card quotes -- through exactly this check, so
   * there is one definition of "something this person actually said", not two.
   */
  opts: {
    includeHidden?: boolean; predicates?: readonly string[]; limit?: number;
    /**
     * Which disclosures to read, overriding `includeHidden`. Only "How you appear" asks
     * for ['matchable_only']: the sentences the clone learned and the person has not yet
     * said may be shared (extract.ts), listed there with "OK to share".
     */
    disclosures?: readonly ('public' | 'private' | 'matchable_only')[];
  } = {},
): Promise<Quote[]> {
  const rows = await tenantSession(who, async (c) => {
    const { rows } = await c.query<{
      id: string; predicate: string; source_quote: string; valid_from: Date | null; disclosure: string;
    }>(
      // THE DISCLOSURE LIST IS THE WHOLE DISCLOSURE CHECK HERE, and for a brief it is
      // ['public'] alone. Under the matchmaker role RLS (0028) enforced it as well;
      // this session is the person's own, which sees every one of their facts --
      // private, matchable_only and the NEVER_PUBLIC kinds alike. Nothing but this
      // line keeps those off a stranger's card. The hide control on "How you appear"
      // works by writing 'private' (POST /v1/facts/:id/disclosure).
      // brief-code-only.test.ts plants one of each that would otherwise pass.
      `SELECT f.id, f.predicate, f.source_quote, f.valid_from, f.disclosure
         FROM facts f
        WHERE f.user_id = $1 AND f.status = 'active' AND f.valid_to IS NULL
          AND f.disclosure = ANY($3::text[])
          -- A private topic is never offered, not even to its owner as "OK to share":
          -- it can never be shared (facts.ts PRIVATE_TOPICS, 0077).
          AND f.private_topic IS NULL
          AND f.extractor_model <> 'interview'
          AND f.predicate = ANY($2::text[])
          AND length(btrim(f.source_quote)) BETWEEN 12 AND 300
          AND EXISTS (
                SELECT 1 FROM episodes e
                 WHERE e.user_id = $1 AND e.role = 'user'
                   AND strpos(lower(regexp_replace(e.raw_text, '\\s+', ' ', 'g')),
                              lower(regexp_replace(btrim(f.source_quote), '\\s+', ' ', 'g'))) > 0)
        ORDER BY f.valid_from DESC NULLS LAST, f.recorded_at DESC
        LIMIT $4`,
      // 'private' is only ever set by the person hiding a quote (POST
      // /v1/facts/:id/disclosure); the defaults are 'public' and 'matchable_only'.
      [who.userId, [...(opts.predicates ?? QUOTABLE)],
       opts.disclosures ? [...opts.disclosures] : opts.includeHidden ? ['public', 'private'] : ['public'],
       opts.limit ?? 20],
    );
    return rows;
  });
  return rows.filter((r) => mayRepeat(r.source_quote)).map((r) => ({
    id: r.id,
    predicate: r.predicate,
    text: r.source_quote.trim(),
    when: monthYear(r.valid_from),
    ...(opts.includeHidden ? { hidden: r.disclosure === 'private' } : {}),
  }));
}

const monthYear = (d: Date | null): string =>
  d
    ? d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : '';

/** The facts line's inputs, from the one row the matchmaker can read about anybody. */
export interface CardFacts {
  age: number | null;
  intent: string[];
  /** A neighbourhood id from shared/areas.ts, when they gave one. */
  area: string | null;
  city: string | null;
}

export async function cardFacts(c: PoolClient, userId: string): Promise<CardFacts> {
  const { rows } = await c.query<{ age: number | null; intent: string[] | null; area: string | null; city: string | null }>(
    `SELECT age, intent, traits->>'area' AS area, traits->>'lives_in' AS city
       FROM match_profile WHERE user_id = $1`,
    [userId],
  );
  const r = rows[0];
  return { age: r?.age ?? null, intent: r?.intent ?? [], area: r?.area ?? null, city: r?.city ?? null };
}

/**
 * Relationship intent in words. The one value a card may name: both people chose
 * their intent to be matched on it, and the filter already made the two overlap. An
 * intent not in this table (a test's made-up tag, a value added later) is left out
 * rather than printed raw.
 */
export const INTENT_WORDS: Record<string, string> = {
  long_term: 'something long-term',
  marriage: 'marriage',
  companionship: 'companionship',
  casual: 'something casual',
};

export function headlineOf(card: CardFacts): string {
  const words = card.intent.map((i) => INTENT_WORDS[i]).filter((w): w is string => Boolean(w));
  const intent = words.length
    ? `Here for ${words.join(' or ')}`
    : card.intent.includes('undecided') ? 'Still working out what they want' : null;
  const place = (card.area ? findArea(card.area)?.name : null) ?? card.city ?? null;
  const parts = [intent, card.age ? String(card.age) : null, place].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(' · ') : PLAIN_HEADLINE;
}

/**
 * The value half of the tags of the given kinds, as words. Order kept, duplicates
 * dropped, and any word that names a core value dropped (namesCoreValue).
 */
export function tagWords(tags: readonly string[], kinds: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const at = t.indexOf(':');
    if (at < 0 || !kinds.has(t.slice(0, at))) continue;
    const word = t.slice(at + 1).replace(/[-_]+/g, ' ').trim().toLowerCase();
    if (word && mayRepeat(word) && !out.includes(word)) out.push(word);
  }
  return out;
}

/**
 * One exchange between the two agents, as a card shows it: the question, their answer,
 * yours -- each in that person's own words, null for "I don't know". Built from the two
 * answer sheets (answer-sheet.ts compareSheets) and handed in by the round, so this file
 * never imports that one: it imports this.
 */
export interface QaLine {
  /** The label beside the answers ("Weekends"). */
  q: string;
  /** The question as one agent asks the other, from the fixed bank: never a model's words. */
  ask: string;
  theirs: string | null;
  mine: string | null;
  /** Their answer is a practice profile's template, never a person's words. */
  practice?: boolean;
}

/**
 * One line of the agents' talk, as one reader sees it (talk.ts talkFor). `say` is a
 * sentence the speaker's person typed, verbatim; `ask` a question from the fixed bank;
 * `react` one of a fixed few; `dunno` is "I don't know." No model wrote any of it.
 */
export interface TalkLine {
  who: 'you' | 'them';
  kind: 'ask' | 'say' | 'dunno' | 'react';
  text: string;
  /** On an ask: the question's label ("Weekends"). */
  q?: string;
  /** A practice profile's template line, never a person's words. */
  practice?: boolean;
}

/** The agents' talk for one reader: the lines, what the two share, and a date idea. */
export interface TalkView {
  lines: TalkLine[];
  /** One sentence of each person's that shows something they share. */
  shared: { mine: string; theirs: string; practice?: boolean }[];
  /** A first-date idea -- the one thing here a model wrote -- and the two sentences it is built on. */
  date: { idea: string; mine: string; theirs: string; practice?: boolean } | null;
}

/**
 * The talk as it may reach a card: every sentence passes the same core-value test a
 * quote does, whatever built it, and a question left with no answer is dropped. Null
 * when nothing worth showing is left.
 */
function cleanTalk(t: TalkView | null): TalkView | null {
  if (!t) return null;
  const ok = (s: string) => mayRepeat(s);
  const said = t.lines.filter((l) => l.kind !== 'say' || ok(l.text));
  const lines = said.filter((l, i) => l.kind !== 'ask' || ['say', 'dunno'].includes(said[i + 1]?.kind ?? ''))
    .filter((l, i, all) => l.kind !== 'react' || all[i - 1]?.kind === 'say');
  const shared = t.shared.filter((s) => ok(s.mine) && ok(s.theirs));
  const date = t.date && ok(t.date.idea) && ok(t.date.mine) && ok(t.date.theirs) ? t.date : null;
  if (!lines.some((l) => l.kind === 'say') && !shared.length && !date) return null;
  return { lines, shared, date };
}

/**
 * One of the reader's wants, next to the other person's own sentence that bears on it
 * (wants.ts). `status` is kept for measurement and never sent to a phone: the card shows
 * the want and the quote, and the reader judges.
 */
export interface WantRow {
  want: string;
  kind: 'wants' | 'not';
  theirs: string | null;
  status: 'met' | 'not_met' | 'unknown' | 'cant_check';
  /** Check-only: a private topic, checked against a card -- never beside a quote. */
  private?: boolean;
  practice?: boolean;
}

/**
 * What a phone is told about one want, beside the want itself. A want tied to a question
 * says matches or not -- never why, never a quote -- and any want nothing could check
 * says so. An ordinary want gets no word at all: the reader judges from the quote.
 *
 * A PRIVATE TOPIC SAYS NOTHING (the founder, 2026-09-28). A want about faith, drinking,
 * smoking, kids, food or one-person-or-open is checked against the other person's card
 * answer, and "Matches" / "Doesn't match" beside it told the reader that answer -- to a
 * want that accepts one answer, exactly -- while the other person had been told "Nobody
 * ever sees your answer". Even "can't check" said something: that they declined the
 * card. So such a want gets one word, the same whatever the check found; the check
 * still moves a not-met person later in the round (wants.ts), silently. Decided by the
 * want's words, the same test that made it private (loadWants), so a card stored
 * before this rule reads the same way.
 *
 * A SITUATION ANSWER SAYS NOTHING EITHER (the founder, 2026-09-29, item (b)). A want tied
 * to a situation question -- "a saver, not an impulse spender" -- is checked against the
 * other person's tapped answer, and "Matches" beside a want that accepts one answer told
 * the reader how they answered a question whose answer "is never repeated to anybody".
 * The same one word, whatever the check found; the round still uses it, silently.
 */
export function wantCheck(
  w: Pick<WantRow, 'want' | 'status' | 'private'>,
): 'matches' | 'doesnt_match' | 'cant_check' | 'private' | null {
  if (namesCoreValue(w.want) || (w.private && isSituationWant(w.want))) return 'private';
  if (w.status === 'cant_check') return 'cant_check';
  if (!w.private) return null;
  return w.status === 'met' ? 'matches' : w.status === 'not_met' ? 'doesnt_match' : 'cant_check';
}

export interface BriefContent {
  /** Intent, age, area. Code words. */
  headline: string;
  /** BRIEF_LINE, on every card. */
  line: string;
  /** Interests and tastes both people carry, as words: "You both like ...". */
  shared: string[];
  /** The field both people work in, as words: "You both work in ...". */
  work: string[];
  /** Up to two of the OTHER person's verified sentences. */
  quotes: { text: string; when: string }[];
  /** "Ask them about: ..." around a shared tag or a quote, or nothing. */
  opener: string | null;
  /** What the two agents asked each other, and what each could answer. */
  qa: QaLine[];
  /** What the two agents said to each other (talk.ts), or null when they did not talk. */
  talk: TalkView | null;
  /** The reader's wants, each next to the other's sentence that bears on it (wants.ts). */
  wants: WantRow[];
}

/** One side as the brief sees it. `tags` are the person's public tags (publicTags). */
export interface BriefSide {
  card: CardFacts;
  tags: string[];
  quotes: Quote[];
}

/**
 * One side's brief: what `reader` is shown about `other`.
 *
 * Pure: no client, no model, no clock. The same two sides always make the same card.
 */
export function composeBrief(
  reader: BriefSide, other: BriefSide, qa: readonly QaLine[] = [], talkIn: TalkView | null = null,
  wantsIn: readonly WantRow[] = [],
): BriefContent {
  const inCommon = (kinds: ReadonlySet<string>) => {
    const mine = new Set(tagWords(reader.tags, kinds));
    return tagWords(other.tags, kinds).filter((w) => mine.has(w));
  };
  const shared = inCommon(LIKED).slice(0, 5);
  const work = inCommon(WORK).slice(0, 2);
  const theirs = tagWords(other.tags, TAGGABLE);

  // THE EXCHANGE, checked again here -- the words of both people pass the same
  // core-value test as a quote, whatever built the lines -- and a sentence already in it
  // is not quoted a second time below.
  const lines = qa
    .map((l) => ({ ...l, theirs: l.theirs && mayRepeat(l.theirs) ? l.theirs : null,
                   mine: l.mine && mayRepeat(l.mine) ? l.mine : null }))
    .filter((l) => l.theirs !== null || l.mine !== null);
  const talk = cleanTalk(talkIn);
  // THE WANTS, checked again here: their sentence must be one that may be repeated at
  // all, or the row says nothing about them -- the want stays, as unknown.
  const wants = wantsIn.map((w): WantRow => (w.private ? { ...w, theirs: null }
    : w.theirs === null || mayRepeat(w.theirs) ? w
    : { want: w.want, kind: w.kind, theirs: null, status: 'unknown' }));
  const said = new Set([
    ...wants.map((w) => w.theirs),
    ...lines.map((l) => l.theirs),
    ...(talk?.lines.filter((l) => l.who === 'them' && l.kind === 'say').map((l) => l.text) ?? []),
    ...(talk?.shared.map((s) => s.theirs) ?? []),
    talk?.date?.theirs,
  ].filter((t): t is string => Boolean(t)).map((t) => t.toLowerCase()));

  // QUOTABLE and the words again, although loadQuotes already filtered: this function
  // is the last thing between a Quote[] and a card, and a caller that builds one by
  // hand must not be able to route a core value round the loader.
  const seen = new Set<string>(said);
  const quotes = other.quotes
    .filter((q) => QUOTABLE.has(q.predicate) && mayRepeat(q.text))
    .filter((q) => { const k = q.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 2)
    .map((q) => ({ text: q.text, when: q.when }));

  // "I DON'T KNOW" FIRST. Something their agent could not answer is exactly what to
  // ask in person -- the reason the agents say it at all. From the talk when there was
  // one (the question just before their "I don't know"), else from the answer sheets.
  const talkUnknown = talk?.lines.find((l, i, all) =>
    l.who === 'them' && l.kind === 'dunno' && all[i - 1]?.kind === 'ask' && all[i - 1]?.q);
  const talkAsk = talkUnknown ? talk!.lines[talk!.lines.indexOf(talkUnknown) - 1]!.q! : null;
  const unknown = lines.find((l) => l.theirs === null && l.mine !== null);
  const opener =
    talkAsk ? `Ask them about ${talkAsk.toLowerCase()}`
    : unknown ? `Ask them about ${unknown.q.toLowerCase()}`
    : shared[0] ? `Ask them about: ${shared[0]}`
    : quotes[0] ? `Ask them about: "${quotes[0].text}"`
    : work[0] ? `Ask them about: ${work[0]}`
    : theirs[0] ? `Ask them about: ${theirs[0]}`
    : null;

  return { headline: headlineOf(other.card), line: BRIEF_LINE, shared, work, quotes, opener, qa: lines, talk, wants };
}

export interface BriefPair {
  forA: BriefContent;
  forB: BriefContent;
}

/** Both briefs. Code only, so it needs no meter and holds nothing open. */
export function composeBoth(
  a: BriefSide, b: BriefSide,
  /** Each reader's exchange, from the two answer sheets. None: no exchange on the card. */
  qa: { forA: readonly QaLine[]; forB: readonly QaLine[] } = { forA: [], forB: [] },
  /** Each reader's view of the agents' talk (talk.ts talkFor). None: no talk on the card. */
  talk: { forA: TalkView | null; forB: TalkView | null } = { forA: null, forB: null },
  /** Each reader's wants against the other's sentences (wants.ts). None: no wants on the card. */
  wants: { forA: readonly WantRow[]; forB: readonly WantRow[] } = { forA: [], forB: [] },
): BriefPair {
  return {
    forA: composeBrief(a, b, qa.forA, talk.forA, wants.forA),
    forB: composeBrief(b, a, qa.forB, talk.forB, wants.forB),
  };
}

/**
 * HOW A CODE-WRITTEN BRIEF IS STORED, with no migration. `rendezvous_briefs` has the
 * columns the model-written brief needed: headline, overlap_quotes (jsonb), concern
 * (text NOT NULL), questions (jsonb). The facts line goes in `headline`; the opener
 * is the one entry in `questions`; `concern` is always ''; and `overlap_quotes` holds
 * a versioned object rather than the old array of quote pairs -- which is how a
 * reader tells this brief from a model's (see readBrief).
 */
const Stored = z.object({
  v: z.literal(2),
  shared: z.array(z.string()),
  // Added the same day as v2 itself, before any v2 row existed outside the tests;
  // defaulted anyway, so a row without it reads as "no field in common".
  work: z.array(z.string()).default([]),
  quotes: z.array(z.object({ text: z.string(), when: z.string() })),
  // What the agents asked each other (0061). Defaulted, so every brief written before
  // the answer sheets reads as "no exchange" rather than failing to parse.
  // `ask` is optional only for a row written the morning the sheets landed, before the
  // town showed the questions; such a line reads its label as the question.
  qa: z.array(z.object({
    q: z.string(), ask: z.string().optional(), theirs: z.string().nullable(), mine: z.string().nullable(),
    practice: z.boolean().optional(),
  })).default([]),
  // The agents' talk (talk.ts), as this reader sees it. Null on every brief written
  // before the talk existed, and on a pair whose agents did not talk.
  talk: z.object({
    lines: z.array(z.object({
      who: z.enum(['you', 'them']), kind: z.enum(['ask', 'say', 'dunno', 'react']), text: z.string(),
      q: z.string().optional(), practice: z.boolean().optional(),
    })),
    shared: z.array(z.object({ mine: z.string(), theirs: z.string(), practice: z.boolean().optional() })),
    date: z.object({
      idea: z.string(), mine: z.string(), theirs: z.string(), practice: z.boolean().optional(),
    }).nullable(),
  }).nullable().default(null),
  // The reader's wants and the other's sentences beside them (wants.ts). The status is
  // stored for measurement; readBrief never passes it on.
  wants: z.array(z.object({
    want: z.string(), kind: z.enum(['wants', 'not']), theirs: z.string().nullable(),
    status: z.enum(['met', 'not_met', 'unknown', 'cant_check']),
    private: z.boolean().optional(), practice: z.boolean().optional(),
  })).default([]),
});

/**
 * Write them, and decide who sees the other first.
 *
 * THE ASYMMETRY IS THE POINT. Whichever side has the larger inbox decides ALONE and
 * FIRST; only then is their profile shown to the other. Dating apps run heavily
 * one-sided, and without this the flooded side is flooded again here. Both people
 * still have to say yes, so it orders the decision without deciding anything.
 */
export async function saveBriefs(
  c: PoolClient,
  rendezvousId: string,
  a: { userId: string },
  b: { userId: string },
  briefs: BriefPair,
): Promise<number> {
  let written = 0;
  for (const [side, made] of [[a, briefs.forA], [b, briefs.forB]] as const) {
    // A ROW FOR EVERY PAIR. The row is what makes the card exist; a pair with no
    // shared tag and no quotable sentence still met, and still gets its facts line.
    const stored: z.infer<typeof Stored> = {
      v: 2, shared: made.shared, work: made.work, quotes: made.quotes, qa: made.qa, talk: made.talk,
      wants: made.wants,
    };
    await c.query(
      `INSERT INTO rendezvous_briefs
         (rendezvous_id, for_user, headline, overlap_quotes, concern, questions)
       VALUES ($1,$2,$3,$4,'',$5)
       ON CONFLICT (rendezvous_id, for_user) DO NOTHING`,
      [rendezvousId, side.userId, made.headline, JSON.stringify(stored),
       JSON.stringify(made.opener ? [made.opener] : [])],
    );
    written++;
  }

  const first = await firstMoverOf(c, a.userId, b.userId);
  await c.query('UPDATE rendezvous SET first_mover = $2 WHERE id = $1', [rendezvousId, first]);

  log.info({ rendezvousId, written, firstMover: first }, 'briefs written');
  return written;
}

/** A card, as the app receives it. */
export interface BriefCard {
  headline: string;
  line: string;
  shared: string[];
  work: string[];
  quotes: { text: string; when: string }[];
  opener: string | null;
  qa: QaLine[];
  talk: TalkView | null;
  /**
   * The reader's wants beside the other's sentences -- WITHOUT the status. `check` is set
   * only for a want checked by code: 'private' for a private topic whatever it found,
   * matches or not for one tied to a question, or one nothing could check (wantCheck).
   */
  wants: {
    want: string; kind: 'wants' | 'not'; theirs: string | null;
    check?: 'matches' | 'doesnt_match' | 'cant_check' | 'private'; practice?: boolean;
  }[];
}

/**
 * The card that says nothing about the person: the plain headline and the line. What
 * a model-written brief reads as (readBrief), and what the second mover sees until the
 * first mover has said yes (api/dating.ts).
 */
export const plainCard = (): BriefCard =>
  ({ headline: PLAIN_HEADLINE, line: BRIEF_LINE, shared: [], work: [], quotes: [], opener: null, qa: [], talk: null, wants: [] });

/**
 * A stored brief, as a card.
 *
 * A BRIEF A MODEL WROTE IS NOT SHOWN AGAIN. Rows written before 2026-09-23 carry a
 * model's headline, its picked quotes (some of them interview strings like
 * "Children? have_and_done"), its questions and the assessor's concern. They are
 * kept -- nothing here deletes data -- but read as the plain card: the same line,
 * the plain headline, no quotes, no opener. The versioned object in overlap_quotes is
 * the only thing that marks a code-written brief, so anything else is treated as old.
 */
export function readBrief(row: { headline: string; overlap_quotes: unknown; questions: unknown }): BriefCard {
  const parsed = Stored.safeParse(row.overlap_quotes);
  if (!parsed.success) return plainCard();
  const q = Array.isArray(row.questions) ? row.questions : [];
  const opener = typeof q[0] === 'string' && q[0] ? q[0] : null;
  return {
    headline: row.headline,
    line: BRIEF_LINE,
    shared: parsed.data.shared,
    work: parsed.data.work,
    quotes: parsed.data.quotes,
    opener,
    qa: parsed.data.qa.map((l) => ({
      q: l.q, ask: l.ask ?? l.q, theirs: l.theirs, mine: l.mine, ...(l.practice ? { practice: true } : {}),
    })),
    talk: readTalk(parsed.data.talk),
    // NO STATUS. The want and the quote, side by side; the reader judges. A want tied to
    // a question says matches or not, a private topic only that it is private -- and
    // neither ever has a quote beside it.
    wants: parsed.data.wants.map((w) => {
      const check = wantCheck({ want: w.want, status: w.status, ...(w.private ? { private: true } : {}) });
      return {
        want: w.want, kind: w.kind, theirs: w.private || check === 'private' ? null : w.theirs,
        ...(check ? { check } : {}), ...(w.practice ? { practice: true } : {}),
      };
    }),
  };
}

/** How a stored sentence is matched to a live one: case and runs of spaces aside. */
export const sentenceKey = (t: string): string => t.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A STORED CARD, CHECKED AGAIN AS IT IS SHOWN.
 *
 * WHAT WAS WRONG (found 2026-09-25, checking a review of the wants). A card is written
 * once, when the agents meet, and keeps the other person's sentences as text. So a
 * sentence they hid on "How you appear" afterwards -- or took back, or replaced -- went
 * on showing on every card already written: in the quotes, as "They said", in the
 * agents' talk, in the answers, in the opener. Hiding promised "never on anybody's
 * card" and kept it only for cards not yet made.
 *
 * NOW every sentence of theirs on a card must still be theirs to show -- among their
 * public, active, current sentences (`live`) -- AND pass the rules a new card would
 * (mayRepeat), each time the card is read. What fails is taken off: a quote dropped,
 * an answer or a "They said" left empty, a talk line and anything hanging off it
 * removed, a date idea built on it withdrawn, an opener that quotes it dropped. `live`
 * is null for a practice profile, which has no sentences to hide; the content rules
 * still apply.
 */
export function liveCard(card: BriefCard, live: ReadonlySet<string> | null): BriefCard {
  const ok = (t: string) => mayRepeat(t) && (live === null || live.has(sentenceKey(t)));
  const gone: string[] = [];
  const keep = (t: string) => { if (ok(t)) return true; gone.push(t); return false; };

  const quotes = card.quotes.filter((q) => keep(q.text));
  const qa = card.qa
    .map((l) => (l.theirs !== null && !keep(l.theirs) ? { ...l, theirs: null } : l))
    .filter((l) => l.theirs !== null || l.mine !== null);
  const wants = card.wants.map((w) => (w.theirs !== null && !keep(w.theirs) ? { ...w, theirs: null } : w));

  let talk = card.talk;
  if (talk) {
    const lines = talk.lines.filter((l) => !(l.who === 'them' && l.kind === 'say') || keep(l.text));
    const shared = talk.shared.filter((x) => keep(x.theirs));
    const date = talk.date && keep(talk.date.theirs) ? talk.date : null;
    talk = cleanTalk({ lines, shared, date });
  }
  const opener = card.opener && gone.some((t) => card.opener!.includes(t)) ? null : card.opener;
  return { ...card, quotes, qa, wants, talk, opener };
}

/** A stored talk, with its optional flags written only when set. */
function readTalk(t: z.infer<typeof Stored>['talk']): TalkView | null {
  if (!t) return null;
  const flag = (p: boolean | undefined) => (p ? { practice: true as const } : {});
  return {
    lines: t.lines.map((l) => ({ who: l.who, kind: l.kind, text: l.text, ...(l.q ? { q: l.q } : {}), ...flag(l.practice) })),
    shared: t.shared.map((x) => ({ mine: x.mine, theirs: x.theirs, ...flag(x.practice) })),
    date: t.date ? { idea: t.date.idea, mine: t.date.mine, theirs: t.date.theirs, ...flag(t.date.practice) } : null,
  };
}

/**
 * Who decides first.
 *
 * A PRACTICE PROFILE NEVER DOES (the founder, 2026-09-28). It never answers, and the
 * busier side -- the rule below -- can be the practice profile, whose open cards are
 * other people's practice: the real person then waited three days on "They decide first"
 * and watched the card fade. Measured that day: 1 open card had a real person waiting
 * behind a practice profile (migration 0074 moved it); 37 more were between two practice
 * profiles, with nobody waiting. Between a real person and a practice profile, the real
 * person decides first; between two real people, the busier side, as before.
 */
export async function firstMoverOf(c: PoolClient, a: string, b: string): Promise<string> {
  const { rows } = await c.query<{ user_id: string }>(
    'SELECT user_id FROM match_profile WHERE user_id = ANY($1::uuid[]) AND is_synthetic', [[a, b]]);
  const practice = new Set(rows.map((r) => r.user_id));
  if (practice.has(a) !== practice.has(b)) return practice.has(a) ? b : a;
  return busierSide(c, a, b);
}

/**
 * Who has more matches waiting. Ties break on the id, so the answer is stable and does
 * not depend on which row the query happened to read first.
 */
async function busierSide(c: PoolClient, a: string, b: string): Promise<string> {
  const { rows } = await c.query<{ user_id: string; n: number }>(
    `SELECT u.user_id, count(r.id)::int AS n
       FROM (VALUES ($1::uuid), ($2::uuid)) AS u(user_id)
       LEFT JOIN rendezvous r
         ON (r.user_a = u.user_id OR r.user_b = u.user_id)
        AND r.status IN ('decided', 'shown_a', 'shown_b')
      GROUP BY u.user_id`,
    [a, b],
  );
  const byUser = new Map(rows.map((r) => [r.user_id, r.n]));
  const na = byUser.get(a) ?? 0;
  const nb = byUser.get(b) ?? 0;
  if (na !== nb) return na > nb ? a : b;
  return a < b ? a : b;
}
