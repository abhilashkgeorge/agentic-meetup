-- 0011: closed signup and revocable device sessions.
--
-- Until now ALLOW_DEVICE_SIGNUP=true meant anyone who could reach the host could
-- create an account, and the bearer token WAS the user id: unsigned, non-expiring,
-- unrevocable, and printed into a WebSocket query string where it lands in every
-- proxy and access log along the way. That was correct for one founder on one
-- laptop. It stops being correct the moment a friend is invited.
--
-- Two tables, both deliberately small.
--
-- `invites` stores a code and NOTHING about the person it is for. Storing "Priya
-- thinks you should meet Dev" means holding third-party personal data about someone
-- who has never heard of this product -- and in a dating context. The inviter sends
-- the code themselves through their own channel; we never learn who they sent it to.
--
-- `device_sessions` makes a credential a row rather than a fact about a string, which
-- is what makes revocation possible at all. A stolen token is now one UPDATE away
-- from dead.
CREATE TABLE invites (
  code            text PRIMARY KEY,
  created_by      uuid REFERENCES app_users(id) ON DELETE SET NULL,
  -- What the inviter wants the invitee to read when they redeem. Written ABOUT the
  -- relationship, never about the person: "we worked together at Acme" is fine,
  -- a description of them is not what this field is for.
  note            text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  used_by         uuid REFERENCES app_users(id) ON DELETE SET NULL,
  used_at         timestamptz,
  CONSTRAINT invites_used_together CHECK ((used_by IS NULL) = (used_at IS NULL))
);

CREATE INDEX invites_by_creator ON invites (created_by, created_at DESC);

CREATE TABLE device_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  label        text NOT NULL DEFAULT 'device',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);

CREATE INDEX device_sessions_by_user ON device_sessions (user_id) WHERE revoked_at IS NULL;

-- Session lookup happens BEFORE we know who the caller is, so it cannot run inside a
-- tenant session -- the same shape as the existing app_users_auth_lookup policy: the
-- policy names the exact row by id, so a caller who already holds the id learns
-- nothing new, and a caller who does not cannot enumerate.
ALTER TABLE device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY device_sessions_auth_lookup ON device_sessions FOR SELECT
  USING (id = NULLIF(current_setting('app.auth_lookup_id', true), '')::uuid);

CREATE POLICY device_sessions_owner ON device_sessions FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- Created during provisioning, before any tenant context exists, exactly like the
-- app_users provisioning policy it mirrors.
CREATE POLICY device_sessions_provisioning ON device_sessions FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.provisioning_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON device_sessions TO clone_app;
GRANT SELECT, INSERT, UPDATE ON invites TO clone_app;
