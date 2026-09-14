-- 0016: a used invite must survive the erasure of whoever used it.
--
-- Found by a test, not by a user, which is the only acceptable way to find this.
--
-- `invites.used_by` is ON DELETE SET NULL, so erasing an account nulls that column and
-- leaves `used_at` set. `invites_used_together` demanded the two be null or non-null
-- together, so the DELETE failed -- meaning any account that had ever redeemed a code
-- could not be erased. An erasure path that fails on ordinary data is not an erasure
-- path.
--
-- The biconditional was wrong about the world. "This code was used on the 4th, and we
-- no longer know by whom" is not a corrupt row: it is precisely the state erasure is
-- supposed to produce. What must stay true is the other direction -- a row that names
-- a user must also say when.
--
-- The code is not freed by any of this: `reserved_for` carries no foreign key, so it
-- survives the cascade and the code stays spent.
ALTER TABLE invites DROP CONSTRAINT invites_used_together;

ALTER TABLE invites ADD CONSTRAINT invites_used_by_implies_used_at
  CHECK (used_by IS NULL OR used_at IS NOT NULL);
