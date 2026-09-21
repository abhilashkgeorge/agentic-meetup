/**
 * Making a pool to match against, without waiting for real people.
 *
 * THREE RULES, and the first two are what keep this from being theatre.
 *
 * 1. STRUCTURE IS SAMPLED, NEVER GENERATED. Every field comes from a distribution in
 *    marginals.ts that a person can read and argue with. Asking a model to "be
 *    diverse" produces a thousand variations of one person; diversity is a property
 *    of the sampler.
 *
 * 2. SYNTHETIC PEOPLE NEVER TOUCH `facts`. They are written straight into
 *    match_profile with is_synthetic = true. Migration 0010 forbids an untrusted or
 *    system-origin fact from ever being active, and weakening that to accommodate
 *    invented people would delete the guarantee that protects the real one. The
 *    candidate query filters a.is_synthetic = b.is_synthetic, so the two populations
 *    cannot see each other at all.
 *
 * 3. SOME FIELDS ARE DELIBERATELY MISSING. Roughly a fifth of every profile is left
 *    blank. If every synthetic person is complete, the "unknown is not a mismatch"
 *    path is never exercised — and that is the single line that decides whether a
 *    real pool is empty or not.
 *
 * What this CANNOT tell us, stated plainly: whether matching predicts attraction.
 * These people do not exist and cannot go on a date. It tells us the filter survives
 * a realistic distribution, the ranking separates, and the arithmetic holds at scale.
 * The attraction question needs the speed-dating data, which is a different harness.
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AREAS, findPlace, nearestArea, toTag } from '@clone/shared';
import { voiceFor } from './synthetic-voice.js';
import {
  AGE_BANDS, BODY, CITIES, DIET, EDUCATION, FREQ, GENDER, IMPORTANCE, INTENT,
  INTERESTS, MEDIA, MONOGAMY, NATIONALITY, SLEEP, SPENDING, TRANSPORT,
  WANTS_CHILDREN, WORKS_IN, pick, tilt, type Dist,
} from './marginals.js';

/**
 * Seeded, so a run is reproducible. A pool that differs every time makes a change in
 * match rates impossible to attribute to the change you actually made.
 */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const between = (r: () => number, lo: number, hi: number) =>
  lo + Math.floor(r() * (hi - lo + 1));

/** Pick n distinct items, weighted toward the front of the list but not rigidly. */
function sample<T>(items: readonly T[], n: number, r: () => number): T[] {
  const pool = [...items];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]!);
  }
  return out;
}

/**
 * Names, so a reveal shows a person rather than a UUID.
 *
 * Sampled like every other field, and from the places the pool actually lives -- a
 * Bangalore pool of Emmas and Liams would make every screenshot a lie about who is on
 * the app. They are invented people, but they have to be plausibly the invented people
 * the marginals describe.
 */
const NAMES_WOMAN = [
  'Ananya', 'Divya', 'Meera', 'Priya', 'Rhea', 'Sneha', 'Kavya', 'Ishita', 'Tara',
  'Nithya', 'Aditi', 'Shreya', 'Pooja', 'Lakshmi', 'Anjali', 'Riya', 'Sana', 'Neha',
  'Maya', 'Zoya', 'Emma', 'Chloe', 'Sofia', 'Hannah', 'Grace',
] as const;

const NAMES_MAN = [
  'Arjun', 'Rohan', 'Karthik', 'Aditya', 'Vikram', 'Nikhil', 'Rahul', 'Siddharth',
  'Aman', 'Varun', 'Dhruv', 'Ishaan', 'Manish', 'Pranav', 'Sandeep', 'Tarun', 'Yash',
  'Kabir', 'Omar', 'Zain', 'James', 'Daniel', 'Lucas', 'Noah', 'Ethan',
] as const;

const NAMES_OTHER = [
  'Kiran', 'Arya', 'Sam', 'Alex', 'Jo', 'Nikita', 'Robin', 'Ray', 'Charlie', 'Ari',
] as const;

export interface SyntheticProfile {
  userId: string;
  tenantId: string;
  displayName: string;
  /** Where they live, kept for the dossier. Matching uses lat/lon. */
  city: string;
  /** What their agent may say, and what a brief may quote. Generated, never a model. */
  dossier: string;
  quotes: { predicate: string; text: string; when: string }[];
  age: number;
  gender: string;
  seekingGender: string[];
  ageMin: number;
  ageMax: number;
  lat: number | null;
  lon: number | null;
  maxDistanceKm: number;
  intent: string[];
  attributeTags: string[];
  traits: Record<string, unknown>;
}

