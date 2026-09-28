-- 0074: on a card between a real person and a practice profile, the real person decides first.
--
-- WHAT WAS WRONG. The first mover -- who decides alone, before the other side sees
-- anything -- was the side with more open cards (brief.ts busierSide). A practice
-- profile can be on many people's cards at once, so it can be the busier side. It never
-- answers: the real person read "They decide first", waited out the three days, and
-- watched the card fade without ever being able to answer it (docs/END-TO-END.md 15.3).
--
-- HOW IT WAS MEASURED (dev database, 2026-09-28, read-only): 52 open cards ('decided',
-- still inside their three days); on 38 of them a practice profile was the first mover,
-- none answered. 37 of those 38 were between two practice profiles -- nobody waiting,
-- and left alone here -- and 1 had a real person waiting behind a practice profile.
-- Applied the same day: that one card moved, and the 37 did not.
--
-- WHY THIS FIX (the founder, 2026-09-28: "practice profiles can never be first mover").
-- The code now never picks a practice profile (brief.ts firstMoverOf); this moves the
-- turn on the cards already open, only where nobody has answered yet, keeping the time
-- left on each card. It changes whose turn it is and nothing else. Nothing is deleted.
UPDATE rendezvous r
   SET first_mover = CASE WHEN r.first_mover = r.user_a THEN r.user_b ELSE r.user_a END
  FROM match_profile fm, match_profile om
 WHERE r.status = 'decided'
   AND fm.user_id = r.first_mover AND fm.is_synthetic
   AND om.user_id = CASE WHEN r.first_mover = r.user_a THEN r.user_b ELSE r.user_a END
   AND NOT om.is_synthetic
   AND NOT EXISTS (SELECT 1 FROM rendezvous_briefs b
                    WHERE b.rendezvous_id = r.id AND b.human_says_yes IS NOT NULL);
