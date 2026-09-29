-- A REPORTED CHAT OUTLIVES BOTH ACCOUNTS (the founder, 2026-09-29: "When an account is
-- deleted, keep any messages that are part of a report, so evidence survives").
--
-- WHAT WAS WRONG. A report about a chat kept only the chat's id (0024 rendezvous_id).
-- Deleting either account deletes the pair, and the pair takes every message in it, both
-- sides (erasure.ts SHARED_TABLES; messages cascade from rendezvous). So somebody reported
-- for what they wrote could delete their account and their words went with it: the
-- report stayed (0079) with a reason and a note, and nothing that was said. And even with
-- both accounts alive no reviewer could read a reported chat -- no admin route read
-- messages at all.
--
-- HOW IT WAS FOUND. Reading erasure.ts after 0079. tests/report-keeps-chat.test.ts plants
-- it: a chat, a report, the reported person deletes their account -- before this, no
-- word of the chat was left anywhere.
--
-- THE FIX. When a report is made, the database copies the chat between the two people --
-- the last 200 messages -- into report_messages, beside the report. Each line is marked
-- as said by the person reported or by the one reporting, never by user id: the copy
-- outlives both accounts and names neither. A copy AT THE MOMENT OF THE REPORT, not at
-- the deletion:
--   - it is what the reporter was looking at when they reported. Nothing sent later can
--     join it (a report blocks), and a "delete for everyone" afterwards cannot rewrite it;
--   - erasure has nothing to remember: the copy belongs to the report, and erasure never
--     deletes a report (0079);
--   - a trigger, so every way a report is made -- a card, a chat, the park -- gets it, and
--     the application has no way to write evidence of its own.
-- The chat is found from the two people, not from the rendezvous id on the report: that
-- id comes from the phone and a report naming a person never checked it
-- (api/messages.ts), so following it could copy somebody else's conversation in.
-- Words taken back with "delete for everyone" are copied, words and all, with when: 0024
-- kept those rows for exactly this.
--
-- WHO READS IT. The reviewer only (clone_matchmaker, api/admin.ts). The application role
-- can neither read nor write it; the eraser cannot touch it.

CREATE TABLE report_messages (
  report_id     uuid        NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  -- Its place in the chat (messages.seq), so the copy reads in order.
  seq           bigint      NOT NULL,
  -- Said by the person reported (true) or by the one who reported them (false).
  from_reported boolean     NOT NULL,
  kind          text        NOT NULL,
  body          text        NOT NULL,
  sent_at       timestamptz NOT NULL,
  -- Taken back ("delete for everyone") before the report was made.
  redacted_at   timestamptz,
  PRIMARY KEY (report_id, seq)
);

ALTER TABLE report_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_messages FORCE ROW LEVEL SECURITY;
-- 0000 and 0026 hand every new table to clone_app (all four) and clone_eraser (SELECT).
REVOKE ALL ON report_messages FROM clone_app, clone_match, clone_eraser, clone_door, clone_discovery;
GRANT SELECT ON report_messages TO clone_matchmaker;
CREATE POLICY report_messages_review ON report_messages FOR SELECT
  TO clone_matchmaker USING (true);

CREATE FUNCTION keep_reported_chat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO report_messages (report_id, seq, from_reported, kind, body, sent_at, redacted_at)
  SELECT NEW.id, m.seq, m.sender_id = NEW.reported_id, m.kind, m.body, m.sent_at, m.redacted_at
    FROM rendezvous r
    CROSS JOIN LATERAL (SELECT * FROM messages x WHERE x.rendezvous_id = r.id
                         ORDER BY x.seq DESC LIMIT 200) m
   -- A pair is stored lowest id first (0022 rendezvous_ordered), once.
   WHERE r.user_a = LEAST(NEW.reporter_id, NEW.reported_id)
     AND r.user_b = GREATEST(NEW.reporter_id, NEW.reported_id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION keep_reported_chat() FROM PUBLIC;

CREATE TRIGGER reports_keep_chat AFTER INSERT ON reports
  FOR EACH ROW EXECUTE FUNCTION keep_reported_chat();

-- Reports made before this, while both people are still here: their chat as it stood
-- when the report was made.
INSERT INTO report_messages (report_id, seq, from_reported, kind, body, sent_at, redacted_at)
SELECT rp.id, m.seq, m.sender_id = rp.reported_id, m.kind, m.body, m.sent_at, m.redacted_at
  FROM reports rp
  JOIN rendezvous r ON r.user_a = LEAST(rp.reporter_id, rp.reported_id)
                   AND r.user_b = GREATEST(rp.reporter_id, rp.reported_id)
  CROSS JOIN LATERAL (SELECT * FROM messages x WHERE x.rendezvous_id = r.id AND x.sent_at <= rp.created_at
                       ORDER BY x.seq DESC LIMIT 200) m;
