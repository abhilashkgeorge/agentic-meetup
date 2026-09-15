-- 0045: a person, rather than a device.
--
-- Until now the account WAS the device. That is written down as a virtue in
-- api/auth.ts -- "the account is the device until there is a reason for it not to
-- be" -- and there are now three reasons, all of them live:
--
--   1. Lose the phone, lose the clone. Everything the product is worth is the pile
--      of things it has learned about you, and the only key to that pile was a
--      string in one keychain. There was no recovery path of any kind: no sign-in,
--      no email, nothing. Getting back in required the database and the signing key.
--   2. One person, two devices, two clones. Already happened here: an iPhone was
--      added beside an Android and redeemed a second invite, so there are now two
--      accounts, two fact stores and two half-taught agents for one human.
--   3. Nothing keeps anybody out. A removed person reinstalls, takes an invite and
--      is back in a minute. A phone number is the cheapest thing a stranger has that
--      costs real money to replace, which is the only property that matters for a
--      product where strangers meet.
--
-- WHAT IS STORED IS NOT THE NUMBER.
--
-- `phone_hmac` is HMAC-SHA256 of the E.164 number under a server-side pepper. It is
-- deterministic, so it works as a lookup key and as a ban key, and it is one-way, so
-- this database is not a phone book. Nothing here ever needs to send to a stored
-- number: verification always starts from a number the person just typed, so the
-- plaintext genuinely has no job to do and is therefore not kept. A dump of this
-- table tells an attacker nothing about who is on the product without the pepper,
-- and the pepper is not in the database.
--
-- The trade is honest and worth naming: support cannot look somebody up by their
-- number, and neither can we. That is the intended cost.

ALTER TABLE app_users
  ADD COLUMN phone_hmac         text,
  ADD COLUMN phone_verified_at  timestamptz;

-- GLOBALLY unique, not per-tenant. One tenant per person is how this schema isolates
-- data, so a per-tenant constraint would permit exactly the thing this migration
-- exists to stop: the same human holding two accounts. Partial, because the column
-- is null for every account that predates this and for the dev self-signup path.
CREATE UNIQUE INDEX app_users_phone_hmac_key
  ON app_users (phone_hmac) WHERE phone_hmac IS NOT NULL;

-- One row per "send me a code". Short-lived, single-use, and the only thing standing
-- between a phone number and an account.
CREATE TABLE phone_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hmac   text NOT NULL,
  -- HMAC of the code, never the code. A challenge row leaking must not hand over a
  -- working credential, and an operator reading this table over somebody's shoulder
  -- must not be able to sign in as them.
  code_hmac    text NOT NULL,
  attempts     int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  -- Set when the right code is typed. From here the row is a ticket: proof this
  -- number was verified, spendable once, on a longer clock than the code itself.
  verified_at  timestamptz,
  -- Set when the ticket is spent, by signing in or by redeeming an invite. A
  -- consumed row is inert for ever after; it is never reset.
  consumed_at  timestamptz,
  -- Kept for rate limiting and for reading back an attack afterwards. Not an
  -- identity: a phone behind carrier NAT shares it with a city.
  created_ip   text
);

CREATE INDEX phone_challenges_by_phone ON phone_challenges (phone_hmac, created_at DESC);
CREATE INDEX phone_challenges_expiry   ON phone_challenges (expires_at);

-- NO ROW LEVEL SECURITY, and that is not an oversight. A challenge exists before
-- there is an account, so there is no tenant to compare against -- the same reason
-- `invites` carries none. The boundary is that only the owner connection may touch
-- this table at all, which the revoke below makes true.
--
-- THE REVOKE IS THE POINT. Migration 0000 runs ALTER DEFAULT PRIVILEGES granting
-- clone_app SELECT/INSERT/UPDATE/DELETE on every table created afterwards, so least
-- privilege here is opt-OUT. Without this line the application role could read every
-- code hash and every phone hash in the system.
REVOKE ALL ON phone_challenges FROM clone_app, clone_match, clone_matchmaker;

-- The eraser must be able to remove somebody's challenges along with everything else
-- when they ask to be forgotten.
--
-- SELECT is granted on ONE COLUMN, not the table. Postgres requires SELECT on every
-- column a DELETE's WHERE clause reads, so `DELETE ... WHERE phone_hmac = $1` cannot
-- run on DELETE alone -- and granting plain SELECT would hand the eraser every code
-- hash in the system to satisfy a clause that only ever looks at one column.
GRANT SELECT (phone_hmac) ON phone_challenges TO clone_eraser;
GRANT DELETE ON phone_challenges TO clone_eraser;
