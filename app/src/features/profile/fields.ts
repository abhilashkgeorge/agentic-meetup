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
import { AREAS, DIETS, GENDERS, RELATIONSHIP_INTENTS } from '@clone/shared';

/** `range` is a pair of numbers, from and to: today only the ages you would meet. */
export type FieldKind = 'one' | 'many' | 'number' | 'text' | 'range';

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

/**
 * The words a person reads, for a value stored as a tag.
 *
 * Neighbourhoods are looked up rather than listed, because there are thirty of them
 * and they already carry their own names. Without that branch "What it knows" showed
 * the raw id -- `mg-road` -- sitting in a list where every other line said something
 * like "Bengaluru" or "Something long-term". The profile screen and the person sheet
 * in the town both got this right; only this helper did not.
 */
export const label = (v: string): string =>
  HUMAN[v] ?? AREAS.find((a) => a.id === v)?.name ?? v.replace(/_/g, ' ');

export const FIELDS: Field[] = [
  { key: 'birth_date', title: 'What year were you born?', kind: 'number',
    hint: 'Used for age filtering, both ways.', essential: true },
  { key: 'gender', title: 'You are…', kind: 'one', essential: true,
    options: GENDERS.map((g) => ({ value: g, label: label(g) })) },
  { key: 'seeking_gender', title: 'You want to meet…', kind: 'many', essential: true,
    options: GENDERS.map((g) => ({ value: g, label: label(g) })) },
  // THE AGE FILTER'S OTHER HALF. The candidate query tests ages both ways, and until
  // this step nothing wrote a real person's range -- see age-range.ts. Pre-filled from
  // the person's own age, shown, editable. Not one of the pool's required fields, so
  // the wizard asks it by a rule of its own (`essentialSteps`) rather than waiting for
  // the server to list it as missing.
  { key: 'age_range_sought', title: 'Who would you like to meet?', kind: 'range', essential: true,
    rowLabel: "Ages you'd meet",
    hint: 'Their age, from and to. We started from yours. Change it if you like.' },
  { key: 'relationship_intent', title: 'What are you after?', kind: 'one', essential: true,
    rowLabel: 'Here for',
    options: RELATIONSHIP_INTENTS.map((i) => ({ value: i, label: label(i) })) },
  { key: 'lives_in', title: 'Where are you now?', kind: 'text', essential: true,
    rowLabel: 'Lives in',
    hint: 'Your city is enough. Nobody sees your exact location.' },
  // Asked only of a person the map covers (the pool says so in `need`), and skipped at
  // run time when the city typed a moment ago is not Bangalore. Optional: the pool never
  // waits on it. What it does is put the agent in that neighbourhood on the Home map and
  // sharpen distance matching from the city centre to the neighbourhood centre.
  { key: 'area', title: 'Which part of town?', kind: 'one', essential: true, rowLabel: 'Part of town',
    hint: 'Roughly. It puts your agent in that neighbourhood on the map.',
    options: AREAS.map((a) => ({ value: a.id, label: a.name })) },
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

/**
 * A human noun for a MISSING item, for the "still needs" lists on the chat home and
 * the end of the interview. Those lists were printing the raw predicate keys --
 * `birth_date`, `lives_in` -- straight onto the screen, which is the internal column
 * name leaking into the one place the product promises plain words. `consent` is here
 * too because the pool reports it alongside the fields but it is not one of them.
 */
const MISSING_NOUN: Record<string, string> = {
  consent: 'Your agreement to the basics',
  birth_date: 'Your birth year',
  gender: 'Your gender',
  seeking_gender: 'Who you want to meet',
  relationship_intent: "What you're after",
  lives_in: 'Where you live',
  area: 'Which part of town',
  max_distance_km: 'How far you would travel',
  // The five core cards. Each is two answers on one screen -- yours, and who you would
  // be fine with -- so the noun names the card, not a single field.
  wants_children: 'Whether you want kids',
  monogamy_stance: 'One person, or open',
  smoking: 'Whether you smoke',
  drinking: 'Whether you drink',
  diet: 'How you eat',
};

export const missingLabel = (key: string): string =>
  MISSING_NOUN[key]
  ?? FIELD_BY_KEY.get(key)?.rowLabel
  ?? FIELD_BY_KEY.get(key)?.title
  ?? key.replace(/_/g, ' ');

/** The six that gate the pool, in the order setup asks them. */
export const ESSENTIAL_FIELDS = FIELDS.filter((f) => f.essential);

/**
 * The steps the setup wizard asks on this visit.
 *
 * `need` is the server's list of what is still worth asking (missing required fields,
 * plus area and distance while they are open). The age range is not on it -- it gates
 * nothing, so the pool never reports it missing -- and a wizard that only filtered on
 * `need` would never ask it, which is exactly how nothing came to write it. So it is
 * asked whenever "What it knows" holds no range yet: once for a new person, and once
 * for everybody who set up before it existed.
 */
export function essentialSteps(need: readonly string[], hasAgeRange: boolean): Field[] {
  return ESSENTIAL_FIELDS.filter((f) =>
    need.includes(f.key) || (f.key === 'age_range_sought' && !hasAgeRange));
}

/**
 * The five core cards, by the predicate each one answers.
 *
 * A card counts as done when it has an answer row, answered or declined, and the
 * server names the predicate on the pool's missing list for every card that is not.
 * Until all five are done the agent is not in the pool: it is not sent out and it is
 * nobody's candidate. They are asked by the interview, not the essentials wizard.
 */
export const CARD_PREDICATES = ['wants_children', 'monogamy_stance', 'smoking', 'drinking', 'diet'] as const;

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
 *
 * THE CARDS NEXT, AND TO THE INTERVIEW. When the five core cards joined the pool's
 * requirements, every person who had set up before them dropped out of the pool --
 * including both of the founder's phones -- and "Finish setting it up" still opened
 * the essentials wizard, which cannot ask a card. The button would have led to a
 * screen with nothing on it for the one thing the card said was missing. The interview
 * asks the cards; when it is done it hands on to the essentials wizard for anything
 * else still missing (see the interview's `done`).
 */
export function setupRoute(missing: readonly string[]) {
  if (missing.includes('consent')) return '/consent' as const;
  if (missing.some((m) => (CARD_PREDICATES as readonly string[]).includes(m))) {
    return '/onboarding/interview' as const;
  }
  return '/onboarding/essentials' as const;
}
