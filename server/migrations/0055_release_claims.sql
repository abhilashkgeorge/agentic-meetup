-- A round claims its pairs before the first model call (orchestrator.ts, the read
-- phase): one rendezvous row each, inside one transaction, so two rounds started at
-- the same moment cannot both decide to run the same pair.
--
-- When the round then failed -- the day's cap, a restart, the model down -- those
-- claims stayed 'running' for ever. The matches list never showed them (no brief),
-- "a pair meets once, ever" counted them, so the three people could never be met
-- again, and the town drew them as a conversation that never ends. Nothing about
-- them was real: no transcript, no brief, no spend on that pair.
--
-- The matchmaker may now release a claim, and ONLY a claim. Its old FOR ALL policy
-- would have opened every row to DELETE the moment the privilege was granted, so it
-- is split by command and the delete arm carries the whole definition of "a claim":
-- still running, with no transcript and no brief on either side.
DROP POLICY rendezvous_matchmaker ON rendezvous;
CREATE POLICY rendezvous_matchmaker_read ON rendezvous FOR SELECT
  TO clone_matchmaker USING (true);
CREATE POLICY rendezvous_matchmaker_insert ON rendezvous FOR INSERT
  TO clone_matchmaker WITH CHECK (true);
CREATE POLICY rendezvous_matchmaker_update ON rendezvous FOR UPDATE
  TO clone_matchmaker USING (true) WITH CHECK (true);

GRANT DELETE ON rendezvous TO clone_matchmaker;
CREATE POLICY rendezvous_release ON rendezvous FOR DELETE
  TO clone_matchmaker
  USING (status = 'running'
         AND NOT EXISTS (SELECT 1 FROM rendezvous_runs x WHERE x.rendezvous_id = rendezvous.id)
         AND NOT EXISTS (SELECT 1 FROM rendezvous_briefs b WHERE b.rendezvous_id = rendezvous.id));
