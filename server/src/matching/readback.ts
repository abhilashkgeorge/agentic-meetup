/**
 * The person's own rules, read back to them in words. No model: a template over what
 * they tapped.
 *
 * WHY THIS EXISTS. An agent that filters people is doing something the person cannot
 * see: nobody ever meets the people it ruled out, and so nobody notices when a rule is
 * stricter than they meant. The spec's line for the send screen: "I'll only bring you
 * people who want marriage, are 26-34, and never smoke or haven't said." Said back,
 * before the agent goes out, a rule stops being invisible.
 *
 * "OR HAVEN'T SAID" IS NOT DECORATION. Every rule passes a person who never answered
 * that card (candidates.ts, 0020), so a readback without that half would promise more
 * than the filter does -- and it is the half people are most surprised by.
 *
 * Pure: no client, no clock. The same rules always read the same way.
 */
import { ALL_CARDS, BY_ID } from '../onboarding/questions.js';
import { INTENT_WORDS } from './brief.js';

/**
 * Each card answer as the rest of "people who ...". It used to be the card's name and its
 * labels -- "kids: want kids", "one person or open: one person" -- which does not follow
 * "people who", on the screen or in the sentence, and it lower-cased a faith's name (the
 * rules card on the Pixel, 2026-09-30). An answer missing here falls back to its label.
 */
const SAYS: Record<string, Record<string, string>> = {
  wants_children: {
    yes: 'want kids', no: "don't want kids", maybe: "aren't sure about kids yet",
    have_and_want_more: 'have kids and want more', have_and_done: 'have kids and want no more',
  },
  monogamy_stance: {
    monogamous: 'want one person', non_monogamous: 'want an open relationship', open_to_either: 'are open to either',
  },
  diet: {
    omnivore: 'eat everything', no_beef: "don't eat beef", no_pork: "don't eat pork",
    pescatarian: 'eat fish but no meat', vegetarian: 'are vegetarian', vegan: 'are vegan',
  },
  religion: {
    spiritual: 'are spiritual but not religious', not_religious: "aren't religious", other: 'have another faith',
  },
};
/** The cards that ask how often: "never or rarely smoke", "drink every day". */
const HOW_OFTEN: Record<string, string> = { smoking: 'smoke', drinking: 'drink' };

/** One card's rule, in the card's order of answers. */
function says(predicate: string, values: readonly string[], label: (v: string) => string): string {
  const verb = HOW_OFTEN[predicate];
  if (verb) {
    const now = values.filter((v) => v !== 'daily');
    return or([...(now.length ? [`${or(now)} ${verb}`] : []), ...(values.includes('daily') ? [`${verb} every day`] : [])]);
  }
  // A faith is said as it is named on the card: "are Hindu", never "hindu".
  const phrases = values.map((v) => SAYS[predicate]?.[v] ?? (predicate === 'religion' ? `are ${label(v)}` : label(v).toLowerCase()));
  // "are vegetarian or vegan", not "are vegetarian or are vegan".
  const are = phrases.filter((x) => x.startsWith('are '));
  const merged = are.length > 1 ? `are ${or(are.map((x) => x.slice(4)))}` : null;
  return or(phrases.flatMap((x) => (!merged || !x.startsWith('are ') ? [x] : x === are[0] ? [merged] : [])));
}

export interface ReadbackInput {
  intent: readonly string[];
  ageRange: { min: number; max: number } | null;
  maxDistanceKm: number | null;
  /** The live `in` dealbreakers on the five card fields, values in card order. */
  rules: readonly { predicate: string; values: readonly string[] }[];
}

export interface Readback {
  /** One short line per rule, for a list on screen. */
  lines: string[];
  /** The honest half, said once under the list. */
  footer: string;
  /** The same, as one sentence, for a screen reader or a single line of copy. */
  sentence: string;
}

export const READBACK_FOOTER = "People who haven't answered a card still pass it.";

/** "a or b", "a, b or c" -- inside one rule. */
const or = (xs: readonly string[]): string => join(xs, 'or');
/** "a, b and c" -- across rules. Its own join, never a rewrite of the "or" one: a rule
 *  that itself reads "never or rarely" must not have its "or" turned into "and". */
const and = (xs: readonly string[]): string => join(xs, 'and');
function join(xs: readonly string[], word: string): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ${word} ${xs[xs.length - 1]}`;
}

/** An answer as the card names it: "Want kids", "Hindu". */
function labelFor(predicate: string): (v: string) => string {
  const card = ALL_CARDS.find((c) => c.predicate === predicate);
  const q = card ? BY_ID.get(card.id) : undefined;
  return (v: string) => q?.options.find((o) => o.value === v)?.label ?? v.replace(/_/g, ' ');
}

/**
 * A card rule standing on its own line, for the rules screen: "They want kids", "They never
 * or rarely smoke". Values in the card's order. Null for anything that is not a card. It
 * read "wants children is yes" and "monogamy stance is monogamous" -- the column's name and
 * the stored value (the founder's "Looking for" on the Pixel, 2026-09-30).
 */
export function cardRuleLine(predicate: string, values: readonly string[]): string | null {
  const card = ALL_CARDS.find((c) => c.predicate === predicate);
  if (!card || !values.length) return null;
  const order = BY_ID.get(card.id)?.options.map((o) => o.value) ?? [];
  const inOrder = [...values].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return `They ${says(predicate, inOrder, labelFor(predicate))}`;
}

export function readback(input: ReadbackInput): Readback {
  const lines: string[] = [];

  const intents = input.intent.map((i) => INTENT_WORDS[i]).filter((w): w is string => Boolean(w));
  if (intents.length) lines.push(`want ${or(intents)}`);
  if (input.ageRange) lines.push(`are ${input.ageRange.min} to ${input.ageRange.max}`);
  if (input.maxDistanceKm !== null) lines.push(`live within ${input.maxDistanceKm} km`);

  // Card order, so the list reads the way the cards were asked.
  for (const card of ALL_CARDS) {
    const rule = input.rules.find((r) => r.predicate === card.predicate);
    if (!rule || !rule.values.length) continue;
    lines.push(says(card.predicate, rule.values, labelFor(card.predicate)));
  }

  const sentence = lines.length
    ? `I'll only bring you people who ${and(lines)}. ${READBACK_FOOTER}`
    : "You haven't set any rules, so I'll bring you anyone who fits the basics.";
  return { lines, footer: READBACK_FOOTER, sentence };
}
