-- 0007: erasure receipts. W6.
--
-- Deliberately OUTSIDE the per-user tables it records, and deliberately NOT deleted by
-- an erasure: the receipt is the evidence the erasure happened. It holds counts and
-- timestamps only -- never content -- so keeping it does not defeat the deletion.
CREATE TABLE erasure_log (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  user_id       uuid NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  /** { "facts": 812, "episodes": 3104, ... } — counts, never rows. */
  deleted_counts jsonb,
  /** Verification: every table asserted empty for this user afterwards. */
  verified      boolean NOT NULL DEFAULT false,
  notes         text
);
CREATE INDEX erasure_log_user ON erasure_log (user_id, requested_at DESC);
