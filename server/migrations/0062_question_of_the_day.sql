-- 0062: the question of the day -- what other agents asked a person's agent that it could
-- not answer, so the person can be asked it themselves.
--
-- WHAT WAS MISSING. When two agents meet, one often has to say "I don't know"
-- (matching/talk.ts, answer-sheet.ts): its person never said. Nothing ever asked the
-- person, so the gap stayed a gap for every meeting after. Found by a review of the
-- 2026-09-25 build ("When an agent hits 'I don't know', nothing asks the real person
-- yet"); the founder asked for it the same day: queue a question for that person's
-- human, at most one or two a day, skippable, and never say who asked.
--
-- WHAT THIS HOLDS.
--   unknown_asks      one row per "I don't know" a person's agent gave, by question id
--                     from the fixed bank (answer-sheet.ts SHEET) and when. NO COLUMN
--                     SAYS WHO ASKED: the rule "never say who asked" is kept by there
--                     being nothing to say. Written by rounds, for both sides.
--   question_prompts  what the person did with a question on a day: answered or
--                     skipped. The daily cap and the week-long quiet after a skip read it.
--
-- WHY THESE GRANTS. The person reads their own unknowns and nobody else's; only a round
-- (clone_matchmaker) writes them, because only a round knows an agent said "I don't
-- know". The person's app deletes their own rows on erasure (erasure.ts USER_TABLES).
-- Matching reads neither: nobody is filtered or ranked on what they have not said.
CREATE TABLE unknown_asks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  question_id text NOT NULL CHECK (length(question_id) BETWEEN 1 AND 64),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX unknown_asks_user_at ON unknown_asks (user_id, at DESC);
ALTER TABLE unknown_asks ENABLE ROW LEVEL SECURITY;
ALTER TABLE unknown_asks FORCE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE ON unknown_asks FROM clone_app;
CREATE POLICY unknown_asks_read_mine ON unknown_asks FOR SELECT TO clone_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY unknown_asks_erase_mine ON unknown_asks FOR DELETE TO clone_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

GRANT INSERT ON unknown_asks TO clone_matchmaker;
CREATE POLICY unknown_asks_rounds ON unknown_asks FOR INSERT TO clone_matchmaker WITH CHECK (true);

REVOKE ALL ON unknown_asks FROM clone_match;

CREATE TABLE question_prompts (
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question_id text NOT NULL CHECK (length(question_id) BETWEEN 1 AND 64),
  day         date NOT NULL DEFAULT CURRENT_DATE,
  outcome     text NOT NULL CHECK (outcome IN ('answered', 'skipped')),
  at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id, day)
);
ALTER TABLE question_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_prompts FORCE ROW LEVEL SECURITY;

CREATE POLICY question_prompts_mine ON question_prompts FOR ALL TO clone_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
          AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

REVOKE ALL ON question_prompts FROM clone_match;
REVOKE ALL ON question_prompts FROM clone_matchmaker;
