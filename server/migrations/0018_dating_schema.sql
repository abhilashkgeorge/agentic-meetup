-- 0018: the dating layer, and the one idea it rests on.
--
-- THE MODEL: a person has ATTRIBUTES, and separately has PREFERENCES about other
-- people's attributes. Both are facts about the user; only the second is about
-- anybody else.
--
--   attribute   works_in = 'AI'          "I work in AI"
--   preference  works_in in ['AI']       "I want someone who works in AI"
--
-- Nobody's taste is in the schema. "She should work on AI", "he must eat meat",
-- "over 6 foot", "not religious" are all the same row shape with different contents.
-- A user who wants the opposite of another user is one value apart, not a code change.
--
-- WHY PREFERENCES ARE NOT JUST FACTS: a fact answers "what is true of you". A
-- preference answers "what would you accept in someone else", and it needs an
-- operator and a strength that a fact has no use for. Cramming both into `facts`
-- means every matching query has to guess which rows describe the user and which
-- describe their imagined partner.
--
-- STRENGTH IS THE WHOLE HARD/SOFT DISTINCTION:
--   dealbreaker  excludes. Costs you pool. Use sparingly.
--   strong/mild  ranks. Costs nothing. Use freely.
-- Filters multiply down and reach zero; points add up and never do. Only five
-- structural filters plus a person's own dealbreakers ever exclude anybody.

-- Distance without PostGIS. earthdistance over cube gives an indexable
-- great-circle search, which is all a "within N km" clause needs.
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- ---------------------------------------------------------------- facts, extended

-- What an agent may say about its human to ANOTHER PERSON'S AGENT.
--
-- This cannot be added later. Agents talking unsupervised about somebody's religion,
-- health or employer is an incident, not a bug report -- and once agents have started
-- disclosing, a new column does not un-say it. Default is the safe end.
ALTER TABLE facts ADD COLUMN disclosure text NOT NULL DEFAULT 'matchable_only'
  CHECK (disclosure IN ('public', 'matchable_only', 'private'));

-- How we know. 'the summary asserts X' and 'the user said X' are currently one row.
-- With this, an agent's epistemic hedging is read from a column instead of being
-- requested from a model that has every incentive to sound certain.
ALTER TABLE facts ADD COLUMN basis text NOT NULL DEFAULT 'explicit'
  CHECK (basis IN ('explicit', 'observed', 'inferred'));

-- --------------------------------------------------------------- predicate_status
--
-- The difference between "never asked", "asked and refused", and "the provider will
-- not store this". Today all three look identical: no row. So the question queue
-- re-asks things people declined, forever, and matching reads missing as mismatched.
--
-- This is also what makes "one fixed schema for every user" representable at all.
CREATE TABLE predicate_status (
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  predicate     text NOT NULL REFERENCES predicates(name),
  state         text NOT NULL DEFAULT 'unknown'
                  CHECK (state IN ('unknown','asked','declined','not_applicable','known')),
  -- Why it is missing. 'policy' means the assistant refused to store it, which is
  -- not the user's choice and should not be treated as a refusal.
  reason        text CHECK (reason IN ('never_mentioned','policy','unclear')),
  asked_count   int NOT NULL DEFAULT 0,
  last_asked_at timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, predicate)
);

CREATE INDEX predicate_status_askable
  ON predicate_status (user_id, state) WHERE state IN ('unknown','asked');

-- ------------------------------------------------------------------- preferences
CREATE TABLE preferences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  -- The attribute this is about, on the OTHER person.
  predicate    text NOT NULL REFERENCES predicates(name),
  operator     text NOT NULL
                 CHECK (operator IN ('equals','in','not_in','gte','lte','between','contains','absent')),
  -- Shape depends on the operator: 'in' takes an array, 'between' {min,max}.
  -- Validated in shared/src/values.ts before it ever gets here.
  value        jsonb NOT NULL,
  strength     text NOT NULL DEFAULT 'mild'
                 CHECK (strength IN ('dealbreaker','strong','mild')),
  -- Said in their own words, so a brief can quote the reason rather than the rule.
  source_quote text NOT NULL DEFAULT '',
  source_fact_id uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  retired_at   timestamptz
);

-- One live preference per (predicate, operator). Saying "I want someone in AI" twice
-- must not double its weight in the score -- the same reasoning as the partial unique
-- index on facts, applied to wants instead of truths.
CREATE UNIQUE INDEX preferences_one_live
  ON preferences (user_id, predicate, operator) WHERE retired_at IS NULL;

CREATE INDEX preferences_by_user ON preferences (user_id) WHERE retired_at IS NULL;

-- ------------------------------------------------------------------ match_profile
--
-- One denormalised, indexed row per person: what the filter joins on.
--
-- A CACHE, never a source. Rebuilt from `facts` on any matchable commit, and a
-- rebuild is always authoritative. It exists because the filter has to be one indexed
-- statement rather than fourteen joins against a hash-partitioned fact table -- and
-- because the difference between filtering in SQL and filtering in a prompt is the
-- difference between $0.10 and six figures per sweep.
CREATE TABLE match_profile (
  user_id        uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- The five structural filters, and nothing else gets to exclude anybody.
  age            int,
  gender         text,
  seeking_gender text[]      NOT NULL DEFAULT '{}',
  age_min        int,
  age_max        int,
  lat            double precision,
  lon            double precision,
  max_distance_km int,
  intent         text[]      NOT NULL DEFAULT '{}',

  -- Everything the score reads. Tags rather than columns: a new interest must not be
  -- a migration.
  attribute_tags text[]      NOT NULL DEFAULT '{}',
  traits         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Mean of the person's value/believes facts. The one vector matching touches.
  value_vec      halfvec(768),

  -- Pool state.
  in_pool        boolean     NOT NULL DEFAULT false,
  is_synthetic   boolean     NOT NULL DEFAULT false,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  rebuilt_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX match_profile_pool
  ON match_profile (is_synthetic, gender, age) WHERE in_pool;
CREATE INDEX match_profile_geo
  ON match_profile USING gist (ll_to_earth(lat, lon)) WHERE in_pool AND lat IS NOT NULL;
CREATE INDEX match_profile_tags
  ON match_profile USING gin (attribute_tags);

-- ---------------------------------------------------------------------- isolation
ALTER TABLE predicate_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE predicate_status FORCE ROW LEVEL SECURITY;
ALTER TABLE preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE preferences FORCE ROW LEVEL SECURITY;

CREATE POLICY predicate_status_isolation ON predicate_status FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY preferences_isolation ON preferences FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- match_profile is DELIBERATELY not tenant-isolated for reads.
--
-- Matching is the one operation that must look across tenants; a policy scoped to the
-- caller would make the candidate query return exactly one row. The protection is
-- instead that this table holds ONLY what a candidate list needs -- no names, no
-- quotes, no episodes, no free text a person wrote -- and that it is reachable only
-- through the dedicated matching role added in 0019, never through tenantSession.
ALTER TABLE match_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_profile FORCE ROW LEVEL SECURITY;

CREATE POLICY match_profile_own ON match_profile FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON predicate_status TO clone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON preferences TO clone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON match_profile TO clone_app;
