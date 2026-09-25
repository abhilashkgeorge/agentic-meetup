-- 0064: bans that end an account's use of the app, and one test for "kept apart".
--
-- WHAT WAS WRONG. Two things, found building the founder's item 3 (block and report on
-- every card, profile and chat; an admin queue where he can ban someone):
--   1. A block stopped new matches (candidates.ts) and hid the conversation list
--      (api/messages.ts) -- and nothing else. Cards already made between the two people
--      stayed on both screens, the profile page still opened, and both still stood in
--      each other's town. "Blocking hides both people from each other everywhere,
--      forever" was true of the future only.
--   2. The reviewer's strongest outcome, 'account_blocked' (0039), hid the person's
--      photos and took them out of the pool, and left them signed in, chatting, and on
--      every card already made. There was no ban.
-- HOW IT WAS FOUND: reading every use of block_exists (four places: candidates, the
-- conversation list, sending a message, photo reads) against the routes that show a
-- person to somebody else, and admin.ts's account_blocked branch.
--
-- WHY THIS SHAPE.
--   bans         one row per ban. Nothing reads or writes it but the two functions
--                below, so no application role can lift or forge one. It outlives the
--                account (user_id is set null on erasure; 0065 adds the phone and the
--                device, so erasing is not a way back in).
--   is_banned()  what sign-in asks (auth.ts): a banned person's sessions are refused.
--   apart()      blocked either way, or the other person banned. Every route that
--                shows one person to another asks this one question, so "blocked" and
--                "banned" cannot drift apart route by route.
--   ban_user()   the one way to ban: writes the row, revokes every session, and sets
--                moderation_hidden -- which the 0048 trigger turns into out of the pool,
--                for good.
CREATE TABLE bans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reason     text NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  report_id  uuid REFERENCES reports(id) ON DELETE SET NULL,
  -- The reviewer. No foreign key on purpose: a reviewer's own erasure must not reach
  -- into somebody else's ban.
  banned_by  uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  lifted_at  timestamptz
);
CREATE INDEX bans_by_user ON bans (user_id) WHERE lifted_at IS NULL;
ALTER TABLE bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE bans FORCE ROW LEVEL SECURITY;
REVOKE ALL ON bans FROM clone_app, clone_match, clone_matchmaker;

CREATE FUNCTION is_banned(who uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM bans WHERE user_id = who AND lifted_at IS NULL)
$$;
REVOKE ALL ON FUNCTION is_banned(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_banned(uuid) TO clone_app, clone_match, clone_matchmaker;

CREATE FUNCTION apart(me uuid, other uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT block_exists(me, other) OR is_banned(other)
$$;
REVOKE ALL ON FUNCTION apart(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apart(uuid, uuid) TO clone_app, clone_match, clone_matchmaker;

CREATE FUNCTION ban_user(target uuid, reviewer uuid, why text, report uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE banned uuid;
BEGIN
  INSERT INTO bans (user_id, reason, report_id, banned_by)
       VALUES (target, why, report, reviewer)
    RETURNING id INTO banned;
  UPDATE device_sessions SET revoked_at = now() WHERE user_id = target AND revoked_at IS NULL;
  UPDATE match_profile SET moderation_hidden = true WHERE user_id = target;
  RETURN banned;
END;
$$;
REVOKE ALL ON FUNCTION ban_user(uuid, uuid, text, uuid) FROM PUBLIC;
-- The reviewer's routes run as the matchmaker (admin.ts): reports span two people.
GRANT EXECUTE ON FUNCTION ban_user(uuid, uuid, text, uuid) TO clone_matchmaker;

ALTER TABLE reports DROP CONSTRAINT reports_outcome_known;
ALTER TABLE reports ADD CONSTRAINT reports_outcome_known
  CHECK (outcome IS NULL OR outcome IN ('no_action', 'photos_hidden', 'account_blocked', 'banned'));
