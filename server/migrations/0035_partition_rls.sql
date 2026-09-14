-- 0035: close row-level security on the 64 partitions.
--
-- THE HOLE, AND IT WAS LIVE. `facts` and `episodes` are hash-partitioned 32 ways.
-- Migrations 0001 and 0002 enabled and FORCEd row-level security on the PARENT
-- tables and created the isolation policy there -- and stopped. Postgres applies a
-- parent's policies only when rows are reached THROUGH the parent. Name a partition
-- directly and only that partition's own policies apply, and the partitions had
-- none. The grant loop, meanwhile, did reach them.
--
-- Measured on the development database as `clone_app`, with a correct tenant and
-- user context set -- not as a superuser, not with the context missing:
--
--     SELECT count(*) FROM facts;     -->   1    (correct: that user's row)
--     SELECT count(*) FROM facts_p4;  --> 115    (every tenant in that partition)
--
-- That is the whole isolation guarantee, bypassed by appending four characters to a
-- table name. Nothing in src/ names a partition today, so nothing was leaked. It is
-- fixed here because "no current caller does the wrong thing" is not a security
-- boundary; it is a coincidence that holds until someone writes a query.
--
-- TWO INDEPENDENT LOCKS, because either one alone fails open under a plausible
-- future mistake:
--
--   1. RLS + the same isolation policy on every partition. If a grant is ever
--      restored -- by a future migration, by a well-meaning GRANT ALL, by a restore
--      from a dump -- rows are still filtered.
--   2. REVOKE the partitions from the roles the app actually connects as. Reaching
--      a partition by name is never a legitimate path, so the privilege should not
--      exist at all.
--
-- Routing is unaffected. Postgres checks privileges on the table NAMED in the
-- query; an INSERT, UPDATE or DELETE issued against the parent still routes into a
-- revoked partition, and a SELECT through the parent still reads it under the
-- parent's policy. Both were verified before this migration was written.
--
-- Driven off pg_inherits rather than a hardcoded 0..31, so this stays correct if
-- the partition count ever changes.

DO $$
DECLARE
  part   regclass;
  parent regclass;
  role   text;
BEGIN
  FOR parent IN SELECT unnest(ARRAY['facts'::regclass, 'episodes'::regclass]) LOOP
    FOR part IN
      SELECT inhrelid::regclass FROM pg_inherits WHERE inhparent = parent
    LOOP
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', part);
      EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', part);

      -- The same predicate as the parent's `%_isolation` policy, deliberately
      -- duplicated rather than inherited: a policy is not inherited, and a partition
      -- with RLS enabled and no policy denies everything including the paths that
      -- should work.
      EXECUTE format($p$
        CREATE POLICY partition_isolation ON %s
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id   = NULLIF(current_setting('app.user_id',   true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
                  AND user_id   = NULLIF(current_setting('app.user_id',   true), '')::uuid)
      $p$, part);

      -- The application roles. `clone_eraser` is deliberately NOT revoked: it is
      -- BYPASSRLS by design and exists to verify that an erasure actually removed
      -- rows, which it cannot do through a filter.
      FOREACH role IN ARRAY ARRAY['clone_app', 'clone_match', 'clone_matchmaker'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role) THEN
          EXECUTE format('REVOKE ALL ON %s FROM %I', part, role);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
