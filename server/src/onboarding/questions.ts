/**
 * The question bank.
 *
 * A structured interview, asked one question at a time. This is the spine of
 * onboarding, not a supplement to it: the strongest published method for making an
 * agent answer like a specific person is a long structured interview, and the variance
 * that actually predicts a person lives in how they answer particular questions rather
 * than in a stable profile.
 *
 * FOUR TIERS, ASKED IN THIS ORDER:
 *   basics    gender, who you want to meet, what you are here for. Cannot be skipped:
 *             the candidate query cannot run without them.
 *   core      five cards -- kids, one person or open, smoking, drinking, food. Each
 *             has a "You" row (declinable) and a "Who's fine" row (never pre-ticked,
 *             always one explicit tap). Every one must be DONE before the agent goes
 *             out, because both people always answered the same five, so the check
 *             between them is exact code rather than a guess.
 *   free      one sentence: who could you not be with.
 *   optional  everything else. Never filters until the person unticks something.
 *
 * WHAT A CARD WRITES. The You answer is a fact, as every chip answer always was. The
 * Who's-fine answer is either "anyone", which writes NO rule and is recorded as a
 * choice, or a narrowed list, which becomes one hard rule `in [accepted]`. Nothing in
 * between: a soft rule at today's scale only reorders practice profiles, and a person
 * who unticked smokers and then meets one reads it as the agent ignoring them.
 *
 * WHAT THIS REPLACED. Four "same as me" questions -- "Could you be with a smoker?",
 * "Does it matter what they want?" and two like them -- whose answer was a STRENGTH,
 * with the value copied from the person's own fact. So a daily smoker who said "No"
 * to "Could you be with a smoker?" got `smoking in ["daily"]`: a rule only daily
 * smokers pass, the exact opposite of what they said. The cards ask the question
 * that was meant -- which of these could you be with -- and store the answer.
 *
 * NO MODEL CALLS ANYWHERE IN THIS FILE. Options are fixed, answers map straight onto
 * predicates, and which question comes next is fixed code up to the optional tier.
 */
import { DIETS, FAITHS, FREQUENCY, IMPORTANCE, MONOGAMY, SITUATION_PREDICATES, WANTS_CHILDREN } from '@clone/shared';

/**
 * `free` is a sentence rather than a choice. It exists for one question -- see
 * `q-dealbreaker`.
 */
export type QuestionKind = 'fact' | 'preference' | 'free';

/** Where a question sits in the interview. See the header for what each one means. */
export type Tier = 'basics' | 'core' | 'optional' | 'free' | 'situation';

export interface Option {
  value: string;
  label: string;
}

/**
 * The second row of a core card: which of these could you be with.
 *
 * The options are the SAME VALUES as the card's own, because the rule it writes is
 * tested against the other person's answer to that same card. A list with different
 * values would be a rule nobody's profile can satisfy.
 */
export interface WhoFine {
  text: string;
  options: Option[];
}

export interface Question {
  id: string;
  /** What it writes to. A fact predicate, or the predicate a preference is about. */
  predicate: string;
  kind: QuestionKind;
  tier: Tier;
  /**
   * Whether "Prefer not to say" is offered. False only for the basics. On a core card
   * it applies to the You row alone: the Who's-fine choice is still required.
   */
  declinable: boolean;
  text: string;
  /** Shown under the question. Why it is being asked, when that is not obvious. */
  why?: string;
  options: Option[];
  multi?: boolean;
  /** Core cards only. */
  whoFine?: WhoFine;
  /**
   * A card that may be skipped whole (card-faith): asked right after the five, never a
   * condition of going out, and skipping it writes no fact and no rule.
   */
  optional?: boolean;
  /**
   * Core cards only: the card's short name, which titles its screen ("Smoking"), so the
   * question itself can sit inside the You box it belongs to. A title that asked "Do you
   * smoke?" above two boxes left people unsure which box was them (the founder,
   * 2026-09-24).
   */
  topic?: string;
  /**
   * Only ask this once another question has been answered. Keeps "would that bother
   * you?" from arriving before "do you?".
   */
  after?: string;
}

const opts = (vals: readonly string[]): Option[] =>
  vals.map((v) => ({ value: v, label: v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) }));

