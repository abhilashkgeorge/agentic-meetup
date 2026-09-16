-- 0053: three things a look at the schema in a GUI turned up.
--
-- 1. `directives` is dropped. Created in 0006 for standing instructions ("always
--    call me X"), read on every turn by coreProfileText and on export by the eraser,
--    and never written by anything: no INSERT in src/, scripts/, or a migration, and
--    zero rows on the development database after months of use. Dropped rather than
--    left dormant, for the reason 0017 gave when it dropped the grader tables: an
--    unused table with policies and grants is a thing every future migration has to
--    reason about. The two reads are gone from the code in the same commit.
--
-- 2. `schema_migrations` could be rewritten by the application role. 0000's ALTER
--    DEFAULT PRIVILEGES hands clone_app SELECT/INSERT/UPDATE/DELETE on every table
--    that is not explicitly revoked, and the migration ledger never was. Migrations
--    run as the owner (migrate.ts, MIGRATION_DATABASE_URL), so the app has no reason
--    to touch it; a deleted ledger row means a migration re-runs on the next deploy.
--
-- 3. `predicates` is written once, at migrate time, by the owner (migrate.ts seeds
--    it on its own connection). The app role's INSERT/UPDATE/DELETE on the
--    dictionary were the default, not a decision. clone_app and clone_match keep
--    SELECT: the ranker and the profile builder read it.
--
--    `invites` is different and the first draft of this migration got it wrong.
--    Its reads and writes in auth.ts run under adminSession, which is NOT the owner
--    pool -- it is clone_app with no tenant context (client.ts:63-74), and invites
--    carries no RLS precisely so that a code can be claimed before the claimant has
--    a tenant. So SELECT, INSERT and UPDATE stay. DELETE goes: nothing in src/
--    deletes an invite, and an invite that vanishes is one that can be handed out
--    again.
--
-- Not done here, on purpose: the fourteen foreign keys without a supporting index
-- (tenant cascades, reports, messages.sender_id) and the two NOT VALID tenant
-- foreign keys on llm_calls / tenant_budget. The first is an index-only change
-- with its own measurement; the second cannot be validated while 1,438 orphaned
-- llm_calls rows exist, and deleting rows is not this migration's call.

DROP TABLE IF EXISTS directives;

REVOKE ALL ON schema_migrations FROM clone_app, clone_match, clone_matchmaker;
REVOKE INSERT, UPDATE, DELETE ON predicates FROM clone_app;
REVOKE DELETE ON invites FROM clone_app;
REVOKE ALL ON invites FROM clone_match, clone_matchmaker;
