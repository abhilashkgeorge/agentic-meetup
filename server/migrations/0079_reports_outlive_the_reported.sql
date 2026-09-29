-- REPORTS AGAINST SOMEBODY OUTLIVE THEIR ACCOUNT (the founder, 2026-09-29: "Deleting an
-- account must keep the reports against that person").
--
-- WHAT WAS WRONG. 0025 made a report cascade away with the account it was about -- "a
-- report is a claim about a person; with the person gone there is nobody for it to be
-- about". That made deleting your account the way to wipe every report against you:
-- three people reporting you, a clean record a minute later. And erasure frees the phone
-- number for a new signup (erasure.ts), so the same person came back with nothing on
-- them. A ban already outlives the account (0064, 0065); the reports it rests on did not.
--
-- HOW IT WAS FOUND. docs/END-TO-END.md 15.2 item 7, from reading 0025 and erasure.ts.
-- tests/erasure-keeps-reports.test.ts plants it: somebody reported deletes their account,
-- and before this the report was gone.
--
-- THE FIX. The report stays, and loses only the account id: reported_id ON DELETE SET
-- NULL. Before the account goes, the erasure copies onto each report against them the
-- keys a ban already keeps to know the same person again -- their phone's HMAC and the
-- handsets they signed in on (0065) -- and when. Keys only, never the number: the HMAC is
-- keyed with the server's pepper and says nothing without it.
--   reported_now(report)   who the report is about today: the account; or, deleted, the
--                          account they came back as (same phone, or a handset they used);
--                          or nobody.
--   reports_about(report)  how many reports, from how many people, about that same
--                          person -- the kept ones counted with the live ones.
-- Both are SECURITY DEFINER because the review role reads reports and never phones.

ALTER TABLE reports ALTER COLUMN reported_id DROP NOT NULL;
ALTER TABLE reports DROP CONSTRAINT reports_reported_id_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_reported_id_fkey
  FOREIGN KEY (reported_id) REFERENCES app_users(id) ON DELETE SET NULL;

ALTER TABLE reports
  ADD COLUMN reported_phone_hmac   text,
  ADD COLUMN reported_device_hmacs text[] NOT NULL DEFAULT '{}',
  ADD COLUMN reported_deleted_at   timestamptz;

-- The erasure writes the keys; nothing else may.
GRANT UPDATE (reported_phone_hmac, reported_device_hmacs, reported_deleted_at) ON reports TO clone_eraser;

CREATE FUNCTION reported_now(report uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(r.reported_id, (
           SELECT u.id FROM app_users u
            WHERE (r.reported_phone_hmac IS NOT NULL AND u.phone_hmac = r.reported_phone_hmac)
               OR EXISTS (SELECT 1 FROM device_sessions s
                           WHERE s.user_id = u.id AND s.device_hmac = ANY (r.reported_device_hmacs))
            ORDER BY u.created_at DESC
            LIMIT 1))
    FROM reports r
   WHERE r.id = report;
$$;

CREATE FUNCTION reports_about(report uuid, OUT reports int, OUT reporters int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH who AS (
    SELECT reported_now(r.id) AS now_id,
           COALESCE(r.reported_phone_hmac,
                    (SELECT u.phone_hmac FROM app_users u WHERE u.id = r.reported_id)) AS phone
      FROM reports r
     WHERE r.id = report)
  SELECT count(*)::int, count(DISTINCT x.reporter_id)::int
    FROM reports x, who
   WHERE x.reported_id = who.now_id
      OR (who.phone IS NOT NULL AND x.reported_phone_hmac = who.phone);
$$;

REVOKE ALL ON FUNCTION reported_now(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports_about(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reported_now(uuid) TO clone_matchmaker;
GRANT EXECUTE ON FUNCTION reports_about(uuid) TO clone_matchmaker;

-- And the erasure may no longer delete a report at all: it used to, for the reports
-- against the person, and now keeps them. Taking the right away makes that a rule the
-- database keeps, not one the code has to remember.
REVOKE DELETE ON reports FROM clone_eraser;