/**
 * One core card. The same options serve both rows, and the labels are written to read
 * right in either -- "Every day" is what you do and what you could live with.
 *
 * `partner` is the second row's question, and it names the partner: "Who would you be
 * fine with?" under a box headed "Who's fine" did not say whose answers those were.
 */
const card = (
  id: string, predicate: string, topic: string, text: string, partner: string,
  values: readonly string[], labels: Record<string, string>,
): Question => {
  const options = values.map((v) => ({ value: v, label: labels[v] ?? v }));
  return {
    id, predicate, kind: 'fact', tier: 'core', declinable: true, topic, text, options,
    whoFine: { text: partner, options },
  };
};

/**
 * One situation question: one tap from a short list, skippable, a fact about what the
 * person does. Returned as a one-element array so the bank reads as a list.
 */
const situation = (
  id: string, predicate: string, topic: string, text: string, labels: Record<string, string>,
): Question[] => [{
  id, predicate, kind: 'fact', tier: 'situation', declinable: true, topic, text,
  options: Object.entries(labels).map(([value, label]) => ({ value, label })),
}];

const FREQUENCY_LABELS: Record<string, string> = {
  never: 'Never', rarely: 'Rarely', sometimes: 'Sometimes', often: 'Often', daily: 'Every day',
};

export const QUESTIONS: readonly Question[] = [
  // ── basics: the three the candidate query cannot run without ─────────────
  {
    id: 'q-gender', predicate: 'gender', kind: 'fact', tier: 'basics', declinable: false,
    text: 'You are…',
    options: [
      { value: 'woman', label: 'A woman' }, { value: 'man', label: 'A man' },
      { value: 'nonbinary', label: 'Nonbinary' }, { value: 'other', label: 'Something else' },
    ],
  },
  {
    id: 'q-seeking', predicate: 'seeking_gender', kind: 'fact', tier: 'basics', declinable: false,
    multi: true,
    text: 'You want to meet…',
    options: [
      { value: 'woman', label: 'Women' }, { value: 'man', label: 'Men' },
      { value: 'nonbinary', label: 'Nonbinary people' },
    ],
  },
  {
    id: 'q-intent', predicate: 'relationship_intent', kind: 'fact', tier: 'basics', declinable: false,
    text: 'What are you here for?',
    options: [
      { value: 'long_term', label: 'Something long-term' },
      { value: 'marriage', label: 'Marriage' },
      { value: 'companionship', label: 'Company' },
      { value: 'casual', label: 'Something casual' },
      { value: 'undecided', label: 'Still working it out' },
    ],
  },

  // ── core: five cards, asked in this order, every one required ────────────
  //
  // Existing enums only (values.ts), so a card answer lands on exactly the value
  // somebody else's rule is tested against. Why these five: they are dealbreakers a
  // person can check on paper, and couples sort on them. Faith is not here until the
  // founder makes the legal call.
  card('card-kids', 'wants_children', 'Kids', 'Do you want children?', 'Which are okay for your partner?', WANTS_CHILDREN, {
    yes: 'Want kids', no: "Don't want kids", maybe: 'Not sure yet',
    have_and_want_more: 'Have kids, want more', have_and_done: 'Have kids, done',
  }),
  card('card-monogamy', 'monogamy_stance', 'One person or open', 'One person, or open?', 'Which are okay for your partner?', MONOGAMY, {
    monogamous: 'One person', non_monogamous: 'Open', open_to_either: 'Either could work',
  }),
  card('card-smoking', 'smoking', 'Smoking', 'Do you smoke?', 'How much can your partner smoke?', FREQUENCY, FREQUENCY_LABELS),
  card('card-drinking', 'drinking', 'Drinking', 'Do you drink?', 'How much can your partner drink?', FREQUENCY, FREQUENCY_LABELS),
  card('card-food', 'diet', 'Food', 'How do you eat?', 'How can your partner eat?', DIETS, {
    omnivore: 'Everything', no_beef: 'No beef', no_pork: 'No pork',
    pescatarian: 'Fish, no meat', vegetarian: 'Vegetarian', vegan: 'Vegan',
  }),

  // ── an optional card: faith (the founder, 2026-09-25) ─────────────────────
  //
  // Optional, and check-only: the answer is NEVER shown to anybody or quoted
  // (`religion` is NEVER_PUBLIC, and every sentence naming a faith is held back by
  // namesCoreValue); it is only used to test a rule both ways, exactly as the other
  // cards are. No caste, no sect, no community -- see FAITHS.
  {
    ...card('card-faith', 'religion', 'Faith', 'What is your faith?', 'Which are okay for your partner?', FAITHS, {
      hindu: 'Hindu', muslim: 'Muslim', christian: 'Christian', sikh: 'Sikh', jain: 'Jain',
      buddhist: 'Buddhist', jewish: 'Jewish', zoroastrian: 'Zoroastrian',
      spiritual: 'Spiritual, not religious', not_religious: 'Not religious', other: 'Something else',
    }),
    optional: true,
    why: 'Optional. Nobody ever sees your answer. It is only used to check who fits, both ways.',
  },

  // ── free: the one sentence, straight after the core ──────────────────────
  //
  // In their own words, on purpose. Every other question here is a chip: fast, and it
  // returns something joinable -- and it returns the same answer everybody else picked.
  // This one returns a sentence.
  //
  // Asked AFTER the core because it is the only question that asks for effort. By this
  // point the person has answered eight things; that is the moment to ask for a real
  // thought, not the first screen.
  //
  // And people are specific about what they cannot stand and vague about what they
  // want: "what are you looking for" returns "someone kind and funny", true of
  // everybody and excluding nobody.
  {
    id: 'q-dealbreaker', predicate: 'dealbreaker', kind: 'free', tier: 'free', declinable: true,
    text: 'Anyone else you couldn\'t be with?',
    why: 'Be blunt. If it matches one of your cards, you\'ll see the change and decide. If not, you\'ll spot it in the first chat.',
    options: [],
  },

  // ── optional: asked later, and never a filter ────────────────────────────
  //
  // The ORDER HERE IS ONLY A FALLBACK -- `nextQuestion` picks among these by what
  // actually divides this person's remaining candidates. None of them writes a hard
  // rule. Education and work are never ranked as a ladder.
  {
    id: 'q-exercise', predicate: 'exercise_habit', kind: 'fact', tier: 'optional', declinable: true,
    text: 'How often do you move your body?',
    options: opts(FREQUENCY),
  },
  {
    id: 'q-religion', predicate: 'religion_importance', kind: 'fact', tier: 'optional', declinable: true,
    text: 'How much does religion matter to you?',
    why: 'Not which one. Just how much it shapes your week.',
    options: opts(IMPORTANCE),
  },
  {
    id: 'q-politics', predicate: 'politics_importance', kind: 'fact', tier: 'optional', declinable: true,
    text: 'How much does politics matter to you?',
    options: opts(IMPORTANCE),
  },
  {
    id: 'q-education', predicate: 'education_level', kind: 'fact', tier: 'optional', declinable: true,
    text: 'How far did you get with school?',
    options: [
      { value: 'school', label: 'School' },
      { value: 'some_college', label: 'Some college' },
      { value: 'bachelors', label: "Bachelor's" },
      { value: 'masters', label: "Master's" },
      { value: 'doctorate', label: 'Doctorate' },
    ],
  },
  {
    id: 'q-works-in', predicate: 'works_in', kind: 'fact', tier: 'optional', declinable: true, multi: true,
    text: 'What field are you in?',
    options: opts([
      'software', 'ai', 'hardware', 'design', 'medicine', 'teaching', 'finance',
      'law', 'media', 'research', 'sales', 'hospitality', 'logistics', 'art',
    ]),
  },
  {
    // The one preference question left, and it names its own values: the answer IS
    // the list, so there is no fact to copy and nothing to invert. A `strong` want,
    // which reorders and never excludes.
    id: 'q-works-pref', predicate: 'works_in', kind: 'preference', tier: 'optional', declinable: true,
    after: 'q-works-in', multi: true,
    text: 'Any field you would especially like them to be in?',
    why: 'This only moves people up the list. It never rules anybody out.',
    options: opts([
      'software', 'ai', 'hardware', 'design', 'medicine', 'teaching', 'finance',
      'law', 'media', 'research', 'art', 'anything',
    ]),
  },
  {
    id: 'q-sleep', predicate: 'sleep_pattern', kind: 'fact', tier: 'optional', declinable: true,
    text: 'Early or late?',
    options: [
      { value: 'early', label: 'Up early' },
      { value: 'normal', label: 'Neither really' },
      { value: 'night-owl', label: 'Up late' },
    ],
  },
  {
    id: 'q-spending', predicate: 'spending_style', kind: 'fact', tier: 'optional', declinable: true,
    text: 'Money — how do you think about it?',
    options: [
      { value: 'value-driven', label: 'It has to be worth it' },
      { value: 'comfortable', label: 'I spend without much thought' },
      { value: 'saver', label: 'I save hard' },
      { value: 'brand-conscious', label: 'I like nice things' },
    ],
  },
  {
    id: 'q-media', predicate: 'media_taste', kind: 'fact', tier: 'optional', declinable: true, multi: true,
    text: 'What do you actually watch?',
    options: opts([
      'foreign-film', 'bollywood', 'regional-cinema', 'prestige-tv', 'anime',
      'documentaries', 'reality-tv', 'comics',
    ]),
  },
  {
    id: 'q-transport', predicate: 'transport', kind: 'fact', tier: 'optional', declinable: true, multi: true,
    text: 'How do you get around?',
    options: opts(['car', 'metro', 'motorbike', 'cycle', 'electric-cycle', 'walking', 'auto']),
  },
  {
    id: 'q-relocation', predicate: 'relocation_openness', kind: 'fact', tier: 'optional', declinable: true,
    text: 'Would you move cities for the right person?',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'maybe', label: 'Maybe' },
      { value: 'no', label: 'No' },
    ],
  },

  // ── situations: what you DO, never what you are (the founder, 2026-09-26) ───
  //
  // Nobody answers "are you impulsive with money?" honestly, and many do not know. So
  // these never ask for the label; they ask what happens. They exist for other people's
  // WANTS (matching/want-questions.ts): "a saver, not an impulse spender" is checked
  // against the answer to the ₹50,000 question, by code, never quoted. Onboarding never
  // asks them (next-question.ts): a person meets one as their question of the day, when
  // somebody's want needs it, and never learns who. Skippable, one tap, tap-only facts
  // (facts.ts SITUATION_PREDICATES).
  ...situation('sit-windfall', 'money_windfall', 'Money', 'You get an unexpected ₹50,000. What happens to most of it?', {
    'save-invest': 'Saved or invested', 'pay-off': 'Pays off something I owe', 'some-each': 'Some saved, some spent',
    treat: 'A treat: a trip, a gadget, a night out', family: 'Goes to family',
  }),
  ...situation('sit-unplanned-buy', 'unplanned_buy', 'Money', "The last time you bought something big you hadn't planned: when was it?", {
    'this-month': 'This month', 'this-year': 'Earlier this year', longer: 'More than a year ago', never: "I don't do that",
  }),
  ...situation('sit-street-food', 'street_food', 'Food', 'A friend takes you to a tiny street stall. Amazing food, not very clean. You…', {
    'dig-in': '😋 Dig in', 'try-a-bit': '🤔 Try a bit', pass: '🙅 Pass',
  }),
  ...situation('sit-pet-sitting', 'pet_sitting', 'Pets', 'A friend asks you to look after their dog for a week. You…', {
    gladly: 'Say yes, gladly', 'if-needed': 'Say yes if nobody else can', no: 'Say no, not for me',
  }),
  ...situation('sit-weeknight-dinner', 'weeknight_dinner', 'Cooking', "It's a weeknight, you're hungry and nothing is planned. Most often you…", {
    cook: 'Cook something', 'order-in': 'Order in', 'eat-out': 'Head out to eat', snack: 'Grab a snack and skip it',
  }),
  ...situation('sit-last-book', 'last_book', 'Books', 'The last book you finished: when was it?', {
    'this-month': 'This month', 'this-year': 'Earlier this year', longer: 'Longer ago than that', 'dont-read': "I don't really read books",
  }),
  ...situation('sit-long-weekend', 'long_weekend', 'Weekends', 'A long weekend and no plans. You…', {
    trip: 'Book a trip somewhere', city: 'See friends around the city', home: 'Stay in and rest', work: 'Catch up on work',
  }),
  ...situation('sit-last-minute', 'last_minute_plan', 'Plans', 'A friend calls at 7pm: plans tonight? You…', {
    in: "I'm in", depends: 'Depends on the plan', 'stay-in': "I'd rather stay in",
  }),
];

