/**
 * A fact as a person reads it on "What it knows": the field in words, and a tapped answer
 * by its chip's own label. It read "WANTS CHILDREN: yes", "MONOGAMY STANCE: monogamous",
 * "MAX DISTANCE KM: 25" -- the column and the stored value (the founder's "What it knows"
 * on the Pixel, 2026-09-30).
 *
 * Only words change. Something the person typed stays exactly as typed: a value is swapped
 * only when it IS one of that field's chip values, so "I eat everything" or a sentence
 * learned in chat comes through untouched. Pure; no model.
 */
import { ANYWHERE_KM } from '@clone/shared';
import { QUESTIONS } from '../onboarding/questions.js';

/** Fields no question names well on its own. Everything else falls back to its question's topic. */
const FIELDS: Record<string, string> = {
  first_name: 'First name', preferred_name: 'Goes by', full_name: 'Full name', birth_date: 'Born',
  gender: 'Gender', seeking_gender: 'Wants to meet', lives_in: 'Lives in', area: 'Part of town',
  relationship_intent: 'Here for', age_range_sought: "Ages you'd meet", max_distance_km: 'How far you would go',
  height_cm: 'Height', interest: 'Into', dislikes: 'Not into', dealbreaker: 'Dealbreaker',
  works_in: 'Works in', education_level: 'Studied', has_children: 'Has kids', wants_children: 'Kids',
  monogamy_stance: 'One person or open', smoking: 'Smoking', drinking: 'Drinking', diet: 'Food',
  religion: 'Faith',
};

/** A chip value, however it was stored: "not_religious", "not religious", "Not-religious". */
const norm = (s: string): string => s.trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Per field, each chip's value -> the words on the chip. Fact questions only: a preference writes a rule. */
const ANSWERS = new Map<string, Map<string, string>>();
const TOPICS = new Map<string, string>();
for (const q of QUESTIONS) {
  if (q.kind !== 'fact') continue;
  const m = ANSWERS.get(q.predicate) ?? new Map<string, string>();
  for (const o of q.options) if (!m.has(norm(o.value))) m.set(norm(o.value), o.label);
  ANSWERS.set(q.predicate, m);
  if (q.topic && !TOPICS.has(q.predicate)) TOPICS.set(q.predicate, q.topic);
}

/** The field, in words: "Kids", "How far you would go". */
export function fieldWords(predicate: string): string {
  const own = FIELDS[predicate] ?? TOPICS.get(predicate);
  if (own) return own;
  const plain = predicate.replace(/_/g, ' ');
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

/** The value, in words: a chip's label, or a number with its unit; anything else as it was. */
export function valueWords(predicate: string, text: string): string {
  const chip = ANSWERS.get(predicate)?.get(norm(text));
  if (chip) return chip;
  if (predicate === 'max_distance_km' && /^\d+$/.test(text.trim())) {
    return Number(text.trim()) >= ANYWHERE_KM ? 'Anywhere' : `${text.trim()} km`;
  }
  if (predicate === 'height_cm' && /^\d+$/.test(text.trim())) return `${text.trim()} cm`;
  const range = predicate === 'age_range_sought' ? /^(\d+)\s*-\s*(\d+)$/.exec(text.trim()) : null;
  if (range) return `${range[1]} to ${range[2]}`;
  return text;
}
