/**
 * TIER 1. Fact commit and current-state read.
 *
 * The write path is deliberately dumb. Supersession for single-valued predicates is
 * decided by a UNIQUE INDEX, not by a model: LLM update passes measure roughly 100%
 * on action-type conflicts but only ~50% on restraint, and the fields that matter
 * here -- lives_in, works_at, relationship_status -- are single-valued. So the
 * database enforces them at $0 per turn with 100% reliability, and the model is only
 * asked about genuinely multi-valued predicates (that arrives in W4, pass P2).
 *
 * A WRITE IS NOT A BELIEF COMMIT. Candidates land as `staged` unless they clear the
 * gates. Measured downstream failure rises from 45.0% to 71.9% once unverified
 * content is committed to durable memory, so the default is to stage, not to assert.
 */
import type { PoolClient } from 'pg';
import {
  MIN_AGE, SINGLE_VALUED, defaultDisclosure, deriveValue, isAdult,
  type OriginClass, type Stance,
} from '@clone/shared';

export interface FactCandidate {
  predicate: string;
  /** VERBATIM. Never generalised: 'Gamecube' stays 'Gamecube'. */
  objectText: string;
  objectValue?: unknown;
  /** WORLD time. Null when the user stated no resolvable time -- never inferred. */
  validFrom?: Date | null;
  stance: Stance;
  /** The hedge itself, verbatim. Dropping it is how a casual remark becomes a
   *  confident standing fact -- measured at 5/5 on one library, 0/5 for a control. */
  hedgeSpan?: string | undefined;
  sourceQuote: string;
  sourceEpisodeIds: string[];
  originClass: OriginClass;
  extractorModel: string;
  extractorVersion: string;
  promptVersion: string;
  /** What an agent may volunteer about it. Defaults from the predicate. */
  disclosure?: 'public' | 'matchable_only' | 'private';
}

export interface CommitResult {
  factId: string | null;
  outcome: 'asserted' | 'superseded' | 'corroborated' | 'staged' | 'rejected';
  supersededFactId?: string;
  reason?: string;
}

export interface Fact {
  id: string;
  predicate: string;
  objectText: string;
  stance: Stance;
  status: string;
  validFrom: Date | null;
  validTo: Date | null;
  recordedAt: Date;
  supersededById: string | null;
  corroborationCount: number;
}

/** Only an asserted, first-party statement may become a standing fact (gate G4). */
/**
 * G4, corrected. Two conditions, not one: the claim must be ASSERTED rather than
 * reported, AND it must come from a source entitled to assert. Stance alone was the
 * whole gate, which meant an untrusted source that phrased something confidently got
 * a live belief -- and through the single-valued index, retired a true one.
 *
 * A friend correcting your clone and a stranger's agent describing you are both
 * untrusted. They can raise a question. They cannot change what you believe.
 * Migration 0010 enforces the same rule in the database.
 */
function passesStanceGate(c: FactCandidate): boolean {
  return c.stance === 'asserted' && (c.originClass === 'owner' || c.originClass === 'agent');
}

/**
 * Commit one candidate. The whole function runs inside the caller's transaction, so
 * retire-old + assert-new is atomic (gate G6): there is no instant at which a user
 * has two live values for a single-valued predicate, and no instant at which they
 * have none.
 */
