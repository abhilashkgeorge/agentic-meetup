-- 0047: a spend table that can be reconciled against an invoice.
--
-- WHAT WAS FOUND. 1,441 of the rows in `llm_calls` carry a cost with zero input
-- tokens, zero output tokens and zero latency -- $4.25 of a $6.69 ledger, and very
-- nearly the whole of the Anthropic line. A call that used no tokens and took no time
-- is not a call. Those rows are estimates, not measurements, and the table gave no
-- way to tell the two apart: `SELECT sum(cost_usd)` returned a number that looked
-- like money and was not.
--
-- WHERE THEY CAME FROM. Metering used to live at eleven call sites, each responsible
-- for remembering, and those sites recorded a computed guess rather than what a
-- provider reported. It now lives at the router's choke point and records the
-- provider's own usage, which is why every row written since carries real tokens and
-- real latency. `computeCost` returns exactly 0.0 for an all-zero usage, so the
-- CURRENT code cannot produce one of these -- this migration is about the history the
-- old code left behind, and about making sure a future refactor cannot reintroduce it.
--
-- NOTHING IS DELETED. The rows are marked. A guess that was recorded is part of the
-- record of how this project was built; the fix is to stop it being counted as money.

ALTER TABLE llm_calls
  ADD COLUMN estimated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN llm_calls.estimated IS
  'True when the cost was computed rather than reported by a provider. Exclude from '
  'any figure that claims to be spend.';

UPDATE llm_calls SET estimated = true
 WHERE cost_usd > 0
   AND input_tokens = 0 AND output_tokens = 0
   AND cached_read_tokens = 0 AND cache_write_tokens = 0;

-- THE GUARD. A row that costs money must say what it spent it on. Existing rows pass
-- because the UPDATE above has already marked them, so this is enforced from here
-- forward without rewriting history.
ALTER TABLE llm_calls
  ADD CONSTRAINT llm_calls_cost_needs_tokens CHECK (
    cost_usd = 0
    OR estimated
    OR input_tokens + output_tokens + cached_read_tokens + cache_write_tokens > 0
  );
