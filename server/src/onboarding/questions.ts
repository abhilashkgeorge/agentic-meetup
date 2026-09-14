/**
 * The question bank.
 *
 * A structured interview, asked one question at a time. This is the spine of
 * onboarding, not a supplement to it: the strongest published method for making an
 * agent answer like a specific person is a long structured interview, and the variance
 * that actually predicts a person lives in how they answer particular questions rather
 * than in a stable profile.
 *
 * EVERY QUESTION DOES ONE OF TWO JOBS:
 *   fact        something true of you        "Do you eat meat?"
 *   preference  something you want in them   "Would it bother you if they didn't?"
 *
 * The second kind is how a dealbreaker gets set without anybody filling in a form. A
 * person answering "yes, that would bother me" has just written a filter.
 *
 * NO MODEL CALLS ANYWHERE IN THIS FILE. Options are fixed, answers map straight onto
 * predicates, and which question comes next is decided by a SQL count. Asking somebody
 * forty questions should cost nothing.
 */
import { DIETS, FREQUENCY, IMPORTANCE, RELATIONSHIP_INTENTS, WANTS_CHILDREN } from '@clone/shared';

/**
 * `free` is a sentence rather than a choice. It exists for one question -- see the end
 * of the list.
 */
export type QuestionKind = 'fact' | 'preference' | 'free';

export interface Option {
  value: string;
  label: string;
}

export interface Question {
  id: string;
  /** What it writes to. A fact predicate, or the predicate a preference is about. */
  predicate: string;
  kind: QuestionKind;
  text: string;
  /** Shown under the question. Why it is being asked, when that is not obvious. */
  why?: string;
  options: Option[];
  multi?: boolean;
  /**
   * For a preference: how the answer becomes a rule. `dealbreakerIf` names the option
   * that turns it into a hard filter; anything else becomes a `strong` want.
   */
  dealbreakerIf?: string;
  /**
   * Only ask this once another question has been answered. Keeps "would that bother
   * you?" from arriving before "do you?".
   */
  after?: string;
}

const opts = (vals: readonly string[]): Option[] =>
  vals.map((v) => ({ value: v, label: v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) }));

/**
 * Ordered roughly by how much each one narrows a pool, but the ORDER HERE IS ONLY A
 * FALLBACK — `nextQuestion` re-sorts by what actually divides this person's remaining
 * candidates. A question that splits nobody is a question not worth a screen.
 */
