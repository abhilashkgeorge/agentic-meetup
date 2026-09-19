-- 0057: points.
--
-- WHAT THEY ARE. Earned for ANSWERING -- "did you two meet", the after-date check-in,
-- building a character, passing the photo check -- a fixed amount each, never for
-- what was answered. Spent on character items. Visible only to their owner:
-- memory/completion.ts says why a gauge other people can see turns self-disclosure
-- into a scored performance, and that rule holds here.
--
-- WHY A LEDGER. Append-only from the app: a ledger the application can edit is a
-- number, not a ledger. UNIQUE (user_id, reason, ref) is the whole of idempotency --
-- a retried request, a re-run photo check, a second tap on the same answer all
-- collapse to one row, and a refund is a new negative row, never an edit.
CREATE TABLE points_ledger (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  reason     text NOT NULL CHECK (reason IN ('checkin', 'met', 'look', 'photos_checked', 'buy')),
  ref        text NOT NULL,                       -- a rendezvous id, 'self', or the item bought
  amount     int  NOT NULL CHECK (amount <> 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, reason, ref)
);
CREATE INDEX points_by_user ON points_ledger (user_id);
ALTER TABLE points_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY points_mine_read ON points_ledger FOR SELECT TO clone_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY points_mine_write ON points_ledger FOR INSERT TO clone_app
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
          AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
REVOKE UPDATE, DELETE ON points_ledger FROM clone_app;
REVOKE ALL ON points_ledger FROM clone_match, clone_matchmaker;
-- Erasure is the one delete, and the eraser is what does it (ERASER_ONLY in erasure.ts).
GRANT DELETE ON points_ledger TO clone_eraser;
