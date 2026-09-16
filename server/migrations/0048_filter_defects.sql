-- 0048: five defects in the hard filters, each verified live before this was written.
--
-- The filter SET was already the one real dating apps enforce -- gender, mutual age
-- range, mutual distance, intent, dealbreakers both ways, activity. The EXECUTION had
-- holes, and each of them is the kind that never throws: the pool just quietly
-- contains the wrong people, or the right people are quietly missing from it.
--
--   1. `last_active_at` was written once at insert and never again. Nothing in the
--      codebase updated it. So every profile silently left every other person's pool
--      exactly 60 days after signup, permanently, while its owner went on using the
--      app. Fixed in code (the rebuild now stamps it); this file adds the index the
--      new ordering needs.
--
--   2. No ORDER BY before `LIMIT 500`. In a pool of 5,013 the planner handed back
--      whichever 500 it liked, and the 5 real people in that pool were reachable only
--      by chance. Real before invented, recent before stale, is the order that makes
--      two real humans able to find each other at all. Index below.
--
--   5. Blocks were not consulted before a conversation. `block_exists` was granted to
--      the application role only, so the candidate query -- which runs as the matcher
--      roles -- could not even call it. Two people who had blocked each other stayed
--      mutually eligible and could be paired into a fresh rendezvous; the block only
--      bit once they would have talked as humans.
--
--   6. A reviewer taking somebody out of the pool set `in_pool = false`, and the next
--      time that person opened the app `rebuildMatchProfile` set it back to true. The
--      moderation action lasted until the moderated person's next tap. `in_pool` is
--      a COMPUTED thing -- "has this person answered enough to be matched" -- and a
--      moderation decision is not, so they need separate columns, and the one has to
--      be impossible to override from the other.
--
-- Defect 3 (real people have no display name) is a code change in profile.ts and
-- needs nothing here.

-- ── 5. the block function reaches the roles that select candidates ─────────────
GRANT EXECUTE ON FUNCTION block_exists(uuid, uuid) TO clone_match, clone_matchmaker;

-- ── 6. moderation is its own column, and the pool flag cannot climb over it ─────
ALTER TABLE match_profile ADD COLUMN moderation_hidden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN match_profile.moderation_hidden IS
  'Set by a reviewer. While true, in_pool is forced false by trigger regardless of what '
  'the application computes, so reopening the app cannot undo a moderation decision.';

-- A TRIGGER, NOT A CONVENTION. The application computes in_pool from five answers and
-- consent and writes it on every rebuild. Asking every writer to remember to AND in
-- the moderation flag is how the previous version was defeated; the database refusing
-- to store the wrong value is the version that cannot be.
CREATE OR REPLACE FUNCTION match_profile_respect_moderation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.moderation_hidden THEN
    NEW.in_pool := false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER match_profile_moderation
  BEFORE INSERT OR UPDATE ON match_profile
  FOR EACH ROW EXECUTE FUNCTION match_profile_respect_moderation();

-- Anybody a reviewer already removed. Their in_pool was true again the moment they
-- next opened the app, so this is the only record of the decision that survived.
UPDATE match_profile
   SET moderation_hidden = true
 WHERE user_id IN (SELECT reported_id FROM reports WHERE outcome = 'account_blocked');

-- ── 1 + 2. the order the candidate query now asks for ──────────────────────────
-- Real first, then most recently active. Partial on in_pool because nothing outside
-- the pool is ever a candidate, and the planner can walk this index in order for the
-- LIMIT instead of sorting the whole pool.
CREATE INDEX match_profile_candidate_order
  ON match_profile (is_synthetic, last_active_at DESC)
  WHERE in_pool;
