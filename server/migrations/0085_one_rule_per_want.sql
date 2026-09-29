-- TWO WANTS ON ONE QUESTION KEEP TWO RULES (the founder, 2026-09-29: "Two wants on one
-- question don't overwrite each other").
--
-- WHAT WAS WRONG. 0018 allowed one live rule per (person, field, operator), so that saying
-- "I want someone in AI" twice would not double its weight. But a rule written by a want
-- (api/wants.ts, 2026-09-26) is that want's -- its source_quote is the want's own words,
-- and that is how the want finds it again -- and two different wants tied to the same
-- question ("a saver", "someone who pays off their debts": both the money question) hit
-- the same key. The second overwrote the first's answers, strength and words, and the
-- first want lost its rule without anybody saying so. The interview's own rule on a
-- field a want can also use (the work field) collided the same way.
--
-- HOW IT WAS FOUND. docs/END-TO-END.md 15.3 item 18. tests/rule-clashes.test.ts ties two
-- wants to the money question: before this, one rule was left.
--
-- THE FIX. One live rule per (person, field, operator, source): the same words twice are
-- still one rule, two wants are two. Both apply -- two must-haves must both pass, two soft
-- rules both count -- which is what two separate wishes mean.
DROP INDEX preferences_one_live;
CREATE UNIQUE INDEX preferences_one_live
  ON preferences (user_id, predicate, operator, source_quote) WHERE retired_at IS NULL;
