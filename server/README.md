# clone-agent server

Personal AI clone. Stateless Hono service over Postgres. The agent is **rows**, not a
process, so replicas scale and rolling deploys work.

Design: `../ARCHITECTURE.md` (the full research) and the build plan. Engine decision
and why we did not adopt Letta / Hermes / DeepSeek Harness: `../ENGINE-DECISION.md`.

## Run it

```bash
docker compose up -d db          # postgres 17 + pgvector on :5433
cp .env.example .env             # add ANTHROPIC_API_KEY
npm run migrate
npm run seed -- you@example.com  # prints your dev token
npm run dev
npm test                         # isolation + model-seam gates, no API key needed
```

Port 5433, not 5432: a host Postgres on `127.0.0.1:5432` shadows Docker's `*:5432`.

## Where the load-bearing parts are

| Concern | File | Why it matters |
|---|---|---|
| Tenant isolation | `src/db/client.ts` | `tenantSession()` is the ONLY way to touch tenant data. `set_config(..., true)` is transaction-local; a plain `SET` would leak to the next borrower of a pooled connection. |
| RLS policies | `migrations/0001_initial.sql` | `NULLIF(current_setting(...), '')` — without it a context-less query on a recycled connection throws a cast error instead of returning zero rows. |
| The app role | `migrations/0000_roles.sql` | `clone_app` is `NOSUPERUSER NOBYPASSRLS`. A superuser ignores RLS entirely; the policies would be decorative. |
| The swap seam | `src/llm/port.ts` | `assertExpressible()` throws instead of degrading. Every documented 2026 abstraction-layer failure was a silent downgrade. |
| Prices | `src/llm/caps.ts` | Ours, not the library's. Boot refuses on an unverified price or a model within 90 days of retirement. |
| Spend cap | `src/metering.ts` | Enforced before the call. One looping tenant overnight is the real risk. |
| Tier 0 | `src/memory/episodes.ts` | Append-only. System of record and the exit path. Nothing UPDATEs or DELETEs here. |
| RAG control | `src/memory/retrieval.ts` | The W3 baseline the fact store must beat, and the permanent fallback. |

## Model routing

Tasks map to models in `.env`; call sites never name a model. W1 routes everything to
`claude-sonnet-5` because those prices are verified.

**Before beta, flip `CHAT_MODEL` and `EXTRACT_MODEL` to OpenAI.** Not a cost decision:
the Anthropic AUP prohibits erotic/sexual content and a dating-adjacent clone receives
it on day one. After the flip Anthropic sees only structured fact payloads.

## Status: W2 done

**W1** — tenancy + RLS, Tier 0 episodes, hybrid recall, the swap seam, metering and
the budget gate, WebSocket chat with `turn_id` idempotency.

**W2** — `predicates` + `facts` with the partial unique index; the commit path with
gates G1 (single-valued), G4 (stance) and G6 (atomic retire+assert); P1 session-end
extraction with its own cached prefix; the conflicts queue; the inactivity sweeper;
usage instrumentation. **32 passing tests, no API key required.**

The W2 gate, from the plan: *tell it you moved city and `facts` holds exactly one
active row and one superseded row, with no LLM having decided anything.* Verified in
`tests/facts.test.ts`, including that the DATABASE rejects a forged second active row.

**W3** — the supersession eval. Frozen rubric (`evals/RUBRIC.md`), 19 seed cases
across 9 axes, a runner that replays sessions through the real pipeline, the G0 A/B
against the verbatim-RAG control, and gates G0–G5. G7/G9/G10 run key-free on every
commit. **35 passing tests.**

Next (W4) — P2 resolve for multi-valued conflicts, gates G2/G3/G5, and the core
profile (Tier 2). Before that: build the real eval corpus by dogfooding, because the
seed cases are scaffolding and a synthetic matrix produces a confident meaningless
number.

Not built yet: P2 resolve (multi-valued conflicts), gates G2/G3/G5, the core profile
(Tier 2), directives (Tier 3), nightly consolidation, voice, the Expo app.

## Commands

    npm run migrate    # applies migrations/*.sql, seeds predicates from @clone/shared
    npm run seed -- you@example.com
    npm run dev
    npm run stats      # median session length, cache read ratio, cost/user/day
    npm test           # 35 tests, no API key needed
    npm run eval       # supersession matrix + G0. Needs keys, costs money.
