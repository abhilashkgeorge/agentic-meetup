-- 0021: two bugs found by running the founder against a 500-person synthetic pool.
--
-- ONE. THE SCORER COULD NOT SEE MOST PREFERENCES.
--
-- 0020 granted the matching role only dealbreaker rows, on the reasoning that those
-- are what the FILTER needs. True, and it leaves the RANKER blind: "works in AI",
-- "goes to the gym", "has a masters" are all `strong`, all invisible, and every
-- candidate therefore scored identically on zero met preferences. The top five were
-- effectively random.
--
-- Widened to every live preference, but by COLUMN, not by row. The matcher gets the
-- rule (predicate, operator, value, strength) and never `source_quote` -- which is
-- the person's own words about what they want, and has no business crossing a tenant
-- boundary to be compared against a stranger.
DROP POLICY IF EXISTS preferences_matcher ON preferences;

CREATE POLICY preferences_matcher ON preferences FOR SELECT
  TO clone_match
  USING (retired_at IS NULL);

REVOKE SELECT ON preferences FROM clone_match;
GRANT SELECT (id, user_id, predicate, operator, value, strength) ON preferences TO clone_match;

-- TWO. A REAL USER COULD NEVER SEE THE TEST POOL.
--
-- The candidate query matches on `a.is_synthetic = b.is_synthetic`, which is right --
-- a real person must never be shown an invented one. It also means the synthetic pool
-- cannot validate anything, because the one real user is filtered away from all of it.
--
-- An explicit opt-in rather than a loosened rule. Default false, set by hand on a test
-- account, and visible in the schema so nobody has to wonder whether the person they
-- matched with exists.
ALTER TABLE match_profile ADD COLUMN sees_synthetic boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN match_profile.sees_synthetic IS
  'Test accounts only. When true this profile may be matched against synthetic ones. '
  'Never set for a real user: every candidate they see would be invented.';
