/**
 * Turning what somebody said into something two computers can compare.
 *
 * `object_text` keeps the words: "somewhere around Bangalore I guess", "I'm 5'4",
 * "she should be into AI". Those are the person's own phrasing and they are what a
 * brief quotes back. They are also useless for matching, because "5'4" and "163cm"
 * and "five foot four" are three strings and one height.
 *
 * `object_value` is the comparable form, derived here. One validator per predicate,
 * run at commit time, never by a model.
 *
 * TWO RULES THAT MATTER MORE THAN THEY LOOK:
 *
 * 1. A value that will not parse does NOT reject the fact. The fact commits with a
 *    null object_value and simply is not matchable, and that becomes a question worth
 *    asking. Refusing the write would throw away what the person said because we could
 *    not tidy it.
 *
 * 2. The shapes are frozen on first use. `object_value` is NULL on every row written
 *    so far, so whatever ships first is what we live with -- retrofitting a shape over
 *    accumulated facts means re-parsing prose that is months old. The dealbreaker
 *    shape especially: without a `target` naming what it is about, a dealbreaker is
 *    a sentence nobody can join on.
 */
import { z } from 'zod';

/** Fixed vocabularies. Open-ended where the world is, closed where it is not. */
export const GENDERS = ['woman', 'man', 'nonbinary', 'other'] as const;
// Named RELATIONSHIP_INTENTS because facts.ts already has INTENTS, which answers a
// different question: why somebody opened the app at all, not what they want with a
// person.
export const RELATIONSHIP_INTENTS =
  ['long_term', 'marriage', 'companionship', 'casual', 'undecided'] as const;
export const MONOGAMY = ['monogamous', 'non_monogamous', 'open_to_either'] as const;
export const WANTS_CHILDREN = ['yes', 'no', 'maybe', 'have_and_want_more', 'have_and_done'] as const;
export const FREQUENCY = ['never', 'rarely', 'sometimes', 'often', 'daily'] as const;
export const IMPORTANCE = ['none', 'low', 'medium', 'high'] as const;
/** Diet ordered from least to most restrictive, so "at least as permissive as" is a compare. */
export const DIETS = ['omnivore', 'no_beef', 'no_pork', 'pescatarian', 'vegetarian', 'vegan'] as const;
export const EDUCATION = ['school', 'some_college', 'bachelors', 'masters', 'doctorate'] as const;
export const BODY_TYPES = ['slim', 'average', 'athletic', 'curvy', 'large'] as const;

const Enum = <T extends readonly [string, ...string[]]>(vals: T) => z.enum(vals);

