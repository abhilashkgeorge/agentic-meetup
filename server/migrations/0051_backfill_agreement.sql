-- 0051: the fifty-six pairs that ran before agreement was a column.
--
-- both_yes and runs_done have been on the row since 0022, so the rate is derivable
-- for every historical rendezvous. Without this the comparison report starts from
-- zero on the one scorer that has actually been run at scale. rank_score and
-- llm_file_score cannot be backfilled -- they were never computed for these pairs --
-- and the report says so by showing a smaller n for them.
UPDATE rendezvous
   SET agreement = both_yes::real / runs_done
 WHERE agreement IS NULL AND runs_done > 0;
