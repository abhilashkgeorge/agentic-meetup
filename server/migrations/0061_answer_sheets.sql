-- 0061: answer sheets -- what a person's agent says when another agent asks it something.
--
-- WHAT WAS MISSING. Two agents meeting had nothing true to say to each other. The
-- conversations they used to hold (matching/rendezvous.ts, off by default since
-- 2026-09-23) were a model writing as each person, and on a real user's card it
-- invented a comedy-writer life he never described -- measured: 9 facts, 1 episode, 0
-- mention comedy; 2 of his 3 briefs said it. The founder asked instead for agents that
-- ask each other the SAME questions, answer only from what their person actually said,
-- and say "I don't know" rather than invent (2026-09-24).
--
-- WHAT THIS HOLDS. For each person, which of their OWN verified sentences answers each
-- question in a fixed bank (server/src/matching/answer-sheet.ts): question id -> fact
-- id. Not the words. The words stay in `facts`, where the matchmaker can read only
-- public, active, current rows (0028) -- so a sentence the person hides, retracts or
-- replaces drops out of every sheet by row-level security alone, with no code on the
-- read path having to remember to check.
--
-- WHY A TABLE AND NOT A ROUND-TIME CALL. A person's answers do not depend on who is
-- asking, so the sheet is built once per change, by the person's own session (checking
-- a sentence against what they typed reads their own episodes, which the matchmaker
-- cannot), and every meeting only reads two sheets. A round stays at zero model calls.
-- `basis` is a hash of the sentences the sheet was built from: unchanged, no rebuild.
--
-- NO MODEL WRITES HERE. The builder points at a sentence by number; nothing it returns
-- is stored except those numbers, resolved to fact ids.
CREATE TABLE answer_sheets (
  user_id   uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  answers   jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(answers) = 'object'),
  basis     text NOT NULL,
  built_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE answer_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_sheets FORCE ROW LEVEL SECURITY;

-- Their own row, and only it: built, read on "How you appear", deleted on erasure.
CREATE POLICY answer_sheets_mine ON answer_sheets FOR ALL TO clone_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
          AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- A round reads both sides' sheets. Read only: a round never builds one.
GRANT SELECT ON answer_sheets TO clone_matchmaker;
CREATE POLICY answer_sheets_rounds ON answer_sheets FOR SELECT TO clone_matchmaker USING (true);

-- Nothing else touches it. Matching needs no answers; it filters on the cards.
REVOKE ALL ON answer_sheets FROM clone_match;
