-- 0019: a database role that can see candidates and nothing else.
--
-- Matching is the only operation in this system that must read across tenants. Every
-- other query is scoped to one person by RLS, and that scoping is the thing that makes
-- a leak structurally impossible rather than carefully avoided.
--
-- So the crossing gets its own role instead of a hole in the existing one. clone_match
-- can SELECT match_profile and nothing else -- not facts, not episodes, not
-- core_profile, not preferences, not a single word anybody wrote. If the matcher is
-- ever wrong, confused, or prompt-injected, the worst it can reach is a list of ages
-- and tags.
--
-- The alternative -- letting clone_app read across tenants when a flag is set -- means
-- one forgotten WHERE clause exposes everything. This way there is nothing to forget.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clone_match') THEN
    CREATE ROLE clone_match LOGIN PASSWORD 'clone_match_dev' NOSUPERUSER NOBYPASSRLS
      NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

GRANT CONNECT ON DATABASE clone TO clone_match;
GRANT USAGE ON SCHEMA public TO clone_match;

-- Exactly two tables, read-only.
GRANT SELECT ON match_profile TO clone_match;
GRANT SELECT ON predicates   TO clone_match;

-- Belt and braces: revoke everything else that might arrive by default in future.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM clone_match;
GRANT SELECT ON match_profile TO clone_match;
GRANT SELECT ON predicates   TO clone_match;

-- The matching role reads every row of match_profile by design, so the isolation
-- policy must not apply to it. This is the ONLY policy in the system granted to a
-- role other than the row's owner, and it is why match_profile carries no free text.
CREATE POLICY match_profile_matcher ON match_profile FOR SELECT
  TO clone_match
  USING (in_pool);
