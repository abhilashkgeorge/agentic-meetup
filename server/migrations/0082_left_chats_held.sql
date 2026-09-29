-- A CHAT OUTLIVES WHOEVER LEFT IT BY THIRTY DAYS, HIDDEN (the founder, 2026-09-29: "hidden
-- 30-day chat copy after deletion (reviewer-only, only with a report, auto-deleted, stated
-- in the privacy notice)").
--
-- WHAT WAS WRONG. Deleting an account deletes every chat it was in, both halves, at once
-- (erasure.ts). 0080 keeps a chat somebody had already reported; a chat nobody had
-- reported yet went with the account. So somebody could harass a person and delete their
-- account the same minute, and the person they harassed had nothing left to report --
-- not the words, not even a conversation to report from: it vanished from their list.
--
-- HOW IT WAS FOUND. docs/END-TO-END.md 15.2 item 7. tests/left-chat.test.ts plants it: a
-- chat, the one who wrote the threats deletes their account, and before this nothing of
-- it was left for the other person, or anybody, to report.
--
-- THE FIX. When an account is deleted, each chat it was in is held for the person who
-- stayed: a row in left_chats that is theirs, and the words in left_chat_messages.
--   - NOBODY READS THE WORDS. No role has any privilege on left_chat_messages but the
--     eraser's INSERT. The one way out is report_left_chat(): the person who stayed may
--     call it once, within the thirty days. It files a report about the one who left --
--     keyed to their phone and handsets, as 0079 keeps a report on somebody who deleted
--     their account, so a return under the same phone is known -- and copies the chat
--     into report_messages, which only the reviewer reads (0080).
--   - The person who stayed sees that they left: the name they knew, and when. Never the
--     keys, never the words.
--   - After thirty days the hold is deleted (erasure.ts forgetLeftChats, every ten
--     minutes); from the moment it expires it is invisible and unreportable, whatever the
--     sweep has done.
--   - A chat the two had blocked their way out of is not held: neither could see it.
-- The person who stayed deleting their own account takes their holds with them.

CREATE TABLE left_chats (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The person who stayed, whose list shows it.
  survivor_id       uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  -- The name they knew the one who left by.
  left_name         text,
  -- How to know the one who left again, as a ban and a kept report do: keys, never the
  -- number (0065, 0079).
  left_phone_hmac   text,
  left_device_hmacs text[]      NOT NULL DEFAULT '{}',
  -- The chat's last message, for the list's order.
  last_at           timestamptz,
  left_at           timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL DEFAULT now() + interval '30 days',
  reported_at       timestamptz
);
CREATE INDEX left_chats_survivor ON left_chats (survivor_id);
CREATE INDEX left_chats_expiry ON left_chats (expires_at);

CREATE TABLE left_chat_messages (
  left_chat_id uuid        NOT NULL REFERENCES left_chats(id) ON DELETE CASCADE,
  seq          bigint      NOT NULL,
  -- Said by the one who left (true) or by the one who stayed (false).
  from_left    boolean     NOT NULL,
  kind         text        NOT NULL,
  body         text        NOT NULL,
  sent_at      timestamptz NOT NULL,
  redacted_at  timestamptz,
  PRIMARY KEY (left_chat_id, seq)
);

ALTER TABLE left_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE left_chats FORCE ROW LEVEL SECURITY;
ALTER TABLE left_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE left_chat_messages FORCE ROW LEVEL SECURITY;

-- 0000 and 0026 hand every new table to clone_app (all four) and clone_eraser (SELECT).
REVOKE ALL ON left_chats, left_chat_messages
  FROM clone_app, clone_match, clone_matchmaker, clone_eraser, clone_door, clone_discovery;

-- The person who stayed: that they left, and when. Not the keys.
GRANT SELECT (id, survivor_id, left_name, last_at, left_at, expires_at, reported_at) ON left_chats TO clone_app;
CREATE POLICY left_chats_survivor ON left_chats FOR SELECT TO clone_app
  USING (survivor_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND expires_at > now());

-- The eraser writes a hold, and deletes it: its own person's, as the one who stayed, and
-- everybody's once the thirty days are up. It never reads the words back.
GRANT SELECT, INSERT, DELETE ON left_chats TO clone_eraser;
GRANT INSERT ON left_chat_messages TO clone_eraser;

-- The only way the words come out: the person who stayed reports the one who left, once,
-- in time. Returns the report, or NULL for a hold that is not theirs, is gone, has
-- expired, or was reported already -- all the same NULL.
CREATE FUNCTION report_left_chat(hold uuid, why text, what text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me     uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  h      left_chats%ROWTYPE;
  report uuid;
BEGIN
  SELECT * INTO h FROM left_chats
   WHERE id = hold AND survivor_id = me AND expires_at > now() AND reported_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO reports (reporter_id, reported_id, reason, detail,
                       reported_phone_hmac, reported_device_hmacs, reported_deleted_at)
  VALUES (me, NULL, why, left(what, 2000), h.left_phone_hmac, h.left_device_hmacs, h.left_at)
  RETURNING id INTO report;

  INSERT INTO report_messages (report_id, seq, from_reported, kind, body, sent_at, redacted_at)
  SELECT report, m.seq, m.from_left, m.kind, m.body, m.sent_at, m.redacted_at
    FROM left_chat_messages m WHERE m.left_chat_id = hold;

  UPDATE left_chats SET reported_at = now() WHERE id = hold;
  RETURN report;
END $$;
REVOKE ALL ON FUNCTION report_left_chat(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_left_chat(uuid, text, text) TO clone_app;
