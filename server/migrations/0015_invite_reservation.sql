-- 0015: reserving a code and recording who used it are two different things.
--
-- The bug this fixes, found by running the flow end to end:
--
--   `invites.used_by` references `app_users(id)`, and a code has to be claimed BEFORE
--   the account exists -- otherwise two devices racing on one code can both win.
--   Claiming with a pre-generated id violated the foreign key; claiming in two steps
--   (used_at now, used_by later) violated `invites_used_together`. Both constraints
--   were right. The model was wrong: one column was being asked to mean "spoken for"
--   and "belongs to" at once, and those happen at different times.
--
-- So they are separated. `reserved_for` is a bare uuid with no foreign key, written
-- atomically at claim time -- it points at an account that does not exist yet, which
-- is exactly why it cannot be a reference. `used_by` is the real reference, written
-- once the account is there, and it is what survives for auditing.
ALTER TABLE invites DROP CONSTRAINT invites_used_together;

ALTER TABLE invites ADD COLUMN reserved_for uuid;
ALTER TABLE invites ADD COLUMN reserved_at  timestamptz;

-- Backfill: anything already redeemed was reserved by whoever used it.
UPDATE invites SET reserved_for = used_by, reserved_at = used_at WHERE used_by IS NOT NULL;

ALTER TABLE invites ADD CONSTRAINT invites_reserved_together
  CHECK ((reserved_for IS NULL) = (reserved_at IS NULL));

-- A code cannot be recorded as used without having been reserved first. This is the
-- ordering the two-step claim gets wrong when written by hand.
ALTER TABLE invites ADD CONSTRAINT invites_used_implies_reserved
  CHECK (used_by IS NULL OR reserved_for IS NOT NULL);

ALTER TABLE invites ADD CONSTRAINT invites_used_together
  CHECK ((used_by IS NULL) = (used_at IS NULL));
