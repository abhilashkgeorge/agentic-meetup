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
import { MIN_AGE, POOL_REQUIRED, canFilterOn, findArea, firstName, haversineKm, nearestArea } from '@clone/shared';
// Aliased: this file already has its own REQUIRED -- the five structural answers --
// and importing a second one under the same name silently shadowed it, emptying
// `missing` for every profile. tsc accepted it; a test caught it.
import { REQUIRED as REQUIRED_CONSENTS } from '../api/consent.js';
import { CORE_CARDS, mustHaveAllowed } from '../onboarding/questions.js';

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
    predicate: string; object_text: string; object_value: unknown; extractor_model: string;
  }>(
    `SELECT f.predicate, f.object_text, f.object_value, f.extractor_model
       FROM facts f JOIN predicates p ON p.name = f.predicate
      WHERE f.user_id = $1 AND f.status = 'active' AND f.valid_to IS NULL
        -- first_name is deliberately NOT matchable -- nobody is filtered on a name --
        -- but it is the one unmatchable predicate this function needs, for the
        -- display name.
        AND (p.matchable OR p.name = 'first_name')`,
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
    // THE NAME ANOTHER PERSON SEES, from one place only: the words the person typed on
    // "What should people call you?" (the founder, 2026-09-28). It used to be the first
    // word of a full_name the chat extractor heard -- no screen asked -- so a name said
    // in passing was the word on a stranger's reveal. `commit` refuses a first_name
    // from any writer but the screens; the writer is checked again here, so a row
    // written some other way (a restored dump, a direct insert) still shows nothing.
    // Before the value check: a typed name is words, with no structured value. And it
    // stops here, so a name never becomes a trait a preference is tested against.
    if (f.predicate === 'first_name') {
      if (f.extractor_model === 'direct') displayName = firstName(f.object_text);
      continue;
    }
    const v = f.object_value;
    if (v === null || v === undefined) continue;

    switch (f.predicate) {
      case 'gender':
        gender = String(v);
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
      case 'area':
        // A neighbourhood: a trait the reveal may print and the map places, never a
        // tag two people are compared on and never something a preference tests
        // (canFilterOn refuses it). The point it stands for is applied after the loop.
        traits.area = String(v);
        continue;
      case 'lives_in': {
        const l = v as { city?: string; lat?: number; lon?: number };
        lat = l.lat ?? null;
        lon = l.lon ?? null;
        // The city NAME as well as the point. The reveal prints traits.lives_in and
        // this branch used to keep only the coordinates, so "lives in" was blank for
        // every real person while the invented ones carried a city. Text from the
        // resolved place when there is one, else what the person typed.
        const city = l.city ?? (typeof f.object_text === 'string' ? f.object_text : null);
        if (city) traits.lives_in = city;
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

  // THE NEIGHBOURHOOD SHARPENS THE POINT. lives_in puts everybody in a city on one
  // point -- the city centre -- so two people in Bangalore were always 0 km apart and
  // the 10 km setting meant nothing. A named neighbourhood moves the point to that
  // neighbourhood's centre (about two kilometres of vagueness, where the centre was
  // twenty), but only while the city still agrees: an area kept from a previous
  // city (they moved) must not drag them back.
  if (typeof traits.area === 'string' && lat !== null && lon !== null) {
    const a = findArea(traits.area);
    if (a && haversineKm(lat, lon, a.lat, a.lon) <= 30) { lat = a.lat; lon = a.lon; }
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

  // THE FIVE CORE CARDS ARE A POOL CONDITION TOO. Kids, one person or open, smoking,
  // drinking, food: the fields two people are compared on as exact code, which is only
  // exact when BOTH answered the same five. Without this a person could go out having
  // been asked only the three basics -- before they are in the pool the interview's
  // picker has nothing to measure and never reached these fields (see
  // next-question.ts) -- and then every rule anybody set on them passed that person as
  // unknown, so "passes your rules both ways" said nothing on the fields it is about.
  //
  // DONE means a question_answers row for the card's id, whatever it holds. "Prefer
  // not to say" is done: declining is kept cheap on purpose, because making it costly
  // pays people to lie. The missing list names the card's PREDICATE, like every other
  // entry on it.
  //
  // Invented profiles are untouched by this. They are written straight into
  // match_profile with in_pool = true (synthetic.ts loadProfiles) and never pass
  // through this function, so they carry no question_answers and need none.
  const { rows: cards } = await c.query<{ question_id: string }>(
    `SELECT question_id FROM question_answers WHERE user_id = $1 AND question_id = ANY($2)`,
    [ctx.userId, CORE_CARDS.map((k) => k.id)],
  );
  const done = new Set(cards.map((r) => r.question_id));
  for (const k of CORE_CARDS) if (!done.has(k.id)) missing.push(k.predicate);

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
       -- What the screen says NOW, nothing kept. A name taken off the screen goes, and
       -- one written before 2026-09-28 from a chat-heard full name is cleared by the
       -- next rebuild. (Practice profiles never pass through here: synthetic.ts.)
       display_name = EXCLUDED.display_name,
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
 * Can this person's agent go out NOW? The stored flag, but never trusted past a rule
 * the code has added since it was written.
 *
 * WHAT WAS WRONG. `in_pool` is a cache, and it is current only while every change to
 * what the pool requires arrives through a write that rebuilds it. The five core cards
 * arrived through a code change instead. Everybody who set up before them kept a
 * stored `in_pool = true` with no card on file, and two paths read that stored flag
 * rather than rebuilding: the Home (/v1/world) rebuilt only when the flag said no, and
 * "send my agent out" (/v1/matches/run) queued a round for a worker that reads the same
 * flag (orchestrator.ts). Found in review; a read-only count on 2026-09-23 showed all
 * six real users in the pool with fewer than five card rows, so any of them could send
 * their agent out from the Home without answering a card, and stayed in other people's
 * candidate lists until they happened to open a screen that rebuilds.
 *
 * WHY THIS SHAPE. A flag that says no is always rebuilt -- that is the only time
 * `missing` has anything in it, and it is what the Home already did. A flag that says
 * yes is trusted only while the five cards are on file, which is one count over the
 * caller's own question_answers; when they are not, the rebuild runs, takes the person
 * out, and names the cards still to do. Not a rebuild on every call: the Home polls
 * this every eight seconds while a round runs, and a rebuild is a write.
 *
 * Invented profiles never come through here, as they never come through the rebuild.
 */
export async function poolNow(
  c: PoolClient,
  ctx: { tenantId: string; userId: string },
): Promise<{ inPool: boolean; missing: string[] }> {
  const { rows } = await c.query<{ in_pool: boolean; cards: string }>(
    `SELECT mp.in_pool,
            (SELECT count(*) FROM question_answers q
              WHERE q.user_id = mp.user_id AND q.question_id = ANY($2)) AS cards
       FROM match_profile mp WHERE mp.user_id = $1`,
    [ctx.userId, CORE_CARDS.map((k) => k.id)],
  );
  if (rows[0]?.in_pool && Number(rows[0].cards) === CORE_CARDS.length) {
    return { inPool: true, missing: [] };
  }
  const r = await rebuildMatchProfile(c, ctx);
  return { inPool: r.inPool, missing: r.missing };
}

/**
 * Take every real profile that is in the pool without its five cards out of it, now.
 *
 * `poolNow` corrects a person the next time they open the Home or tap "send my agent
 * out". Somebody who never opens the app again would otherwise stay in other people's
 * candidate lists, cards unanswered, until the sixty-day activity filter drops them.
 * This closes that for everybody at once. It is for scripts/hold-until-cards.ts, which
 * the founder runs; it needs the OWNER connection, because it reads and writes across
 * tenants.
 *
 * ONLY `in_pool`, set to false. Not a rebuild: a rebuild stamps `last_active_at`, and
 * a script run is not the person being here -- it would keep an absent profile
 * "active" for another sixty days. Nothing is deleted. The person's next visit
 * rebuilds from their facts and says which cards are left. Invented profiles are never
 * touched (`NOT is_synthetic`): they carry no cards and need none.
 *
 * `only` scopes it to the given users, which is how the test runs it against its own
 * fixtures and never against the real people sharing the database.
 */
export async function holdUntilCardsDone(
  c: PoolClient,
  opts: { only?: readonly string[]; dry?: boolean } = {},
): Promise<string[]> {
  const { rows } = await c.query<{ user_id: string }>(
    `${opts.dry ? 'SELECT mp.user_id FROM match_profile mp WHERE' : 'UPDATE match_profile mp SET in_pool = false WHERE'}
        NOT mp.is_synthetic AND mp.in_pool
        AND ($1::uuid[] IS NULL OR mp.user_id = ANY($1::uuid[]))
        AND (SELECT count(*) FROM question_answers q
              WHERE q.user_id = mp.user_id AND q.question_id = ANY($2)) < $3
     ${opts.dry ? '' : 'RETURNING mp.user_id'}`,
    [opts.only ?? null, CORE_CARDS.map((k) => k.id), CORE_CARDS.length],
  );
  return rows.map((r) => r.user_id);
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
/**
 * Is "which part of town?" still worth asking? Only a person the map covers (their
 * point is within reach of one of the thirty centres), and only until they have
 * answered or declined -- a "prefer not to say" leaves no fact, so predicate_status
 * is what says so, exactly as for max_distance_km.
 */
export async function shouldAskArea(c: PoolClient, userId: string): Promise<boolean> {
  const { rows } = await c.query<{ lat: number | null; lon: number | null; traits: Record<string, unknown> | null }>(
    'SELECT lat, lon, traits FROM match_profile WHERE user_id = $1', [userId]);
  const p = rows[0];
  if (!p || p.lat === null || p.lon === null) return false;
  if (typeof p.traits?.area === 'string') return false;
  if (nearestArea(p.lat, p.lon) === null) return false;
  const { rows: st } = await c.query(
    `SELECT 1 FROM predicate_status
      WHERE user_id = $1 AND predicate = 'area' AND state IN ('known', 'declined')`, [userId]);
  return st.length === 0;
}

/**
 * Is the first name still worth asking? Until the person has typed one on the screen
 * or said they would rather not. Optional, like the neighbourhood: the pool never waits
 * on it, and a reveal without one says "Someone". Asked in setup, and on the Home for
 * everybody who set up before the screen existed (the founder, 2026-09-28).
 *
 * The fact, not the "known" status, decides "has one": a name taken away again leaves
 * the status behind, and must be asked for again rather than quietly missing. The same
 * fact the rebuild shows -- typed on the screen -- or it is not a name anybody sees.
 */
export async function shouldAskName(c: PoolClient, userId: string): Promise<boolean> {
  const { rows } = await c.query<{ named: boolean; declined: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM facts
                     WHERE user_id = $1 AND predicate = 'first_name' AND extractor_model = 'direct'
                       AND status = 'active' AND valid_to IS NULL) AS named,
            EXISTS (SELECT 1 FROM predicate_status
                     WHERE user_id = $1 AND predicate = 'first_name' AND state = 'declined') AS declined`,
    [userId]);
  return !rows[0]!.named && !rows[0]!.declined;
}

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
  // Only on a tapped answer (questions.ts mustHaveAllowed): a must-have that could hide
  // somebody over a sentence the extractor misread is refused, not stored.
  if (pref.strength === 'dealbreaker' && !mustHaveAllowed(pref.predicate)) {
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
