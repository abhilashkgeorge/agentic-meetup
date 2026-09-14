-- 0009: a conflict row that points at no fact, because the fact was never written.
--
-- Found in dogfooding. An imported profile contained the sentence:
--
--   "Your marital status -- you mentioned sending a 'best photo' feature to 'my
--    wife,' which implies you're married, but you haven't stated it directly."
--
-- The assistant was being careful and said outright that the person had NOT stated
-- it. The importer stored relationship_status='married' anyway, flagged uncertain,
-- and the flag changed nothing downstream: it sat in the staged pool looking exactly
-- like a fact the person had actually given.
--
-- The rule that follows: a guess is never a fact, at any confidence, with any flag.
-- A guess is a QUESTION. `fact_conflicts` is already the queue the clone draws its
-- one-per-session question from, so a guess belongs there -- but it has no fact to
-- point at, and `fact_a_id` was NOT NULL.
--
-- The check keeps that hole exactly one kind wide: only 'gap' rows may be factless.
ALTER TABLE fact_conflicts ALTER COLUMN fact_a_id DROP NOT NULL;

ALTER TABLE fact_conflicts ADD CONSTRAINT fact_conflicts_gap_has_no_fact
  CHECK ((kind = 'gap') = (fact_a_id IS NULL));

-- Gaps are deduplicated by their question text, not by a fact id they do not have.
-- Without this a re-import asks "are you married?" once per paste, forever.
CREATE UNIQUE INDEX fact_conflicts_gap_unique ON fact_conflicts (user_id, clarifying_question)
  WHERE kind = 'gap' AND status IN ('open', 'asked');
