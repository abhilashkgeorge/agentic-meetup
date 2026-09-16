-- 0049: a round meets several people and the human sees them one at a time.
--
-- WHAT WAS WRONG. One tap sent the agent to exactly one person: the top-ranked
-- candidate, chosen by a score nobody could see. Then five conversations ran, and if
-- fewer than three of five ended in a mutual yes the pair was marked 'lapsed' and the
-- human saw nothing. Five of the seven real rounds ever run ended that way. The other
-- nineteen people the ranker had already scored were thrown away.
--
-- And the whole thing ran inside one HTTP request. Five conversations is about a
-- minute and a half; three candidates' worth is closer to five minutes, which no phone
-- keeps a request open for. A timeout was shown to the person as a rejection.
--
-- THE SHAPE NOW. A tap creates a `rounds` row and returns immediately. A worker picks
-- it up, meets the top K candidates, and writes a brief for EVERY one of them -- the
-- agents' agreement rate orders the list, it no longer gates it. The person sees the
-- head of that list, says yes or not-for-me, and the next one is already there. That
-- is Hinge's "Most Compatible" shape, and it is the founder's own proposal.
--
-- The queue is the rendezvous table itself, ordered, rather than a new table that
-- would duplicate it. Two columns are added so it can be ordered: what the ranker
-- thought before the conversation, and what the conversation thought afterwards.
-- Keeping both on the row is also what makes the two comparable later.

ALTER TABLE rendezvous
  ADD COLUMN rank_score real,
  ADD COLUMN agreement  real;

COMMENT ON COLUMN rendezvous.rank_score IS
  'The profile-vs-profile score that put this pair in the round, before any conversation.';
COMMENT ON COLUMN rendezvous.agreement IS
  'both_yes / counted after the conversations. NULL when no run was conclusive. This '
  'ORDERS the list a person sees; it does not gate it.';

CREATE INDEX rendezvous_queue ON rendezvous (user_a, agreement DESC NULLS LAST, rank_score DESC NULLS LAST);
CREATE INDEX rendezvous_queue_b ON rendezvous (user_b, agreement DESC NULLS LAST, rank_score DESC NULLS LAST);

-- ── the work queue ─────────────────────────────────────────────────────────────
CREATE TABLE rounds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'running', 'done', 'failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  -- The RoundResult, verbatim, so the app can say what happened without a second
  -- table. Small: counts and a reason, never a transcript.
  result       jsonb,
  error        text
);

CREATE INDEX rounds_pending ON rounds (requested_at) WHERE status = 'queued';
-- One in flight per person. A second tap while the first is running is the first
-- one, not a second one; the unique index is what makes that true under concurrency
-- rather than by convention.
CREATE UNIQUE INDEX rounds_one_active ON rounds (user_id) WHERE status IN ('queued', 'running');

ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds FORCE ROW LEVEL SECURITY;

-- The person: their own rows, to ask for one and to see how it went. Migration 0000's
-- default privileges already grant clone_app the table; this scopes it.
CREATE POLICY rounds_mine ON rounds FOR ALL TO clone_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- The worker: every row, to claim and to finish. It runs as the matchmaker because
-- that is the role the round itself runs as.
GRANT SELECT, UPDATE ON rounds TO clone_matchmaker;
CREATE POLICY rounds_worker ON rounds FOR ALL TO clone_matchmaker USING (true) WITH CHECK (true);

-- Nothing else needs it.
REVOKE ALL ON rounds FROM clone_match;