export const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));

/** Questions whose answers gate entry to the pool. Asked before anything optional. */
export const GATING = ['q-gender', 'q-seeking', 'q-intent'];

/**
 * The five core cards, in the order they are asked. Asked straight after GATING, in
 * this order, whatever the pool looks like -- see next-question.ts for why no
 * picking happens here.
 *
 * A card is DONE when a question_answers row exists for its id: answered, or "Prefer
 * not to say" on the You row. Every one must be done before the agent goes out
 * (matching/profile.ts), and the pool's `missing` list names the PREDICATE of each
 * card still to do.
 */
export const CORE = ['card-kids', 'card-monogamy', 'card-smoking', 'card-drinking', 'card-food'] as const;

/** Each core card's id with the predicate it writes, in card order. */
export const CORE_CARDS: readonly { id: string; predicate: string }[] =
  CORE.map((id) => ({ id, predicate: BY_ID.get(id)!.predicate }));

/** The five predicates a card writes, and the only ones a written dealbreaker may map to. */
export const CORE_PREDICATES: readonly string[] = CORE_CARDS.map((c) => c.predicate);

/** Cards that may be skipped whole, asked in this order straight after the five. */
export const OPTIONAL_CARDS = ['card-faith'] as const;

/** Every card, required first, with the predicate it writes: what a readback reads. */
export const ALL_CARDS: readonly { id: string; predicate: string }[] = [
  ...CORE_CARDS, ...OPTIONAL_CARDS.map((id) => ({ id, predicate: BY_ID.get(id)!.predicate })),
];

