-- 0039: somebody has to be able to read a report, hide a photo, and agree to terms.
--
-- Three gaps that are each individually small and together are the difference between
-- a closed beta and a liability, plus two grants that should never have been there.
--
-- 1. REPORTS WERE WRITE-ONLY. `reports` has carried a `reviewed_at` column since
--    0024 and nothing in src/ has ever read the table -- no endpoint, no script, no
--    query. A person could report somebody and the report went into a drawer with no
--    handle on it. The columns below are what a reviewer needs to leave a decision
--    behind: who looked, what they concluded, and why.
--
-- 2. PHOTOS HAD NO OFF SWITCH. Uploads are re-encoded, EXIF-stripped and bomb-guarded,
--    which handles the accidental cases and none of the deliberate ones. There was no
--    way to take a picture down short of deleting the account.
--
--    `hidden_at` rather than a delete: a moderation decision has to be reversible and
--    has to leave evidence. A hidden photo still exists, still belongs to its owner,
--    and stops being served to anybody -- including the owner's matches -- the moment
--    it is set.
--
--    AUTO-HIDING ON REPORT IS DELIBERATELY NOT DONE HERE. One malicious report would
--    then take somebody's face off the product, which is a griefing tool. The
--    threshold rule (two distinct reporters) lives in the application where it can be
--    tuned without a migration.
--
-- 3. NOBODY EVER AGREED TO ANYTHING. No terms, no privacy notice, no age attestation
--    was recorded anywhere -- 0036 enforces the age but nothing captured the person
--    saying it. A separate table rather than a column on app_users, because consent
--    is an event with a version and a time, and re-consenting to a new version must
--    not overwrite the fact that they accepted the old one.
--
-- 4. THE TWO GRANTS. `tenants` and `erasure_log` carry no row-level security and are
--    granted to `clone_app`, so anything running as the application could list every
--    tenant and read every erasure ever performed. Nothing in src/ does: `tenants` is
--    touched only by seed scripts on the migration connection, and the erasure log is
--    written during account deletion, which is exactly what `clone_eraser` exists for.

-- ── reports: a reviewer can now leave a decision ─────────────────────────────
ALTER TABLE reports
  ADD COLUMN outcome     text,
  ADD COLUMN reviewed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN review_note text NOT NULL DEFAULT '';

ALTER TABLE reports
  ADD CONSTRAINT reports_outcome_known
  CHECK (outcome IS NULL OR outcome IN ('no_action', 'photos_hidden', 'account_blocked'));

-- A reviewed report has an outcome and vice versa; half-finished review states are a
-- source of "did anybody actually look at this" arguments later.
ALTER TABLE reports
  ADD CONSTRAINT reports_review_is_complete
  CHECK ((reviewed_at IS NULL) = (outcome IS NULL));

CREATE INDEX IF NOT EXISTS reports_open ON reports (created_at) WHERE reviewed_at IS NULL;

-- ── photos: an off switch that is reversible and leaves evidence ─────────────
ALTER TABLE photos
  ADD COLUMN hidden_at     timestamptz,
  ADD COLUMN hidden_reason text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS photos_hidden ON photos (user_id) WHERE hidden_at IS NOT NULL;

-- The visibility function is where this has to bite. A caller asking for somebody's
-- photos must not receive a hidden one, and the rule belongs here rather than at the
-- four call sites that would each have to remember it.
CREATE OR REPLACE FUNCTION visible_photos(owner uuid, viewer uuid)
RETURNS TABLE (id uuid, slot int, width int, height int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.position, p.width, p.height
    FROM photos p
   WHERE p.user_id = owner
     AND p.hidden_at IS NULL
     AND photos_visible_to(owner, viewer)
   ORDER BY p.position;
$$;

-- ── consent: an event, with a version and a time ─────────────────────────────
CREATE TABLE consents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  -- 'terms', 'privacy', 'age' -- separate rows, because they can be versioned and
  -- withdrawn independently and a single boolean cannot express that.
  document    text NOT NULL,
  version     text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, document, version)
);

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents FORCE ROW LEVEL SECURITY;
CREATE POLICY consents_isolation ON consents
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id   = NULLIF(current_setting('app.user_id',   true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
          AND user_id   = NULLIF(current_setting('app.user_id',   true), '')::uuid);

GRANT SELECT, INSERT ON consents TO clone_app;
-- Never updated and never deleted by the application: a consent record that can be
-- edited by the party relying on it is not evidence of anything.

-- ── the two grants ───────────────────────────────────────────────────────────
REVOKE ALL ON tenants FROM clone_app;

-- The erasure log moves to the role that performs erasures. `clone_eraser` is
-- BYPASSRLS by design -- it exists to verify that rows actually went away -- so it can
-- write the log for the account it is in the middle of deleting, and the application
-- role loses the ability to read who has left.
GRANT INSERT, UPDATE, SELECT ON erasure_log TO clone_eraser;
REVOKE ALL ON erasure_log FROM clone_app;
