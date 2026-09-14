-- 0025: three bugs in 0024, each found by a test that tried the thing a real person does.
--
-- 1. NOBODY COULD BE SENT A READ RECEIPT. The policy on `messages` was FOR ALL with a
--    WITH CHECK saying `sender_id = me`. WITH CHECK applies to the row an UPDATE
--    PRODUCES, so the recipient marking a message read wrote a row whose sender is the
--    other person and was refused. Read receipts were structurally impossible.
--
-- 2. BLOCKING ONLY WORKED IN ONE DIRECTION. The block check reads `blocks`, and the
--    policy there shows you only rows you wrote yourself. So the blocked person could
--    not see the block that names them, the check returned false, and their messages
--    kept arriving. The one function in the system whose entire job is to make somebody
--    stop did not stop them.
--
-- 3. ERASURE THREW. reports.reporter_id was NOT NULL with ON DELETE SET NULL -- a
--    combination that cannot fire. Deleting the account of anybody who had ever filed
--    or received a report raised a constraint violation instead.

-- ------------------------------------------------------------------ 1. receipts
DROP POLICY messages_participants ON messages;

-- Split, because the three verbs need three different answers.
CREATE POLICY messages_read ON messages FOR SELECT
  USING (EXISTS (
    SELECT r.id FROM rendezvous r
     WHERE r.id = messages.rendezvous_id
       AND NULLIF(current_setting('app.user_id', true), '')::uuid IN (r.user_a, r.user_b)));

-- Writing is still only ever as yourself, into an introduced pair. An agent-level yes
-- is not permission to write to somebody.
CREATE POLICY messages_send ON messages FOR INSERT
  WITH CHECK (
    sender_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (
      SELECT r.id FROM rendezvous r
       WHERE r.id = messages.rendezvous_id
         AND NULLIF(current_setting('app.user_id', true), '')::uuid IN (r.user_a, r.user_b)
         AND r.status = 'introduced'));

-- Either participant may update a message in their conversation -- the recipient to
-- mark it delivered and read, the sender to redact their own. WHICH COLUMNS is not a
-- thing RLS can say, so the column grant below says it instead: body and sender_id are
-- not updatable by the application role at all, and no policy can be got around to
-- rewrite what somebody said.
CREATE POLICY messages_receipts ON messages FOR UPDATE
  USING (EXISTS (
    SELECT r.id FROM rendezvous r
     WHERE r.id = messages.rendezvous_id
       AND NULLIF(current_setting('app.user_id', true), '')::uuid IN (r.user_a, r.user_b)))
  WITH CHECK (EXISTS (
    SELECT r.id FROM rendezvous r
     WHERE r.id = messages.rendezvous_id
       AND NULLIF(current_setting('app.user_id', true), '')::uuid IN (r.user_a, r.user_b)));

REVOKE UPDATE ON messages FROM clone_app;
GRANT UPDATE (delivered_at, read_at, redacted_at) ON messages TO clone_app;

-- No DELETE grant on messages, deliberately. "Delete for everyone" is `redacted_at`,
-- not a removed row, and erasure runs in an admin session -- so there is no path by
-- which the application role can make a message disappear from a conversation.

-- ------------------------------------------------------------------ 2. blocking
--
-- The blocked person must not be able to READ the block -- being told you are blocked
-- is the thing that makes somebody open a second account -- but the server must be
-- able to ASK. One function, SECURITY DEFINER, answering exactly one boolean question
-- and nothing else: no table, no ids, no timestamps, no way to enumerate.
--
-- Locked down as such a function must be: a fixed search_path so nothing it names can
-- be shadowed, no dynamic SQL, and EXECUTE revoked from PUBLIC before it is granted.
CREATE OR REPLACE FUNCTION block_exists(one uuid, two uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocks
     WHERE (blocker_id = one AND blocked_id = two)
        OR (blocker_id = two AND blocked_id = one))
$$;

REVOKE ALL ON FUNCTION block_exists(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION block_exists(uuid, uuid) TO clone_app;

-- Your own block list stays readable -- you can see who you blocked, and unblock them.
-- What you cannot see is who blocked you.

-- ------------------------------------------------------------------ 3. erasure
--
-- A report outlives the account of whoever filed it, with the name taken off: the
-- safety signal about the OTHER person is not the reporter's to withdraw, and three
-- reports from three people is the pattern that matters. Same shape as invites --
-- "reported on this date, by nobody we can name".
ALTER TABLE reports ALTER COLUMN reporter_id DROP NOT NULL;
ALTER TABLE reports DROP CONSTRAINT reports_reporter_id_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_reporter_id_fkey
  FOREIGN KEY (reporter_id) REFERENCES app_users(id) ON DELETE SET NULL;

-- The reported account leaving takes its reports with it. A report is a claim about a
-- person; with the person gone there is nobody for it to be about, and keeping it
-- would be keeping an accusation against somebody who has left.
ALTER TABLE reports DROP CONSTRAINT reports_reported_id_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_reported_id_fkey
  FOREIGN KEY (reported_id) REFERENCES app_users(id) ON DELETE CASCADE;

-- reports stays write-only to the application role. Erasure clears it from an admin
-- session, where the clearing can be verified, rather than by granting the app a
-- privilege that only erasure would ever use.
