-- "FELT UNSAFE" AND "PHOTOS WEREN'T THEM" OUTLIVE AN ACCOUNT (the founder, 2026-09-29:
-- "keep felt-unsafe and photos-weren't-them answers tied to the phone").
--
-- WHAT WAS WRONG. After a date each side answers a few questions about the other
-- (0058); two people saying the photos were not them, or one saying they felt unsafe, is
-- what the reviewer's flags turn on (identity_flags). Deleting an account deleted every
-- such answer about it -- the pair went, and the check-ins with it (erasure.ts) -- so the
-- way to wipe "she felt unsafe with him" was to delete the account and sign up again
-- with the same phone. The same hole 0079 closed for reports. And an answer the deleted
-- person had given about somebody else went too.
--
-- HOW IT WAS FOUND. Following 0079 through every table erasure clears.
-- tests/kept-flags.test.ts plants it: two answers about him, he deletes his account and
-- comes back under the same phone -- before this, the desk showed nothing.
--
-- THE FIX. Before the pair goes, the erasure copies every check-in answer that said
-- "felt unsafe" or "photos: no" into kept_checkin_flags -- the ones about the person
-- leaving, and the ones they gave about others -- keyed to the phone and handsets of the
-- person it is about, as a ban and a kept report are (0065, 0079). Never an account id
-- for who it is about, never the number. Who answered stays, so two answers still need
-- two people; the answerer deleting their own account takes their name off, not the
-- answer. identity_flags() counts the kept answers with the live ones, for whichever
-- account holds that phone or handset now.
-- Only those two answers: "not sure", tags and "would see again" are not safety signals,
-- and keeping them would keep more of a deleted person than safety needs.

CREATE TABLE kept_checkin_flags (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who answered. Their own deletion takes the name off, not the answer.
  for_user           uuid REFERENCES app_users(id) ON DELETE SET NULL,
  -- Who it is about: keys, never an account id or a number.
  about_phone_hmac   text,
  about_device_hmacs text[]      NOT NULL DEFAULT '{}',
  felt_unsafe        boolean     NOT NULL,
  photos_not_them    boolean     NOT NULL,
  answered_at        timestamptz NOT NULL,
  kept_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kept_flag_is_a_flag CHECK (felt_unsafe OR photos_not_them)
);
CREATE INDEX kept_flags_phone ON kept_checkin_flags (about_phone_hmac);

ALTER TABLE kept_checkin_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE kept_checkin_flags FORCE ROW LEVEL SECURITY;
-- 0000 and 0026 hand every new table to clone_app (all four) and clone_eraser (SELECT).
-- Nobody reads it but identity_flags(); the eraser writes it and takes names off it.
REVOKE ALL ON kept_checkin_flags FROM clone_app, clone_match, clone_matchmaker, clone_door, clone_discovery;
GRANT INSERT, UPDATE (for_user) ON kept_checkin_flags TO clone_eraser;

-- The desk (0058), now counting the kept answers for the account that holds that phone or
-- handset today. The same thresholds; an anonymised answerer still counts as one person.
CREATE OR REPLACE FUNCTION identity_flags()
RETURNS TABLE (about_user uuid, no_photos int, no_age int, unsafe int, checkins int, last_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH said AS (
    SELECT c.about_user, c.for_user::text AS who,
           c.answers->>'photos' = 'no' AS no_photos, c.answers->>'age' = 'no' AS no_age,
           c.felt_safe = false AS unsafe, c.answered_at
      FROM date_checkins c
     WHERE c.met
    UNION ALL
    SELECT u.id, COALESCE(k.for_user::text, k.id::text),
           k.photos_not_them, false, k.felt_unsafe, k.answered_at
      FROM kept_checkin_flags k
      JOIN app_users u
        ON (k.about_phone_hmac IS NOT NULL AND u.phone_hmac = k.about_phone_hmac)
        OR EXISTS (SELECT 1 FROM device_sessions s
                    WHERE s.user_id = u.id AND s.device_hmac = ANY (k.about_device_hmacs)))
  SELECT s.about_user,
         count(DISTINCT s.who) FILTER (WHERE s.no_photos)::int,
         count(DISTINCT s.who) FILTER (WHERE s.no_age)::int,
         count(DISTINCT s.who) FILTER (WHERE s.unsafe)::int,
         count(*)::int, max(s.answered_at)
    FROM said s
    JOIN match_profile m ON m.user_id = s.about_user AND NOT m.is_synthetic
   GROUP BY s.about_user
  HAVING count(DISTINCT s.who) FILTER (WHERE s.no_photos) >= 2
      OR count(DISTINCT s.who) FILTER (WHERE s.no_age) >= 2
      OR count(*) FILTER (WHERE s.unsafe) >= 1;
$$;
