-- 0078: points for doing things together in Cubbon Park.
--
-- WHAT WAS MISSING. The founder, 2026-09-29: "add more tasks couples can do in the park.
-- gameify it." Two people talking in the park can now walk together, ride together, sit
-- and talk, and see the sights (shared/src/park-quests.ts), and each done pays both of
-- them points, once a day each. The ledger's reasons are a closed list (0057), so a park
-- reason would be refused at the insert.
--
-- HOW IT WAS MEASURED (2026-09-29, the dev database): pg_constraint on points_ledger
-- has points_ledger_reason_check = reason IN ('checkin', 'met', 'look',
-- 'photos_checked', 'buy'), and nothing else constrains the reason.
--
-- WHY THIS FIX. One reason per thing to do, so the ledger says what each payment was
-- for, and the ref is the day in Bengaluru (parkDay): UNIQUE (user_id, reason, ref)
-- already makes a second payment for the same thing on the same day insert nothing,
-- which is the whole of "once a day". Nothing else changes -- no table, no grant: the
-- ledger's row security, its revokes and its erasure stand as 0057 set them, and the
-- server pays through the person's own tenant session like every other award.
ALTER TABLE points_ledger DROP CONSTRAINT points_ledger_reason_check;
ALTER TABLE points_ledger ADD CONSTRAINT points_ledger_reason_check CHECK (reason IN (
  'checkin', 'met', 'look', 'photos_checked', 'buy',
  'park_hello', 'park_walk', 'park_ride', 'park_talk', 'park_sights'));
