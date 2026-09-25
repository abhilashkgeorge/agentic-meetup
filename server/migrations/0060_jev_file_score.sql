-- A FOURTH SCORER ON EVERY PAIR, READ BY NOBODY.
--
-- WHAT WAS WRONG. Three numbers are already recorded before any human looks at a pair
-- (rank_score, llm_file_score, agreement), and scripts/compare-scorers.ts reports
-- which of them predicts a human yes. Nothing else can settle it: the literature says
-- nothing measured before two people interact predicts attraction, and the only
-- honest answer to "is the expensive one worth it" is an AUC on real decisions.
--
-- HOW IT WAS MEASURED. The header of matching/candidates.ts records the arithmetic
-- that forced the whole design: a model looking at a 1,000-person pool for one user is
-- about $7, and full pairwise at 10,000 agents is roughly $350,000 a sweep -- "not
-- expensive, impossible", which is why every filter is SQL. A System One model
-- (docs.typesafe.ai/models.md, read 2026-09-23) prices input at $0.042 per million
-- tokens and output at zero. The same thousand-person pool is about four cents.
--
-- WHY THIS COLUMN. That price changes what is worth TESTING, not what is true. A cheap
-- judgement of something close to unpredictable is cheap noise, and the way to find out
-- which it is, is the rig that already exists: record the number on every pair, show it
-- to nobody, and compare all four against what the humans then said. One column is the
-- whole cost of asking.
--
-- WHAT WAS DELIBERATELY LEFT ALONE. No confidence column. A `noul` answer IS a
-- probability -- their own docs say there is no separate confidence for one -- so the
-- calibration test is the DISTRIBUTION of this column across pairs. A near-unpredictable
-- target should cluster near the base rate; a confident spread would be evidence the
-- model is wrong rather than that it is good.
--
-- No new table, so no new grants: rendezvous is granted at table level to clone_app,
-- clone_match, clone_matchmaker and clone_eraser (0022, 0027, 0028, 0026) and a column
-- inherits those. tests/schema-shape.test.ts checks the live catalogue.

ALTER TABLE rendezvous ADD COLUMN IF NOT EXISTS jev_file_score double precision;

COMMENT ON COLUMN rendezvous.jev_file_score IS
  'Fourth scorer: a System One model''s probability that each would want a second '
  'evening, from the two files alone, with no conversation. Recorded only when '
  'DECIDE_MODEL is set. Never shown to a person; compared in scripts/compare-scorers.ts.';
