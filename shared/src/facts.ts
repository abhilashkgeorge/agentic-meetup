/**
 * The fact vocabulary. The spine of the product.
 *
 * Two tiers, reconciling a real tension: a CLOSED predicate vocabulary is what makes
 * the current-state read plain SQL and makes later matchmaking cross-user comparable,
 * while the anti-generalisation rule forbids flattening "Gamecube" into "gaming
 * console". They are reconciled by scope:
 *
 *   the closed vocabulary constrains the PREDICATE; anti-generalisation constrains
 *   the OBJECT, which is always stored verbatim.
 */
import { z } from 'zod';

/** Whether a second value can coexist. Drives the partial unique index. */
export const Cardinality = z.enum(['single', 'multi']);
/** 'hard' facts are not weakened by a single anecdote. */
export const Durability = z.enum(['hard', 'soft']);

/**
 * How the user said it. Only 'asserted' may become a standing fact (commit gate G4).
 * "I might quit my job" is 'hypothetical' and must never register as a job change.
 */
export const Stance = z.enum(['asserted', 'hedged', 'hypothetical', 'reported', 'negated']);

/**
 * Who authored it. 'untrusted' is excluded STRUCTURALLY, before the prompt is built --
 * never merely score-penalised (gate G3). Needed on day one because in the
 * matchmaking phase facts arrive from other users' agents: an adversarial source.
 */
export const OriginClass = z.enum(['owner', 'agent', 'untrusted', 'system']);

export const FactStatus = z.enum([
  'staged',        // extracted, not yet a belief. A write is not a belief commit.
  'active',
  'superseded',
  'retracted',
  'needs_recheck',
  'quarantined',
]);

export type Cardinality = z.infer<typeof Cardinality>;
export type Durability = z.infer<typeof Durability>;
export type Stance = z.infer<typeof Stance>;
export type OriginClass = z.infer<typeof OriginClass>;
export type FactStatus = z.infer<typeof FactStatus>;

export interface PredicateDef {
  name: string;
  cardinality: Cardinality;
  durability: Durability;
  /** Joined on in the deferred matchmaking phase. Free to carry now, brutal to retrofit. */
  matchable: boolean;
}

/**
 * What an agent may volunteer about its human to a stranger's agent, BY DEFAULT.
 *
 * The column exists on `facts` with a safe default of `matchable_only`, and nothing
 * ever moved a fact off it -- so every agent went into every rendezvous with an empty
 * dossier and agreed pleasantly about nobody. The default has to be per predicate,
 * because "what may be said" is a property of the KIND of thing, not of the row.
 *
 * The list below is the part a person would expect to be on a dating profile. What is
 * missing from it matters more than what is in it: religion, politics, health,
 * allergies, ethnicity, income, body, employer, family. Those are `matchable_only` --
 * they can still decide a match, and the agent may not bring them up.
 *
 * Anyone can move any of their own facts in either direction. This is the starting
 * point, and it is the conservative one.
 */
export const PUBLIC_BY_DEFAULT: ReadonlySet<string> = new Set([
  'preferred_name', 'lives_in', 'languages',
  'industry', 'works_in', 'education_level',
  'interest', 'dislikes', 'goal', 'value',
  'media_taste', 'pet', 'prompt_answer',
  'relationship_intent', 'seeking', 'wants_children', 'monogamy_stance',
  'exercise_habit', 'diet', 'dietary_restriction', 'sleep_pattern',
  'transport', 'relocation_openness', 'communication_style',
  // Open-tier texture: what they are into, what they did, what they think. This is
  // most of what makes a conversation sound like a person.
  'topic', 'did', 'believes',
]);

/**
 * NEVER volunteered, whatever anybody sets. An agent that can be talked into
 * disclosing somebody's medical history is a headline, not a bug report, so the
 * ceiling is enforced rather than defaulted.
 */
export const NEVER_PUBLIC: ReadonlySet<string> = new Set([
  'medical_condition', 'allergy', 'religion', 'politics', 'ethnicity',
  'full_name', 'birth_date', 'works_at', 'has_children', 'close_to', 'lives_with',
  'relationship_status', 'drugs',
]);

