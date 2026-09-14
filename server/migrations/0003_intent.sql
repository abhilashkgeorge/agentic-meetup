-- 0003_intent: what people actually want from their clone.
--
-- This exists to answer one deferred product question with evidence instead of
-- instinct: when agent discovery is switched on, WHICH cluster gets recruited. A
-- thousand users spread across four intents is four dead markets; a thousand after
-- one thing is a live one. That decision is months away and this data takes months
-- to accumulate, which is why it is collected now.
--
-- Deliberately NOT a separate LLM call. The signal rides along on the session-end
-- extraction we already pay for, so the marginal cost is a few output tokens.

CREATE TABLE intent_signals (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  session_id  uuid NOT NULL,
  intent      text NOT NULL,
  -- 0..1 from the extractor. Weak signals are kept: the aggregate is the point,
  -- and discarding uncertain ones would bias toward whatever is easiest to name.
  confidence  real NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, session_id, intent)
);
CREATE INDEX intent_signals_rollup ON intent_signals (intent, at DESC);
CREATE INDEX intent_signals_user   ON intent_signals (user_id, at DESC);

ALTER TABLE intent_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_signals FORCE ROW LEVEL SECURITY;
CREATE POLICY intent_signals_isolation ON intent_signals
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND user_id   = NULLIF(current_setting('app.user_id',   true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
          AND user_id   = NULLIF(current_setting('app.user_id',   true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON intent_signals TO clone_app;
GRANT USAGE, SELECT ON SEQUENCE intent_signals_id_seq TO clone_app;
