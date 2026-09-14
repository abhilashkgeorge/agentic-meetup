-- 0020: the preference test, in SQL.
--
-- The filter must run entirely in the database. The moment a dealbreaker check needs
-- a round trip to application code, "find everyone I could meet" becomes N queries
-- instead of one, and the live pool counter -- which runs this six times per keystroke
-- -- stops being possible.
--
-- It mirrors satisfies() in shared/src/values.ts exactly, including the rule that
-- matters most: an unknown value is UNKNOWN, never a mismatch. Written as SQL rather
-- than shared with TypeScript because a filter that leaves the database is not a
-- filter, it is a fetch.
CREATE OR REPLACE FUNCTION match_pref_satisfied(
  operator text,
  wanted   jsonb,
  actual   jsonb
) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    -- Nothing on the other side to test. Passing is deliberate: six of the eight
    -- filter fields come back empty from a memory export by vendor policy, so
    -- treating missing as failing would empty the pool before anybody answered.
    WHEN actual IS NULL OR jsonb_typeof(actual) = 'null' THEN true

    WHEN operator = 'equals'  THEN actual = wanted
    WHEN operator = 'in'      THEN wanted @> actual
    WHEN operator = 'not_in'  THEN NOT (wanted @> actual)
    WHEN operator = 'gte'     THEN (actual #>> '{}')::numeric >= (wanted #>> '{}')::numeric
    WHEN operator = 'lte'     THEN (actual #>> '{}')::numeric <= (wanted #>> '{}')::numeric
    WHEN operator = 'between' THEN
      (wanted -> 'min' IS NULL OR (actual #>> '{}')::numeric >= (wanted ->> 'min')::numeric)
      AND
      (wanted -> 'max' IS NULL OR (actual #>> '{}')::numeric <= (wanted ->> 'max')::numeric)
    WHEN operator = 'contains' THEN actual @> wanted
    WHEN operator = 'absent'   THEN false

    -- An operator nobody taught this function about must not silently exclude people.
    ELSE true
  END
$$;

GRANT EXECUTE ON FUNCTION match_pref_satisfied(text, jsonb, jsonb) TO clone_app, clone_match;

-- Preferences are read during matching, across tenants, by the same query that reads
-- match_profile. The matching role gets the dealbreaker rows and nothing else --
-- strength, operator, value, predicate. No quotes, no free text.
CREATE POLICY preferences_matcher ON preferences FOR SELECT
  TO clone_match
  USING (retired_at IS NULL AND strength = 'dealbreaker');

GRANT SELECT ON preferences TO clone_match;
