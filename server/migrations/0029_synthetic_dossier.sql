-- 0029: the invented half of the pool had nothing to say.
--
-- The first real round produced a decided rendezvous, two both-yes runs, and zero
-- briefs. The cause: synthetic people deliberately never touch `facts` (rule 2 in
-- synthetic.ts, and migration 0010 forbids an untrusted-origin fact from ever being
-- active), and both `buildDossier` and the brief's quotes read `facts`. So one agent
-- went into five conversations carrying an empty dossier, and said yes twice anyway.
--
-- That is the failure the research already warned about, reproduced exactly: two
-- agents on the same base model will agree pleasantly about nothing at all. A pool
-- that cannot speak does not test matching, it tests politeness.
--
-- The fix keeps the rule. These columns are on match_profile, where invented people
-- already live entirely, and they are GENERATED FROM THE SAMPLED TRAITS rather than
-- written by a model -- deterministic, free, and incapable of leaking into the fact
-- store or being mistaken for something a person said.
ALTER TABLE match_profile ADD COLUMN synthetic_dossier text;
ALTER TABLE match_profile ADD COLUMN synthetic_quotes jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN match_profile.synthetic_dossier IS
  'Invented people only. What their agent may say about them, in place of the facts '
  'they do not have. Never written for a real user: a real dossier comes from facts '
  'the person confirmed.';

-- A real person must never acquire one of these. If a row has a synthetic dossier it
-- is a synthetic row, and the database says so rather than a comment.
ALTER TABLE match_profile ADD CONSTRAINT match_profile_dossier_is_synthetic
  CHECK (synthetic_dossier IS NULL OR is_synthetic);
