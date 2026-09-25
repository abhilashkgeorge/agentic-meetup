-- 0065: a ban sticks to the phone number and to the phone, not only to the account.
--
-- WHAT WAS WRONG. 0064's ban names an account, and an account is easy to replace.
-- Every door that makes one (auth.ts: invite redeem, phone verify, the dev device
-- signup, the legacy upgrade) asked nothing about bans at all. So a banned person
-- could (a) put a new SIM in the same phone, verify the new number and redeem an
-- invite; (b) once the account was erased, sign up again with the very same number --
-- erasure sets bans.user_id to NULL, and after that the ban points at nobody. The
-- founder's item 4: "bans that stick (phone number + device); a new SIM on the same
-- phone can't get back in."
-- HOW IT WAS FOUND: reading auth.ts's doors against 0064 -- is_banned() asks by user
-- id, and none of the doors has a user id to ask with yet.
--
-- WHY THIS SHAPE.
--   device_sessions.device_hmac  the handset a session was made on: the id the app
--                sends as X-Device-Id (ANDROID_ID; a keychain id on iPhone -- both
--                survive a new SIM and deleting the app), keyed with the phone
--                number pepper (server/src/phone.ts). Never the raw id.
--   ban_marks    what a ban holds against: 'phone' (the account's phone_hmac) and
--                'device' (every handset its sessions were made on). No foreign key
--                to the person, so erasing the account cannot erase the marks; they
--                go only with the ban itself.
--   mark_banned  the one question the doors ask, before an invite is spent or a
--                session is made. SECURITY DEFINER: no application role can read
--                bans or ban_marks, so none can list who is banned.
--   ban_user     now writes the marks in the same statement group as the ban. The
--                REVIEWER'S OWN handsets are never marked: the founder testing a ban
--                on an account made on his own phone must not lock that phone out.
CREATE TABLE ban_marks (
  ban_id  uuid NOT NULL REFERENCES bans(id) ON DELETE CASCADE,
  kind    text NOT NULL CHECK (kind IN ('phone', 'device')),
  mark    text NOT NULL CHECK (length(mark) BETWEEN 16 AND 128),
  PRIMARY KEY (kind, mark, ban_id)
);
ALTER TABLE ban_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ban_marks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ban_marks FROM clone_app, clone_match, clone_matchmaker;

-- Nullable: sessions made before this, and by an app built before it, carry none.
ALTER TABLE device_sessions ADD COLUMN device_hmac text
  CHECK (device_hmac IS NULL OR length(device_hmac) BETWEEN 16 AND 128);

CREATE FUNCTION mark_banned(what text, mark text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT mark_banned.mark IS NOT NULL AND EXISTS (
    SELECT 1 FROM ban_marks m JOIN bans b ON b.id = m.ban_id
     WHERE m.kind = mark_banned.what AND m.mark = mark_banned.mark AND b.lifted_at IS NULL)
$$;
REVOKE ALL ON FUNCTION mark_banned(text, text) FROM PUBLIC;
-- The doors run as clone_app (adminSession) -- and, until item 6 moves it, the owner.
GRANT EXECUTE ON FUNCTION mark_banned(text, text) TO clone_app;

CREATE OR REPLACE FUNCTION ban_user(target uuid, reviewer uuid, why text, report uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE banned uuid;
BEGIN
  INSERT INTO bans (user_id, reason, report_id, banned_by)
       VALUES (target, why, report, reviewer)
    RETURNING id INTO banned;
  INSERT INTO ban_marks (ban_id, kind, mark)
    SELECT banned, 'phone', u.phone_hmac FROM app_users u
     WHERE u.id = target AND u.phone_hmac IS NOT NULL
    UNION
    SELECT banned, 'device', s.device_hmac FROM device_sessions s
     WHERE s.user_id = target AND s.device_hmac IS NOT NULL
       AND s.device_hmac NOT IN (
         SELECT r.device_hmac FROM device_sessions r
          WHERE r.user_id = reviewer AND r.device_hmac IS NOT NULL)
  ON CONFLICT DO NOTHING;
  UPDATE device_sessions SET revoked_at = now() WHERE user_id = target AND revoked_at IS NULL;
  UPDATE match_profile SET moderation_hidden = true WHERE user_id = target;
  RETURN banned;
END;
$$;
