-- 0006: TIER 2 (core profile) and TIER 3 (directives). W4.

-- TIER 2. DERIVED and CACHED -- never authoritative. Rebuilt from `facts`, so a bad
-- render is a cache bug, not data loss. Deliberately NOT vectorised: it is inlined
-- verbatim on every turn, so there is nothing to search.
CREATE TABLE core_profile (
  tenant_id       uuid NOT NULL,
  user_id         uuid NOT NULL,
  block_name      text NOT NULL CHECK (block_name IN ('identity','situation','preferences','open_threads')),
  content         text NOT NULL,
  token_count     int  NOT NULL,
  rendering_model text NOT NULL,
  source_fact_ids uuid[] NOT NULL,
  rebuilt_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, block_name)
);

-- TIER 3. Imperative, and governed by the OPPOSITE prompt rule to facts.
--
-- Observed facts are declarative ("prefers concise answers"); directives are the
-- instructions the user gave the agent ("always be concise"). Mixing them is a real
-- failure: an imperative stored as a fact gets re-read as a standing order in a later
-- session and can override what the person is asking for right now. Different table,
-- different rule, supersede-in-place.
CREATE TABLE directives (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  user_id          uuid NOT NULL,
  text             text NOT NULL,
  valid_from       timestamptz NOT NULL DEFAULT now(),
  valid_to         timestamptz,
  superseded_by_id uuid,
  source_fact_id   uuid,
  active           boolean NOT NULL DEFAULT true
);
CREATE INDEX directives_active ON directives (user_id) WHERE active;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['core_profile','directives'] LOOP
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

GRANT SELECT, INSERT, UPDATE, DELETE ON core_profile, directives TO clone_app;
