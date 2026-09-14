-- 0042: a consent record the relying party can edit is not evidence of anything.
--
-- 0039 created `consents` and granted `clone_app` SELECT and INSERT, deliberately not
-- UPDATE or DELETE. A test then demonstrated the application happily rewriting an
-- `accepted_at` to a year ago.
--
-- THE REASON IS SYSTEMIC AND WORTH WRITING DOWN. Migration 0000 says:
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public
--       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clone_app;
--
-- so every table created in this schema from then on is fully writable by the
-- application role the moment it exists. A later `GRANT SELECT, INSERT` adds nothing
-- and removes nothing; it reads like a restriction and is a no-op. Least privilege in
-- this database is opt-OUT, and the opt-out has to be written by hand, per table, by
-- somebody who remembered. `reports` is the one place it was remembered -- it has
-- INSERT and UPDATE and no SELECT, which is why reports were unreadable rather than
-- merely unread.
--
-- Not changing the default here. Flipping it would silently break the next migration
-- that creates a table and forgets to grant, and that failure would appear at runtime
-- rather than at deploy. It is recorded as a finding instead, and every table that
-- needs narrower access says so explicitly, like this one.

REVOKE UPDATE, DELETE ON consents FROM clone_app;

COMMENT ON TABLE consents IS
  'Append-only from the application: SELECT and INSERT only, enforced by an explicit '
  'REVOKE in 0042 because ALTER DEFAULT PRIVILEGES in 0000 grants clone_app all four '
  'verbs on every new table. A withdrawal is a new row, never an edit.';