export async function commit(
  c: PoolClient,
  ctx: { tenantId: string; userId: string },
  cand: FactCandidate,
): Promise<CommitResult> {
  const meta = await c.query<{ cardinality: string; durability: string }>(
    'SELECT cardinality, durability FROM predicates WHERE name = $1',
    [cand.predicate],
  );
  if (!meta.rowCount) {
    // A predicate outside the vocabulary is an extractor bug, not a new fact. The
    // open tier ('topic', 'owns', 'did', 'believes') is the sanctioned escape hatch.
    return { factId: null, outcome: 'rejected', reason: `unknown predicate '${cand.predicate}'` };
  }
  const isSingle = meta.rows[0]!.cardinality === 'single';

  // THE AGE GATE, and it lives here because here is the only place every write path
  // passes through. Typing a year into setup, editing it on the profile, an import,
  // and the extractor reading it out of a sentence all end at this function -- so a
  // check at any one of them is a check somebody can walk around.
  //
  // It refuses the fact rather than clamping or ignoring it. A stored birth year that
  // the pool then declines to use would leave a minor with an account, a profile and
  // photos, which is most of the harm with none of the record.
  if (cand.predicate === 'birth_date') {
    const value = (cand.objectValue ?? null) as { year?: number; month?: number | null } | null;
    const year = typeof value?.year === 'number' ? value.year : Number(cand.objectText);
    const parsed = Number.isInteger(year) ? { year, month: value?.month ?? null } : null;
    if (!isAdult(parsed)) {
      return {
        factId: null,
        outcome: 'rejected',
        reason: `birth_date below the minimum age of ${MIN_AGE}`,
      };
    }
  }

  // G4: stance. Hedged, hypothetical, reported and negated statements are recorded
  // but never asserted. "I might quit my job" is not a job change.
  const status = passesStanceGate(cand) ? 'active' : 'staged';

  // Is this already what we believe? Then it is corroboration, not a change.
  // Without this, restating a fact would churn the lineage and inflate the
  // supersession history with self-supersessions.
  const existing = await c.query<{
    id: string; object_text: string; object_value: unknown; corroboration_count: number;
  }>(
    `SELECT id, object_text, object_value, corroboration_count FROM facts
      WHERE user_id = $1 AND predicate = $2 AND status = 'active' AND valid_to IS NULL
      ORDER BY recorded_at DESC`,
    [ctx.userId, cand.predicate],
  );

  const same = existing.rows.find(
    (r) => r.object_text.trim().toLowerCase() === cand.objectText.trim().toLowerCase(),
  );
  if (same) {
    // Restating the same words is corroboration -- UNLESS it arrives carrying a
    // structured value the stored row is missing or disagrees on. A city typed into
    // setup ("Bangalore" -> coordinates) restates a word the extractor already saved
    // from a sentence with no value attached; treating that as mere corroboration is
    // how somebody enters their city, sees it on their profile, and still has an agent
    // that "does not know where they are" -- the first, value-less mention winning for
    // ever. Fill it in. Never the other way: a value-less restatement does not wipe a
    // value that is already there.
    const newVal = cand.objectValue ?? null;
    const fills =
      newVal !== null &&
      JSON.stringify(same.object_value ?? null) !== JSON.stringify(newVal);
    await c.query(
      `UPDATE facts SET corroboration_count = corroboration_count + 1,
                        source_episode_ids = source_episode_ids || $3::uuid[]${
                          fills ? ',\n                        object_value = $4::jsonb' : ''
                        }
        WHERE id = $1 AND user_id = $2`,
      fills
        ? [same.id, ctx.userId, cand.sourceEpisodeIds, JSON.stringify(newVal)]
        : [same.id, ctx.userId, cand.sourceEpisodeIds],
    );
    await audit(c, ctx, same.id, 'corroborate', null,
      { count: same.corroboration_count + 1, ...(fills ? { filledValue: true } : {}) }, cand);
    return { factId: same.id, outcome: 'corroborated' };
  }

  const newId = crypto.randomUUID();
  let supersededFactId: string | undefined;

  // G1: single-valued supersession. The unique index makes coexistence impossible;
  // this UPDATE is what keeps the index satisfiable, and it must precede the INSERT.
  if (isSingle && status === 'active') {
    const prior = existing.rows[0];
    if (prior) {
      await c.query(
        `UPDATE facts
            SET valid_to = now(), invalidated_at = now(),
                status = 'superseded', superseded_by_id = $3
          WHERE id = $1 AND user_id = $2`,
        [prior.id, ctx.userId, newId],
      );
      supersededFactId = prior.id;
      await audit(c, ctx, prior.id, 'supersede', { objectText: prior.object_text },
        { supersededBy: newId }, cand);
    }
  }

  await c.query(
    `INSERT INTO facts (
       id, tenant_id, user_id, subject_entity_id, predicate, is_single_valued,
       object_text, object_value, valid_from, status, supersedes_id,
       origin_class, stance, hedge_span, source_quote, source_episode_ids,
       extractor_model, extractor_version, prompt_version, disclosure)
     VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      newId, ctx.tenantId, ctx.userId, cand.predicate, isSingle,
      // Derived here, from the words, at the moment the fact is written. Never asked
      // of a model: "5'4" and "163cm" and "five foot four" must land on one number
      // for everybody, which is a parsing job, not a judgement call. A value that
      // will not derive is null -- the fact still commits and simply is not matchable
      // yet, which is a question worth asking rather than a write worth refusing.
      cand.objectText,
      JSON.stringify(cand.objectValue ?? deriveValue(cand.predicate, cand.objectText)),
      cand.validFrom ?? null,
      status, supersededFactId ?? null,
      cand.originClass, cand.stance, cand.hedgeSpan ?? null,
      cand.sourceQuote, cand.sourceEpisodeIds,
      cand.extractorModel, cand.extractorVersion, cand.promptVersion,
      // What the agent may volunteer about this, decided by the KIND of thing rather
      // than by the row. The column defaulted to `matchable_only` and nothing ever
      // moved a fact off it, so every dossier came out empty and two agents spent five
      // conversations agreeing about nobody. The person can change any of their own.
      cand.disclosure ?? defaultDisclosure(cand.predicate),
    ],
  );
  await audit(c, ctx, newId, status === 'active' ? 'assert' : 'stage', null,
    { predicate: cand.predicate, objectText: cand.objectText, stance: cand.stance }, cand);

  return {
    factId: newId,
    outcome: supersededFactId ? 'superseded' : status === 'active' ? 'asserted' : 'staged',
    ...(supersededFactId ? { supersededFactId } : {}),
  };
}

/**
 * The current-state read. Plain SQL over the partial index -- no ANN, ever.
 * This is the query the reply prompt is built from.
 */
export async function currentState(
  c: PoolClient,
  userId: string,
  predicates?: readonly string[],
): Promise<Fact[]> {
  const { rows } = await c.query(
    `SELECT id, predicate, object_text, stance, status, valid_from, valid_to,
            recorded_at, superseded_by_id, corroboration_count
       FROM facts
      WHERE user_id = $1 AND status = 'active' AND valid_to IS NULL
        AND ($2::text[] IS NULL OR predicate = ANY($2))
      ORDER BY predicate, recorded_at DESC`,
    [userId, predicates ?? null],
  );
  return rows.map(mapFact);
}

/** Full lineage for one predicate, newest first. The supersession debugger, and
 *  what the profile screen shows when a user taps a fact. */
export async function history(c: PoolClient, userId: string, predicate: string): Promise<Fact[]> {
  const { rows } = await c.query(
    `SELECT id, predicate, object_text, stance, status, valid_from, valid_to,
            recorded_at, superseded_by_id, corroboration_count
       FROM facts WHERE user_id = $1 AND predicate = $2
      ORDER BY recorded_at DESC`,
    [userId, predicate],
  );
  return rows.map(mapFact);
}

function mapFact(r: Record<string, unknown>): Fact {
  return {
    id: r.id as string,
    predicate: r.predicate as string,
    objectText: r.object_text as string,
    stance: r.stance as Stance,
    status: r.status as string,
    validFrom: (r.valid_from as Date | null) ?? null,
    validTo: (r.valid_to as Date | null) ?? null,
    recordedAt: r.recorded_at as Date,
    supersededById: (r.superseded_by_id as string | null) ?? null,
    corroborationCount: r.corroboration_count as number,
  };
}

async function audit(
  c: PoolClient,
  ctx: { tenantId: string; userId: string },
  factId: string,
  op: string,
  before: unknown,
  after: unknown,
  cand: FactCandidate,
): Promise<void> {
  await c.query(
    `INSERT INTO memory_audit (tenant_id, user_id, fact_id, op, before, after,
                               actor, model, prompt_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ctx.tenantId, ctx.userId, factId, op,
     before ? JSON.stringify(before) : null,
     after ? JSON.stringify(after) : null,
     cand.originClass, cand.extractorModel, cand.promptVersion],
  );
}
