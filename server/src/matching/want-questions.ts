/**
 * From a want to the question the other person answers.
 *
 * THE FOUNDER'S PLAN (2026-09-26): wants like "works in AI", "okay with street food" or
 * "a saver, not an impulse spender" are specific and checkable -- if the other person is
 * asked the right question. So each want is matched, BY CODE, to one question in the bank
 * (onboarding/questions.ts): a situation question ("You get an unexpected ₹50,000. What
 * happens to most of it?") or one of the tapped questions that already exist ("What
 * field are you in?"). The person then ticks which answers are fine, and that becomes an
 * ordinary rule on that answer (preferences), shown on "What you're looking for" with
 * Must have / Really want / Nice to have like every other rule.
 *
 * FIRST MATCH WINS, in this order, and the words are narrow on purpose: a want that
 * matches nothing is not forced onto the nearest question. It stays a sentence, checked
 * against what people write (wants.ts), and can only move people down.
 *
 * A private topic -- kids, faith, smoking, drinking, food, one person or open -- never
 * gets here: it is checked against its card, as before (namesCoreValue).
 */
import { BY_ID, type Question } from '../onboarding/questions.js';

export interface WantQuestion {
  /** The bank question the other person answers. */
  questionId: string;
  /** Words in a want that point at it. */
  pattern: RegExp;
  /** What it is about, in a few words: the check-in asks whether they were like that. */
  about: string;
}

export const WANT_QUESTIONS: readonly WantQuestion[] = [
  { questionId: 'sit-street-food',
    pattern: /\b(street[- ]?food|street stalls?|chaat|dhabas?|roadside|small (shops?|places|joints|eateries)|hole[- ]in[- ]the[- ]wall|local (food|joints|eateries)|thelas?)\b/i,
    about: 'food' },
  { questionId: 'sit-windfall',
    pattern: /\b(sav(e|es|er|ers|ing|ings)|frugal|thrift\w*|money|financ\w*|budget\w*|spend(s|er|ers|ing)?|spendthrift|extravagan\w*|debts?|loans?|splurg\w*)\b/i,
    about: 'money' },
  { questionId: 'sit-unplanned-buy', pattern: /\b(impulsiv\w*|impulse)\b/i, about: 'money' },
  { questionId: 'sit-last-book',
    pattern: /\b(reads|reader|readers|reading|books?|bookworm|novels?|literature)\b/i, about: 'books' },
  { questionId: 'sit-pet-sitting',
    pattern: /\b(dogs?|cats?|pets?|puppy|puppies|animals?|animal lover)\b/i, about: 'animals' },
  { questionId: 'sit-weeknight-dinner',
    pattern: /\b(cooks?|cooking|kitchen|home[- ]?cooked|chef)\b/i, about: 'cooking' },
  { questionId: 'q-works-in',
    pattern: /\b(ai|a\.i\.|machine learning|artificial intelligence|software|engineer(s|ing)?|developer|programm\w*|coder|data scien\w*|techie|tech)\b/i,
    about: 'work' },
  { questionId: 'q-exercise',
    pattern: /\b(fit|fitness|gym|work ?outs?|works out|athletic|runs|runner|running|yoga|sports?|sporty|trek\w*|hik(e|es|ing))\b/i,
    about: 'exercise' },
  { questionId: 'q-sleep',
    pattern: /\b(early riser|morning person|early bird|night owl|sleeps? (early|late)|late nights?)\b/i, about: 'sleep' },
  { questionId: 'sit-long-weekend',
    pattern: /\b(travel\w*|trips?|explor\w*|backpack\w*|wanderlust|adventur\w*|homebody|home body)\b/i, about: 'weekends' },
  { questionId: 'sit-last-minute',
    pattern: /\b(spontaneous\w*|last[- ]minute|going out|goes out|parties|partying|night ?life|outgoing)\b/i, about: 'plans' },
  { questionId: 'q-relocation',
    pattern: /\b(relocat\w*|move (cities|city|abroad|countries)|moving (cities|abroad)|open to moving)\b/i, about: 'moving cities' },
];

const BY_QUESTION = new Map(WANT_QUESTIONS.map((w) => [w.questionId, w]));

/** Every predicate a want may be checked against by a question, with that question. */
export const QUESTION_BY_PREDICATE: ReadonlyMap<string, Question> =
  new Map(WANT_QUESTIONS.map((w) => [BY_ID.get(w.questionId)!.predicate, BY_ID.get(w.questionId)!]));
export const WANT_QUESTION_PREDICATES: ReadonlySet<string> = new Set(QUESTION_BY_PREDICATE.keys());

/**
 * A rule on a question's answer, said with that question's own labels: "Money: Saved or
 * invested, Pays off something I owe" -- not "money windfall is save invest". Null for
 * any other rule. Pure.
 */
export function ruleLabel(predicate: string, value: unknown): string | null {
  const q = QUESTION_BY_PREDICATE.get(predicate);
  if (!q || !Array.isArray(value)) return null;
  const label = new Map(q.options.map((o) => [o.value, o.label]));
  return `${q.topic ?? q.text}: ${value.map((v) => label.get(String(v)) ?? String(v)).join(', ')}`;
}

/** The question for a want, or null. First match in WANT_QUESTIONS. Pure. */
export function questionForWant(text: string): { want: WantQuestion; question: Question } | null {
  for (const w of WANT_QUESTIONS) {
    if (w.pattern.test(text)) return { want: w, question: BY_ID.get(w.questionId)! };
  }
  return null;
}

/** A want question by its bank id, or null. */
export const wantQuestion = (questionId: string): { want: WantQuestion; question: Question } | null => {
  const w = BY_QUESTION.get(questionId);
  return w ? { want: w, question: BY_ID.get(questionId)! } : null;
};

/**
 * One person's answer against the answers a want accepts, BY CODE. `cant_check` when they
 * have not answered: unknown is never a mismatch. A multi-choice question (the field
 * you work in) is read from the tags, which hold every value; a single one from traits.
 */
export function checkAsked(
  ask: { predicate: string; accepted: readonly string[]; multi: boolean },
  answers: { traits: Readonly<Record<string, unknown>>; tags: readonly string[] } | null,
): 'met' | 'not_met' | 'cant_check' {
  if (!answers) return 'cant_check';
  if (ask.multi) {
    const prefix = `${ask.predicate}:`;
    const theirs = answers.tags.filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length));
    if (!theirs.length) return 'cant_check';
    return theirs.some((v) => ask.accepted.includes(v)) ? 'met' : 'not_met';
  }
  const v = answers.traits[ask.predicate];
  if (typeof v !== 'string') return 'cant_check';
  return ask.accepted.includes(v) ? 'met' : 'not_met';
}
