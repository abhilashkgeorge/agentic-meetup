-- 0034: repair the concerns already written the wrong way round.
--
-- `rendezvous_runs.a_concern` is named after `rendezvous.user_a` -- the LOWER of the
-- two ids. But it was written in the order the caller passed the two sides, which is
-- the person whose agent went out, and that is user_a only half the time. Where they
-- differed, each person's card carried their OWN agent's worry about THEMSELVES,
-- presented as the one thing to check about the person they were about to meet.
--
-- The code now normalises on the way in (see recordRuns). This repairs what is already
-- stored. Every round run so far was started by the one real account in the database
-- through `runRound`, which passes that person first -- so the rows to swap are
-- exactly the ones where the real person is user_b.
UPDATE rendezvous_runs rr
   SET a_says_yes = rr.b_says_yes,
       b_says_yes = rr.a_says_yes,
       a_concern  = rr.b_concern,
       b_concern  = rr.a_concern
  FROM rendezvous r
  JOIN match_profile mb ON mb.user_id = r.user_b
 WHERE rr.rendezvous_id = r.id
   AND NOT mb.is_synthetic;
