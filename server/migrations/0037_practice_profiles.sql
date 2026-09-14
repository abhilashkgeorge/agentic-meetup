-- 0037: a real person must be able to tell an invented one apart.
--
-- THE PROBLEM. The 5,000-person synthetic pool exists so the app is not empty before
-- it has users. That part is sound. What was not sound is what happened when it
-- worked: the synthetic side is auto-decided `yes` the moment briefs exist, `decide`
-- introduces a pair once both sides are yes, and the reveal screen routes straight
-- into the conversation. So a real person who said yes to an invented person was put
-- in a chat room with nobody in it, and nothing anywhere -- card, reveal, thread --
-- ever used the word synthetic. The single occurrence of it in the app was a comment
-- in a source file.
--
-- Two changes, and they are separable on purpose.
--
-- 1. THE BIT, EXPOSED. `match_profile.is_synthetic` already existed and was readable
--    only by the matchmaker. The card and reveal are served on the caller's own
--    session, which cannot see the other person's profile row at all -- correctly.
--    So this follows the pattern already used twice in this schema for exactly this
--    shape of question: a SECURITY DEFINER function that answers one bit about the
--    other seat and discloses nothing else. `block_exists` and
--    `rendezvous_other_said_yes` are the precedents.
--
-- 2. THE POOL, SHOWN BY DEFAULT. `sees_synthetic` defaulted to false, so a real
--    person who finished setup today was matched against the three other real
--    accounts and saw an empty app. Defaulting it to true is the only setting that
--    makes the product work before it has users -- and it is only honest now that
--    the bit above lets every surface say what it is looking at.

CREATE OR REPLACE FUNCTION rendezvous_other_is_synthetic(rz uuid, me uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(bool_or(p.is_synthetic), false)
    FROM rendezvous r
    JOIN match_profile p
      ON p.user_id = CASE WHEN r.user_a = me THEN r.user_b ELSE r.user_a END
   WHERE r.id = rz
     AND (r.user_a = me OR r.user_b = me);
$$;

COMMENT ON FUNCTION rendezvous_other_is_synthetic(uuid, uuid) IS
  'One bit: is the other seat of this rendezvous an invented profile? Returns false '
  'for a rendezvous the caller is not half of, which is the same answer as one that '
  'does not exist.';

REVOKE ALL ON FUNCTION rendezvous_other_is_synthetic(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rendezvous_other_is_synthetic(uuid, uuid) TO clone_app;

ALTER TABLE match_profile ALTER COLUMN sees_synthetic SET DEFAULT true;

-- Existing real accounts, brought to the new default. Synthetic rows are left alone:
-- an invented person has no app and no pool to see.
UPDATE match_profile SET sees_synthetic = true WHERE NOT is_synthetic;

COMMENT ON COLUMN match_profile.sees_synthetic IS
  'Whether this person is matched against the invented pool. True by default: before '
  'there are users, it is the only way the app is not empty. Every surface that shows '
  'such a match must label it -- see rendezvous_other_is_synthetic.';
