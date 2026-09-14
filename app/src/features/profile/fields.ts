/**
 * The things about you that can be set from a screen.
 *
 * ONE LIST, SHARED. It used to live inside the onboarding flow, which meant those six
 * fields were the only ones anybody could ever set -- and Height and Diet sat on the
 * profile reading "Not set" with nothing on the screen that would change them. A
 * profile row that names a value and offers no way to give it one is worse than not
 * showing the row at all.
 *
 * Adding a field here gives it both a step in setup and an editor on the profile.
 */
import { DIETS, GENDERS, RELATIONSHIP_INTENTS } from '@clone/shared';

export type FieldKind = 'one' | 'many' | 'number' | 'text';

export interface Field {
  key: string;
  title: string;
  hint?: string;
  kind: FieldKind;
  options?: { value: string; label: string }[];
  /** Shown on the profile row. Absent means it is setup-only. */
  rowLabel?: string;
  /** Part of the six the agent cannot go out without. */
  essential?: boolean;
}

/** Words people use, for values stored as tags. */
const HUMAN: Record<string, string> = {
  woman: 'Woman', man: 'Man', nonbinary: 'Nonbinary', other: 'Something else',
  long_term: 'Something long-term', marriage: 'Marriage',
  companionship: 'Company', casual: 'Casual', undecided: 'Still deciding',
  omnivore: 'I eat everything', no_beef: 'No beef', no_pork: 'No pork',
  pescatarian: 'Pescatarian', vegetarian: 'Vegetarian', vegan: 'Vegan',
};

export const label = (v: string): string => HUMAN[v] ?? v.replace(/_/g, ' ');

export const FIELDS: Field[] = [
  { key: 'birth_date', title: 'What year were you born?', kind: 'number',
    hint: 'Used for age filtering, both ways.', essential: true },
  { key: 'gender', title: 'You are…', kind: 'one', essential: true,
    options: GENDERS.map((g) => ({ value: g, label: label(g) })) },
  { key: 'seeking_gender', title: 'You want to meet…', kind: 'many', essential: true,
    options: GENDERS.map((g) => ({ value: g, label: label(g) })) },
  { key: 'relationship_intent', title: 'What are you after?', kind: 'one', essential: true,
    rowLabel: 'Here for',
    options: RELATIONSHIP_INTENTS.map((i) => ({ value: i, label: label(i) })) },
  { key: 'lives_in', title: 'Where are you now?', kind: 'text', essential: true,
    rowLabel: 'Lives in',
    hint: 'Your city is enough. Nobody sees your exact location.' },
  { key: 'max_distance_km', title: 'How far would you travel?', kind: 'one', essential: true,
    options: [
      { value: '10', label: '10 km' }, { value: '25', label: '25 km' },
      { value: '50', label: '50 km' }, { value: '200', label: '200 km' },
      { value: '20000', label: 'Anywhere' },
    ] },

  // ── settable from the profile, not asked during setup ────────────────────
  //
  // These were readable and not writable, which is the worst of both: the row admits
  // the app wants to know and gives nobody a way to say.
  { key: 'height_cm', title: 'How tall are you?', kind: 'number', rowLabel: 'Height',
    hint: 'In centimetres. Some people filter on it; you can leave it blank.' },
  { key: 'diet', title: 'How do you eat?', kind: 'one', rowLabel: 'Diet',
    options: DIETS.map((d) => ({ value: d, label: label(d) })) },
];

export const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

/** The six that gate the pool, in the order setup asks them. */
export const ESSENTIAL_FIELDS = FIELDS.filter((f) => f.essential);

/**
 * Where "Finish setup" should actually go.
 *
 * THE BUG THIS FIXES, found on a real phone. The card lists what is missing -- and
 * when the missing thing was consent it said "It still needs your consent" directly
 * above a button that opened the birth-year question. The button did not lead to the
 * thing the sentence named, which is the specific way a setup flow teaches somebody
 * that it is lying to them.
 *
 * Consent first, because it is the one the server will not let you past and the one
 * that is three taps rather than six questions.
 */
export function setupRoute(missing: readonly string[]) {
  if (missing.includes('consent')) return '/consent' as const;
  return '/onboarding/essentials' as const;
}
