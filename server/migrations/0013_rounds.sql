-- 0013: the weekly round.
--
-- Once a week the clone writes one message AS its owner, and the people who actually
-- know that person say whether it sounds like them. It is the self-test with a
-- different judge, which is the point: the same act, graded by someone who cannot be
-- fooled by their own wishful thinking about themselves.
--
-- THE SCARCITY IS A PRIMARY KEY. `UNIQUE (user_id, iso_week)` is the rule that one
-- round per person per week is possible, not a policy that it is intended -- the same
-- architectural move as the partial unique index on facts. No growth experiment, no
-- retry loop and no future well-meaning cron can send a second one, because the
-- database will not hold it.
--
-- A grader has NO ACCOUNT. They hold a link. That is deliberate: requiring the people
-- who know you to install an app to answer one question is how a two-sided loop dies
-- before the second side arrives.
CREATE TABLE rounds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  -- ISO week, e.g. '2026-W37'. Text rather than a date because the week is the unit
  -- of scarcity and a date invites off-by-one arguments about when a week starts.
  iso_week    text NOT NULL,
  question    text NOT NULL,
  answer      text NOT NULL,
  model       text NOT NULL,
  cost_usd    numeric(12,6) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  closes_at   timestamptz NOT NULL,
  UNIQUE (user_id, iso_week)
);

CREATE INDEX rounds_recent ON rounds (user_id, created_at DESC);

-- The people who know you. One row, one permanent link, revocable.
CREATE TABLE graders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  -- What the owner calls them. Never an email, never a phone number: we have no use
  -- for either, and holding contact details for people who never signed up is
  -- exactly the third-party-data trap the nomination design also avoids.
  name        text NOT NULL,
  token       text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);

CREATE INDEX graders_by_user ON graders (user_id) WHERE revoked_at IS NULL;

CREATE TABLE round_grades (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  round_id    uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  grader_id   uuid NOT NULL REFERENCES graders(id) ON DELETE CASCADE,
  verdict     text NOT NULL CHECK (verdict IN ('sounds_like', 'not_like')),
  -- What they would have expected instead. This is the most valuable text in the
  -- system: first-hand, specific, and volunteered by someone with no reason to
  -- flatter. It NEVER becomes a fact -- see 0010 -- it becomes a question.
  correction  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, grader_id)
);

ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds FORCE ROW LEVEL SECURITY;
ALTER TABLE graders ENABLE ROW LEVEL SECURITY;
ALTER TABLE graders FORCE ROW LEVEL SECURITY;
ALTER TABLE round_grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE round_grades FORCE ROW LEVEL SECURITY;

CREATE POLICY rounds_isolation ON rounds FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY graders_isolation ON graders FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY round_grades_isolation ON round_grades FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- The grader's view. Scoped by a token they already hold, exactly like the auth-lookup
-- policy: someone with the token sees the one grader row it names and the rounds of
-- the one person it belongs to. Someone without it sees nothing and cannot enumerate.
--
-- Note what a grader can NEVER read: `facts`, `episodes`, `core_profile`. They see one
-- question and one answer. The clone's memory is not a thing a link exposes.
CREATE POLICY graders_by_token ON graders FOR SELECT
  USING (token = NULLIF(current_setting('app.grader_token', true), '')
     AND revoked_at IS NULL);

CREATE POLICY rounds_by_grader_token ON rounds FOR SELECT
  USING (user_id = (SELECT g.user_id FROM graders g
                     WHERE g.token = NULLIF(current_setting('app.grader_token', true), '')
                       AND g.revoked_at IS NULL));

-- A grader may write their own grade and read it back, and nobody else's.
CREATE POLICY round_grades_by_grader_token ON round_grades FOR SELECT
  USING (grader_id = (SELECT g.id FROM graders g
                       WHERE g.token = NULLIF(current_setting('app.grader_token', true), '')
                         AND g.revoked_at IS NULL));

CREATE POLICY round_grades_insert_by_grader_token ON round_grades FOR INSERT
  WITH CHECK (grader_id = (SELECT g.id FROM graders g
                            WHERE g.token = NULLIF(current_setting('app.grader_token', true), '')
                              AND g.revoked_at IS NULL));

GRANT SELECT, INSERT, UPDATE ON rounds TO clone_app;
GRANT SELECT, INSERT, UPDATE ON graders TO clone_app;
GRANT SELECT, INSERT, UPDATE ON round_grades TO clone_app;
