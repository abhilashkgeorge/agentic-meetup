-- 0033: reordering photos fought its own unique index.
--
-- `position` is unique per person, so moving the first picture into the third slot
-- collides with whatever is already there. The usual workaround is to shuffle
-- everything out to a scratch range first and back again -- which then collides with
-- the CHECK that says a position is 0 to 5, because there is no scratch range inside
-- six slots.
--
-- Postgres has the real answer: defer the constraint to the end of the transaction.
-- The intermediate states are allowed to be nonsense, and what must hold is the state
-- that is committed. One pass, no scratch values, and a failure rolls back to the
-- order that was there before rather than to a half-shuffled mess.
ALTER TABLE photos DROP CONSTRAINT photos_user_id_position_key;
ALTER TABLE photos ADD CONSTRAINT photos_user_position
  UNIQUE (user_id, position) DEFERRABLE INITIALLY IMMEDIATE;
