-- 0058: what happened on the date, asked of each side separately, told to nobody.
--
-- WHAT WAS THERE. 0050 added "did you two meet?" -- one boolean per side on the brief,
-- the only label in the product that is a fact. Nothing followed it.
--
-- WHAT THIS ADDS. After "yes, we met": a few yes / no / not-sure questions about the
-- other person, built ONLY from what this person was actually shown (the reveal:
-- first name, age, city, a few tags, whether they saw photos -- checkin/questions.ts),
-- plus "did you feel safe" and "would you see them again". One row per side per
-- rendezvous; a pair meets once (rendezvous_pair), so the number of rows a person can
-- ever earn points for is the number of real introductions they have had.
--
-- WHO SEES WHAT. The answerer reads their own row. The other person never reads it,
-- and never learns it exists: the INSERT policy is the only write, there is no UPDATE
-- or DELETE for the app, and the only things that leave this table are aggregates
-- through the three SECURITY DEFINER functions below. Nothing here is ever read into
-- anyone's facts -- 0022/0028: a claim about somebody must not become a remembered
-- fact about them.
CREATE TABLE date_checkins (
  rendezvous_id uuid NOT NULL REFERENCES rendezvous(id) ON DELETE CASCADE,
  for_user      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,   -- who answered
  about_user    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,   -- who it is about
  met           boolean NOT NULL,                  -- copied from the brief; the policy proves it
  -- {"photos":"yes","age":"no","name":"unsure","city":"yes","tag:climbing":"yes"}, or
  -- {"why_not":"plans_fell_through"} when met is false. Keys come from checkin/questions.ts.
  answers       jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(answers) = 'object'),
  felt_safe     boolean,                           -- NULL when they did not meet
  see_again     boolean,                           -- NULL = not sure, or did not meet
  answered_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rendezvous_id, for_user),
  CONSTRAINT checkin_not_self CHECK (for_user <> about_user),
  CONSTRAINT checkin_safety_only_if_met CHECK (met OR (felt_safe IS NULL AND see_again IS NULL))
);
CREATE INDEX checkins_about ON date_checkins (about_user);
ALTER TABLE date_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE date_checkins FORCE ROW LEVEL SECURITY;

CREATE POLICY checkins_mine_read ON date_checkins FOR SELECT TO clone_app
  USING (for_user = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- The insert proves, in the policy, everything the route would otherwise have to
-- remember: I am in this introduced rendezvous, about_user is the other seat, and
-- `met` is what I already told the brief. The subqueries run under this role's own
-- policies (rendezvous_mine, briefs_mine), which is exactly the visibility wanted.
CREATE POLICY checkins_mine_write ON date_checkins FOR INSERT TO clone_app
  WITH CHECK (
    for_user = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM rendezvous r
                 WHERE r.id = rendezvous_id AND r.status = 'introduced'
                   AND for_user IN (r.user_a, r.user_b)
                   AND about_user = CASE WHEN r.user_a = for_user THEN r.user_b ELSE r.user_a END)
    AND EXISTS (SELECT 1 FROM rendezvous_briefs b
                 WHERE b.rendezvous_id = rendezvous_id AND b.for_user = for_user AND b.met = met));
REVOKE UPDATE, DELETE ON date_checkins FROM clone_app;       -- an answer is final
REVOKE ALL ON date_checkins FROM clone_match, clone_matchmaker;
GRANT DELETE ON date_checkins TO clone_eraser;               -- SHARED_TABLES in erasure.ts

-- "Confirmed by N people": check-ins about them where no identity answer was a no.
-- Tag answers do not count -- forgetting a hobby is not a fake profile. Gated by the
-- reveal rule, exactly as photos are: nobody the rule excludes can ask.
CREATE OR REPLACE FUNCTION confirmations_of(owner uuid, viewer uuid) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN photos_visible_to(owner, viewer) THEN (
    SELECT count(DISTINCT c.for_user)::int FROM date_checkins c
     WHERE c.about_user = owner AND c.met
       AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(c.answers) a
                        WHERE a.key IN ('photos', 'age', 'name', 'city') AND a.value = 'no'))
  ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION confirmations_of(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirmations_of(uuid, uuid) TO clone_app;

-- Mutual, like the introduction: true only when BOTH said they would see each other
-- again. false for "they said no", "not sure" and "has not answered" alike.
CREATE OR REPLACE FUNCTION checkin_mutual_again(rz uuid, me uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT count(*) = 2 FROM date_checkins c
     WHERE c.rendezvous_id = rz AND c.see_again
       AND EXISTS (SELECT 1 FROM rendezvous r WHERE r.id = rz AND me IN (r.user_a, r.user_b))
  ), false);
$$;
REVOKE ALL ON FUNCTION checkin_mutual_again(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION checkin_mutual_again(uuid, uuid) TO clone_app;

-- The desk. Counts only; no row, no answer, no who-said-what ever reaches a reviewer.
-- Two independent people saying the photos or the age were wrong, or one saying they
-- felt unsafe. Practice profiles are left out. No automatic action follows (0039: an
-- automatic penalty is a griefing tool).
CREATE OR REPLACE FUNCTION identity_flags()
RETURNS TABLE (about_user uuid, no_photos int, no_age int, unsafe int, checkins int, last_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.about_user,
         count(DISTINCT c.for_user) FILTER (WHERE c.answers->>'photos' = 'no')::int,
         count(DISTINCT c.for_user) FILTER (WHERE c.answers->>'age' = 'no')::int,
         count(DISTINCT c.for_user) FILTER (WHERE c.felt_safe = false)::int,
         count(*)::int, max(c.answered_at)
    FROM date_checkins c
    JOIN match_profile m ON m.user_id = c.about_user AND NOT m.is_synthetic
   WHERE c.met
   GROUP BY c.about_user
  HAVING count(DISTINCT c.for_user) FILTER (WHERE c.answers->>'photos' = 'no') >= 2
      OR count(DISTINCT c.for_user) FILTER (WHERE c.answers->>'age' = 'no') >= 2
      OR count(*) FILTER (WHERE c.felt_safe = false) >= 1;
$$;
REVOKE ALL ON FUNCTION identity_flags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity_flags() TO clone_matchmaker;   -- the desk's session, not the app's
