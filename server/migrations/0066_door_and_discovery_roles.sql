-- 0066: the sign-in door and the background discovery stop running as the superuser.
--
-- WHAT WAS WRONG. `phoneSession` (every phone sign-in) and `discoverySession` (the
-- memory sweeper, the nightly consolidator, the public /stats page) connected as the
-- owner, `clone` -- a superuser. A superuser ignores every grant and every row-level
-- policy in this database, so the only thing keeping a request that has not even
-- signed in away from everybody's messages was that nobody had written the wrong
-- query yet. Release blocker 3 in CLAUDE.md; the founder's item 6.
-- HOW IT WAS MEASURED: every statement run through the two helpers, read from
-- api/auth.ts (seven calls), memory/session.ts dueSessions, memory/consolidate.ts
-- activeUsers and api/stats.ts. What each reads and writes is listed below and is all
-- either role is given.
--
-- WHY TWO ROLES, NOT ONE. They need different things, and each should fail on the
-- other's work:
--   clone_door       the phone door, before anybody is anybody: phone_challenges (code
--                    hashes, no RLS -- 0045 took it away from clone_app, so this role
--                    is the only one besides the owner that can see it), and one look
--                    at app_users by phone_hmac for the sign-in, whose id and tenant it
--                    may read and nothing else.
--   clone_discovery  metadata across tenants, never content: which sessions are idle,
--                    who said something today, and three counts for /stats. Named
--                    columns only -- episodes' ids and times but not its text -- so
--                    "metadata only" (db/client.ts) is the database's rule now, not a
--                    comment's.
-- Both NOSUPERUSER NOBYPASSRLS; their policies say USING (true) on exactly the tables
-- above, so row-level security still decides and a table left off this list is
-- invisible to them. Dev passwords are the role names, like every other role here;
-- server/ROTATION.md section 3 rotates them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clone_door') THEN
    CREATE ROLE clone_door LOGIN PASSWORD 'clone_door'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clone_discovery') THEN
    CREATE ROLE clone_discovery LOGIN PASSWORD 'clone_discovery'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT CONNECT ON DATABASE clone TO clone_door, clone_discovery;
GRANT USAGE ON SCHEMA public TO clone_door, clone_discovery;

-- ------------------------------------------------------------------- the phone door
GRANT SELECT, INSERT, UPDATE, DELETE ON phone_challenges TO clone_door;

-- Only accounts that have a number: the door looks up nobody else.
GRANT SELECT (id, tenant_id, phone_hmac) ON app_users TO clone_door;
CREATE POLICY app_users_door ON app_users FOR SELECT
  TO clone_door USING (phone_hmac IS NOT NULL);

-- ------------------------------------------------------------------------ discovery
-- dueSessions: idle sessions with turns not yet extracted, of people who signed in.
GRANT SELECT (tenant_id, user_id, session_id, turn_index, ingested_at) ON episodes TO clone_discovery;
CREATE POLICY episodes_discovery ON episodes FOR SELECT TO clone_discovery USING (true);
GRANT SELECT (user_id, session_id, last_turn_index) ON session_extractions TO clone_discovery;
CREATE POLICY session_extractions_discovery ON session_extractions FOR SELECT
  TO clone_discovery USING (true);
GRANT SELECT (user_id, revoked_at) ON device_sessions TO clone_discovery;
CREATE POLICY device_sessions_discovery ON device_sessions FOR SELECT
  TO clone_discovery USING (true);

-- /stats: people who are not synthetic, and how self-tests were judged.
GRANT SELECT (tenant_id) ON app_users TO clone_discovery;
CREATE POLICY app_users_discovery ON app_users FOR SELECT TO clone_discovery USING (true);
GRANT SELECT (id, name) ON tenants TO clone_discovery;
GRANT SELECT (verdict) ON self_tests TO clone_discovery;
CREATE POLICY self_tests_discovery ON self_tests FOR SELECT TO clone_discovery USING (true);
