-- 0059: "Photos checked".
--
-- WHAT IT IS. Two selfies -- facing, then head turned -- compared to the person's own
-- photos by a face model running on this machine (photos/face.ts). A pass puts
-- "Photos checked" on their reveal, for exactly the people who may see the photos.
--
-- WHAT IS KEPT. A verdict, a score for tuning the threshold, and WHICH photos were
-- compared, so a photo added later takes the badge away until it too is checked.
-- THE SELFIES ARE NEVER STORED AND NO EMBEDDING IS EVER WRITTEN: the two frames live
-- under PHOTO_DIR/<user>/_check/ for the seconds the worker needs and are deleted in
-- its finally, pass or fail.
--
-- SHAPE. A queue, copied from rounds (0049): the app inserts and moves its own row
-- from pending (first frame) to queued (second frame); the matchmaker -- which may
-- already read photos (0041) -- claims with SKIP LOCKED, computes with no
-- transaction open, and writes the result.
CREATE TABLE photo_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'queued', 'running', 'done', 'failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  result       text CHECK (result IS NULL OR result IN
                 ('match', 'no_match', 'no_face', 'not_live', 'no_photos', 'error')),
  photo_ids    uuid[] NOT NULL DEFAULT '{}',   -- compared against; the badge covers exactly these
  score        real,                           -- best similarity, for tuning the threshold
  error        text
);
CREATE INDEX photo_checks_queue ON photo_checks (requested_at) WHERE status = 'queued';
CREATE INDEX photo_checks_latest ON photo_checks (user_id, finished_at DESC);
CREATE UNIQUE INDEX photo_checks_one_active ON photo_checks (user_id)
  WHERE status IN ('pending', 'queued', 'running');
ALTER TABLE photo_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_checks FORCE ROW LEVEL SECURITY;

CREATE POLICY photo_checks_mine_read ON photo_checks FOR SELECT TO clone_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY photo_checks_mine_insert ON photo_checks FOR INSERT TO clone_app
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
          AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- The app may move its own row pending -> queued (the second frame arrived), nothing else.
CREATE POLICY photo_checks_mine_queue ON photo_checks FOR UPDATE TO clone_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND status = 'pending')
  WITH CHECK (status = 'queued');
CREATE POLICY photo_checks_mine_delete ON photo_checks FOR DELETE TO clone_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);  -- erasure, and abandoning a pending check

GRANT SELECT, UPDATE ON photo_checks TO clone_matchmaker;
CREATE POLICY photo_checks_worker_read ON photo_checks FOR SELECT TO clone_matchmaker USING (true);
CREATE POLICY photo_checks_worker_write ON photo_checks FOR UPDATE TO clone_matchmaker
  USING (status IN ('pending', 'queued', 'running')) WITH CHECK (status IN ('running', 'done', 'failed'));
REVOKE ALL ON photo_checks FROM clone_match;

-- The badge, gated by the reveal rule exactly as photos are: nobody who cannot see the
-- photos can ask whether they were checked. True only if EVERY currently visible photo
-- was in the last passing check -- adding a photo takes the badge off until the person
-- checks again. Hidden photos (moderation) count on neither side.
CREATE OR REPLACE FUNCTION photos_checked(owner uuid, viewer uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT photos_visible_to(owner, viewer)
     AND EXISTS (SELECT 1 FROM photos p WHERE p.user_id = owner AND p.hidden_at IS NULL)
     AND coalesce((
       SELECT NOT EXISTS (SELECT 1 FROM photos p
                           WHERE p.user_id = owner AND p.hidden_at IS NULL
                             AND NOT (p.id = ANY (k.photo_ids)))
         FROM photo_checks k
        WHERE k.user_id = owner AND k.status = 'done' AND k.result = 'match'
        ORDER BY k.finished_at DESC LIMIT 1), false);
$$;
REVOKE ALL ON FUNCTION photos_checked(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION photos_checked(uuid, uuid) TO clone_app;
