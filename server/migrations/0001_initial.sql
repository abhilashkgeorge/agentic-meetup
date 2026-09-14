-- 0001_initial: tenancy, episodes (Tier 0), metering, budget.
--
-- Raw SQL is the SOURCE OF TRUTH for the schema, not Drizzle's schema.ts. The
-- things that matter most here -- hash partitioning, RLS policies, partial unique
-- indexes, generated tsvector columns, halfvec + HNSW -- cannot be expressed in
-- Drizzle. schema.ts is a typed VIEW over this file, for query building only.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tenancy --------------------------------------------------------------------
CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       text NOT NULL,
  tier        text NOT NULL DEFAULT 'trial' CHECK (tier IN ('trial', 'paid')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- TIER 0: episodes. Append-only, immutable, vectorised. -----------------------
-- Ground truth, the fallback product, and the only real exit path from any engine.
-- Hash-partitioned on user_id into 32 partitions -- NOT per-tenant LIST, which
-- would mean DDL on every signup and 1000+ relations for autovacuum to track.
CREATE TABLE episodes (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  user_id            uuid NOT NULL,
  session_id         uuid NOT NULL,
  turn_id            uuid NOT NULL,
  turn_index         int  NOT NULL,
  role               text NOT NULL CHECK (role IN ('user', 'assistant')),
  source             text NOT NULL DEFAULT 'text' CHECK (source IN ('text', 'voice')),
  raw_text           text NOT NULL,
  asr_confidence     real,
  asr_low_conf_spans jsonb,
  audio_uri          text,
  occurred_at        timestamptz NOT NULL,
  ingested_at        timestamptz NOT NULL DEFAULT now(),
  -- Embed raw_text || ' ' || extracted_facts at INDEX time. LongMemEval measured
  -- recall@5 of 0.732 for value+facts vs 0.706 raw-only vs 0.642 facts-alone
  -- (condensing loses information), and index-time key merging beat retrieval-time
  -- rank fusion 0.732 vs 0.618.
  embedding          halfvec(768),
  -- REQUIRED once embedded. Embeddings from different models are not comparable,
  -- and a migration without this column is undetectable. Re-embedding a year of
  -- data costs ~$35; doing it blind on 11.7M rows does not.
  embedding_model    text,
  embedding_version  smallint,
  fts                tsvector GENERATED ALWAYS AS (to_tsvector('english', raw_text)) STORED,
  PRIMARY KEY (id, user_id),
  -- The partition key must appear in every unique constraint. This one is also the
  -- idempotency key: a client reconnect can never spawn a second LLM call.
  UNIQUE (user_id, turn_id)
) PARTITION BY HASH (user_id);

DO $$ BEGIN
  FOR i IN 0..31 LOOP
    EXECUTE format(
      'CREATE TABLE episodes_p%s PARTITION OF episodes FOR VALUES WITH (MODULUS 32, REMAINDER %s)',
      i, i);
  END LOOP;
END $$;

CREATE INDEX episodes_session ON episodes (user_id, session_id, turn_index);
CREATE INDEX episodes_fts     ON episodes USING gin (fts);
-- b-tree on the partition key PLUS hnsw on the vector -- deliberately not a
-- multicolumn hnsw. With approximate indexes the tenant filter is applied AFTER
-- the scan, so a selective policy can return too few neighbours; pgvector 0.8's
-- hnsw.iterative_scan = relaxed_order is the mitigation (set in retrieval.ts).
CREATE INDEX episodes_embedding ON episodes
  USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Metering. cost_usd comes from OUR price table, never a library's. ------------
CREATE TABLE llm_calls (
  id                 bigserial PRIMARY KEY,
  tenant_id          uuid NOT NULL,
  user_id            uuid NOT NULL,
  task               text NOT NULL,
  provider           text NOT NULL,
  model              text NOT NULL,
  input_tokens       int  NOT NULL DEFAULT 0,
  cached_read_tokens int  NOT NULL DEFAULT 0,
  cache_write_tokens int  NOT NULL DEFAULT 0,
  output_tokens      int  NOT NULL DEFAULT 0,
  reasoning_tokens   int  NOT NULL DEFAULT 0,
  cost_usd           numeric(12, 6) NOT NULL,
  latency_ms         int,
  at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_calls_user_day ON llm_calls (user_id, at DESC);

CREATE TABLE tenant_budget (
  tenant_id      uuid NOT NULL,
  user_id        uuid NOT NULL,
  day            date NOT NULL,
  turns_used     int  NOT NULL DEFAULT 0,
  cost_usd       numeric(12, 6) NOT NULL DEFAULT 0,
  turn_cap       int,
  daily_cost_cap numeric(12, 6),
  PRIMARY KEY (tenant_id, user_id, day)
);

-- RLS. Every table, both keys, from the first migration. ----------------------
-- The context is only ever stamped by tenantSession() in src/db/client.ts.
--
-- NULLIF(..., '') is load-bearing, not defensive noise. current_setting(x, true)
-- returns NULL only while the GUC has NEVER been set; once any transaction on that
-- pooled backend has called set_config, the setting persists as an EMPTY STRING, and
-- ''::uuid raises "invalid input syntax for type uuid". Without NULLIF a
-- context-less query on a recycled connection throws a confusing cast error instead
-- of cleanly returning zero rows. Both fail closed -- but only one is debuggable.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['episodes', 'llm_calls', 'tenant_budget'] LOOP
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

  EXECUTE 'ALTER TABLE app_users ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE app_users FORCE ROW LEVEL SECURITY';
  EXECUTE $f$
    CREATE POLICY app_users_isolation ON app_users
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  $f$;
END $$;

-- The app role can read and write tenant data, but only through the policies above.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clone_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clone_app;
