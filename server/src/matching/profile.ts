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

export interface RebuildResult {
  matchable: number;
  missing: string[];
  inPool: boolean;
}

/** Everything needed before an agent can go out and represent somebody. */
const REQUIRED = ['gender', 'seeking_gender', 'birth_date', 'lives_in', 'relationship_intent'];

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
        AND p.matchable`,
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
        break;
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

  const missing = REQUIRED.filter((p) => {
    if (p === 'gender') return !gender;
    if (p === 'seeking_gender') return seeking.length === 0;
    if (p === 'birth_date') return age === null;
    if (p === 'lives_in') return lat === null;
    if (p === 'relationship_intent') return intent.length === 0;
    return false;
  });

  // An agent that cannot answer the five questions every candidate query asks would
  // be matched with everybody or nobody. It waits outside the pool until it can.
  const inPool = missing.length === 0;

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
       rebuilt_at = now()`,
    [
      ctx.userId, ctx.tenantId, age, gender, seeking, ageMin, ageMax,
      lat, lon, maxDistance, intent, tags, JSON.stringify(traits), inPool, displayName,
    ],
  );

  return { matchable: Object.keys(traits).length, missing, inPool };
}

/**
 * Record a preference: what somebody wants in another person.
 *
 * Separate from a fact on purpose. A fact answers "what is true of you"; a preference
 * answers "what would you accept in somebody else", and it needs an operator and a
 * strength that a fact has no use for. Collapsing them means every matching query has
 * to guess which rows describe the user and which describe an imagined partner.
 */
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
