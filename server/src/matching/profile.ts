/**
 * Building the one indexed row the matcher reads.
 *
 * A CACHE, never a source. Everything here is derived from `facts` and `preferences`,
 * and a full rebuild is always authoritative. It exists because the filter has to be
 * one indexed statement rather than fourteen joins against a hash-partitioned fact
 * table, and because a filter that leaves the database is not a filter.
 *
 * What it deliberately does NOT hold: names, quotes, episodes, prompt answers, or any
 * sentence a person wrote. The matching role can read this table across tenants, so
 * the protection is that there is nothing here worth stealing -- ages, tags, and
 * coordinates rounded to the precision the person actually gave.
 */
import type { PoolClient } from 'pg';
import { MIN_AGE, POOL_REQUIRED, canFilterOn } from '@clone/shared';
// Aliased: this file already has its own REQUIRED -- the five structural answers --
// and importing a second one under the same name silently shadowed it, emptying
// `missing` for every profile. tsc accepted it; a test caught it.
import { REQUIRED as REQUIRED_CONSENTS } from '../api/consent.js';

export interface RebuildResult {
  matchable: number;
  missing: string[];
  inPool: boolean;
}

/** Everything needed before an agent can go out and represent somebody. */
// From shared, so the app cannot offer to skip something the pool insists on. It used
// to be a private array here and the app had its own opinion; see POOL_REQUIRED.
const REQUIRED = POOL_REQUIRED;

export async function rebuildMatchProfile(
  c: PoolClient,
  ctx: { tenantId: string; userId: string },
): Promise<RebuildResult> {
  // Only ACTIVE, owner-or-agent, asserted facts. Migration 0010's CHECK already makes
  // that the only thing that can be active, so this inherits the guarantee for free:
  // a staged paste can never reach the matcher.
  const { rows: facts } = await c.query<{
    predicate: string; object_text: string; object_value: unknown;
  }>(
    `SELECT f.predicate, f.object_text, f.object_value
       FROM facts f JOIN predicates p ON p.name = f.predicate
      WHERE f.user_id = $1 AND f.status = 'active' AND f.valid_to IS NULL
        -- full_name is deliberately NOT matchable -- nobody is filtered on a name --
        -- but it is the one unmatchable predicate this function needs, for the
        -- display name. Without this clause the \`case 'full_name'\` below was dead
        -- code: 5,008 of 5,013 pooled profiles had a name and every one of them was
        -- invented, while every real human rendered as "Someone".
        AND (p.matchable OR p.name = 'full_name')`,
    [ctx.userId],
  );

  const traits: Record<string, unknown> = {};
  const tags: string[] = [];
  let lat: number | null = null;
  let lon: number | null = null;
  let age: number | null = null;
  let ageMin: number | null = null;
  let ageMax: number | null = null;
  let maxDistance: number | null = null;
  const seeking: string[] = [];
  const intent: string[] = [];
  let gender: string | null = null;
  let displayName: string | null = null;

  for (const f of facts) {
    const v = f.object_value;
    if (v === null || v === undefined) continue;

    switch (f.predicate) {
      case 'gender':
        gender = String(v);
        break;
      case 'full_name':
        // First name only, and it stops here. The rest of the name never reaches the
        // matching role, so a person who has not decided whether to meet you cannot
        // be looked up before they do.
        displayName = String(v).trim().split(/\s+/)[0] ?? null;
        // `continue`, not `break`: the line after the switch back-fills every string
        // value into traits, and a name must never become something a preference can
        // be tested against or a tag two people are compared on.
        continue;
      case 'seeking_gender':
        seeking.push(String(v));
        break;
      case 'relationship_intent':
        intent.push(String(v));
        break;
      case 'max_distance_km':
        maxDistance = Number(v);
        break;
      case 'age_range_sought': {
        const r = v as { min?: number; max?: number };
        ageMin = r.min ?? null;
        ageMax = r.max ?? null;
        break;
      }
      case 'birth_date': {
        const b = v as { year?: number };
        if (b.year) age = new Date().getUTCFullYear() - b.year;
        break;
      }
      case 'lives_in': {
        const l = v as { lat?: number; lon?: number };
        lat = l.lat ?? null;
        lon = l.lon ?? null;
        break;
      }
      default:
        // Multi-valued predicates become tags; single-valued become traits. Tags are
        // what two people's interests are compared on; traits are what preferences
        // are tested against.
        if (typeof v === 'string') tags.push(`${f.predicate}:${v}`);
        traits[f.predicate] = v;
    }
    if (typeof v === 'string' && !(f.predicate in traits)) traits[f.predicate] = v;
  }

  // `string[]`, not the REQUIRED tuple's own element type: 'consent' goes on this
  // list too, a few lines down, and it is not one of the five fields. Inferring the
  // narrow type here made that push a type error that `tsc -b` was caching away.
  const missing: string[] = REQUIRED.filter((p) => {
    if (p === 'gender') return !gender;
    if (p === 'seeking_gender') return seeking.length === 0;
    if (p === 'birth_date') return age === null;
    if (p === 'lives_in') return lat === null;
    if (p === 'relationship_intent') return intent.length === 0;
    return false;
  });

  // An agent that cannot answer the five questions every candidate query asks would
  // be matched with everybody or nobody. It waits outside the pool until it can.
  //
  // The age term is not one of the five and is not negotiable. `commit` already
  // refuses to store a birth year below the limit, so reaching this with one means
  // something upstream changed -- a relaxed schema, a direct write, a restored dump.
  // The pool is the last gate before a person is shown to strangers, so it repeats
  // the check instead of trusting that the earlier one ran. An unknown age is treated
  // as failing, not as missing: `age === null` already fails the REQUIRED list above,
  // and this makes that explicit rather than incidental.
  const adult = age !== null && age >= MIN_AGE;

  // CONSENT IS A POOL CONDITION, not a screen somebody can skip. A record of
  // agreement that does not gate anything is decoration: it proves only that a
  // dialog was rendered. An agent going out to meet strangers on behalf of somebody
  // who never accepted the terms is the exact thing the record is supposed to be
  // evidence about, so the two are wired together here.
  const { rows: consented } = await c.query<{ n: string }>(
    `SELECT count(*) AS n FROM consents
      WHERE user_id = $1 AND (document, version) IN (${
        REQUIRED_CONSENTS.map((_, i) => `($${i * 2 + 2}, $${i * 2 + 3})`).join(', ')
      })`,
    [ctx.userId, ...REQUIRED_CONSENTS.flatMap((r) => [r.document, r.version])],
  );
  const agreed = Number(consented[0]!.n) === REQUIRED_CONSENTS.length;
  if (!agreed) missing.push('consent');

  const inPool = missing.length === 0 && adult;

  await c.query(
    `INSERT INTO match_profile (
       user_id, tenant_id, age, gender, seeking_gender, age_min, age_max,
       lat, lon, max_distance_km, intent, attribute_tags, traits, in_pool,
       display_name, rebuilt_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
     ON CONFLICT (user_id) DO UPDATE SET
       age = EXCLUDED.age, gender = EXCLUDED.gender,
       seeking_gender = EXCLUDED.seeking_gender,
       age_min = EXCLUDED.age_min, age_max = EXCLUDED.age_max,
       lat = EXCLUDED.lat, lon = EXCLUDED.lon,
       max_distance_km = EXCLUDED.max_distance_km,
       intent = EXCLUDED.intent, attribute_tags = EXCLUDED.attribute_tags,
       traits = EXCLUDED.traits, in_pool = EXCLUDED.in_pool,
       -- Never overwrite a name with nothing. A rebuild that ran before the person
       -- told us their name would otherwise blank it on every later pass.
       display_name = coalesce(EXCLUDED.display_name, match_profile.display_name),
       -- A rebuild only ever happens because the person is here, so it is a heartbeat.
       -- This column was previously written once at insert and never again, which
       -- silently dropped every profile out of everyone else's pool sixty days after
       -- signup while its owner went on using the app.
       last_active_at = now(),
       rebuilt_at = now()`,
    [
      ctx.userId, ctx.tenantId, age, gender, seeking, ageMin, ageMax,
      lat, lon, maxDistance, intent, tags, JSON.stringify(traits), inPool, displayName,
    ],
  );

  return { matchable: Object.keys(traits).length, missing, inPool };
}

