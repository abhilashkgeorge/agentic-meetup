-- 0073: nobody's photos reach anybody until THAT person has said yes to them.
--
-- WHAT WAS WRONG. photos_visible_to (0032) let the FIRST MOVER see the other person's
-- photos the moment the cards were written -- before the other person had done
-- anything, and whether or not they ever would. Several first movers could look at the
-- same photos at once. Every screen promised the opposite: consent said photos are
-- "shown to one person at a time, after both agents have said yes"; the photo screens
-- said "Only somebody you have both said yes to ever sees these". The rule also let
-- photos stay visible after a card EXPIRED (it excluded only 'lapsed').
--
-- HOW IT WAS MEASURED (dev database, 2026-09-28, while writing docs/END-TO-END.md):
-- 55 open pairs; in 1 of them the first mover could see the photos of someone who had
-- not said yes; 8 people have photos. No expired pair was exposed yet (0 of 0 with
-- photos), but the rule allowed it.
--
-- WHY THIS FIX (the founder, 2026-09-28: "nobody's photos or name reach anyone until
-- THAT person has said yes to them"). The first mover decides on the words card and the
-- other's character alone; their yes -- "Yes, share my profile with them" -- is the
-- permission, and shows THEIR photos to the other person. The second person then sees
-- them and answers "Yes, share mine back" or "Not for me"; only that second yes shows
-- their photos to the first mover, and opens the chat. So the whole rule is one test:
-- the OWNER's own answer in a pair they share with the viewer is yes, and the pair has
-- not ended (a no lapses it; three days of silence expire it). Introduced pairs pass
-- because both answers are yes. The name follows the same rule in the server
-- (api/dating.ts, api/world.ts); the turn order is enforced in decide().
--
-- confirmations_of and photos_checked (0058, 0059) call this function, so "Confirmed by
-- N people" and "Photos checked" now show only where the photos do. Grants are kept by
-- CREATE OR REPLACE (0032: clone_app only).
CREATE OR REPLACE FUNCTION photos_visible_to(owner uuid, viewer uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT owner = viewer
     OR (
       NOT block_exists(owner, viewer)
       AND EXISTS (
         SELECT 1 FROM rendezvous r
           JOIN rendezvous_briefs b ON b.rendezvous_id = r.id AND b.for_user = owner
          WHERE ((r.user_a = owner AND r.user_b = viewer)
              OR (r.user_b = owner AND r.user_a = viewer))
            AND r.status NOT IN ('lapsed', 'expired')
            -- The owner said yes to this viewer. Nothing else opens their photos.
            AND b.human_says_yes IS TRUE));
$$;