/** The shape stored in facts.object_value, by predicate. */
export const VALUE_SHAPES = {
  gender: Enum(GENDERS),
  seeking_gender: Enum(GENDERS),
  relationship_intent: Enum(RELATIONSHIP_INTENTS),
  monogamy_stance: Enum(MONOGAMY),
  wants_children: Enum(WANTS_CHILDREN),
  diet: Enum(DIETS),
  education_level: Enum(EDUCATION),
  body_type: Enum(BODY_TYPES),
  religion_importance: Enum(IMPORTANCE),
  politics_importance: Enum(IMPORTANCE),
  smoking: Enum(FREQUENCY),
  drinking: Enum(FREQUENCY),
  drugs: Enum(FREQUENCY),
  exercise_habit: Enum(FREQUENCY),

  height_cm: z.number().int().min(120).max(230),
  max_distance_km: z.number().int().min(1).max(20_000),
  age_range_sought: z.object({ min: z.number().int().min(18), max: z.number().int().max(120) }),
  birth_date: z.object({ year: z.number().int(), month: z.number().int().min(1).max(12).nullable() }),
  lives_in: z.object({
    city: z.string(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    /** How vague they were. "near Bangalore" is not a street address. */
    precision_km: z.number().min(0),
  }),

  /** Free tags, lowercased and hyphenated so two people's words join. */
  works_in: z.string(),
  interest: z.string(),
  dislikes: z.string(),
  media_taste: z.string(),
  transport: z.string(),
  ethnicity: z.string(),
  nationality_origin: z.string(),
  languages: z.string(),
  spending_style: z.string(),
  sleep_pattern: z.string(),
  relocation_openness: z.string(),

  /**
   * A dealbreaker names what it is ABOUT. "no smokers" is {target:'smoking'}, and
   * that is the difference between a joinable rule and a sentence.
   */
  dealbreaker: z.object({ target: z.string(), value: z.unknown().optional() }),
} as const;

export type MatchableValue = unknown;

/** Tags are compared across people, so they must normalise identically for everyone. */
export function toTag(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Centimetres from whatever a person typed. Feet-and-inches is the common case. */
export function parseHeight(raw: string): number | null {
  const t = raw.trim().toLowerCase();
  const cm = t.match(/(\d{2,3})\s*(cm|centim)/);
  if (cm) return Number(cm[1]);
  // 5'4, 5 ft 4, 5'4", 5 feet 4 inches
  const ft = t.match(/(\d)\s*(?:'|ft|feet|foot)\s*(\d{1,2})?/);
  if (ft) {
    const inches = Number(ft[1]) * 12 + Number(ft[2] ?? 0);
    return Math.round(inches * 2.54);
  }
  const bare = t.match(/^(\d{2,3})$/);
  if (bare) {
    const n = Number(bare[1]);
    return n >= 120 && n <= 230 ? n : null;
  }
  return null;
}

/**
 * Derive the comparable value, or null.
 *
 * Null is a normal outcome, not a failure: the fact still commits, it is simply not
 * matchable yet, and the gap becomes something worth asking about.
 */
export function deriveValue(predicate: string, objectText: string): unknown | null {
  const shape = (VALUE_SHAPES as Record<string, z.ZodTypeAny | undefined>)[predicate];
  if (!shape) return null;

  const text = objectText.trim();
  if (!text) return null;

  // Height is the one field people write six different ways.
  if (predicate === 'height_cm') {
    const cm = parseHeight(text);
    return cm !== null && shape.safeParse(cm).success ? cm : null;
  }

  // Enums: match on the normalised tag, so "Long term" and "long-term" both land.
  if (shape instanceof z.ZodEnum) {
    const tag = toTag(text).replace(/-/g, '_');
    const parsed = shape.safeParse(tag);
    return parsed.success ? parsed.data : null;
  }

  // Plain tag fields.
  if (shape instanceof z.ZodString) {
    const tag = toTag(text);
    return tag.length >= 2 ? tag : null;
  }

  // Anything structured must already be structured; prose is not guessed at.
  return null;
}

/** Does a value satisfy a preference? The one comparison matching is built on. */
export function satisfies(
  operator: string,
  wanted: unknown,
  actual: unknown,
): boolean | null {
  // Unknown on either side is UNKNOWN, never false. Treating missing as a mismatch
  // empties the pool on day one, because half of any real schema is missing.
  if (actual === null || actual === undefined) return null;

  switch (operator) {
    case 'equals':
      return actual === wanted;
    case 'in':
      return Array.isArray(wanted) && wanted.includes(actual);
    case 'not_in':
      return Array.isArray(wanted) && !wanted.includes(actual);
    case 'gte':
      return typeof actual === 'number' && typeof wanted === 'number' && actual >= wanted;
    case 'lte':
      return typeof actual === 'number' && typeof wanted === 'number' && actual <= wanted;
    case 'between': {
      const w = wanted as { min?: number; max?: number };
      return (
        typeof actual === 'number' &&
        (w.min === undefined || actual >= w.min) &&
        (w.max === undefined || actual <= w.max)
      );
    }
    case 'contains':
      return Array.isArray(actual) && actual.includes(wanted);
    case 'absent':
      return false; // actual is present, so an 'absent' requirement fails
    default:
      return null;
  }
}

/**
 * The fields a free-text dealbreaker may be mapped onto, with the values each accepts.
 *
 * Deliberately SHORT. This list is what the only pool-reducing answer in the product is
 * allowed to touch, and every entry here is a way for somebody to be removed from
 * someone else's matches without either of them finding out. A field belongs here only
 * when a mismatch genuinely wastes an evening for both people.
 *
 * Notably absent: religion, politics, ethnicity, body type. Those can decide a match
 * through the ordinary preference path, where the person has chosen the value from a
 * list themselves rather than a model inferring it from a sentence.
 */
export const MATCHABLE_PREDICATES: readonly { name: string; values: readonly string[] }[] = [
  { name: 'smoking', values: FREQUENCY },
  { name: 'drinking', values: FREQUENCY },
  { name: 'drugs', values: FREQUENCY },
  { name: 'diet', values: DIETS },
  { name: 'wants_children', values: WANTS_CHILDREN },
  { name: 'relationship_intent', values: RELATIONSHIP_INTENTS },
  { name: 'monogamy_stance', values: MONOGAMY },
  { name: 'exercise_habit', values: FREQUENCY },
] as const;
