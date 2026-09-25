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

/** What a card is called when its rule is read back: "smoking: never". */
const CARD_NOUN: Record<string, string> = {
  wants_children: 'kids',
  monogamy_stance: 'one person or open',
  smoking: 'smoking',
  drinking: 'drinking',
  diet: 'food',
  religion: 'faith',
};

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
    const q = BY_ID.get(card.id);
    const label = (v: string) => (q?.options.find((o) => o.value === v)?.label ?? v.replace(/_/g, ' ')).toLowerCase();
    lines.push(`${CARD_NOUN[card.predicate] ?? card.predicate}: ${or(rule.values.map(label))}`);
  }

  const sentence = lines.length
    ? `I'll only bring you people who ${and(lines)}. ${READBACK_FOOTER}`
    : "You haven't set any rules, so I'll bring you anyone who fits the basics.";
  return { lines, footer: READBACK_FOOTER, sentence };
}
