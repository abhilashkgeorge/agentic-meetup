-- 0056: a character to be drawn as, the same to everybody.
--
-- WHAT WAS WRONG. The town drew every person as a grey capsule tinted by kind; a
-- reveal with no photos was an empty well; nothing on screen was the person's own
-- until a photograph, and photographs wait for both yeses.
--
-- WHY THIS. A catalog of eight small integers (shared/src/look.ts) chosen for exactly
-- one purpose -- being seen -- is the one thing about a stranger that is safe to show.
-- It is a DELIBERATE loosening of matching/world.ts: refs stay per-viewer, but two
-- viewers now agree that the person in the green kurta is one person. Not a photo,
-- an age, a tag or an id; it cannot be joined to anything.
--
-- jsonb, not eight columns. The catalog is a shop and grows; a CHECK per part would
-- make every new hat a migration, and migrations are immutable here. Bounds are zod's,
-- enforced at PUT /v1/look; renderers clamp whatever they read.
CREATE TABLE looks (
  user_id    uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  look       jsonb NOT NULL CHECK (jsonb_typeof(look) = 'object'),
  saved_at   timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE looks ENABLE ROW LEVEL SECURITY;
ALTER TABLE looks FORCE ROW LEVEL SECURITY;
CREATE POLICY looks_mine ON looks FOR ALL TO clone_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
          AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- Public by design: the roster draws strangers with it (clone_match), the reveal and
-- the inbox draw met people with it (clone_matchmaker). Read only, for both.
GRANT SELECT ON looks TO clone_match;
CREATE POLICY looks_match ON looks FOR SELECT TO clone_match USING (true);
GRANT SELECT ON looks TO clone_matchmaker;
CREATE POLICY looks_matchmaker ON looks FOR SELECT TO clone_matchmaker USING (true);
-- clone_eraser reads by default (0026); the row goes with the tenant-session delete.

-- What the person has bought. Bought is bought: no UPDATE for the app, and the only
-- DELETE is erasure.
CREATE TABLE look_items (
  user_id   uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item      text NOT NULL,                    -- catalog id, e.g. 'hair:5'
  bought_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item)
);
ALTER TABLE look_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE look_items FORCE ROW LEVEL SECURITY;
CREATE POLICY look_items_mine ON look_items FOR ALL TO clone_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
          AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
REVOKE UPDATE ON look_items FROM clone_app;
REVOKE ALL ON look_items FROM clone_match, clone_matchmaker;
