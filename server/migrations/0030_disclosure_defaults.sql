-- 0030: every agent went out with nothing to say.
--
-- `facts.disclosure` was added in 0018 with a deliberately safe default of
-- `matchable_only`, and the "and then the person chooses what is public" half was
-- never built. So no fact anywhere was ever `public`, `buildDossier` filters on
-- `disclosure = 'public'`, and the first real rendezvous ran with an EMPTY dossier on
-- both sides. The agents said yes to each other twice. They were agreeing about
-- nobody.
--
-- The default belongs to the KIND of thing, not the row: "what may be said about me"
-- is a property of the predicate. The list lives in shared/src/facts.ts so the app,
-- the extractor and this migration cannot disagree about it, and it is repeated here
-- only because a migration must be readable on its own.
--
-- WHAT IS NOT IN IT IS THE POINT. Religion, politics, health, allergies, ethnicity,
-- employer, family, relationship history: still matchable, never volunteered.
UPDATE facts SET disclosure = 'public'
 WHERE disclosure = 'matchable_only'
   AND predicate IN (
     'preferred_name', 'lives_in', 'languages',
     'industry', 'works_in', 'education_level',
     'interest', 'dislikes', 'goal', 'value',
     'media_taste', 'pet', 'prompt_answer',
     'relationship_intent', 'seeking', 'wants_children', 'monogamy_stance',
     'exercise_habit', 'diet', 'dietary_restriction', 'sleep_pattern',
     'transport', 'relocation_openness', 'communication_style',
     'topic', 'did', 'believes');
