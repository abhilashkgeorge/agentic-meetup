-- 0000_roles: the role the application connects as.
--
-- WHY THIS EXISTS. Postgres superusers, and any role with BYPASSRLS, ignore row
-- level security entirely. The default role in a postgres container is a superuser.
-- So an app connecting as it would run every query with tenant isolation SILENTLY
-- disabled -- the policies would exist, the tests would pass, and nothing would be
-- enforced. FORCE ROW LEVEL SECURITY makes policies apply to the table OWNER; it
-- does not defeat BYPASSRLS.
--
-- Migrations run as the owner/superuser. The application connects as clone_app,
-- which is NOSUPERUSER NOBYPASSRLS and therefore actually subject to the policies.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clone_app') THEN
    CREATE ROLE clone_app LOGIN PASSWORD 'clone_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO clone_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clone_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO clone_app;
