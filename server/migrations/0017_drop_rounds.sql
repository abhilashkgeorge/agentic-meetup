-- 0017: the friend-grading mechanic is removed.
--
-- Rounds asked the people who know you whether your clone sounded like you. It was a
-- good loop and it is the wrong product: this is a dating app, and the agent is built
-- BY the user FOR the user. Other people do not describe you, rate you, or vouch for
-- you anywhere in it.
--
-- Founder's direction, verbatim: "friends verdict is a wrong way to go. dont let
-- friends talk about me... a agent is created by the user for whom the agent is
-- created. not from the friends talking about it."
--
-- Dropped rather than left dormant. An unused table with RLS policies and foreign
-- keys is a thing every future migration has to reason about, and the grader token
-- policy in particular granted read access to a caller with no account -- which is
-- exactly the kind of door that should not be left standing unused.
--
-- `self_tests` STAYS. That is the user grading their own clone, which is the same act
-- without anybody else involved, and it is the only source the eval corpus has.
DROP TABLE IF EXISTS round_grades;
DROP TABLE IF EXISTS rounds;
DROP TABLE IF EXISTS graders;
