-- 0028: the System needs a seat at the table, and one table was left unlocked.
--
-- TWO PROBLEMS.
--
-- 1. Nothing can run a rendezvous. Matching two people means reading what BOTH of them
--    allow to be said about them, and no session can do that: a tenant session sees
--    one tenant, the match role has SELECT on match_profile only, and the app role
--    with no context set sees nothing at all. `meet()` has therefore only ever been
--    called from tests, with the dossiers handed in by hand.
--
-- 2. `rendezvous_runs` has no row-level security. 0022 enabled it on `rendezvous` and
--    `rendezvous_briefs` and missed the table holding the TRANSCRIPTS -- the one whose
--    own comment says it is "kept for debugging and NEVER shown to either human". Any
--    app session could read every simulated conversation in the database, including
--    both agents' unverified characterisations of people in other tenants.
--
-- The matchmaker is a role, not a bypass. It reads facts marked public and nothing
-- else, which makes the public-only rule STRUCTURAL: `buildDossier` filters in SQL
-- today, but a future caller that forgets to is now refused by the database.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clone_matchmaker') THEN
    CREATE ROLE clone_matchmaker LOGIN PASSWORD 'clone_matchmaker'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT CONNECT ON DATABASE clone TO clone_matchmaker;
GRANT USAGE ON SCHEMA public TO clone_matchmaker;

-- ---------------------------------------------------------------- what it may read
GRANT SELECT ON match_profile TO clone_matchmaker;
CREATE POLICY match_profile_matchmaker ON match_profile FOR SELECT
  TO clone_matchmaker USING (true);

-- Public facts only, enforced by the policy rather than by the query. An agent handed
-- somebody's whole memory will repeat all of it to a stranger; this cannot be talked
-- out of, and it cannot be forgotten by the next person who writes a query here.
-- Named columns, not the table. No `hedge_span`, no `origin_class`, no extractor
-- bookkeeping: what an agent is allowed to say about its human, plus the temporal
-- columns that decide whether it is still true.
GRANT SELECT (id, user_id, predicate, object_text, object_value, source_quote,
              valid_from, valid_to, recorded_at, stance, status, disclosure,
              superseded_by_id, corroboration_count)
  ON facts TO clone_matchmaker;
CREATE POLICY facts_matchmaker ON facts FOR SELECT
  TO clone_matchmaker
  USING (disclosure = 'public' AND status = 'active' AND valid_to IS NULL);

-- The written profile, which is assembled from facts the person has already confirmed.
GRANT SELECT ON core_profile TO clone_matchmaker;
CREATE POLICY core_profile_matchmaker ON core_profile FOR SELECT
  TO clone_matchmaker USING (true);

-- --------------------------------------------------------------- what it may write
GRANT SELECT, INSERT, UPDATE ON rendezvous TO clone_matchmaker;
CREATE POLICY rendezvous_matchmaker ON rendezvous FOR ALL
  TO clone_matchmaker USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON rendezvous_briefs TO clone_matchmaker;
CREATE POLICY briefs_matchmaker ON rendezvous_briefs FOR ALL
  TO clone_matchmaker USING (true) WITH CHECK (true);

-- ------------------------------------------------------ the transcripts, locked down
ALTER TABLE rendezvous_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rendezvous_runs FORCE ROW LEVEL SECURITY;

-- No policy for clone_app, deliberately. A transcript is never shown to either human:
-- it contains each agent's characterisation of its own person, which is unverified,
-- and reading it would quietly turn a claim into a remembered fact about somebody they
-- have not met. With RLS on and no policy, the app role cannot read one even if a
-- future endpoint tries.
REVOKE ALL ON rendezvous_runs FROM clone_app;

GRANT SELECT, INSERT, UPDATE ON rendezvous_runs TO clone_matchmaker;
CREATE POLICY runs_matchmaker ON rendezvous_runs FOR ALL
  TO clone_matchmaker USING (true) WITH CHECK (true);

-- The eraser still has to be able to clear them.
GRANT SELECT, DELETE ON rendezvous_runs TO clone_eraser;

-- The candidate query tests dealbreakers, so the matchmaker needs the same narrow
-- view of preferences the match role has: the rule, never the sentence the person
-- said when they gave it.
GRANT SELECT (id, user_id, predicate, operator, value, strength)
  ON preferences TO clone_matchmaker;
CREATE POLICY preferences_matchmaker ON preferences FOR SELECT
  TO clone_matchmaker USING (true);

GRANT EXECUTE ON FUNCTION match_pref_satisfied(text, jsonb, jsonb) TO clone_matchmaker;

-- Standing instructions the person gave their own clone -- "never bring up my ex" --
-- have to reach the agent that goes out on their behalf, or the one place they are
-- most needed is the one place they are missing. Active ones only.
GRANT SELECT (user_id, text, active, valid_from) ON directives TO clone_matchmaker;
CREATE POLICY directives_matchmaker ON directives FOR SELECT
  TO clone_matchmaker USING (active);