/** The disclosure a fact starts at. */
export const defaultDisclosure = (predicate: string): 'public' | 'matchable_only' =>
  !NEVER_PUBLIC.has(predicate) && PUBLIC_BY_DEFAULT.has(predicate)
    ? 'public'
    : 'matchable_only';

/**
 * The closed core (~40). Every `single` entry is protected by the partial unique
 * index, which makes its supersession 100% reliable at $0 per turn with no prompt
 * engineering -- the strongest component in the system needs no LLM at all.
 */
export const CORE_PREDICATES: readonly PredicateDef[] = [
  // identity & situation
  { name: 'full_name',            cardinality: 'single', durability: 'hard', matchable: false },
  { name: 'preferred_name',       cardinality: 'single', durability: 'soft', matchable: false },
  { name: 'birth_date',           cardinality: 'single', durability: 'hard', matchable: true },
  { name: 'pronouns',             cardinality: 'single', durability: 'hard', matchable: false },
  { name: 'lives_in',             cardinality: 'single', durability: 'hard', matchable: true },
  // Which part of town, from the thirty in areas.ts. Soft: people move across a city,
  // and the pool never insists on it -- it places the agent on the map and sharpens
  // distance matching from the city centre to a neighbourhood centre.
  { name: 'area',                 cardinality: 'single', durability: 'soft', matchable: true },
  { name: 'grew_up_in',           cardinality: 'single', durability: 'hard', matchable: false },
  { name: 'nationality',          cardinality: 'multi',  durability: 'hard', matchable: false },
  { name: 'languages',            cardinality: 'multi',  durability: 'hard', matchable: true },
  // work
  { name: 'works_at',             cardinality: 'single', durability: 'hard', matchable: false },
  { name: 'job_title',            cardinality: 'single', durability: 'hard', matchable: false },
  { name: 'industry',             cardinality: 'single', durability: 'soft', matchable: true },
  { name: 'employment_status',    cardinality: 'single', durability: 'hard', matchable: false },
  { name: 'education',            cardinality: 'multi',  durability: 'hard', matchable: false },
  // relationships
  { name: 'relationship_status',  cardinality: 'single', durability: 'hard', matchable: true },
  { name: 'has_children',         cardinality: 'single', durability: 'hard', matchable: true },
  { name: 'lives_with',           cardinality: 'multi',  durability: 'soft', matchable: false },
  { name: 'close_to',             cardinality: 'multi',  durability: 'soft', matchable: false },
  { name: 'seeking',              cardinality: 'single', durability: 'soft', matchable: true },
  // constraints - the ones where being wrong is dangerous, not just embarrassing
  { name: 'allergy',              cardinality: 'multi',  durability: 'hard', matchable: true },
  { name: 'dietary_restriction',  cardinality: 'multi',  durability: 'hard', matchable: true },
  { name: 'medical_condition',    cardinality: 'multi',  durability: 'hard', matchable: false },
  { name: 'dealbreaker',          cardinality: 'multi',  durability: 'hard', matchable: true },
  { name: 'hard_constraint',      cardinality: 'multi',  durability: 'hard', matchable: true },
  { name: 'schedule_constraint',  cardinality: 'multi',  durability: 'soft', matchable: false },
  // texture
  { name: 'interest',             cardinality: 'multi',  durability: 'soft', matchable: true },
  { name: 'dislikes',             cardinality: 'multi',  durability: 'soft', matchable: true },
  { name: 'value',                cardinality: 'multi',  durability: 'soft', matchable: true },
  { name: 'goal',                 cardinality: 'multi',  durability: 'soft', matchable: true },
  { name: 'communication_style',  cardinality: 'single', durability: 'soft', matchable: false },
  { name: 'religion',             cardinality: 'single', durability: 'soft', matchable: true },
  { name: 'politics',             cardinality: 'single', durability: 'soft', matchable: true },
  { name: 'smoking',              cardinality: 'single', durability: 'soft', matchable: true },
  { name: 'drinking',             cardinality: 'single', durability: 'soft', matchable: true },
  { name: 'exercise_habit',       cardinality: 'single', durability: 'soft', matchable: true },
  { name: 'pet',                  cardinality: 'multi',  durability: 'soft', matchable: true },

  // ── dating: the five that may exclude ───────────────────────────────────
  // The ONLY attributes allowed to remove somebody from consideration, and only
  // because a mismatch wastes an evening for both people rather than merely
  // disappointing one. Everything else below adds points.
  { name: 'gender',               cardinality: 'single', durability: 'hard', matchable: true },
  { name: 'seeking_gender',       cardinality: 'multi',  durability: 'hard', matchable: true },
  { name: 'age_range_sought',     cardinality: 'single', durability: 'hard', matchable: true },
  { name: 'max_distance_km',      cardinality: 'single', durability: 'soft', matchable: true },
  { name: 'relationship_intent',  cardinality: 'single', durability: 'hard', matchable: true },

  // ── dating: rank only ───────────────────────────────────────────────────
  // A want that matters enormously is a `strong` preference, never a filter. Filters
  // multiply down and reach zero; points add up and never do.
  { name: 'monogamy_stance',      cardinality: 'single', durability: 'hard', matchable: true },
  { name: 'wants_children',       cardinality: 'single', durability: 'hard', matchable: true },
  { name: 'height_cm',            cardinality: 'single', durability: 'hard', matchable: true },
  { name: 'body_type',            cardinality: 'single', durability: 'soft', matchable: true },
  { name: 'ethnicity',            cardinality: 'multi',  durability: 'hard', matchable: true },
  { name: 'religion_importance',  cardinality: 'single', durability: 'soft', matchable: true },
  { name: 'politics_importance',  cardinality: 'single', durability: 'soft', matchable: true },
  { name: 'diet',                 cardinality: 'single', durability: 'hard', matchable: true },
  { name: 'drugs',                cardinality: 'single', durability: 'soft', matchable: true },
  { name: 'education_level',      cardinality: 'single', durability: 'hard', matchable: true },
  // The FIELD someone works in, as a tag. Separate from `works_at` (the employer,
  // which identifies them) and `industry` (free text). "wants someone in AI" joins
  // on this.
  { name: 'works_in',             cardinality: 'multi',  durability: 'soft', matchable: true },
  { name: 'nationality_origin',   cardinality: 'multi',  durability: 'hard', matchable: true },
  { name: 'media_taste',          cardinality: 'multi',  durability: 'soft', matchable: true },
  { name: 'transport',            cardinality: 'multi',  durability: 'soft', matchable: true },
  { name: 'spending_style',       cardinality: 'single', durability: 'soft', matchable: true },
  { name: 'sleep_pattern',        cardinality: 'single', durability: 'soft', matchable: true },
  { name: 'relocation_openness',  cardinality: 'single', durability: 'soft', matchable: true },
  // Three sentence-stems in the person's own words. The only free text an agent
  // reasons over, and the only part of a profile that sounds like a person.
  { name: 'prompt_answer',        cardinality: 'multi',  durability: 'soft', matchable: false },
] as const;

