-- 0027: the missing middle. Agents decide, and then nothing happens.
--
-- `/v1/matches` returned a hard-coded empty list, no endpoint wrote `human_says_yes`,
-- and no code path anywhere set a rendezvous to 'introduced'. The messaging built in
-- 0024 was therefore unreachable: its RLS requires an introduced pair, and nothing
-- could produce one. Two working halves with no join between them.
--
-- Two columns close it.

-- A first name to show. Deliberately NOT read from the fact store at reveal time: the
-- matching role can see match_profile and nothing else, and giving it a way to read
-- facts to fetch a name would hand it a way to read facts.
--
-- First name only. A full name is a search query for somebody who has not yet decided
-- whether to meet you, and dating apps that show surnames are how people get found on
-- LinkedIn before a first date.
ALTER TABLE match_profile ADD COLUMN display_name text;

-- Who sees the other's profile first.
--
-- The asymmetry is the point. Whichever side receives more matches decides ALONE and
-- FIRST, and only then is their profile shown to the other. Dating apps run heavily
-- one-sided; without this the flooded side is flooded again here, and an app whose
-- busier side leaves becomes a one-gender app. Both sides must still say yes, so it
-- gates the order, never the outcome.
ALTER TABLE rendezvous ADD COLUMN first_mover uuid REFERENCES app_users(id) ON DELETE CASCADE;

COMMENT ON COLUMN rendezvous.first_mover IS
  'The side that sees the other profile first. Set when the runs finish, from who has '
  'the larger inbox. Never a permission: both people still have to say yes.';

GRANT SELECT ON rendezvous TO clone_match;
