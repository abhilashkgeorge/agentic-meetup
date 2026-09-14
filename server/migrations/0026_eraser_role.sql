-- 0026: the erasure verification could not fail.
--
-- `eraseUser` deletes the rows, then re-counts them "WITHOUT tenant context
-- deliberately -- if RLS were the only thing making the rows look gone, this would
-- catch it". It could not. The count ran as clone_app with no tenant context set, and
-- every policy on those tables compares against `current_setting('app.tenant_id')`,
-- which was unset and therefore NULL. NULL matches no row. The verifier saw zero rows
-- in every table, always, whether or not anything had been deleted.
--
--   $ psql "$DATABASE_URL" -c 'select count(*) from facts'   ->  0
--
-- with 40,000 facts in the table. `verified: true` was a constant. An erasure that
-- cannot fail its own verification is exactly the thing the verification was added to
-- prevent, and it had been passing in CI for weeks.
--
-- So: one role that genuinely sees everything, used for nothing else. BYPASSRLS is
-- normally the bug (see 0000_roles) -- here it is the entire requirement, because
-- proving an absence means being able to see a presence.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clone_eraser') THEN
    -- Dev password, same as clone_app. In deployment both come from the secret store.
    CREATE ROLE clone_eraser LOGIN PASSWORD 'clone_eraser'
      NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO clone_eraser;

-- Sees everything, by design: it has to, to prove a row is gone.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO clone_eraser;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO clone_eraser;

-- Writes almost nothing. Only the tables a conversation spans, which no tenant
-- session can reach both halves of, plus the account row itself.
GRANT DELETE ON rendezvous, rendezvous_briefs, messages, blocks, reports, app_users
  TO clone_eraser;
GRANT UPDATE (reporter_id) ON reports TO clone_eraser;

-- Not a general-purpose connection: it cannot write a fact, send a message, or read a
-- budget into anything. If this role is ever used outside erasure, that is the bug.
