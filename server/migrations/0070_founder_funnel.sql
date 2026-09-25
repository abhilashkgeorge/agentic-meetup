-- 0070: the founder's funnel -- how many matches get as far as a meeting.
--
-- WHAT WAS MISSING. Nothing said how far matches get. The founder's item 10: a simple
-- page, for him, of matches -> both said yes -> first message -> date proposed -> met
-- (the check-in), real users only.
-- HOW IT WAS MEASURED: the steps already exist as rows -- rendezvous (cards issued),
-- introduced_at (both yes), messages, messages.kind = 'date_idea' (0067), and "did you
-- meet" (rendezvous_briefs.met) or the after-date check-in (date_checkins.met).
--
-- WHY THIS SHAPE. One function, SECURITY DEFINER, returning seven counts and no rows:
-- the steps span two people and several tables no single role reads together, and a
-- count cannot leak a person. Granted to the matchmaker, which the reviewer's routes
-- already use (api/admin.ts); the route answers 404 to anybody but a reviewer.
--
-- A REAL PERSON is someone who is not invented (match_profile.is_synthetic; somebody
-- still setting up has no profile yet and is real all the same), has signed
-- in on a phone at least once (a device session -- the boundary memory/session.ts uses
-- for the same reason), and is not a test fixture (tests make their people with an
-- @example.test address and clean them up; a crashed run leaves some behind -- 34 of
-- them when this was written, all with sessions). A pair counts only when BOTH are real.
CREATE FUNCTION founder_funnel() RETURNS TABLE (
  people int, matches int, both_yes int, first_message int, date_proposed int, met int, expired int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH real AS (
    SELECT u.id FROM app_users u
      LEFT JOIN match_profile p ON p.user_id = u.id
     WHERE NOT coalesce(p.is_synthetic, false)
       AND u.email NOT LIKE '%@example.test'
       AND EXISTS (SELECT 1 FROM device_sessions d WHERE d.user_id = u.id)
  ), pairs AS (
    SELECT r.* FROM rendezvous r
     WHERE r.status <> 'running'
       AND r.user_a IN (SELECT id FROM real) AND r.user_b IN (SELECT id FROM real)
  )
  SELECT (SELECT count(*) FROM real)::int,
         (SELECT count(*) FROM pairs)::int,
         (SELECT count(*) FROM pairs WHERE introduced_at IS NOT NULL)::int,
         (SELECT count(*) FROM pairs x WHERE introduced_at IS NOT NULL
             AND EXISTS (SELECT 1 FROM messages m WHERE m.rendezvous_id = x.id))::int,
         (SELECT count(*) FROM pairs x
           WHERE EXISTS (SELECT 1 FROM messages m WHERE m.rendezvous_id = x.id AND m.kind = 'date_idea'))::int,
         (SELECT count(*) FROM pairs x
           WHERE EXISTS (SELECT 1 FROM rendezvous_briefs b WHERE b.rendezvous_id = x.id AND b.met)
              OR EXISTS (SELECT 1 FROM date_checkins c WHERE c.rendezvous_id = x.id AND c.met))::int,
         (SELECT count(*) FROM pairs WHERE status = 'expired')::int
$$;
REVOKE ALL ON FUNCTION founder_funnel() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION founder_funnel() TO clone_matchmaker;
