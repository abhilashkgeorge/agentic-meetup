-- 0046: an invite that does not get used up.
--
-- WHY. Testing the new-account path end to end means redeeming an invite, and an
-- invite is single-use by design, so every pass through the flow needed a fresh code
-- minted by hand. That friction lands entirely on the person doing the testing, which
-- is the person who most needs the loop to be quick.
--
-- WHAT THIS IS, PLAINLY: a credential that creates unlimited accounts and never
-- expires. That is a backdoor. It is worth having only because two things make it
-- inert anywhere but a laptop:
--
--   1. The column defaults to false, so no existing invite changes behaviour.
--   2. `redeem` honours it ONLY when ALLOW_REUSABLE_INVITES is on, and the server
--      refuses to boot with that flag in production. With the flag off the redeem
--      path refuses a reusable row outright rather than treating it as a normal
--      invite -- so a row restored into a real database from a development dump is
--      dead, not merely limited to one account.
--
-- Both are needed. A flag alone would be a footgun the day somebody copies .env; a
-- column alone would be a live backdoor sitting in the table.
ALTER TABLE invites ADD COLUMN reusable boolean NOT NULL DEFAULT false;

-- Deliberately not indexed. There is one of these, on one laptop.
COMMENT ON COLUMN invites.reusable IS
  'Dev only. Redeem never spends this code. Inert unless ALLOW_REUSABLE_INVITES is on, '
  'which production refuses at boot.';
