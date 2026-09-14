-- 0023: what a person has been asked, and what they said.
--
-- Separate from `facts` because a question has a life of its own: it can be asked,
-- skipped, and asked again later, and none of that is a fact about anybody. Without
-- this the interview has no memory of itself and would re-ask the same thing forever.
--
-- `skipped` is recorded, not inferred from absence. A question somebody declined and a
-- question never reached look identical otherwise, and the first must not come back.
CREATE TABLE question_answers (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  question_id text NOT NULL,
  /** The chosen option values. Empty when skipped. */
  answer      jsonb NOT NULL DEFAULT '[]'::jsonb,
  skipped     boolean NOT NULL DEFAULT false,
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

CREATE INDEX question_answers_recent ON question_answers (user_id, answered_at DESC);

ALTER TABLE question_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_answers FORCE ROW LEVEL SECURITY;

CREATE POLICY question_answers_isolation ON question_answers FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON question_answers TO clone_app;