/**
 * The open tier. Free-text objects, vector-indexed, NEVER queried by SQL, always
 * multi-valued. This is the escape hatch that keeps the closed vocabulary honest.
 */
export const OPEN_PREDICATES = ['topic', 'owns', 'did', 'believes'] as const;

export const CORE_PREDICATE_NAMES = CORE_PREDICATES.map((p) => p.name);
export const SINGLE_VALUED = new Set(
  CORE_PREDICATES.filter((p) => p.cardinality === 'single').map((p) => p.name),
);

/**
 * What someone wants their clone FOR. Closed vocabulary, because the whole point is
 * to aggregate — free text would not roll up.
 *
 * Collected from v1 so that the deferred "which cluster do we recruit" question is
 * settled by who actually showed up rather than by a guess made today.
 */
export const INTENTS = [
  'companionship',    // they just want to talk
  'introspection',    // understanding themselves, working something out
  'memory_recall',    // asking the clone what it knows, using it as a record
  'advice',           // asking it to weigh in on a decision
  'romance',          // partners, dating, a relationship
  'professional',     // work, hiring, collaborators, co-founders
  'local_services',   // finding someone who does a thing nearby
  'task',             // do something for me
  'testing',          // probing the system rather than using it
] as const;

export type Intent = (typeof INTENTS)[number];
