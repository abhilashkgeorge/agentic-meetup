-- 0032: photos.
--
-- THE ONLY THING IN THIS SYSTEM THAT IS NEVER MATCHED ON. Attraction is the one thing
-- a matcher genuinely cannot predict, and pretending otherwise is where these products
-- get creepy. So there is no photo column on match_profile, no embedding, no tag, and
-- nothing here is joined by the candidate query or read by the scorer. A photo exists
-- for exactly one purpose: a person looks at it and decides for themselves.
--
-- WHICH MAKES ACCESS THE WHOLE PROBLEM. A dating photo is the most sensitive thing the
-- app holds -- it is the piece that identifies somebody in the street. Every leak of
-- this kind has the same shape: the file sits at a URL, the URL is unguessable, and
-- unguessable turns out to mean "guessed". So the bytes are never at a public address.
-- They are served by an endpoint, and the endpoint asks the database the same question
-- the reveal asks: is it this person's turn to see them yet.
CREATE TABLE photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,

  -- Which one they lead with. First is the one shown in a list.
  position    int  NOT NULL CHECK (position BETWEEN 0 AND 5),

  width       int  NOT NULL,
  height      int  NOT NULL,
  bytes       int  NOT NULL,
  -- Of the STORED file, after re-encoding. Lets a re-upload of the same picture be
  -- recognised, and lets a corrupted file be spotted rather than served.
  sha256      text NOT NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, position)
);

CREATE INDEX photos_by_user ON photos (user_id, position);

ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos FORCE ROW LEVEL SECURITY;

-- Your own photos, and only your own. Somebody ELSE's are never readable through this
-- table -- that path goes through the function below, which carries the rule.
CREATE POLICY photos_mine ON photos FOR ALL
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON photos TO clone_app;

/**
 * May this person see that person's photos?
 *
 * The same order as the reveal, because a photo IS the reveal -- showing it earlier
 * would quietly undo the asymmetry the whole introduction is built on:
 *
 *   yourself            always
 *   introduced pair     both ways
 *   the first mover     yes -- they are the one who decides first, and alone
 *   the second mover    only once the first has said yes
 *   anybody else        no, including somebody holding the id
 *   blocked either way  no
 *
 * SECURITY DEFINER because answering it means reading the other person's rendezvous
 * brief, which they are right not to be able to read.
 */
CREATE OR REPLACE FUNCTION photos_visible_to(owner uuid, viewer uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT owner = viewer
     OR (
       NOT block_exists(owner, viewer)
       AND EXISTS (
         SELECT 1 FROM rendezvous r
          WHERE ((r.user_a = owner AND r.user_b = viewer)
              OR (r.user_b = owner AND r.user_a = viewer))
            AND r.status <> 'lapsed'
            AND (
              r.status = 'introduced'
              OR r.first_mover = viewer
              -- The owner has already said yes, so their face is theirs to show.
              OR coalesce((SELECT b.human_says_yes FROM rendezvous_briefs b
                            WHERE b.rendezvous_id = r.id AND b.for_user = owner), false)
            )));
$$;

REVOKE ALL ON FUNCTION photos_visible_to(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION photos_visible_to(uuid, uuid) TO clone_app;

/**
 * The rows a viewer is allowed to see. Empty for somebody with no business here --
 * the same answer as a person who has no photos, so the absence of a photo and the
 * absence of permission are indistinguishable from outside.
 *
 * `position` is a reserved word in a RETURNS TABLE list, hence `slot`.
 */
CREATE OR REPLACE FUNCTION visible_photos(owner uuid, viewer uuid)
RETURNS TABLE (id uuid, slot int, width int, height int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.position, p.width, p.height
    FROM photos p
   WHERE p.user_id = owner
     AND photos_visible_to(owner, viewer)
   ORDER BY p.position;
$$;

REVOKE ALL ON FUNCTION visible_photos(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION visible_photos(uuid, uuid) TO clone_app;

-- The eraser has to be able to remove them. The FILES are removed by the erasure code;
-- rows alone would leave the pictures on disk, which is not an erasure.
GRANT SELECT, DELETE ON photos TO clone_eraser;