/**
 * "They were here." The cheapest write in the system, and the one the activity
 * filter depends on.
 *
 * Called from the two routes a person hits when they are actually looking -- the
 * matches list and the send-my-agent-out button -- so the sixty-day window measures
 * looking, not signing up. Every rebuild stamps it too; this is for the paths that do
 * not rebuild. Runs as the owner under RLS, so it can touch exactly one row.
 */
export async function touchActive(c: PoolClient, userId: string): Promise<void> {
  await c.query('UPDATE match_profile SET last_active_at = now() WHERE user_id = $1', [userId]);
}

/**
 * Record a preference: what somebody wants in another person.
 *
 * Separate from a fact on purpose. A fact answers "what is true of you"; a preference
 * answers "what would you accept in somebody else", and it needs an operator and a
 * strength that a fact has no use for. Collapsing them means every matching query has
 * to guess which rows describe the user and which describe an imagined partner.
 */
/** Thrown for a dealbreaker on a predicate the candidate query cannot test. */
export class PreferenceCannotFilter extends Error {
  constructor(public readonly predicate: string) {
    super(`a dealbreaker on '${predicate}' cannot exclude anybody`);
  }
}

export async function setPreference(
  c: PoolClient,
  ctx: { tenantId: string; userId: string },
  pref: {
    predicate: string;
    operator: string;
    value: unknown;
    strength: 'dealbreaker' | 'strong' | 'mild';
    sourceQuote?: string;
  },
): Promise<void> {
  // A DEALBREAKER THAT CANNOT EXCLUDE ANYBODY IS REFUSED, not stored. The candidate
  // query tests dealbreakers against the other person's traits, and a predicate that
  // never reaches traits -- no value shape, or routed to its own column -- passed for
  // everyone, silently, for ever. The person believed they had drawn a line. Nothing
  // had. Saying so at the moment they draw it is the only honest response.
  if (pref.strength === 'dealbreaker' && !canFilterOn(pref.predicate)) {
    throw new PreferenceCannotFilter(pref.predicate);
  }
  await c.query(
    `INSERT INTO preferences (tenant_id, user_id, predicate, operator, value, strength, source_quote)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id, predicate, operator) WHERE retired_at IS NULL
     DO UPDATE SET value = EXCLUDED.value, strength = EXCLUDED.strength,
                   source_quote = EXCLUDED.source_quote`,
    [ctx.tenantId, ctx.userId, pref.predicate, pref.operator,
     JSON.stringify(pref.value), pref.strength, pref.sourceQuote ?? ''],
  );
}