/**
 * The fields a person sets by TAPPING -- the basics and the five cards -- which a
 * sentence may propose a change to but never make.
 *
 * WHY. Chat, "tell" and a pasted export all run the same extractor, and it used to mark
 * every fact it found as the person's own word (extract.ts, originClass 'owner'). A
 * single-valued fact from a sentence then superseded whatever the person had tapped: a
 * card that said "drinks sometimes", followed by "I drink socially" said in passing to
 * their clone, silently became whatever the extractor made of "socially" -- and every
 * other person's drinking rule was now tested against that. These are exactly the
 * fields other people's rules are tested against, so on these a sentence is STAGED: it
 * waits, one at a time, for a Yes (memory/pasteImport.ts pendingConfirmation), and until
 * then the tapped answer stands.
 */
export const TAPPED_PREDICATES: ReadonlySet<string> = new Set([
  'gender', 'seeking_gender', 'birth_date', 'lives_in', 'relationship_intent',
  'age_range_sought', 'max_distance_km', 'area',
  ...CORE_PREDICATES,
  // The faith card too: a sentence in chat must never quietly change a card.
  ...OPTIONAL_CARDS.map((id) => BY_ID.get(id)!.predicate),
  // And every situation answer: somebody's want is checked against it.
  ...SITUATION_PREDICATES.map((p) => p.name),
]);

/**
 * WHETHER A RULE ON THIS FIELD MAY BE A MUST-HAVE (the founder, 2026-09-26: "only on
 * tapped answers"). A must-have hides people, so it may only test an answer the person
 * TAPPED: the basics, the cards and the situations, which a sentence can never set
 * (above). Not the field you work in, exercise, sleep or moving cities -- those are also
 * filled from what people say in chat, read by the extractor, and a wrong reading there
 * would hide somebody for good with nobody knowing. Those rules move people up or down.
 */
export function mustHaveAllowed(predicate: string): boolean {
  return TAPPED_PREDICATES.has(predicate);
}

/** The situation questions, in bank order. */
export const SITUATIONS: readonly Question[] = QUESTIONS.filter((q) => q.tier === 'situation');
