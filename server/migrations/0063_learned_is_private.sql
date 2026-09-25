-- 0063: what the clone learned before today is private too, until the person shares it.
--
-- WHAT WAS WRONG. Everything the extractor learned from chat, "tell" or a pasted
-- memory was public the moment it was learned, whenever its kind was public by
-- default (an interest, a thing they did): a sentence typed in passing to the clone
-- could be quoted to a stranger on a card or said in the agents' talk. The founder
-- (2026-09-25): learned sentences are private by default -- the agent may use them for
-- matching, never quote them -- until the person taps "OK to share"; only answers to
-- the five set questions start shareable. extract.ts and pasteImport.ts now write new
-- ones match-only. This does the same for the ones already there.
--
-- HOW IT WAS MEASURED. Active, current, public facts whose origin is learning -- not
-- the interview, the essentials wizard ('direct') or a story ('story') -- and whose kind
-- is not a tapped field: 29 on real accounts on 2026-09-25 (7 from claude-sonnet-5, 4
-- from gemini-3.5-flash-lite, 14 confirmed imports, 4 from an old test writer). Applied,
-- it changed 3,729 rows: those 29, and 3,700 left by old test runs whose account rows are
-- gone (the orphans reported, not removed, on 2026-09-23). Counted from memory_audit.
--
-- WHY THIS FIX. 'matchable_only', not 'private': private means "the person hid it", and
-- nobody hid these; match-only is exactly "used for matching, never said". Nothing is
-- deleted, and each change is written to memory_audit so it can be read back. A tapped
-- field (basics, cards) is never quoted either way and is left as it was. "OK to share"
-- on "How you appear" writes 'public' through POST /v1/facts/:id/disclosure.
WITH learned AS (
  UPDATE facts SET disclosure = 'matchable_only'
   WHERE disclosure = 'public' AND status = 'active' AND valid_to IS NULL
     AND extractor_model NOT IN ('interview', 'direct', 'story')
     AND predicate <> ALL (ARRAY[
       'gender', 'seeking_gender', 'birth_date', 'lives_in', 'relationship_intent',
       'age_range_sought', 'max_distance_km', 'area',
       'wants_children', 'monogamy_stance', 'smoking', 'drinking', 'diet', 'religion'])
  RETURNING id, tenant_id, user_id
)
INSERT INTO memory_audit (tenant_id, user_id, fact_id, op, before, after, actor)
SELECT tenant_id, user_id, id, 'disclosure',
       '{"disclosure": "public"}'::jsonb,
       '{"disclosure": "matchable_only", "why": "0063: learned is private until shared"}'::jsonb,
       'system'
  FROM learned;
