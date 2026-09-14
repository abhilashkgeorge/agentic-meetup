-- 0010: an untrusted source can never write a live belief. Enforced in the database.
--
-- Found by adversarial review of the multi-user design, then verified in the code:
-- `passesStanceGate` is `return c.stance === 'asserted'` and never looks at
-- origin_class. Today that is latent -- the only untrusted writer is the paste
-- importer, which hard-codes stance='reported' and therefore stages. It stops being
-- latent the moment a second untrusted writer exists, and the whole dating design is
-- two of them: a friend correcting your clone, and a stranger's agent asserting
-- something about you.
--
-- The failure it prevents is the exact one this product claims to have solved: a
-- friend's joke, or another person's agent, retiring a true owner fact through the
-- single-valued index and the clone then stating it to a stranger with confidence.
--
-- The gate is fixed in commit() as well. This constraint exists because caller
-- discipline is not a defence -- the same reasoning as the partial unique index that
-- makes single-valued supersession reliable without asking an LLM to be careful.
ALTER TABLE facts ADD CONSTRAINT facts_untrusted_never_active
  CHECK (NOT (status = 'active' AND origin_class IN ('untrusted', 'system')));