/** The thirty neighbourhoods as a distribution, in whole-number weights. */
const AREA_DIST: Dist<string> = AREAS.map((a) => [a.id, Math.round(a.weight * 100)] as const);

export function makeProfile(r: () => number, tenantId: string): SyntheticProfile {
  const gender = pick(GENDER, r);
  const names = gender === 'woman' ? NAMES_WOMAN : gender === 'man' ? NAMES_MAN : NAMES_OTHER;
  const displayName = names[Math.floor(r() * names.length)]!;
  const band = pick(AGE_BANDS, r);
  const [lo, hi] = band.split('-').map(Number) as [number, number];
  const age = between(r, lo, hi);

  const religionImportance = pick(IMPORTANCE, r);
  const t = tilt(age, religionImportance);

  // Who they want to meet. Mostly the other binary gender, sometimes more than one --
  // a pool that is perfectly straight tests only half the filter.
  const seeking =
    r() < 0.08
      ? ['woman', 'man']
      : gender === 'man'
        ? ['woman']
        : gender === 'woman'
          ? ['man']
          : sample(['woman', 'man', 'nonbinary'], 2, r);

  // Age range: most people want somebody near their own age, asymmetrically.
  const ageMin = Math.max(18, age - between(r, 2, 8));
  const ageMax = age + between(r, 2, 10);

  const city = pick(CITIES, r);
  const place = findPlace(city);
  // A Bangalore person lives somewhere in Bangalore: one of the thirty neighbourhoods,
  // weighted the way the areas table weights them, and their point is that
  // neighbourhood's centre rather than the city's -- the same rule rebuildMatchProfile
  // applies to a real person who names one. About one in twelve never says (Rule 3).
  const inBangalore = place !== null && nearestArea(place.lat, place.lon, 3) !== null;
  const area = inBangalore && r() >= 0.08 ? pick(AREA_DIST, r) : null;
  const areaCentre = area ? AREAS.find((a) => a.id === area) ?? null : null;

  let intent = pick(INTENT, r);
  // The tilt, applied: older people fall through to something settled more often.
  if (t.intentBias > 1 && r() < 0.3 && (intent === 'casual' || intent === 'undecided')) {
    intent = 'long_term';
  }

  const interests = sample(INTERESTS, between(r, 3, 9), r).map(toTag);
  const media = sample(MEDIA, between(r, 1, 3), r).map(toTag);
  const worksIn = pick(WORKS_IN, r);

  const traits: Record<string, unknown> = {
    gender,
    relationship_intent: intent,
    monogamy_stance: pick(MONOGAMY, r),
    wants_children: r() < t.childrenBias * 0.5 ? pick(WANTS_CHILDREN, r) : 'maybe',
    diet: pick(DIET, r),
    drinking: pick(FREQ, r),
    smoking: pick(FREQ, r),
    exercise_habit: pick(FREQ, r),
    education_level: pick(EDUCATION, r),
    religion_importance: religionImportance,
    politics_importance: t.politicsBias,
    body_type: pick(BODY, r),
    sleep_pattern: pick(SLEEP, r),
    spending_style: pick(SPENDING, r),
    transport: pick(TRANSPORT, r),
    works_in: worksIn,
    nationality_origin: pick(NATIONALITY, r),
    height_cm: gender === 'man' ? between(r, 158, 190) : between(r, 148, 178),
  };

  // Rule 3: leave holes. Roughly one field in five, chosen at random, so the
  // "unknown is not a mismatch" path is exercised by most pairs rather than none.
  for (const key of Object.keys(traits)) {
    if (key === 'gender' || key === 'relationship_intent') continue; // structural
    if (r() < 0.2) delete traits[key];
  }
  // After the holes, so it is never one of them: the reveal's "lives in" line reads
  // this, and a person deciding whether to meet somebody is owed the city.
  traits.lives_in = city;
  if (area) traits.area = area;

  const base = {
    userId: randomUUID(),
    tenantId,
    displayName,
    city,
    age,
    gender,
    seekingGender: seeking,
    ageMin,
    ageMax,
    lat: areaCentre?.lat ?? place?.lat ?? null,
    lon: areaCentre?.lon ?? place?.lon ?? null,
    maxDistanceKm: Number(
      pick([['10', 12], ['25', 24], ['50', 34], ['200', 18], ['20000', 12]] as const, r),
    ),
    intent: [intent],
    attributeTags: [
      ...interests.map((i) => `interest:${i}`),
      ...media.map((m) => `media_taste:${m}`),
      `works_in:${worksIn}`,
    ],
    traits,
  };

  // An agent with nothing to say produced a rendezvous where both sides agreed about
  // nobody. Built from the traits just sampled, by template -- see synthetic-voice.ts.
  const voice = voiceFor(base, r);
  return { ...base, dossier: voice.dossier, quotes: voice.quotes };
}

