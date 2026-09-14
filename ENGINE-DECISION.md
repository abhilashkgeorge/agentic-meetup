# Engine Selection — Per-User AI Clone / Agent Matchmaking Backend

**Date:** 2026-08-30 · **Decision owner:** abhilash@dabba.com · **Status:** actionable today

---

## 1. Verdict

**Build it yourself: a stateless FastAPI service over Postgres 18 + pgvector, with a storage-free agent library (Pydantic AI, MIT, [v2.36.0](https://pypi.org/pypi/pydantic-ai/json)) as the in-process tool-calling loop, and a bi-temporal fact store you own.** All three named candidates — Hermes Agent, DeepSeek Harness, Letta — are single-operator products whose unit of tenant isolation is a filesystem directory selected by an environment variable read at process start. None of them ships fact supersession at the depth this product requires, and none survives 5,000 concurrent per-user agents without a fork.

**Runner-up: [Agno AgentOS](https://github.com/agno-agi/agno) (Apache-2.0, v3.0.2).** It is the only surveyed runtime whose serving shape actually matches R2 — stateless FastAPI, all state in Postgres, per-user columns, JWT/RBAC, and A2A as both server *and* client.

**Flip condition:** if you cannot staff one named engineer to own the memory layer end-to-end (schema, supersession evaluator, contradiction eval set, cross-tenant contract test) for the next twelve months, take Agno with the full safe-config checklist in §5.6 and revisit at Series A. An unowned DIY memory layer is strictly worse than a framework's, and its failure mode is silent: the agent confidently tells a match about a job the user left four months ago.

---

## 2. Scorecard

| | R1 Memory supersession | R2 Multi-tenant API service | R3 License | R4 Maturity | R5 Self-host | R6 Model-agnostic | R7 Embeddability | R8 Agent-to-agent |
|---|---|---|---|---|---|---|---|---|
| **Hermes Agent** (NousResearch) | ⚠️ Real add/replace/remove, 1.4KB cap | ❌ Tenant = directory; session-id collisions | ✅ MIT, clean, no model entanglement | ⚠️ Huge velocity, pre-1.0, ~220 commits/day | ❌ SQLite-only, no k8s, host-net pet | ✅ 20+ providers, real adapters | ❌ No library API; 117k lines/6 files | ⚠️ Best A2A code, 6-wide blocking runtime |
| **DeepSeek Harness** (dsh) | ❌ No memory subsystem at all | ❌ No principal, no tenant, cwd = authz | ✅ MIT, 140/142 deps permissive | ❌ 17 days old, all rc/alpha, PRs refused | ❌ No image, POSIX fence rejects k8s vols | ✅ pi-ai covers all majors | ⚠️ 68 clean seams, frozen schema, no delete | ⚠️ Teams cap 8, process-local, disabled |
| **Letta** (letta-code) | ⚠️ Right intent, 50% restraint failure | ❌ V1 archived; no tenant id in protocol | ✅ Apache-2.0 + brand exclusion | ❌ Two pivots in six months | ❌ Volume lock, no rolling deploys | ✅ 38 providers, mid-convo swap | ❌ TS-only WS reducer, filesystem layout | ⚠️ Subprocess/peer, cap 32 process-wide |
| **Agno AgentOS** | ⚠️ Tools right, default prompt says append | ⚠️ Right shape, isolation default-OFF | ✅ Apache-2.0, no Commons Clause | ⚠️ v3.0.0 six days old, 654 open PRs | ✅ Docker/Helm/ECS — needs Redis too | ✅ Providers + fallback chains | ❌ Owns 3 tables + 148 routes + Redis | ✅ A2A server AND client |
| **Graphiti** (library only) | ✅ Bi-temporal, invalidate-don't-delete | ❌ group_ids=None → all tenants; open IDOR | ✅ Apache-2.0 (CLA required) | ⚠️ Active, pre-1.0, breaking minors | ⚠️ Drags Neo4j/FalkorDB + LLM per episode | ✅ OpenAI-compatible + majors | ⚠️ Owns graph schema, no export | ❌ Not an agent framework |
| **DIY** (recommended) | ✅ You define supersession semantics | ✅ Stateless replicas + Postgres RLS | ✅ MIT / PostgreSQL License | ✅ Postgres is the mature dependency | ✅ One container, one managed DB | ✅ Pydantic AI, provider-portable | ✅ Owns nothing you can't replace | ✅ Semaphore + gather at N=5 |

---

## 3. Per-candidate analysis

### 3.1 Hermes Agent (NousResearch) — real, MIT, **wrong shape**

**What it is.** A finished consumer product in the OpenClaw lineage: terminal CLI/TUI, a messaging gateway (Telegram/Discord/Slack/WhatsApp/Signal), an Electron desktop app, a localhost admin dashboard, and an optional OpenAI-compatible HTTP server. Not a framework, not an SDK, not an embeddable engine. Enormous adoption (~238k stars, ~6,600 commits in 30 days) and genuinely [MIT-licensed](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/LICENSE) with no model-license entanglement.

**Per-requirement.** R1 ⚠️ — the `memory` tool genuinely supersedes (`add`/`replace`/`remove`/`batch`, substring match, rewrite in place), which is the right *contract*. But `user_char_limit` defaults to **1375 characters** and `memory_char_limit` to 2200, stored as flat §-delimited Markdown, frozen into the system prompt at session start. A ~1.4KB budget cannot carry a digital clone, and the ceiling follows from the prefix-cache design, so raising it costs you the caching. R2 ❌ — a tenant is a directory under `~/.hermes/profiles/<name>/`; there is no users or tenants table. R3 ✅ clean MIT. R4 ⚠️ — not abandoned by any measure, but pre-1.0 at v0.20.6 with date-based tags and ~98k issue numbers in 13 months. R5 ❌ — SQLite/WAL only, `network_mode: host`, s6-overlay as PID 1, zero Helm or k8s manifests repo-wide, and two documented production fd-exhaustion outages *at single-tenant scale*. R6 ✅ genuinely excellent. R7 ❌ — no library API at all; console scripts over ~117,000 lines across six files. R8 ⚠️ — best permissively-licensed A2A v1.0 implementation you will find (inbound + outbound, stdlib-only), and the worst to actually run.

**Disqualifier — three day-one correctness bugs, not architecture bugs.** The default session id for `/v1/chat/completions` is `'api-' + sha256(system_prompt + '\n' + first_user)[:16]` (`gateway/platforms/api_server.py:1393-1408`). Two dating-app users whose first message is "hi" get **the same session, the same transcript, and the same sandbox directory** — on the documented default path. Session continuation is gated only on "is an API key configured" (`api_server.py:5108-5150`), so any authenticated caller reads any transcript. `ResponseStore` has no tenant column, no ownership check, and holds 100 rows process-wide. These would be live with 50 users.

**Adaptation cost.** Replace `hermes_state.py` (15,316 lines, `sqlite3` imported directly, no seam) against Postgres; thread a tenant id through a call graph that currently resolves tenancy from a contextvar; fork the fan-out path; strip the dashboard's `/api/pty`, `/api/console`, `/api/fs/write-text`, `/api/env/reveal`; pin a commit and own the fork at ~220 commits/day. **What to take instead: read `plugins/platforms/a2a/protocol.py` and the `memory` tool's add/replace/remove/batch contract. Copy the interfaces. Ship none of the code.**

### 3.2 DeepSeek Harness (dsh) — real, MIT, **does not do the thing**

**What it is.** A Node/TypeScript coding-agent harness on the Cordis plugin kernel — a Claude Code / Codex competitor. Genuinely elegant engineering: 68 documented `ctx.*` capability seams, an append-only SessionEvent log as single source of truth, and the cleanest swap surfaces in this study. [MIT](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/LICENSE), with 140 of 142 declared dependencies MIT/Apache/BSD/ISC.

**Per-requirement.** R1 ❌ — **there is no long-term memory subsystem.** Zero occurrences of *embedding*, *vector*, or *rerank* across 225KB of first-party docs; no `ctx.memory` in the 68-seam table; the only appearance of "long-term memory" in the tool catalog is the `ralph` tool describing the filesystem workspace. Session search is lexical FTS5, opt-in, and off by default in shipped compositions. R2 ❌ — auth exists (single-operator browser session, landed 2026-08-24) but there is no principal, no tenant id, no row-level scoping; `tool-session-query` authorizes cross-session reads by **exact working-directory string equality**, and the SDK fixes `cwd` per process, so multiplexed tenants share one authority domain. R3 ✅ clean, with a trademark caveat (`BRAND_GUIDELINES.md` asserts "DeepSeek Harness" is a registered trademark). R4 ❌ — 17 days old publicly, every release rc/alpha, `SESSION_FORMAT_VERSION = 0` with "no compatibility implied," a breaking SQLite store change already shipped six days after going public, Issues disabled, external PRs refused, and a sandbox-escape report ([#4503](https://github.com/deepseek-ai/deepseek-harness/discussions/4503)) with no maintainer response. R5 ❌ — no official image, community reports of >12-minute container installs from native deps, and a POSIX ownership fence on the SQLite file that rejects typical k8s `fsGroup`/EFS/NFS volumes at startup. R6 ✅. R7 ⚠️. R8 ⚠️ — Agent Teams exists (durable named teammates, peer mailbox) but caps at 8 members, cannot cross a process boundary, stores the whole team in the Lead's session log, and ships disabled.

**Disqualifier — two, either sufficient.** (1) R1 is 100% your build on a framework that provides zero scaffolding for it, so choosing dsh for a memory product is choosing a framework that does not do the thing. (2) The persistence layer's own Known Limitations: *"No deletion or historical compaction — normal appends are insert-only and nothing removes old rows."* For a product holding intimate personal data under GDPR/CCPA erasure obligations, there is no supported way to delete a user's history short of deleting their entire home directory.

**Adaptation cost.** Build the memory system, the tenancy layer, the HTTP API, a networked session-persistence plugin, and a networked storage plugin — i.e. everything. Not worth it for a tool-calling loop.

### 3.3 Letta — **the thing that matched this brief was retired two weeks ago**

**What it is *now*.** Until mid-2026 Letta was exactly what this brief asks for: a Python multi-tenant agent server with REST, Postgres/pgvector, organizations/users/identities, `core_memory_replace`, and K8s scaling. That server was retired; its source sits on an `archive` branch and its own README says it *"is unsupported, receives no fixes or security updates, and should not be used in production."* (Correction to two judges: the `letta-ai/letta` *repo* is not GitHub-archived — 24,491 stars, pushed 2026-08-23, default branch `main` per [ungh](https://ungh.cc/repos/letta-ai/letta) — the V1 *source* was moved to a branch and disclaimed.) What ships today is `letta-code`, a TypeScript coding-agent harness whose server mode is a single-process, single-shared-token, single-volume WebSocket runtime.

**Per-requirement.** R1 ⚠️ — the best *intent* of any candidate. MemFS is git-backed Markdown, `system/persona.md` + `system/human.md` are inlined every turn (a literal soul file), and the reflection prompt says *"fix the stale entry at the source. Do not append the new version alongside the old."* Then its own [issue #4029](https://github.com/letta-ai/letta-code/issues/4029) measures a **50% restraint-failure rate across 120 runs / 10 models**, including a safety-critical allergy downgraded on anecdotal evidence and a **fabricated address produced by merging a stale value with a new one**. Supersession also fires on context compaction, not on the utterance — "I moved to Berlin and I'm single again" can sit stale for hours. R2 ❌ — no tenant identity in the protocol; `client.agents.list()/retrieve()/update()/delete()` take no owner parameter; `handleListModels` takes only a response object and advertises every agent on the server; the only tenancy lever the software can express is `LETTA_LOCAL_BACKEND_DIR`, read once at process start. R3 ✅ Apache-2.0, plus a Brand Assets Exclusion appended to `letta-code`'s LICENSE. R4 ❌ — two hard pivots in six months. R5 ❌ — one volume, `overlapSeconds: 0` because *"two generations must not share one computer identity or its persistent volume concurrently"*: rolling deploys and horizontal replicas are architecturally forbidden. R6 ✅ 38 providers. R7 ❌ — TypeScript-only stateful WebSocket reducer; Python must hand-roll a client against a 0.x wire protocol. R8 ⚠️ — subagent spawn forks a full CLI process per peer, capped at 32 process-wide, and deploying a peer by `agent_id` grants it a **general-purpose read-write toolset inside your working directory**.

**Disqualifier.** Beyond the archived-V1 problem: the filesystem sandbox is **off by default** for agent shells and **fails open** when `bwrap` is absent — which it is, in Letta's own published Docker image (`availability.ts`: *"We intentionally continue rather than fail closed"*). Persistence is 44 synchronous `fs` calls with zero async, so tenants serialize behind each other's disk I/O. And the flagship self-hosting doc points at `letta-app-server-deployment`, a repo now rewritten to boot a **Letta-Cloud-attached worker** with no published ports and no `LETTA_APP_SERVER_TOKEN` — the documented self-host path does not currently produce a self-hosted server.

**What to take instead: MemFS's format.** Plain Markdown with YAML frontmatter in an ordinary git repo is the best exit story in this entire study, and the `system/persona.md` ÷ `system/human.md` split is the right conceptual decomposition for a digital clone. Steal the format, not the runtime.

---

## 4. Alternatives worth knowing

**Agno AgentOS (Apache-2.0) — the runner-up, and the only real one.** Stateless FastAPI, 148 route decorators, Postgres-backed sessions/memories/runs, JWT with scopes and RBAC, 18 storage adapters behind a genuine `BaseDb` interface, reversible migrations (`up()`/`down()`), model fallback chains, and A2A in **both** directions. It loses to DIY on four specifics: (1) `AgentOS(authorization=False)` and `AuthorizationConfig(user_isolation=False)` are separate flags both default-off, and when isolation is off the fallback is the **client-supplied `user_id` query parameter** — `GET /memories?user_id=<victim>` works out of the box; (2) isolation is a per-endpoint hand-threading convention whose own module docstring concedes *"Omitting this will silently bypass user isolation with no runtime error"*; (3) the default memory prompt literally instructs *"append the existing memory with new information rather than completely overwriting it"* and `delete_memories` defaults to `False` — the shipped policy argues against R1; (4) `MemoryManager` loads **all** of a user's memories into the prompt each memory-updating turn with no top-K, so per-turn cost grows O(n) in profile size forever. Also: "stateless, add replicas" is contradicted by its own source — the default event stream and cancellation manager are process-local, so Redis is mandatory for multi-replica, and SSE resume/cancel silently no-op behind a load balancer without it. v3.0.2 uploaded 2026-08-30 — four releases in seven days.

**Graphiti (Apache-2.0) — take the schema, never the runtime.** `EntityEdge` carries `valid_at` / `invalid_at` / `expired_at`; contradictions invalidate rather than delete. That is R1 done correctly, and it is the data model in §5.3. Its runtime is not adoptable: `group_ids=None` searches every tenant and `validate_group_ids(None)` returns `True` (fail-open); the bundled FastAPI server has zero auth and a straight IDOR on `GET /entity-edge/{uuid}`; ingestion is a single in-process `asyncio.Queue` with one worker that **discards queued episodes on shutdown**; and it requires a CLA, from the vendor that already withdrew Zep CE.

**Mem0 / Zep — both escape hatches are closed.** Mem0 PR #4805 (merged 2026-04-14) replaced two-call ADD/UPDATE/DELETE reconciliation with a single-pass **ADD-only** pipeline, deleted `custom_update_memory_prompt`, and shipped no revert flag. Re-verified today against `mem0ai` 2.0.19: `mem0/memory/main.py` imports and uses only `ADDITIVE_EXTRACTION_PROMPT` (lines 20, 942, 2604) — no UPDATE call site four months on ([PyPI](https://pypi.org/pypi/mem0ai/json)). It also moved graph memory *out of OSS* into the paid Platform. Zep Community Edition is discontinued and in `legacy/`.

**Redis `agent-memory-server` — the strongest shape-match nobody swept, and it was demoted.** Apache-2.0, REST + MCP, two-tier working/long-term memory, user+namespace tenancy, LiteLLM, published Docker images. The OSS server now lives in `V0/` and its README states it *"is no longer actively maintained and is not the supported production path"*, superseded by managed **Redis Iris** ([source](https://raw.githubusercontent.com/redis/agent-memory-server/main/V0/README.md)). Its semantics are hash-based semantic deduplication, not supersession. **This is the fourth OSS agent-memory server retired in 18 months** — Zep CE → Cloud, Letta V1 → archived, mem0 graph → paid Platform, Redis V0 → Iris. That pattern is the single strongest argument for owning the memory layer.

**MemPalace (MIT, ~58.7k stars) — exists, and is the anti-recommendation.** Someone will raise it on star count. Its README: it stores conversation history as **verbatim** text and retrieves it *"without summarizing, extracting, or paraphrasing."* That is append-only by design — the precise opposite of R1 — shipped as a local-first MCP stdio server and CLI.

**Traps to name explicitly.** `langgraph` the library is MIT; **`langgraph-api` — the server you would actually deploy — is Elastic License 2.0 and requires a `LANGGRAPH_CLOUD_LICENSE_KEY`.** Mastra's `ee/` directories (auth providers, RBAC, fine-grained authorization) are enterprise-licensed **and invisible to SCA tooling**, because npm reports the package flat Apache-2.0. **MinnsDB is AGPL-3.0** (with `Cargo.toml` contradictorily declaring GPL-3.0-only) — this was the one genuine copyleft landmine in the study, and the original sweep missed it by wrongly declaring the project nonexistent. **Restack** publishes no engine source and no license on PyPI: treat as commercial, do not evaluate further.

---

## 5. Recommended architecture

### 5.1 Shape
One stateless service, N replicas, **no per-user process**. Background workers for memory consolidation and matchmaking. One managed Postgres 18 with `pgvector`. Nothing sticky, so autoscaling and zero-downtime rolling deploys work — which is precisely what Hermes, dsh, and Letta all forbid.

### 5.2 API layer
FastAPI (or Hono/Node) exposing a deliberately narrow contract that **your React Native app is the only consumer of**:
```
POST /v1/chat            (SSE)
GET  /v1/profile
POST /v1/matches
GET  /v1/matches/{id}/negotiation
```
This is the single rule that keeps R7 true. Never let a mobile client bind to an engine's endpoints — that is how Agno's 148 routes become *your* migration cost.

### 5.3 Memory store — the part you own
Four tables, one database:

| Table | Purpose |
|---|---|
| `raw_observations` | Append-only, `tenant_id NOT NULL`. Your system of record, your recovery path from a bad LLM extraction, and your only real exit path from any engine. |
| `facts` | `(tenant_id, subject, predicate, value, provenance, confidence, valid_from, valid_to, superseded_by, superseded_at)` — Graphiti's bi-temporal model in ordinary SQL. Invalidate, never delete. |
| `profile_snapshots` | The soul file: versioned Markdown, diffable, `persona.md` ÷ `human.md` split. Letta's best idea without Letta. |
| `match_cards` | The consented, redacted Tier-3 projection (~300–400 tokens). **The only tier that ever crosses a tenant boundary.** |

Supersession is a classifier over `{new candidate fact} × {semantically-near existing facts}` emitting Memobase's contract — `APPEND | UPDATE | ABORT` — written through Hermes's tool schema (`add | replace | remove | batch`). Every write is auditable and reversible because `raw_observations` never loses anything.

### 5.4 Tenant isolation
`tenant_id NOT NULL` on every row, **plus Postgres Row-Level Security** — the one thing no candidate offers, and the only defense that survives a forgotten filter in a new endpoint.

> **RLS has the same fail-open footgun you rejected the frameworks for.** Behind PgBouncer/Supavisor/RDS Proxy in *transaction* mode, tenant context **must** be set with `SET LOCAL` / `set_config(..., true)`. A plain `SET app.tenant_id` persists for the connection's life and the next client to grab that pooled backend inherits the previous tenant's context — [described as "the single most common way teams accidentally break tenant isolation"](https://queryplane.com/blog/postgres-row-level-security-in-practice/). Structurally identical to Hermes's `user_id="default"` fallback. Enforce `SET LOCAL` inside a single session-dependency, and test it.

**Ship this contract test before anything else, and re-run it on every dependency bump:** a query with no tenant id **raises**; a request carrying user A's token returns 403/empty for user B's rows. Every candidate in this study fails that test at defaults — Graphiti `group_ids=None` → all groups; Memobase unset `ACCESS_TOKEN` → every bearer is root; Agno unscoped → client-supplied `user_id`; a2a-python unauthenticated → `owner = ''`, one shared bucket.

### 5.5 Matchmaking — cascade, not fan-out
Naive agent-vs-agent fan-out is business-ending: 1,000 peers × 6 turns ≈ **$78/user/round on Sonnet 5, $195 on Opus 5**, against a $15–30/month subscription. Prices confirmed: Opus 5 $5/$25, Sonnet 5 $2/$10, Haiku 4.5 $1/$5 per MTok; batch 50% off input *and* output.

| Stage | Mechanism | Funnel | Rough cost |
|---|---|---|---|
| 0 | ANN over match-card embeddings, tenant-filtered | 100k → 500 | ~$0 LLM |
| 1 | **Deterministic** SQL constraint filter (geo, age, orientation, dealbreakers) | 500 → 150 | $0 |
| 2 | Batched card scoring, ~25 cards/call, Haiku 4.5 | 150 → 20 | ~$0.04–0.08 |
| 3 | **Stateless** dyadic mediator, one Sonnet 5 call per pair | 20 → 5 | ~$0.20 |
| 4 | True multi-turn envoy dialogue — the user-visible artifact | top 3–5 | ~$0.32 |

≈ **$0.30–0.60 per user per match round**: a 140–350× reduction. Two constraints the cost model must carry: the $0.56 figure assumes the **Batch API**, which is asynchronous with a multi-hour SLA — so this is a *nightly precomputed* match round, not an on-demand one (interactive Stage 2 roughly doubles). And **Haiku 4.5's context is 200K, not 1M**, which caps Stage 2's batch size before cost does.

**Assignment is deterministic code, never the LLM.** Feed LLM pairwise scores into Gale-Shapley. Reasoning models fail Hard stable-matching instances and cannot reliably identify blocking pairs ([arXiv 2506.04478](https://arxiv.org/abs/2506.04478)); centralized mechanisms beat free negotiation on stability and efficiency with LLM agents ([arXiv 2606.03030](https://arxiv.org/abs/2606.03030)).

**The negotiation envoy is a separate short-lived agent with no tool binding to the memory store.** Its context contains exactly: own match card, own mandate, peer's match card. Capability isolation enforced by the **context builder**, with a unit test asserting no Tier-1 token ever appears in an envoy prompt — never by a prompt instruction saying "do not reveal." Treat every peer message as untrusted input and constrain envoy replies to a strict JSON schema.

**Instrument exposure bias from week one.** An LLM reranker was measured collapsing onto **3 unique items vs 497 for a random baseline** in cold-start ([arXiv 2604.16318](https://arxiv.org/abs/2604.16318)). In a dating product that is not a metrics nicety — it is 2% of users receiving 90% of attention.

### 5.6 Swap-out seam
Define three interfaces on day one and let nothing else touch an engine:

```python
class MemoryPort(Protocol):
    def upsert_observation(self, tenant_id, obs) -> None: ...
    def current_profile(self, tenant_id) -> Profile: ...
    def fact_history(self, tenant_id, subject) -> list[Fact]: ...
    def forget(self, tenant_id) -> None: ...          # GDPR erasure, day one

class AgentPort(Protocol):
    def run_turn(self, tenant_id, message, tools) -> Turn: ...

class NegotiatePort(Protocol):
    def negotiate(self, card_a, mandate_a, card_b, mandate_b) -> Verdict: ...
```

Keep `NegotiatePort` A2A-*shaped* (opaque peer, card-based identity, task lifecycle) so an A2A adapter is a ~200-line edge shim when a genuine external counterparty appears — but do **not** adopt A2A internally. Every peer is your own tenant on your own infrastructure; A2A solves cross-organizational interop you do not have, prescribes no registry, no fan-out, and no orchestration, and its reference SDK owns two tables plus an Alembic chain in *your* database with cross-owner push dispatch and no SSRF guard.

**If you take Agno instead — the non-negotiable checklist:** `authorization=True` **and** `user_isolation=True` together; `QueueConfig(redis=...)` with an explicit non-null `key_prefix`; the async Postgres adapter; `MemoryManager(system_message=...)` overriding the append-biased default prompt; a forked fan-out path with a concurrency semaphore (it ships `ThreadPoolExecutor(max_workers=len(tasks))` uncapped and bare `asyncio.gather`); your own thin API in front; and the cross-tenant contract test in CI on every version bump.

---

## 6. What we'd have to build ourselves anyway

Under **every** option in this study:

1. **Contradiction detection, fact supersession, and profile rewrite** — extraction pass, conflict classification, bi-temporal write, periodic profile regeneration. *No candidate ships this.* Plus an eval harness of scripted life-change transcripts (new job, moved city, changed relationship goal, dropped interest) scored on whether the retrieved profile reflects the **new** state.
2. **The multi-tenant control plane** — user identity, `user_id → agent_id` mapping, per-request authorization. Letta's own integration guide assigns you *"users, tasks, dashboards, durable results, and retry policy"*; Agno pushes tenancy to per-endpoint convention.
3. **The matchmaking cascade and orchestrator** — fan-out with concurrency caps, per-negotiation token budgets, timeouts, cancellation, persisted transcripts, Gale-Shapley assignment, ranking, diversity injection.
4. **The consent, disclosure, and redaction layer** — the three-tier data model, per-pair disclosure ledger and budget, progressive disclosure gated on mutual interest, rate-limited re-negotiation. No agent protocol expresses delegation, consent, or dissent ([arXiv 2606.31498](https://arxiv.org/abs/2606.31498)).
5. **Cross-tenant privacy enforcement and its tests** — RLS policies, `SET LOCAL` discipline, the contract test.
6. **Background job infrastructure** — queue, claim/lease/heartbeat, crash recovery. (This is the one place Agno genuinely gives you real work for free.)
7. **Mobile transport concerns** — SSE reconnect, replay/reconciliation, one active turn per conversation.
8. **GDPR/CCPA erasure** — `forget(tenant_id)` cascading across facts, snapshots, embeddings, negotiation transcripts, and match cards held by *other* users' rounds.

Frameworks save roughly 3–5 engineer-weeks of item 6 and parts of 2. Items 1, 3, 4, 5, and 8 — the product — are 5–8 weeks either way.

---

## 7. Open risks

**Unresolved, and the critic is right to flag them:**

- **Nobody measured anything.** There is no cold-start, per-turn-latency, memory-per-agent, or concurrency benchmark anywhere in this study — for the candidates *or* for the recommendation. Every R2 verdict, including the winning one, is code-reading plus arithmetic. **Action: build a 500-synthetic-tenant load harness in week one and measure before you commit to the cascade's stage boundaries.**
- **R1 has no acceptance criterion.** Letta's issue #4029 (50% restraint failure over 120 runs) is the only *measured* supersession datum in the entire corpus — and it measures a candidate we reject. Define the target accuracy and the eval set before writing the classifier, or you will ship a coin flip.
- **The exit path is asserted, never demonstrated.** Rebuild one profile from `raw_observations` end-to-end and price the LLM re-extraction bill *before* you rely on it as the escape hatch. Graphiti's exit cost is re-running the entire extraction bill; that is exactly the trap the raw log is meant to avoid.
- **RLS threatens Stage 0.** With approximate indexes, filtering happens *after* the HNSW scan, so a selective tenant policy can return few or zero neighbours. Guidance is a b-tree on `tenant_id` **plus** HNSW on the vector — not a multicolumn HNSW — with per-tenant partitioning for whale tenants ([pgvector multi-tenancy](https://pradeepbhandari.com/blog/pgvector-multi-tenancy-postgresql-rls-guide)). The 100k→500 prefilter is not free.
- **Capacity has no escape hatch.** **Priority Tier excludes Claude Opus 5 and Sonnet 5** (a Priority Tier request naming either fails validation), and fast mode is Opus-only at $10/$50. The cascade's Sonnet 5 stages have neither reserved capacity nor a latency lever under burst.
- **The three-model cascade is unvalidated against the simpler baseline.** First-party guidance: measure the most capable model at *lower effort* on the same tasks first, because **caches are model-scoped and a cascade forfeits cache reuse across its models**, and judge cost per *completed task*, not per request. The cost model has no effort dimension at all. The 140–350× figure may be right for the wrong reason — run the single-model baseline before locking in three tiers.
- **Stage 3's cache-hit assumption is untested.** Pair-verdict caching keyed on `(unordered_pair, profile_version_a, profile_version_b)` is claimed to halve Stage 3. If profiles version often — which is the *product* — the cache mostly misses and Stage 3 doubles.
- **Graphiti's two blocker issues (#1676 cross-tenant write corruption; #1793 unindexed vector scan) could not be re-verified today** (GitHub API rate-limited). They are load-bearing for "borrow the schema, never the runtime." Re-check before this reaches a board deck.
- **Legal is entirely unaddressed.** Consent, disclosure, and algorithmic-fairness obligations for agent-mediated matchmaking of intimate data were flagged and dropped: no jurisdiction analysis, no DPIA, no retention/erasure design — despite deletion being the exact thing that disqualified DeepSeek Harness.

**Licensing caveats to carry into diligence:**

- ✅ **Clean:** Pydantic AI (MIT), FastAPI (MIT), Postgres, pgvector (**PostgreSQL License**, not MIT — permissive either way, [LICENSE](https://raw.githubusercontent.com/pgvector/pgvector/master/LICENSE)), Agno (Apache-2.0, no Commons Clause), Hermes (MIT), dsh (MIT), Letta (Apache-2.0), Graphiti (Apache-2.0), A2A (Apache-2.0).
- ⚠️ **`langgraph-api` is Elastic License 2.0 + a mandatory license key.** "LangGraph is MIT" is true of the library and false of the server. Flag this *before* anyone prototypes with `langgraph dev`.
- ⚠️ **Mastra `ee/` requires a paid enterprise license for production** — and npm metadata reports the package flat Apache-2.0, so **SCA tooling will not catch it.** This is a policy control, not a tooling control.
- ⚠️ **MinnsDB is AGPL-3.0** (`Cargo.toml` says GPL-3.0-only — the repo contradicts itself). Excluded either way.
- ⚠️ **Honcho is AGPL-3.0** — relevant only if you follow Hermes's documented deep-modeling path; its bundled `plugins/memory/holographic` is MIT and avoids it.
- ⚠️ Brand carve-outs: `letta-code`'s LICENSE appends a Brand Assets Exclusion; dsh ships `BRAND_GUIDELINES.md` asserting a registered trademark. Strip branding in any derivative.
- ❌ **Restack:** no engine source, no published license. Treat as commercial.
- 📌 **Cadence caveat on our own pick:** Pydantic AI shipped **8 releases in 9 days** (2.32.1 → 2.36.0). "DIY has no upgrade treadmill" is only true of Postgres — pin the agent library exactly, and keep it behind `AgentPort` so the churn stops at one file.