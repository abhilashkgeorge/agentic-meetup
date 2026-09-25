-- 0069: a match nobody answers expires after three days, and says so as itself.
--
-- WHAT WAS WRONG. A card waited for ever. A person who never answered left the other
-- one "waiting on them" indefinitely -- and, because the busier side decides first,
-- held a place in that person's queue that nobody would ever free. Of the rendezvous
-- in the dev database when this was written, 55 were 'decided' and unanswered, most
-- of them for more than three days. The founder's item 9: matches expire after three
-- days with no answer; the card fades; "expired" is recorded separately from "no".
-- HOW IT WAS FOUND: `SELECT status, count(*) FROM rendezvous GROUP BY status`, and
-- reading every place a status is written -- nothing ever moved a 'decided' row on
-- except an answer.
--
-- WHY THIS SHAPE.
--   answer_by   the deadline for whoever's turn it is: set when the cards are issued
--               (matching/rendezvous.ts) and moved on by every yes that hands the turn
--               to the other person (orchestrator.ts decide). A column, not a sum
--               worked out at read time, so the phone can show the card fading
--               toward it and every reader agrees on when it ends.
--   'expired'   its own status, beside 'lapsed' (a no). Nobody said no: both
--               briefs keep human_says_yes NULL, so compare-scorers, which labels a
--               pair only when both answered or one said no, leaves it out rather
--               than counting silence as a rejection. expired_at says when.
--   THE CLOCK STARTS NOW for every card already out: a card somebody is looking at
--   today should not vanish the minute this ships because it was issued last week.
ALTER TABLE rendezvous DROP CONSTRAINT rendezvous_status_check;
ALTER TABLE rendezvous ADD CONSTRAINT rendezvous_status_check
  CHECK (status IN ('running', 'decided', 'shown_a', 'shown_b', 'introduced', 'lapsed', 'expired'));

ALTER TABLE rendezvous ADD COLUMN answer_by timestamptz;
ALTER TABLE rendezvous ADD COLUMN expired_at timestamptz;

UPDATE rendezvous SET answer_by = now() + interval '3 days' WHERE status = 'decided';

-- The sweep reads exactly this: open cards past their deadline.
CREATE INDEX rendezvous_answer_by ON rendezvous (answer_by) WHERE status = 'decided';