/**
 * Write them in one statement per batch.
 *
 * Straight into match_profile, never through commit(). These people have no facts,
 * no episodes and no memory, because they are not people — they are a distribution
 * with user ids, and giving them a memory would be inventing evidence.
 */
export async function loadProfiles(
  c: PoolClient,
  profiles: readonly SyntheticProfile[],
): Promise<number> {
  let n = 0;
  for (const p of profiles) {
    // An app_users row first, because match_profile.user_id references it. Keeping
    // that key rather than dropping it matters: without it a synthetic profile is a
    // dangling id that every join, erasure sweep and integrity check has to special-
    // case for ever. The row holds nothing -- no email anybody could reach, no
    // credential, no facts -- and lives in a tenant nothing else can see.
    await c.query(
      `INSERT INTO app_users (id, tenant_id, email, tier)
       VALUES ($1::uuid, $2::uuid, $3, 'trial')
       ON CONFLICT (id) DO NOTHING`,
      [p.userId, p.tenantId, `${p.userId}@synthetic.invalid`],
    );
    await c.query(
      `INSERT INTO match_profile (
         user_id, tenant_id, age, gender, seeking_gender, age_min, age_max,
         lat, lon, max_distance_km, intent, attribute_tags, traits, display_name,
         synthetic_dossier, synthetic_quotes,
         in_pool, is_synthetic, last_active_at, rebuilt_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, true, true, now(), now())
       ON CONFLICT (user_id) DO NOTHING`,
      [
        p.userId, p.tenantId, p.age, p.gender, p.seekingGender, p.ageMin, p.ageMax,
        p.lat, p.lon, p.maxDistanceKm, p.intent, p.attributeTags, JSON.stringify(p.traits),
        p.displayName, p.dossier, JSON.stringify(p.quotes),
      ],
    );
    n++;
  }
  return n;
}

export interface QualityReport {
  count: number;
  /** Realised share per value, per axis. Compared against the target marginals. */
  distributions: Record<string, Record<string, number>>;
  /** Share of fields left blank. Too low means the unknown path is never tested. */
  missingRate: number;
  /** Distinct interest combinations over the pool. Low means mode collapse. */
  distinctInterestSets: number;
}

/**
 * The gates. Numbers, not impressions.
 *
 * A synthetic pool that has quietly collapsed looks completely fine from a distance —
 * every profile reads as a plausible person. The only way to catch it is to measure
 * the spread and fail on it.
 */
export function assess(profiles: readonly SyntheticProfile[]): QualityReport {
  const axes = ['gender', 'diet', 'relationship_intent', 'works_in', 'education_level'];
  const distributions: Record<string, Record<string, number>> = {};

  for (const axis of axes) {
    const counts: Record<string, number> = {};
    for (const p of profiles) {
      const v = String(p.traits[axis] ?? 'missing');
      counts[v] = (counts[v] ?? 0) + 1;
    }
    distributions[axis] = Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, Number((v / profiles.length).toFixed(3))]),
    );
  }

  // The neighbourhood is not one of the eighteen sampled fields: it is placed after the
  // holes (like lives_in, which the eighteen already count) and only for Bangalore, so
  // counting it would move the hole rate for a reason that has nothing to do with holes.
  const totalFields = profiles.reduce((a, p) => a + Object.keys(p.traits).filter((k) => k !== 'area').length, 0);
  const expectedFields = profiles.length * 18;

  const sets = new Set(
    profiles.map((p) =>
      p.attributeTags.filter((t) => t.startsWith('interest:')).sort().join(','),
    ),
  );

  return {
    count: profiles.length,
    distributions,
    missingRate: Number((1 - totalFields / expectedFields).toFixed(3)),
    distinctInterestSets: sets.size,
  };
}
