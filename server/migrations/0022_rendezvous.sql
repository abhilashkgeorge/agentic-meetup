-- 0022: two agents meeting, several times over.
--
-- THE MECHANIC, and where it comes from. In "Hang the DJ" the System runs a pair a
-- thousand times and counts how often they rebel together; 998 of 1,000 is the match.
-- The idea underneath it is the good part: the score comes from WATCHING THE PAIR
-- INTERACT, repeatedly, rather than from comparing two questionnaires. Stated
-- preferences predict attraction badly. A behaviour, repeated, is at least a
-- measurement of something.
--
-- So a rendezvous holds SEVERAL runs, and the number that matters is how many of them
-- both sides said yes to. One agreement can be politeness. Four out of five is a
-- signal. Four out of five for one pair and one out of five for another is a ranking
-- that came from behaviour.
--
-- WHAT IS DELIBERATELY ABSENT: any "declined" outcome anybody is told about. A run
-- that ends in no is silent to both sides, for ever. In a small pool where people can
-- compare notes, an emitted rejection is unrecoverable.
CREATE TABLE rendezvous (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Ordered, so a pair can only exist once however the two ids arrive.
  user_a       uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  user_b       uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  tenant_a     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_b     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  runs_planned int  NOT NULL DEFAULT 5,
  runs_done    int  NOT NULL DEFAULT 0,
  /** How many runs ended with BOTH sides saying yes. The whole point. */
  both_yes     int  NOT NULL DEFAULT 0,

  -- introduced only when a human on each side has also said yes.
  status       text NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running', 'decided', 'shown_a', 'shown_b', 'introduced', 'lapsed')),
  cost_usd     numeric(12,6) NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,

  CONSTRAINT rendezvous_ordered CHECK (user_a < user_b),
  CONSTRAINT rendezvous_counts  CHECK (both_yes <= runs_done AND runs_done <= runs_planned)
);

-- One lifetime rendezvous per pair. Running the same two people again next week would
-- turn a match into a war of attrition.
CREATE UNIQUE INDEX rendezvous_pair ON rendezvous (user_a, user_b);
CREATE INDEX rendezvous_open ON rendezvous (status) WHERE status = 'running';

-- One simulated meeting.
--
-- Each run is INDEPENDENT: a fresh conversation, no memory of the previous run, and a
-- verdict written by an assessor that never sees its own earlier reasoning. Runs that
-- could see each other would converge, and five correlated runs measure exactly as
-- much as one.
CREATE TABLE rendezvous_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rendezvous_id  uuid NOT NULL REFERENCES rendezvous(id) ON DELETE CASCADE,
  run_no         int  NOT NULL,

  -- The conversation, kept for debugging and NEVER shown to either human. It contains
  -- each agent's characterisation of its own person, which is unverified -- and
  -- reading it would quietly turn a claim into a remembered fact about somebody they
  -- have not met.
  transcript     jsonb NOT NULL DEFAULT '[]'::jsonb,

  a_says_yes     boolean,
  b_says_yes     boolean,
  /** Mandatory. A verdict with nothing to worry about was written to please. */
  a_concern      text,
  b_concern      text,
  cost_usd       numeric(12,6) NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (rendezvous_id, run_no)
);

-- What the human is shown, written by their OWN agent in their own agent's voice.
-- Never a score, never the transcript: only things that are verifiably true, which
-- means quotes with dates out of two memories.
CREATE TABLE rendezvous_briefs (
  rendezvous_id uuid NOT NULL REFERENCES rendezvous(id) ON DELETE CASCADE,
  for_user      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  headline      text NOT NULL,
  -- Named overlap_quotes, not `overlaps`: OVERLAPS is a Postgres operator and a
  -- column called that fails to parse in a CREATE TABLE.
  overlap_quotes jsonb NOT NULL DEFAULT '[]'::jsonb,
  concern       text NOT NULL,
  questions     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- null while they have not looked, then their answer. A no is never transmitted.
  human_says_yes boolean,
  decided_at    timestamptz,
  PRIMARY KEY (rendezvous_id, for_user)
);

ALTER TABLE rendezvous ENABLE ROW LEVEL SECURITY;
ALTER TABLE rendezvous FORCE ROW LEVEL SECURITY;
ALTER TABLE rendezvous_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rendezvous_briefs FORCE ROW LEVEL SECURITY;

-- A person may read a rendezvous they are half of, and their OWN brief. Never the
-- other side's brief, which is the other agent's private assessment of them.
CREATE POLICY rendezvous_mine ON rendezvous FOR SELECT
  USING (user_a = NULLIF(current_setting('app.user_id', true), '')::uuid
      OR user_b = NULLIF(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY briefs_mine ON rendezvous_briefs FOR ALL
  USING (for_user = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (for_user = NULLIF(current_setting('app.user_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON rendezvous TO clone_app;
GRANT SELECT, INSERT, UPDATE ON rendezvous_runs TO clone_app;
GRANT SELECT, INSERT, UPDATE ON rendezvous_briefs TO clone_app;
