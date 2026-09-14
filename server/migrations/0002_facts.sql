-- 0002_facts: TIER 1. The product.
--
-- Design principle: CURRENT STATE IS A SQL QUERY, not a vector search. Nearest
-- neighbour returns the most SIMILAR fact, not the currently TRUE one -- a system
-- that retrieves the most recently stated preference returns exactly the
-- pre-evolution distractor. Vector search stays in Tier 0 for episodic recall.

CREATE TABLE predicates (
  name         text PRIMARY KEY,
  tier         text NOT NULL CHECK (tier IN ('core', 'open')),
  cardinality  text NOT NULL CHECK (cardinality IN ('single', 'multi')),
  durability   text NOT NULL CHECK (durability IN ('hard', 'soft')),
  -- Joined on in the deferred matchmaking phase. Free to carry now, brutal to
  -- retrofit over a year of accumulated facts.
  matchable    boolean NOT NULL DEFAULT false
);

CREATE TABLE facts (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  user_id             uuid NOT NULL,

  subject_entity_id   uuid NOT NULL,
  predicate           text NOT NULL REFERENCES predicates(name),
  -- Denormalised from predicates FOR THE INDEX: a partial unique index cannot
  -- reference another table, so this column is what makes G1 enforceable in the
  -- database rather than in application code.
  is_single_valued    boolean NOT NULL,
  object_text         text NOT NULL,          -- VERBATIM. never generalised.
  object_value        jsonb,

  -- Bi-temporal. valid_* is WORLD time (when it was true of the person);
  -- recorded_at / invalidated_at is SYSTEM time (when we learned it).
  -- valid_from is a required INPUT, never inferred: "Leave both fields null if no
  -- explicit or resolvable time is stated. Do NOT hallucinate or infer dates."
  valid_from          timestamptz,
  valid_to            timestamptz,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  invalidated_at      timestamptz,

  status              text NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged','active','superseded','retracted','needs_recheck','quarantined')),
  supersedes_id       uuid,
  superseded_by_id    uuid,

  -- Governance. Every one of these gates a commit rule; none is decoration.
  origin_class        text NOT NULL DEFAULT 'untrusted'
    CHECK (origin_class IN ('owner','agent','untrusted','system')),
  stance              text NOT NULL
    CHECK (stance IN ('asserted','hedged','hypothetical','reported','negated')),
  hedge_span          text,                   -- the hedge, VERBATIM. never dropped.
  source_quote        text NOT NULL,          -- VERBATIM
  source_episode_ids  uuid[] NOT NULL,
  corroboration_count smallint NOT NULL DEFAULT 1,
  extractor_model     text NOT NULL,
  extractor_version   text NOT NULL,
  prompt_version      text NOT NULL,

  -- Promotion signal. Deliberately NOT a write-time confidence float: a model's
  -- own confidence is the weakest available signal. A fact graduates into the core
  -- profile because it kept being USEFUL, which is observed and self-correcting.
  retrieval_count     int NOT NULL DEFAULT 0,
  used_in_reply_count int NOT NULL DEFAULT 0,
  last_retrieved_at   timestamptz,
  importance          smallint,

  embedding           halfvec(768),           -- open tier only
  embedding_model     text,
  embedding_version   smallint,
  fts                 tsvector GENERATED ALWAYS AS (to_tsvector('english', object_text)) STORED,

  PRIMARY KEY (id, user_id)
) PARTITION BY HASH (user_id);

DO $$ BEGIN
  FOR i IN 0..31 LOOP
    EXECUTE format(
      'CREATE TABLE facts_p%s PARTITION OF facts FOR VALUES WITH (MODULUS 32, REMAINDER %s)',
      i, i);
  END LOOP;
END $$;

-- ─── THE SINGLE MOST IMPORTANT LINE IN THIS ARCHITECTURE ─────────────────────
-- A new works_at CANNOT coexist with the old one, even if the extractor never
-- noticed the contradiction. Cost per turn: $0. Reliability: 100%.
--
-- LLM update passes measure ~100% on action-type conflicts and ~50% on restraint.
-- current_city / current_employer / relationship_status are single-valued and are
-- exactly the fields that matter here -- so the database decides them, not a model.
CREATE UNIQUE INDEX facts_single_valued_current ON facts
  (tenant_id, user_id, subject_entity_id, predicate)
  WHERE status = 'active' AND valid_to IS NULL AND is_single_valued;

-- The current-state read. Plain SQL, no ANN, ever.
CREATE INDEX facts_current_state ON facts (tenant_id, user_id, predicate)
  WHERE status = 'active' AND valid_to IS NULL;

CREATE INDEX facts_lineage  ON facts (user_id, superseded_by_id) WHERE superseded_by_id IS NOT NULL;
CREATE INDEX facts_fts      ON facts USING gin (fts);
CREATE INDEX facts_embedding ON facts
  USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Every mutation, append-only. The rollback path after a bad model swap, and the
-- evidence for what the extractor actually did.
CREATE TABLE memory_audit (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  user_id        uuid NOT NULL,
  fact_id        uuid,
  op             text NOT NULL,
  before         jsonb,
  after          jsonb,
  actor          text NOT NULL,
  model          text,
  prompt_version text,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memory_audit_user ON memory_audit (user_id, at DESC);

-- The conflicts queue. THE PRIMARY user-facing quality mechanism, not a fallback:
-- it is the only thing in this design that turns a wrong answer into a logged,
-- resolvable event instead of a silent guess.
CREATE TABLE fact_conflicts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  user_id             uuid NOT NULL,
  fact_a_id           uuid NOT NULL,
  fact_b_id           uuid,
  kind                text NOT NULL,
  clarifying_question text NOT NULL,
  detected_at         timestamptz NOT NULL DEFAULT now(),
  asked_at            timestamptz,
  status              text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','asked','resolved','dismissed')),
  resolved_at         timestamptz,
  resolution          text
);
CREATE INDEX fact_conflicts_open ON fact_conflicts (user_id, status) WHERE status = 'open';

-- Session extraction bookkeeping: which sessions P1 has already processed.
CREATE TABLE session_extractions (
  tenant_id     uuid NOT NULL,
  user_id       uuid NOT NULL,
  session_id    uuid NOT NULL,
  last_turn_index int NOT NULL,
  extracted_at  timestamptz NOT NULL DEFAULT now(),
  facts_staged  int NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, user_id, session_id)
);

-- RLS, same discipline as 0001.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facts','memory_audit','fact_conflicts','session_extractions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY %I_isolation ON %I
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
           AND user_id   = NULLIF(current_setting('app.user_id',   true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
                AND user_id   = NULLIF(current_setting('app.user_id',   true), '')::uuid)
    $f$, t, t);
  END LOOP;
END $$;

-- predicates is a shared read-only vocabulary, not tenant data.
GRANT SELECT ON predicates TO clone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON facts, memory_audit, fact_conflicts, session_extractions TO clone_app;
GRANT USAGE, SELECT ON SEQUENCE memory_audit_id_seq TO clone_app;
