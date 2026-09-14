-- 0041: the reviewer's connection needs to be able to see what it is reviewing.
--
-- 0039 built the moderation path and the tests failed immediately with
-- `permission denied for table reports`, which is the roles doing their job: nothing
-- in this schema gets to read a table because some new code would like to.
--
-- Two facts made this necessary. `clone_app` has INSERT and UPDATE on `reports` and
-- deliberately NOT SELECT -- the table has always been write-only from the
-- application, which is why the reports sat unread. And `clone_matchmaker` had only
-- SELECT on `match_profile` and nothing at all on `reports` or `photos`.
--
-- WHY THE MATCHMAKER ROLE AND NOT A NEW ONE. A fifth role (`clone_reviewer`) is the
-- textbook answer and was the first draft. It was dropped because it buys very little
-- here and costs a connection string, a pool, a password and a deployment step: the
-- matchmaker already reads every user's profile and every brief across every tenant,
-- so it is already the role that sees people rather than rows. Reports are about
-- matched people. If moderation ever grows past one person with curl, split it out --
-- and this comment is the note saying that was a considered decision, not an
-- oversight.
--
-- Everything below is the narrowest grant that makes the three admin routes work:
-- read reports and write a decision on them, hide and unhide a photograph, and take
-- somebody out of the pool. No DELETE anywhere -- a reviewer must not be able to
-- destroy the evidence a report is about.

-- ── reports: read the queue, write the decision ──────────────────────────────
GRANT SELECT, UPDATE ON reports TO clone_matchmaker;
CREATE POLICY reports_matchmaker ON reports FOR SELECT
  TO clone_matchmaker USING (true);
CREATE POLICY reports_matchmaker_review ON reports FOR UPDATE
  TO clone_matchmaker USING (true) WITH CHECK (true);

-- ── photos: hide and unhide, never delete ────────────────────────────────────
GRANT SELECT, UPDATE ON photos TO clone_matchmaker;
CREATE POLICY photos_matchmaker ON photos FOR SELECT
  TO clone_matchmaker USING (true);
CREATE POLICY photos_matchmaker_hide ON photos FOR UPDATE
  TO clone_matchmaker USING (true) WITH CHECK (true);

-- ── match_profile: take somebody out of the pool ─────────────────────────────
--
-- The matchmaker already writes this table's `in_pool` nowhere else; the grant is new
-- and the policy is scoped to UPDATE so a review cannot create or remove a profile.
GRANT UPDATE ON match_profile TO clone_matchmaker;
CREATE POLICY match_profile_matchmaker_review ON match_profile FOR UPDATE
  TO clone_matchmaker USING (true) WITH CHECK (true);
