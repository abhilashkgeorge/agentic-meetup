-- 0031: the reveal deadlocked, twice, for two different reasons.
--
-- First it gated on `rendezvous.status = 'decided'`, and the status only leaves
-- 'decided' when BOTH people have answered -- so the second person waited for a state
-- that only their own answer could produce.
--
-- Then it gated on the other person's brief, which the policy on rendezvous_briefs
-- correctly hides: your side's brief is yours, and the other agent's assessment of you
-- is not. Under a tenant session that subquery is always NULL, so the gate never
-- opened.
--
-- What the second mover actually needs to know is ONE BIT: has the first mover said
-- yes. This function answers exactly that and nothing else.
--
-- A NO IS SILENT, AND THIS KEEPS IT SILENT. `false` is returned for "said no" and for
-- "has not looked yet" alike, so a rejection is indistinguishable from a delay -- for
-- ever, and by construction rather than by the caller remembering to conflate them.
-- In a small pool where people compare notes, an emitted rejection is unrecoverable.
CREATE OR REPLACE FUNCTION rendezvous_other_said_yes(rendezvous uuid, me uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT b.human_says_yes
       FROM rendezvous_briefs b
       JOIN rendezvous r ON r.id = b.rendezvous_id
      WHERE b.rendezvous_id = rendezvous
        AND b.for_user <> me
        -- The caller must be in this conversation. Without it, anybody holding an id
        -- could ask about anybody else's.
        AND me IN (r.user_a, r.user_b)),
    false);
$$;

REVOKE ALL ON FUNCTION rendezvous_other_said_yes(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rendezvous_other_said_yes(uuid, uuid) TO clone_app;
