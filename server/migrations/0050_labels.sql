-- 0050: the ground truth. Every human decision becomes a labelled row.
--
-- THE QUESTION THIS EXISTS TO ANSWER. Is a five-conversation simulation between two
-- clones any better at predicting whether two people want to meet than one model call
-- that reads both their files? Or than a hand-weighted score over the same files? The
-- literature says nothing measured before two people interact predicts pair-specific
-- attraction (Joel, Eastwick & Finkel 2017 could not do it with 100+ variables), and
-- says nothing at all about clone conversations, because nobody has tried. So the
-- answer has to be measured here, and measuring needs three scores and one label on
-- every pair.
--
--   rank_score      (0049)  the hand-weighted profile score, before any conversation
--   llm_file_score  (here)  one model call over both dossiers, no conversation
--   agreement       (0049)  what the five conversations concluded
--   human_says_yes  (0022)  what each person actually said, on each brief
--   met             (here)  whether they report having actually met, later
--
-- After ~50 human decisions, scripts/compare-scorers.ts reports how well each score
-- ranks the pairs humans said yes to, and the design is chosen by that number rather
-- than by argument.

ALTER TABLE rendezvous
  ADD COLUMN llm_file_score real,
  ADD COLUMN introduced_at  timestamptz;

COMMENT ON COLUMN rendezvous.llm_file_score IS
  'One model call reading both dossiers, no conversation: "how likely a second evening", 0..1. '
  'The founder''s proposal in its strongest form, recorded so it can be compared.';
COMMENT ON COLUMN rendezvous.introduced_at IS
  'When both humans had said yes. The clock "did you meet?" runs from.';

-- Per side, like human_says_yes: each person answers for themselves, and the pair is
-- counted as met when either says so -- one honest yes beats one forgotten prompt.
ALTER TABLE rendezvous_briefs
  ADD COLUMN met            boolean,
  ADD COLUMN met_answered_at timestamptz;

COMMENT ON COLUMN rendezvous_briefs.met IS
  'Hinge''s "We Met": the only outcome label that means anything. NULL until asked and answered.';
