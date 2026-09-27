-- 0072: the wants no question fits, for the founder -- so he knows which situation
-- questions to add next.
--
-- WHAT WAS MISSING. A want that matches a question in the bank is checked against the
-- other person's tapped answer (want-questions.ts); one that matches none stays a
-- sentence and only ever moves people down. Nothing said which wants those were, or how
-- often they come up. The founder, 2026-09-28: "keep a list of wants that didn't match
-- any question, sorted by how often they come up."
-- HOW: the wants are the `seeking` and `dealbreaker` facts (wants.ts WANT_SOURCES); which
-- ones match a question is decided in TypeScript (questionForWant), so this function
-- only hands over the raw rows and the server does the rest (matching/want-gaps.ts).
--
-- WHY THIS SHAPE. SECURITY DEFINER, real people only (0070's rule: not invented, signed
-- in on a phone, not a test fixture), granted to the matchmaker the reviewer's routes
-- use. It returns people's want sentences to the SERVER, which never sends one person's
-- sentence on: a want only one person has leaves as its topic words, a want two or more
-- share leaves whole, and nothing names anybody (Settings promises "Nobody else has
-- ever seen what your clone knows about you").
CREATE FUNCTION founder_unmatched_wants() RETURNS TABLE (user_id uuid, kind text, text text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH real AS (
    SELECT u.id FROM app_users u
      LEFT JOIN match_profile p ON p.user_id = u.id
     WHERE NOT coalesce(p.is_synthetic, false)
       AND u.email NOT LIKE '%@example.test'
       AND EXISTS (SELECT 1 FROM device_sessions d WHERE d.user_id = u.id)
  )
  SELECT f.user_id, f.predicate, f.object_text
    FROM facts f
   WHERE f.predicate IN ('seeking', 'dealbreaker')
     AND f.status = 'active' AND f.valid_to IS NULL
     AND f.user_id IN (SELECT id FROM real)
$$;
REVOKE ALL ON FUNCTION founder_unmatched_wants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION founder_unmatched_wants() TO clone_matchmaker;
