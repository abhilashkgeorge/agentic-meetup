-- THE MATCHMAKER READS NO PROFILE SUMMARY (the founder, 2026-09-29: "Remove the matching
-- role's access to profile summaries").
--
-- WHAT WAS WRONG. 0028 gave clone_matchmaker -- the role every round, reveal and review
-- runs as -- every row of core_profile, "assembled from facts the person has already
-- confirmed". Four of its five blocks (identity, situation, preferences, open_threads)
-- are prose that rebuildCoreProfile writes from promotableFacts: every confirmed fact,
-- private ones included -- faith, drinking, kids, whatever they told their clone in
-- confidence. The same role reads `facts` through a policy that shows public facts only
-- (0028 facts_matchmaker); the summary was the whole file again, one SELECT away, for the
-- role whose agents speak to strangers.
--
-- HOW IT WAS FOUND. docs/END-TO-END.md 15.2 item 9, which also said nothing in a round
-- read the table. That was wrong about the fifth block: every round read each person's
-- 'voice' -- how they write: style, habits, and short fragments quoted from their own
-- messages (chatImport.ts) -- through this role (orchestrator.ts), for the agent
-- conversations. Taking the table away alone would have failed every round.
--
-- THE FIX. A round now reads a person's voice as that person, under their own tenant
-- session -- the move loadQuotes already makes for episodes -- and only when the
-- conversations are on (RENDEZVOUS_RUNS, off by default). So this role needs nothing in
-- core_profile, and loses the policy and every privilege on it.
-- tests/matchmaker-no-summaries.test.ts runs a round with conversations on over two
-- people with all five blocks: the voice still reaches the conversation, no summary does,
-- and the role is refused the table.

DROP POLICY core_profile_matchmaker ON core_profile;
REVOKE ALL ON core_profile FROM clone_matchmaker;
