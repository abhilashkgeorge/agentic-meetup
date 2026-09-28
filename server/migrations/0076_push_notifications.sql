-- 0076: phones can be woken -- a device's push token, and a card's "fades today" mark.
--
-- WHAT WAS WRONG. Nothing reached a phone that was not open. Every event -- a new card
-- waiting on you, "they shared their profile", "you can talk now", a message -- went
-- down the app's socket (messaging/hub.ts) and was lost when there was none. Only one
-- waiting card shows at a time, so a second card could run out its three days unseen
-- (docs/END-TO-END.md 15.3, "Cards can expire unseen ... there are no push
-- notifications").
--
-- HOW IT WAS MEASURED (dev database, 2026-09-28, read-only): 52 cards were open, each on
-- a three-day clock, and no table held any way to reach a phone that was closed.
--
-- WHY THIS SHAPE (the founder, 2026-09-28: push for "your turn", "introduced", a new
-- message, and "fades today").
--
--   push_tokens: one row per device, the person's own. Row-level security like every
--   user table: the app reads and writes only its own rows. A token belongs to one
--   account at a time -- the same phone signing in as somebody else moves it -- which
--   the app role cannot do under its own policy (the old row is not its to see), so
--   claim_push_token does exactly that and nothing more: it acts only on the token the
--   caller presents, and only for the caller.
--
--   push_tokens_for / forget_push_token: the server's sender reads a recipient's tokens
--   and drops the ones Expo reports dead. SECURITY DEFINER, EXECUTE for clone_app only;
--   no route returns a token. The other roles get nothing.
--
--   rendezvous_briefs.fade_warned_at: "fades today" is sent once per card per person.
--   The matchmaker, which already expires cards (0069), marks it before sending.
CREATE TABLE push_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE CHECK (length(token) BETWEEN 10 AND 200),
  platform     text NOT NULL CHECK (platform IN ('android', 'ios')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user ON push_tokens (user_id);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY push_tokens_mine ON push_tokens FOR ALL TO clone_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id   = NULLIF(current_setting('app.user_id',   true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
          AND user_id   = NULLIF(current_setting('app.user_id',   true), '')::uuid);
-- clone_app keeps its four (0000); nobody else touches the table.
REVOKE ALL ON push_tokens FROM clone_match, clone_matchmaker, clone_door, clone_discovery;

CREATE FUNCTION claim_push_token(p_token text, p_platform text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me  uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  ten uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF me IS NULL OR ten IS NULL THEN
    RAISE EXCEPTION 'claim_push_token needs a signed-in person';
  END IF;
  DELETE FROM push_tokens WHERE token = p_token AND user_id <> me;
  INSERT INTO push_tokens (tenant_id, user_id, token, platform)
  VALUES (ten, me, p_token, p_platform)
  ON CONFLICT (token) DO UPDATE SET platform = EXCLUDED.platform, last_seen_at = now();
END $$;
REVOKE ALL ON FUNCTION claim_push_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_push_token(text, text) TO clone_app;

CREATE FUNCTION push_tokens_for(p_user uuid) RETURNS TABLE (token text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.token FROM push_tokens t WHERE t.user_id = p_user
$$;
REVOKE ALL ON FUNCTION push_tokens_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION push_tokens_for(uuid) TO clone_app;

CREATE FUNCTION forget_push_token(p_token text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM push_tokens WHERE token = p_token
$$;
REVOKE ALL ON FUNCTION forget_push_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION forget_push_token(text) TO clone_app;

ALTER TABLE rendezvous_briefs ADD COLUMN fade_warned_at timestamptz;