export const QUESTIONS: readonly Question[] = [
  // ── the five that gate the pool ──────────────────────────────────────────
  {
    id: 'q-gender', predicate: 'gender', kind: 'fact',
    text: 'You are…',
    options: [
      { value: 'woman', label: 'A woman' }, { value: 'man', label: 'A man' },
      { value: 'nonbinary', label: 'Nonbinary' }, { value: 'other', label: 'Something else' },
    ],
  },
  {
    id: 'q-seeking', predicate: 'seeking_gender', kind: 'fact', multi: true,
    text: 'You want to meet…',
    options: [
      { value: 'woman', label: 'Women' }, { value: 'man', label: 'Men' },
      { value: 'nonbinary', label: 'Nonbinary people' },
    ],
  },
  {
    id: 'q-intent', predicate: 'relationship_intent', kind: 'fact',
    text: 'What are you here for?',
    options: [
      { value: 'long_term', label: 'Something long-term' },
      { value: 'marriage', label: 'Marriage' },
      { value: 'companionship', label: 'Company' },
      { value: 'casual', label: 'Something casual' },
      { value: 'undecided', label: 'Still working it out' },
    ],
  },

  // ── facts that split a pool hard ─────────────────────────────────────────
  {
    id: 'q-diet', predicate: 'diet', kind: 'fact',
    text: 'How do you eat?',
    options: opts(DIETS),
  },
  {
    id: 'q-diet-pref', predicate: 'diet', kind: 'preference', after: 'q-diet',
    text: 'Would it be a problem if they ate differently from you?',
    why: 'Some people mind a lot. Most do not.',
    options: [
      { value: 'dealbreaker', label: "Yes — I couldn't" },
      { value: 'strong', label: "I'd prefer they matched" },
      { value: 'none', label: "Doesn't matter" },
    ],
    dealbreakerIf: 'dealbreaker',
  },
  {
    id: 'q-kids', predicate: 'wants_children', kind: 'fact',
    text: 'Children?',
    options: opts(WANTS_CHILDREN),
  },
  {
    id: 'q-kids-pref', predicate: 'wants_children', kind: 'preference', after: 'q-kids',
    text: 'Does it matter what they want?',
    options: [
      { value: 'dealbreaker', label: 'It has to match' },
      { value: 'strong', label: "I'd prefer it did" },
      { value: 'none', label: 'Open to talking about it' },
    ],
    dealbreakerIf: 'dealbreaker',
  },
  {
    id: 'q-monogamy', predicate: 'monogamy_stance', kind: 'fact',
    text: 'One person, or open?',
    options: [
      { value: 'monogamous', label: 'One person' },
      { value: 'non_monogamous', label: 'Open' },
      { value: 'open_to_either', label: 'Either could work' },
    ],
  },
  {
    id: 'q-drink', predicate: 'drinking', kind: 'fact',
    text: 'Do you drink?',
    options: opts(FREQUENCY),
  },
  {
    id: 'q-smoke', predicate: 'smoking', kind: 'fact',
    text: 'Do you smoke?',
    options: opts(FREQUENCY),
  },
  {
    id: 'q-smoke-pref', predicate: 'smoking', kind: 'preference', after: 'q-smoke',
    text: 'Could you be with a smoker?',
    options: [
      { value: 'dealbreaker', label: 'No' },
      { value: 'strong', label: "I'd rather not" },
      { value: 'none', label: "Doesn't bother me" },
    ],
    dealbreakerIf: 'dealbreaker',
  },
  {
    id: 'q-exercise', predicate: 'exercise_habit', kind: 'fact',
    text: 'How often do you move your body?',
    options: opts(FREQUENCY),
  },
  {
    id: 'q-religion', predicate: 'religion_importance', kind: 'fact',
    text: 'How much does religion matter to you?',
    why: 'Not which one. Just how much it shapes your week.',
    options: opts(IMPORTANCE),
  },
  {
    id: 'q-religion-pref', predicate: 'religion_importance', kind: 'preference', after: 'q-religion',
    text: 'Does theirs need to match?',
    options: [
      { value: 'dealbreaker', label: 'Yes' },
      { value: 'strong', label: 'Would prefer it' },
      { value: 'none', label: 'No' },
    ],
    dealbreakerIf: 'dealbreaker',
  },
  {
    id: 'q-politics', predicate: 'politics_importance', kind: 'fact',
    text: 'How much does politics matter to you?',
    options: opts(IMPORTANCE),
  },
  {
    id: 'q-education', predicate: 'education_level', kind: 'fact',
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
    id: 'q-works-in', predicate: 'works_in', kind: 'fact', multi: true,
    text: 'What field are you in?',
    options: opts([
      'software', 'ai', 'hardware', 'design', 'medicine', 'teaching', 'finance',
      'law', 'media', 'research', 'sales', 'hospitality', 'logistics', 'art',
    ]),
  },
  {
    id: 'q-works-pref', predicate: 'works_in', kind: 'preference', after: 'q-works-in', multi: true,
    text: 'Any field you would especially like them to be in?',
    why: 'This only moves people up the list. It never rules anybody out.',
    options: opts([
      'software', 'ai', 'hardware', 'design', 'medicine', 'teaching', 'finance',
      'law', 'media', 'research', 'art', 'anything',
    ]),
  },
  {
    id: 'q-sleep', predicate: 'sleep_pattern', kind: 'fact',
    text: 'Early or late?',
    options: [
      { value: 'early', label: 'Up early' },
      { value: 'normal', label: 'Neither really' },
      { value: 'night-owl', label: 'Up late' },
    ],
  },
  {
    id: 'q-spending', predicate: 'spending_style', kind: 'fact',
    text: 'Money — how do you think about it?',
    options: [
      { value: 'value-driven', label: 'It has to be worth it' },
      { value: 'comfortable', label: 'I spend without much thought' },
      { value: 'saver', label: 'I save hard' },
      { value: 'brand-conscious', label: 'I like nice things' },
    ],
  },
  {
    id: 'q-media', predicate: 'media_taste', kind: 'fact', multi: true,
    text: 'What do you actually watch?',
    options: opts([
      'foreign-film', 'bollywood', 'regional-cinema', 'prestige-tv', 'anime',
      'documentaries', 'reality-tv', 'comics',
    ]),
  },
  {
    id: 'q-transport', predicate: 'transport', kind: 'fact', multi: true,
    text: 'How do you get around?',
    options: opts(['car', 'metro', 'motorbike', 'cycle', 'electric-cycle', 'walking', 'auto']),
  },
  {
    id: 'q-relocation', predicate: 'relocation_openness', kind: 'fact',
    text: 'Would you move cities for the right person?',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'maybe', label: 'Maybe' },
      { value: 'no', label: 'No' },
    ],
  },

  // ── the last one, and the one that pays for itself ───────────────────────
  //
  // In their own words, on purpose. Every other question here is a chip: fast, and it
  // returns something joinable -- and it returns the same answer everybody else picked.
  // This one returns a sentence, and a sentence is the only thing in this flow that
  // could end up quoted in somebody else's brief.
  //
  // Asked LAST because it is the only question that asks for effort. By this point the
  // person has answered several things and watched the number of people move; that is
  // the moment to ask for a real thought, not the first screen.
  //
  // And people are specific about what they cannot stand and vague about what they
  // want: "what are you looking for" returns "someone kind and funny", true of
  // everybody and excluding nobody.
  {
    id: 'q-dealbreaker', predicate: 'dealbreaker', kind: 'free',
    text: 'Who could you absolutely not spend time with?',
    why: 'Be blunt. This is the only answer that takes people out of your matches.',
    options: [],
  },
];

export const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));

/** Questions whose answers gate entry to the pool. Asked before anything optional. */
export const GATING = ['q-gender', 'q-seeking', 'q-intent'];
