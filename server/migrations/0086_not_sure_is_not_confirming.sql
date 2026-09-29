-- "NOT SURE" DOES NOT CONFIRM ANYBODY (the founder, 2026-09-29: "'Not sure' doesn't count
-- as confirming someone").
--
-- WHAT WAS WRONG. "Confirmed by N people who met them" (0058 confirmations_of) counted every
-- check-in about somebody in which no identity answer was a "no". So a date who answered
-- "Not sure" to "Were those their photos?" and "Were they the age it said?" -- somebody
-- who could not vouch for anything -- counted as confirming them, and the badge said more
-- than anybody had said.
--
-- HOW IT WAS FOUND. docs/END-TO-END.md 15.3 item 20. tests/checkin.test.ts plants a check-in
-- of "Not sure"s: before this, it counted.
--
-- THE FIX. A check-in confirms only when every identity question it asked was answered yes
-- (and it asked at least one). A "no" still never confirms; a "not sure" no longer does.
CREATE OR REPLACE FUNCTION confirmations_of(owner uuid, viewer uuid) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN photos_visible_to(owner, viewer) THEN (
    SELECT count(DISTINCT c.for_user)::int FROM date_checkins c
     WHERE c.about_user = owner AND c.met
       AND EXISTS (SELECT 1 FROM jsonb_each_text(c.answers) a
                    WHERE a.key IN ('photos', 'age', 'name', 'city') AND a.value = 'yes')
       AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(c.answers) a
                        WHERE a.key IN ('photos', 'age', 'name', 'city') AND a.value <> 'yes'))
  ELSE 0 END;
$$;
