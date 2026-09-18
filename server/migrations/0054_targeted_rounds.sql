-- 0054: a round can be aimed at one person.
--
-- The town (the 3D Home) lets somebody tap a stranger's agent and send their own
-- agent over to talk to that one person. That is an ordinary round with a single
-- candidate, so it is the same table and the same worker; the only new fact is who it
-- was aimed at. Nullable: an ordinary round aims at nobody in particular.
--
-- ON DELETE SET NULL, not CASCADE: the round happened and cost money whether or not
-- the person it was aimed at is still here, and the spend ledger reconciles against
-- these rows. No new table, so no new grants or revokes; `rounds` already carries its
-- policies (0049) and is in the eraser's list.
ALTER TABLE rounds ADD COLUMN target_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL;

COMMENT ON COLUMN rounds.target_user_id IS
  'The one person this round was aimed at, when it was; null for an ordinary round. '
  'Counted per day as a spend control -- see TARGETED_ROUNDS_PER_DAY.';
