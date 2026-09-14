-- 0036: nobody under 18 in the pool, enforced by the database.
--
-- There was no age check anywhere. Not in the app, not in the API, not in the
-- schema. `age` was computed as this year minus the stated birth year and stored,
-- and pool entry asked only whether the five required fields were filled. The single
-- occurrence of "18" in the codebase constrained the age range somebody *sought*,
-- never the age they *were*.
--
-- The application now refuses an under-age birth year in `commit`, which is the one
-- function every write path goes through, and again at `/v1/essentials` so the person
-- gets a sentence instead of a silent drop. This is the third lock and the only one
-- that survives a bug in the other two: `match_profile` is what the candidate query
-- reads, so a row that cannot exist here is a person who cannot be shown to anybody.
--
-- NOT VALID, then VALIDATE, deliberately: the check applies to every future write
-- immediately and the scan of existing rows happens without holding a write lock on
-- the table. The two statements are separated for that reason alone.
--
-- `age IS NULL` is allowed. An agent with no stated age is already held out of the
-- pool by `in_pool` -- it cannot answer one of the five questions every candidate
-- query asks -- and rejecting the row outright would break the ordinary case of
-- somebody halfway through setup.

ALTER TABLE match_profile
  ADD CONSTRAINT match_profile_adults_only
  CHECK (age IS NULL OR age >= 18) NOT VALID;

ALTER TABLE match_profile VALIDATE CONSTRAINT match_profile_adults_only;

COMMENT ON CONSTRAINT match_profile_adults_only ON match_profile IS
  'Minimum age 18. Mirrors MIN_AGE in shared/src/values.ts and the check in commit().';
