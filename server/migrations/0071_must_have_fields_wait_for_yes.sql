-- 0071: every field a must-have can test is one chat cannot change without a Yes -- and
-- a must-have on a field with several answers reads all of them.
--
-- WHAT WAS WRONG. Two things, both about the fields a must-have can depend on.
--   1. b61b1b7 refused must-haves on the field you work in, exercise, sleep and moving
--      cities, because chat could fill them: the extractor wrote what it read as the
--      person's answer, live. The founder (2026-09-28): make chat changes to those wait
--      for the person's Yes, like the cards, for any field a must-have can depend on.
--      The code does that from now on (questions.ts TAPPED_PREDICATES). What chat had
--      ALREADY written live is fixed here.
--   2. A must-have is tested against `traits`, which holds ONE value per field. The field
--      you work in holds several ("software" and "ai"), and traits keeps one of them, so
--      "must work in AI" would have hidden somebody in both software and AI whenever
--      traits happened to hold "software". Every value is in `attribute_tags`.
-- HOW IT WAS MEASURED:
--   SELECT extractor_model, origin_class, status, count(*) FROM facts
--    WHERE predicate IN (the four) AND valid_to IS NULL GROUP BY 1,2,3
--   -> 1,196 't' (test and invented people), 120 'interview' (tapped), 12 'direct' (the
--   person's own edit), 1 already staged, and 2 live from the chat model
--   ('gemini-3.5-flash-lite') -- one work field, one exercise habit, two real people.
--
-- WHY THIS SHAPE.
--   The two chat-read values are STAGED, not deleted: status 'staged', origin
--   'untrusted', which is exactly what chat writes now. The person is asked about each on
--   the You screen, one at a time; a Yes makes it live again. Only values a chat model
--   wrote are touched -- matched by the vendor's model name -- never a tap, an edit, a
--   story answer or an invented person.
--   match_pref_satisfied_multi() reads a field with several answers from the tags: no
--   tag for the field is unknown and passes (0020's rule), `in` passes when any of their
--   answers is wanted, `not_in` when none is. The candidate query (candidates.ts) uses
--   it for every many-answer field, both directions.
UPDATE facts SET status = 'staged', origin_class = 'untrusted'
 WHERE predicate IN ('works_in', 'exercise_habit', 'sleep_pattern', 'relocation_openness')
   AND status = 'active' AND valid_to IS NULL
   AND extractor_model ~* '^(gemini|claude|gpt|o[0-9])';

CREATE FUNCTION match_pref_satisfied_multi(field text, operator text, wanted jsonb, tags text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    -- Nothing answered on this field: unknown, never a mismatch.
    WHEN NOT EXISTS (SELECT 1 FROM unnest(coalesce(tags, '{}')) t
                      WHERE left(t, length(field) + 1) = field || ':') THEN true
    WHEN operator = 'in' THEN EXISTS (
      SELECT 1 FROM unnest(tags) t, jsonb_array_elements_text(wanted) w WHERE t = field || ':' || w)
    WHEN operator = 'not_in' THEN NOT EXISTS (
      SELECT 1 FROM unnest(tags) t, jsonb_array_elements_text(wanted) w WHERE t = field || ':' || w)
    -- An operator this function does not know must not silently exclude people.
    ELSE true
  END
$$;
GRANT EXECUTE ON FUNCTION match_pref_satisfied_multi(text, text, jsonb, text[]) TO clone_app, clone_match, clone_matchmaker;
