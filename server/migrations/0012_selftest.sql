-- 0012: the private self-test.
--
-- Before a clone is allowed to be seen by anyone else, its owner grades it. Five
-- questions, answered in the owner's voice from the owner's facts; the owner marks
-- each "that's me" or "not me" and corrects the misses.
--
-- Two jobs, and the second is the one that matters.
--
-- 1. A gate. The first outbound act of a new clone is to be judged by a named friend.
--    A clone with two facts and no voice model scores zero, and the artifact of that
--    failure carries the friend's name on it. There is no second first impression
--    with a small seeded group, so it does not get to fail in public first.
--
-- 2. A corpus. `server/evals/cases/mine.ts` is an empty array and has been for the
--    life of the project, because real cases can only come from dogfooding. Every
--    graded answer here IS an eval case -- question, clone's answer, human verdict,
--    human correction -- so the corpus fills as a by-product of a screen people
--    actually want to use rather than as a project nobody will ever start.
CREATE TABLE self_tests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  question     text NOT NULL,
  answer       text NOT NULL,
  -- NULL until graded. An ungraded row is a question in flight, not a result.
  verdict      text CHECK (verdict IN ('me', 'not_me')),
  correction   text,
  model        text NOT NULL,
  cost_usd     numeric(12,6) NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  graded_at    timestamptz,
  CONSTRAINT self_tests_graded_together CHECK ((verdict IS NULL) = (graded_at IS NULL))
);

CREATE INDEX self_tests_recent ON self_tests (user_id, created_at DESC);

ALTER TABLE self_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE self_tests FORCE ROW LEVEL SECURITY;

CREATE POLICY self_tests_isolation ON self_tests FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON self_tests TO clone_app;
