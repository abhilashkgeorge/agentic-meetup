# Personal Clone Agent — Architecture

**Author:** final architect · **Date:** 2026-09-07 · **Status:** build from this
**Audience:** one solo developer, unfunded, paying inference out of pocket

---

## 1. What we are building

A personal AI clone: one user talks to it by text and voice, it extracts durable facts about that person, and it **updates and retires facts that have stopped being true** so its model of them stays current instead of accumulating contradictions. The profile lives in Postgres as a bi-temporal fact store with per-tenant isolation, not in a prompt or a file. The mobile app is a thin client — capture, render, cache — and every decision about what is true happens server-side. The clone gets more useful the longer you use it because the store compounds, not because the context window grows. A later phase lets one user's clone reason with another user's clone to find compatible people; the schema is shaped for that today and nothing else is built for it.

**The one thing that has to work:** when a fact about the user changes, the old fact stops being asserted — and when a fact only *looks* like it changed, it does not. Everything else in this document is scaffolding around that. If supersession does not work, this is a chatbot with a slow, expensive RAG index, and the correct move is to ship the RAG index and stop.

---

## 2. The five decisions

| Q | Verdict | One-line reason |
|---|---|---|
| **Q1 — cost at 1k DAU** | **~$1,950/month all-in** (routed stack, 20 turns/day, TTS off by default). Voice output, not the brain, is the cliff. | LLM is $1,213 of it; cloud TTS at 10 spoken replies/day would add $2,700–18,000/mo — 2–15× the entire LLM bill. |
| **Q2 — topology** | **(b) Stateless FastAPI workers; the agent is rows in Postgres.** Two 1-vCPU containers. | Peak is ~2.5 turns/s and ~30 concurrent LLM-bound turns = 0.1–0.2 vCPU. Container-per-user on Fly is **~$5,900/mo realistic** for zero functional gain. |
| **Q3 — client** | **Expo, development build from commit one.** Never Expo Go. | The managed/bare split is a deprecated concept and Expo Go is unshippable, so you already hold the native escape hatch. Only Android `VoiceInteractionService` would flip it. |
| **Q4 — memory** | **Bi-temporal Postgres fact store. Current state is a SQL query. Supersession for single-valued predicates is a partial unique index, not an LLM decision.** | LLM update passes are **100% on action, 50% on restraint**; a unique index is 100% at $0/turn on exactly the fields a dating clone needs (city, employer, relationship status). |
| **Q5 — model swap** | **Your own `LLMPort` over Pydantic AI. Chat on GPT-5.6-luna, write path on Claude Sonnet 5.** No gateway, no proxy. | Every abstraction layer surveyed silently dropped prompt caching in 2026 — never an exception, always a bigger bill. The seam has to be yours so degradation raises instead of leaking. |

**Model choice, decided and dated.** Do **not** build on Claude Haiku 4.5. Its tentative retirement is *"not sooner than October 15, 2026"* — five weeks from today, the shortest horizon of any active Claude model, on a provider whose policy is *"at least 60 days' notice"* versus OpenAI's *"at least 6 months"* ([model-deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations), [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations), both fetched 2026-09-07). Two of the three candidate designs pinned chat *and* extraction on Haiku 4.5 and padded a 4,200–4,775-token prefix specifically to clear its 4,096-token cache minimum — a pad that is pure waste on every other model. **That pad dies with Haiku.** Sonnet 5's minimum is 1,024 and GPT-5.6's is 1,024; a 3,000-token shared prefix clears both with no padding tax.

---

## 3. Cost model

### 3.1 Assumptions — state them, because everything is linear in them

| Parameter | Value | Confidence |
|---|---|---|
| DAU × days | 1,000 × 30 | given |
| Turns/user/day | 5 / 20 / 40 (low / mid / high) | **unmeasured — see §10** |
| Sessions/day × turns/session | 2×2.5 / 4×5 / 6×6.7 | **unmeasured, and the caching model is linear in it** |
| Voice input share | 50% of turns, 15s clips | unmeasured |
| Spoken replies | **off by default** (platform TTS = $0) | design decision |
| Extraction | **1 call per session**, not per turn | design decision |
| Resolve (LLM) | 40% of sessions (multi-valued candidates only) | estimated |
| Nightly reflection | 40% of users, Batch API | design decision |

**Prompt shape per chat turn** (old-tokenizer counts; Claude 4.7+ models produce ~30% more tokens for identical text, so Sonnet-5 counts are ×1.3):

| Segment | Tokens | Cacheable |
|---|---|---|
| [1] shared system + tool defs + few-shot | 2,300 | yes, breakpoint 1 |
| [2] per-user core profile | 1,150 | yes, breakpoint 2 |
| [3] conversation history | 1,540 | yes, breakpoint 3 |
| [4] retrieved facts (this turn) | 615 | **never** |
| [5] user message | 77 | **never** |
| **input total** | **5,692** | |
| output | 310 | |

### 3.2 Live prices used (all fetched 2026-09-07)

| Item | Price | Source |
|---|---|---|
| GPT-5.6-luna | $0.20 / $1.20 per MTok; cache read 0.1×, cache write 1.25×, **30-min reuse window**, 1,024-tok minimum | [developers.openai.com/api/docs/pricing](https://developers.openai.com/api/docs/pricing), [prompt-caching](https://developers.openai.com/api/docs/guides/prompt-caching) |
| Claude Sonnet 5 | $2.00 / $10.00; 5m write $2.50, read $0.20; 1,024-tok min; **new tokenizer (+~30%)**; Batch 50% off | [platform.claude.com/pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Claude Haiku 4.5 | $1.00 / $5.00 — **rejected, retires ≥2026-10-15** | [model-deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations) |
| Claude Opus 5 | $5.00 / $25.00 — reference only | [pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| text-embedding-3-small | $0.02 / MTok | [openai.com](https://openai.com/index/new-embedding-models-and-api-updates/) |
| Groq whisper-large-v3-turbo | $0.04 / audio-hour — **free tier caps at 28,800 audio-sec/day = 8 hr/day**; developer-tier ceiling unpublished | [console.groq.com/docs/rate-limits](https://console.groq.com/docs/rate-limits) |
| OpenAI Whisper (capacity-verified fallback) | $0.006/min = $0.36/audio-hour | [pricing](https://developers.openai.com/api/docs/pricing) |
| OpenAI tts-1 / Deepgram Aura-1 | $15 / 1M chars | [pricing](https://developers.openai.com/api/docs/pricing), [deepgram.com/pricing](https://deepgram.com/pricing) |
| ElevenLabs Flash / v3 | $50 / $100 per 1M chars | [elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api) |
| Supabase Pro + Large + PITR(7d) | $25 + $110 − $10 credit + $100 = $225 | [supabase.com/pricing](https://supabase.com/pricing) |
| Apple Small Business Program | **15% commission** (≤$1M proceeds prior year) | [developer.apple.com/app-store/small-business-program](https://developer.apple.com/app-store/small-business-program/) |
| Google Play, US/EEA/UK from 2026-06-30 | **10% + 5% billing fee = 15% effective** on auto-renewing subs | [support.google.com](https://support.google.com/googleplay/android-developer/answer/112622) |

### 3.3 The numbers

I apply a **30% cache-miss haircut** to OpenAI cache reads, because the docs say `prompt_cache_key` *"influences routing; it does not pin requests to a machine or guarantee a cache read hit."* This is deliberate pessimism. It is also why the headline is higher than the cheapest competing design's $484 chat line — a line I could not reproduce from its own stated table (it computes to $560, and its model choice is incompatible with its own cross-user-prefix assumption; see §3.5).

**Monthly, 1,000 DAU, routed stack, TTS off:**

| Line | Low (5 t/d) | **Mid (20 t/d)** | High (40 t/d) |
|---|---|---|---|
| Chat + reply (luna) | $160 | **$625** | $1,280 |
| Extract, session-level (luna) | $80 | **$170** | $300 |
| Resolve / supersede (Sonnet 5, **sync**) | $103 | **$230** | $360 |
| Nightly reflection (Sonnet 5 **Batch**) | $84 | **$168** | $252 |
| Core-profile render (luna) | $6 | **$14** | $30 |
| Embeddings | $4 | **$6** | $10 |
| **LLM subtotal** | **$437** | **$1,213** | **$2,232** |
| STT (OpenAI Whisper, capacity-verified) | $113 | **$450** | $900 |
| Infra (Supabase $225 + Fly $18 + EAS $19 + Apple $8 + storage $15) | $285 | **$285** | $385 |
| **ALL-IN** | **$835** | **$1,948** | **$3,517** |
| **per DAU / month** | **$0.84** | **$1.95** | **$3.52** |

**Sensitivity — the four things that actually move it:**

| Change | Mid-case all-in | Delta |
|---|---|---|
| **No prompt caching at all** | ~$2,595 | +33% |
| **Groq turbo scales (STT $50 not $450)** | ~$1,548 | −21% |
| **Cloud TTS on, 10 spoken replies/day** (tts-1, $15/1M chars, 180M chars) | ~$4,648 | **+$2,700** |
| **Cloud TTS on ElevenLabs v3** | ~$19,948 | **+$18,000** |
| **Chat on Sonnet 5 instead of luna** | ~$7,735 | +297% |
| **Everything on Opus 5** | ~$16,000 | +720% |
| **Realtime speech-to-speech, 5 min/day** ($0.016–0.05/conv-min) | +$2,400–7,500 | catastrophic |

**Prompt caching is worth ~33% of the all-in and ~35% of the LLM line. It is not worth 90%.** The 90% applies only to the cached *segment*; segments [4] and [5] are structurally uncacheable, and at a **1-turn session the 5-minute TTL is a 25% surcharge, not a saving** (write 1.25×, never read). This is the single largest unmeasured risk in the model — see §10.

### 3.4 Break-even — with commission, which no prior model included

Store commission is 15% either way, so $19.99 nets **$16.99**.

| Shape | Free-user cost | Paid-user cost | Verdict |
|---|---|---|---|
| Free tier 5 turns/day, text only, no reflection, no LLM resolve | **$0.22/mo** | — | viable as a trial only |
| Paid, 40 turns/day + voice + cloud TTS | — | **$3.50/mo variable** | |

**At 1,000 DAU with a permanent free tier:**

| Conversion | Monthly cost | Revenue @ $19.99 (net) | Result |
|---|---|---|---|
| 3% (30 payers) | $603 | $510 | **−$93** |
| 5% (50 payers) | $669 | $850 | +$181 |
| 8% (80 payers) | $767 | $1,359 | +$592 |

**Break-even at 3% conversion is $23.65 list.** Consumer subscription apps convert 2–5%. So:

> **Decision: paid from signup, $19.99/month, 7-day trial hard-capped at 10 turns/day. No permanent free tier.** At 1,000 *paying* DAU, revenue is $16,990 net against $1,948–3,517 cost — **gross margin 79–89%**. Every alternative shape needs ≥5% conversion to clear zero, and no price in the $12–19 band closes at 3%.

Say the quiet part: **"1,000 DAU" in this plan means 1,000 paying DAU, which at consumer trial-conversion means ~15,000–30,000 installs.** That is the real go-to-market number.

### 3.5 Where I am being deliberately pessimistic, and where three prior models were not

1. **Commission (15%) is in every revenue line here and was in none of the prior three.** One design's break-even ("$424 cost vs $390 revenue") was already a loss before commission and is a 28% shortfall after.
2. **30% cache-miss haircut on OpenAI.** No prior model applied one.
3. **STT budgeted at OpenAI Whisper ($450), not Groq ($50).** Groq's free tier caps at 8 audio-hours/day; we need 41. Developer-tier limits for that model are **not published**. Groq is upside, not a plan.
4. **The luna-vs-shared-prefix contradiction, adjudicated.** One design claimed both GPT-5.6-luna *and* a 0.24× multiplier driven by a byte-identical prefix shared across all 1,000 users. Those are mutually exclusive: OpenAI routes on a hash of initial tokens with a documented ≤15 rpm per-machine ceiling before overflow routing, so an identical prefix across 1,000 users at 14–40 rpm is a guaranteed hot spot, and the documented mitigation (`prompt_cache_key = user_id`) *deliberately destroys* the sharing. **My luna numbers assume no cross-user sharing.** They are honest.
5. **Unpriced in all three prior designs, priced here:** app-store commission, PITR ($100/mo), auth, embedding-model migration, DB growth (§10).

---

## 4. Topology

**Verdict: (b) stateless workers. Two API containers plus one background worker.**

**The arithmetic that settles it.** 1,000 DAU × 20 turns = 20,000 turns/day = 0.23/s average. Put 15% of volume in the peak hour → 0.83/s. Add a 3× minute-burst → **2.5 turns/s**. Each turn holds a connection ~12s *waiting on the model*, so by Little's Law that is **~30 concurrent in-flight turns** and **0.1–0.2 vCPU of real Python**. Two 1-vCPU/1GB containers give ~20× headroom; the second exists for zero-downtime deploys, not capacity.

**Why one container per user is wrong, with the price.** Fly: 1,000 machines at shared-cpu-1x 1GB active 1h/day = $246/mo compute **plus $225/mo rootfs for machines that are stopped and doing nothing** = $471/mo optimistic. But Fly's own docs say the proxy stop loop *"stops or suspends at most one Machine per region each pass"* and with thousands of machines *"most of your idle Machines stay running"* ([autostop-autostart](https://fly.io/docs/launch/autostop-autostart/), fetched 2026-09-07) — so the honest number is **1,000 × $5.92 = ~$5,920/month**, 12× the optimistic figure and ~3× the *entire* mid-case bill of this architecture. Add: Fly's own guidance is one-app-per-user (1,000 deploys per code change), a 50-machine default quota, and **suspend snapshots discarded on every deploy** — a solo dev shipping daily hands every user a cold start every day. The state is already rows in Postgres. A per-user process is a cache, not a home.

Cloudflare Durable-Object-per-user is the one place per-user isolation genuinely works, but the $12/mo headline is unsafe: Cloudflare's pricing page states an outbound `connect()` — how you reach Postgres — *"keeps a Durable Object in memory and causes it to incur duration charges for up to 15 minutes per connection, even with no incoming requests."* Worst case ≈ **$840/mo**, plus a TypeScript rewrite. Revisit only at a natural rewrite boundary, never mid-flight.

**Why on-device is not the main runtime.** Both platforms forbid the core use case. Apple rate-limits the on-device Foundation Model when the device is on battery **and** the process is in the background (Apple Frameworks Engineer, [forums/thread/789788](https://developer.apple.com/forums/thread/789788)); a developer hit the limit after 4 requests at 30-second intervals. Android ML Kit GenAI returns **`ErrorCode.BACKGROUND_USE_BLOCKED`** outside the foreground, plus a separate `PER_APP_BATTERY_USE_QUOTA_EXCEEDED` daily quota ([developers.google.com/ml-kit/genai](https://developers.google.com/ml-kit/genai)). **A clone that gets better over time is a background process by definition.** Beyond that: the best on-device instruction-follower scores 49.12 on BFCLv3; constrained decoding moves *value* accuracy by only −0.007 to +0.033 (it guarantees valid JSON, not true JSON); Apple Intelligence coverage is ~30% so the server path exists anyway, making on-device always a second codebase; and the correctly-priced prize is **$8–60/month**.

**The hybrid split that IS worth shipping:**

| On device | Why |
|---|---|
| **VAD** (Silero, MIT, ~2MB) | Gates the mic. Measure the saving, do not assume 50–70% |
| **Live-partial STT** (Apple SpeechAnalyzer / Android `createOnDeviceSpeechRecognizer`) | **Screen only.** Zero network latency, free, zero app-size cost |
| **TTS** (`AVSpeechSynthesizer` / Android `TextToSpeech`) | ~50–100ms vs cloud's ~2,000ms, and $0 instead of $2,700–18,000/mo. TTS failures are cosmetic, never epistemic — they cannot poison the fact store |
| **Offline read-only profile cache** (SQLite mirror) + local outbox | Instant app-open, offline "what do you know about me" |

| Server-side, always | Why |
|---|---|
| **Canonical transcript** (cloud Whisper over retained audio) | Apple on-device STT is 2.12% WER; Android's is 6–12%. Letting the handset write the canonical store makes profile quality a function of which phone the user owns — the exact objection that kills on-device inference, applied to on-device STT |
| Extraction, resolution, supersession, commit, retrieval, reply | Everything that decides what is true |

**Streaming:** every turn is a stateless request. **Resume the turn, not the token stream** — the client generates an idempotent `turn_id`, the server persists the assistant message as it completes, and reconnect re-fetches by id. Buffering chunks in process memory requires sticky routing, which is option (a) through the back door.

**Queue:** one Postgres table, `SELECT … FOR UPDATE SKIP LOCKED`, partial index on pending, separate archive table. You need ~0.06 jobs/s against ~11,300 msg/s measured. Two rules matter more than throughput, because **bloat is how this fails, not throughput** (a held-open xmin horizon measures 14× dead tuples, 15× table size, −35% dequeue throughput): **never hold a transaction open across an LLM call**, and **alarm on `idle in transaction` and replication-slot lag**.

**What breaks first, in order.** (1) A blocking call inside an `async def` handler stalls the whole event loop — the most common real failure; a sync `def` endpoint is *safer* because it runs in the threadpool. (2) `httpx.AsyncClient` defaults `max_connections=100`, `max_keepalive_connections=20`, `keepalive_expiry=5.0s` — set them explicitly or LLM calls silently queue. (3) DB connections — pooler in transaction mode, pool ≈ 2× cores. (4) Provider limits. Memory never breaks first.

---

## 5. Client

**Expo SDK 57 (RN 0.86), development build from commit one. Decisively.**

The founder's rule — "if the app is a very thin client I go Expo, otherwise Kotlin+Swift" — tests a variable that no longer exists. Expo's own docs state that *"managed vs bare workflow"* and *"ejecting"* are **deprecated concepts** ([continuous-native-generation](https://docs.expo.dev/workflow/continuous-native-generation/)); native code enters through config plugins and Expo Native Modules in Swift/Kotlin without leaving the toolchain. And Expo Go is unshippable for production anyway — SDK 55/56 sat unapproved in App Store review through May 2026 — so **you are on a dev build regardless, which means you already hold the native escape hatch on day one.**

| Concern | Choice |
|---|---|
| Capture | `expo-audio`: `AudioRecorder` for push-to-talk, `useAudioStream` (SDK 56, 48kHz/mono/float32) if you go live |
| Background | `["expo-audio", {enableBackgroundRecording:true}]` + `setAudioModeAsync({allowsBackgroundRecording:true})` |
| Transport | **One authenticated WebSocket**, audio up / events down, heartbeat every 15s |
| Not SSE | `expo/fetch` streaming still carries **unshipped** iOS fixes in expo's changelog (empty body on a 200, dropped chunks, AbortSignal hangs). RN's WebSocket is built-in and stable |
| Push | Expo Push (600/s/project, free) for user-visible nudges. **Not** silent pushes — Apple's own guidance is 2–3/hour |
| Deferred | LiveKit realtime. Check `@livekit/react-native-expo-plugin` first: 1.0.2, published 2026-03-17, six months stale |

**What would flip it to native:** exactly one thing — Android `VoiceInteractionService` (the assistant role, long-press to summon). There is no Expo or RN path, it is deep platform Kotlin, and it also buys a background-mic while-in-use exemption, making it a bigger prize than it looks. Audio-thread DSP (custom wake word, custom AEC) flips a *module*, not the app — you write an Expo Native Module in Swift/Kotlin and stay in Expo. That is CNG working as designed. Neither is day-one, and against them, EAS absorbing the 2026-04-28 Xcode 26 mandate and the 2026-08-31 Play API-36 mandate is worth more than both combined.

**Kill "always-on clone" as a product concept now, before it shapes anything.** Android cannot start a `microphone` foreground service from the background or from `BOOT_COMPLETED`. iOS only extends a session **begun in the foreground**, always with the orange pill visible. Kotlin+Swift changes neither. The shippable shape is **user-initiated capture that survives backgrounding** — open app, tap talk, lock phone, keep talking. One exception worth building: on Android, *"the service starts by interacting with a notification"* is a documented while-in-use exemption, so **a notification tap can legally start a mic foreground service.** That is your proactive-agent affordance.

**What must live server-side for "thin client" to hold.** The phone owns: capture, VAD, live-partial STT, playback, local draft cache, auth token, push token, optimistic UI, and a read-only profile mirror. The server owns: canonical transcription, fact extraction, supersession, the bi-temporal store, retrieval, prompt assembly, the model adapter, tool execution, metering, and conversation history as system of record. **The client must be replaceable in a weekend and must never be the authority on any user fact.** Hold that line and Expo stays correct as the phone-side capability list grows.

**Compliance, all first-build:**

1. **Apple 5.1.2(i)** (effective 2025-11-13): name the third-party AI provider and obtain explicit permission before the first transmission. **Serve the provider string from `GET /v1/config`** so a Q5 model swap is not a binary release.
2. **EU AI Act Article 50**, in force since **2026-08-02**, penalties to €15M / 3% of turnover: disclose that the user is interacting with AI.
3. **Anthropic AUP**: consumer-facing chatbots *"must disclose to users that they are interacting with AI... at a minimum at the beginning of each chat session"* ([anthropic.com/legal/aup](https://www.anthropic.com/legal/aup)). An onboarding consent screen **does not satisfy this**. Ship a per-session disclosure line.
4. **California SB 243** (chaptered 2025-10-13, B&P Code §22601 et seq.): "companion chatbot" is defined as *"an AI system with natural language interface providing adaptive, human-like responses capable of meeting social needs, exhibiting anthropomorphic features, and sustaining relationships across multiple interactions"* — this product's spec sheet. **No small-operator exemption.** Requires a conspicuous AI notice, a **maintained and website-published protocol** for suicidal/self-harm ideation with crisis referral, and for known minors a break reminder every three hours. Remedy: **damages of at least $1,000 per violation** plus attorney's fees, private right of action ([SB-243 text](https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260SB243)).
5. **Apple 4.7 / 4.7.5**: chatbots are explicitly enumerated; *"your app must provide a way for users to identify software that exceeds the app's age rating, and use an age restriction mechanism based on verified or declared age."* **Guideline 1.2** additionally requires a filtering method, a report mechanism with timely responses, **the ability to block abusive users**, and **published contact information**. Expect 13+, not 4+.
6. **Google Play AI-Generated Content policy**: chatbot apps must ship **in-app reporting/flagging without leaving the app**.
7. **Apple 5.1.2(iii)** forbids surreptitious profile building — so make the profile conspicuous. **The "here's what I know about you — edit or delete anything" screen does quadruple duty:** App Review defence, GDPR Art. 17 surface, the write-approval consent UX, and your supersession debugger.

**Two week-one spikes, in this order, before any feature work:**

1. **iOS `AVAudioSession` contention.** `useAudioStream`, `expo-speech-recognition` (which seizes the session as `playAndRecord` / mode `measurement`), and any future WebRTC cannot all own the session, and JS has almost no visibility into which won. **Rule: never run `useAudioStream` and `expo-speech-recognition` concurrently; if LiveKit ever ships, it owns the session end-to-end.** This, not "thickness" or background modes, is the real Expo risk for *this* product.
2. **facebook/react-native#57725** (open since 2026-07-28): a controlled multiline `TextInput` on iOS 26.6 + Fabric grows memory unboundedly with autocorrect on until jetsam kills the app at ~3.5GB, **no crash log, not reproducible in the simulator**. That component is your product. Workaround `autoCorrect={false} spellCheck={false}`. Test on a physical device.

---

## 6. Memory architecture

### 6.1 The design principle

**Current state is a SQL query. Vector search is for episodic recall.** HorizonBench states it directly: *"a system that retrieves the most recently stated preference would return exactly the pre-evolution distractor value"* (arXiv:2604.17283). Nearest-neighbour returns the *most similar* fact, not the *currently true* one. Confusing the two is the documented failure at the heart of this product category.

**And the strongest component in this design needs no LLM at all.** LLM update passes measure **60/60 (100%) on action-type conflicts and 30/60 (50%) on restraint-type** (letta-code#4029). But `current_city`, `current_employer`, `relationship_status` — the fields mem0 issue #4956 names as its live failure mode, and exactly the fields a dating clone needs — are **single-valued**. A partial unique index makes those 100% reliable at $0 per turn with no prompt engineering. The LLM only has to handle genuinely multi-valued predicates.

### 6.2 The four tiers

| Tier | Table | Bound | Read primitive | Rebuild |
|---|---|---|---|---|
| **0 — Episodes** | `episodes` | unbounded, append-only, immutable | **vector ∪ FTS** | never |
| **1 — Facts** | `facts` | ~1–5k active/user | **plain SQL** for the closed core; vector for the open tier | on write |
| **2 — Core profile** | `core_profile` | **1,500 tokens hard** | keyed lookup, always inlined | on budget overflow / N new hard facts |
| **3 — Directives** | `directives` | ~20 rows | keyed lookup, always inlined | supersede in place |

Tier 0 is the ground truth and your fallback product. Tier 1 is the product. Tier 2 is the prompt. Tier 3 is what the *user told the agent to do*, which is a different thing with a different rule (see §6.6).

### 6.3 Tables

```sql
-- ═══ TIER 0 ═════════════════════════════════════════════════════════
-- Append-only. Immutable. Never edited. VECTORISED.
CREATE TABLE episodes (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL,
  user_id           uuid NOT NULL,
  session_id        uuid NOT NULL,
  turn_id           uuid NOT NULL,          -- client-supplied; idempotency key
  turn_index        int  NOT NULL,
  role              text NOT NULL,          -- 'user' | 'assistant'
  source            text NOT NULL,          -- 'text' | 'voice'
  raw_text          text NOT NULL,          -- never discarded
  asr_confidence    real,                   -- NULL for text
  asr_low_conf_spans jsonb,                 -- word-level; drives default stance
  audio_uri         text,                   -- lifecycle-deleted at 30d
  occurred_at       timestamptz NOT NULL,
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  embedding         halfvec(768),           -- K = raw_text || ' ' || extracted_facts
  embedding_model   text NOT NULL,          -- REQUIRED. see §10, risk 11
  embedding_version smallint NOT NULL,
  fts               tsvector,
  UNIQUE (tenant_id, turn_id)
) PARTITION BY HASH (user_id);              -- 32 partitions
```

Embed **raw value concatenated with the facts extracted from it, at index time**. LongMemEval (ICLR 2025) measured recall@5 at session granularity: raw value 0.706, facts-alone **0.642** (condensing *loses* information), **value+facts 0.732**. And index-time key merging beat retrieval-time rank fusion **0.732 vs 0.618** — so RRF is for blending the episode and fact *channels*, never as the primary fusion for this index.

```sql
-- ═══ TIER 1 ═════════════════════════════════════════════════════════
CREATE TABLE predicates (            -- ~40 closed core + the 'topic' escape hatch
  name          text PRIMARY KEY,
  tier          text NOT NULL,       -- 'core' (SQL-readable, matchmaking join) | 'open'
  cardinality   text NOT NULL,       -- 'single' | 'multi'
  durability    text NOT NULL,       -- 'hard' | 'soft'
  matchable     boolean NOT NULL DEFAULT false   -- phase-2 join key
);

CREATE TABLE facts (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL,
  user_id           uuid NOT NULL,

  subject_entity_id uuid NOT NULL,           -- usually the user
  predicate         text NOT NULL REFERENCES predicates(name),
  is_single_valued  boolean NOT NULL,        -- denormalised from predicates FOR THE INDEX
  object_text       text NOT NULL,           -- VERBATIM. never generalised.
  object_entity_id  uuid,
  object_value      jsonb,

  -- bi-temporal: four columns, Graphiti's model
  valid_from        timestamptz,             -- WORLD time. required input, never inferred.
  valid_to          timestamptz,
  recorded_at       timestamptz NOT NULL DEFAULT now(),   -- SYSTEM time
  invalidated_at    timestamptz,

  status            text NOT NULL DEFAULT 'staged',
     -- staged | active | superseded | retracted | needs_recheck | quarantined
  supersedes_id     uuid REFERENCES facts(id),
  superseded_by_id  uuid REFERENCES facts(id),

  -- governance
  origin_class      text NOT NULL DEFAULT 'untrusted',  -- owner|agent|untrusted|system
  stance            text NOT NULL,           -- asserted|hedged|hypothetical|reported|negated
  hedge_span        text,                    -- the VERBATIM hedge. NEVER dropped.
  source_quote      text NOT NULL,           -- VERBATIM
  source_episode_ids uuid[] NOT NULL,
  corroboration_count smallint NOT NULL DEFAULT 1,
  extractor_model   text NOT NULL,
  extractor_version text NOT NULL,
  prompt_version    text NOT NULL,

  -- promotion signal (NOT a write-time confidence float)
  retrieval_count   int NOT NULL DEFAULT 0,
  used_in_reply_count int NOT NULL DEFAULT 0,
  last_retrieved_at timestamptz,
  importance        smallint,

  embedding         halfvec(768),            -- open tier only
  embedding_model   text,
  embedding_version smallint,
  fts               tsvector
) PARTITION BY HASH (user_id);

-- ─── THE SINGLE MOST IMPORTANT LINE IN THIS ARCHITECTURE ───
CREATE UNIQUE INDEX facts_single_valued_current ON facts
  (tenant_id, user_id, subject_entity_id, predicate)
  WHERE status = 'active' AND valid_to IS NULL AND is_single_valued;

CREATE INDEX facts_current_state ON facts
  (tenant_id, user_id, predicate) WHERE status = 'active' AND valid_to IS NULL;
```

A new `works_at` **cannot coexist** with the old one even if the extractor never noticed the contradiction. The writer does `UPDATE … SET valid_to=now(), invalidated_at=now(), status='superseded', superseded_by_id=$new` then `INSERT`, **in one transaction**. Cost per turn: **$0**. Reliability: **100%**. mem0 issue #4956's repro is literally *"I work at Company A"* → *"I now work at Company B"* → *"Both memories coexist"*, with retrieval *"returning Company A as a top-ranked candidate because the scoring signals don't incorporate recency."* This index deletes that failure mode.

```sql
-- ═══ TIER 2 ═════════════════════════════════════════════════════════
CREATE TABLE core_profile (           -- DERIVED, CACHED, NOT VECTORISED
  tenant_id      uuid NOT NULL, user_id uuid NOT NULL,
  block_name     text NOT NULL,       -- identity | situation | preferences | open_threads
  content        text NOT NULL,
  token_count    int  NOT NULL,
  rendering_model text NOT NULL,
  source_fact_ids uuid[] NOT NULL,
  rebuilt_at     timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, user_id, block_name)
);

-- ═══ TIER 3 ═════════════════════════════════════════════════════════
CREATE TABLE directives (             -- imperative. OPPOSITE prompt rule to facts. see §6.6
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
  text text NOT NULL,                 -- "Always", "Never", "Prefer"
  valid_from timestamptz NOT NULL, valid_to timestamptz,
  superseded_by_id uuid, source_fact_id uuid, active boolean NOT NULL DEFAULT true
);

-- ═══ SUPPORTING ═════════════════════════════════════════════════════
CREATE TABLE entities (               -- VECTORISED. phase-2 matchmaking joins here.
  id uuid PRIMARY KEY, tenant_id uuid, user_id uuid,
  name text, normalized_name text, aliases text[], type text,
  first_seen timestamptz, last_seen timestamptz, mention_count int,
  summary text, embedding halfvec(768), embedding_model text
);

CREATE TABLE fact_conflicts (         -- THE PRIMARY USER-FACING MECHANISM, not a fallback
  id uuid PRIMARY KEY, tenant_id uuid, user_id uuid,
  fact_a_id uuid, fact_b_id uuid, kind text,
  clarifying_question text, detected_at timestamptz, asked_at timestamptz,
  status text, resolved_at timestamptz, resolution text
);

CREATE TABLE memory_audit (           -- append-only. PASB L5. rollback after a bad model swap.
  id bigserial PRIMARY KEY, tenant_id uuid, user_id uuid, fact_id uuid,
  op text, before jsonb, after jsonb,
  actor text, model text, prompt_version text, at timestamptz DEFAULT now()
);

CREATE TABLE llm_calls (              -- METERING AND KILL SWITCH
  id bigserial PRIMARY KEY, tenant_id uuid, user_id uuid, task text,
  provider text, model text,
  input_tokens int, cached_read_tokens int, cache_write_tokens int,
  output_tokens int, reasoning_tokens int,
  cost_usd numeric NOT NULL,          -- from YOUR price table, never the library's
  at timestamptz DEFAULT now()
);

CREATE TABLE tenant_budget (
  tenant_id uuid, user_id uuid, day date,
  turns_used int, cost_usd numeric,
  turn_cap int, daily_cost_cap numeric, tier text,
  PRIMARY KEY (tenant_id, user_id, day)
);

CREATE TABLE jobs (...);              -- SKIP LOCKED + jobs_archive
CREATE TABLE erasure_log (...);       -- GDPR Art. 17 receipts
```

RLS on `tenant_id` **and** `user_id`, from the first migration, on every table.

### 6.4 Vectorised vs plain SQL — and why

| Vectorised (`halfvec(768)`, pgvector 0.8+) | Plain SQL, no ANN, ever |
|---|---|
| `episodes.embedding` — episodic recall ("what did we talk about") | **`facts` current-state read** — `WHERE status='active' AND valid_to IS NULL AND predicate = ANY($core)` |
| `facts.embedding` — **open tier only**, semantic recall of tastes/anecdotes | `core_profile` (keyed lookup) |
| `entities.embedding` — canonicalisation candidates | `directives` (small, always inlined) |
| | `fact_conflicts`, `memory_audit`, `llm_calls`, `tenant_budget`, `jobs` |

**Partition by HASH on `user_id` into 32 partitions — not 1,000 LIST partitions.** Per-tenant LIST means DDL on every signup, 1,000+ relations for autovacuum to track, and planner overhead that grows with partition count. Hash gives the same locality with none of that, and pgvector 0.8's `hnsw.iterative_scan = relaxed_order` handles the low-selectivity filtered search that used to make partitioning a correctness argument rather than a locality one. `halfvec` (float16) halves index RAM.

**The predicate taxonomy — two tiers, resolving a real tension nobody settled.** A closed vocabulary is what makes the current-state read plain SQL and what makes phase-2 matchmaking cross-user comparable. But Graphiti's anti-generalisation rule — which we adopt verbatim — forbids generalising "Gamecube" to "gaming console". These are reconciled by scoping: **the closed vocabulary constrains the *predicate*; the anti-generalisation rule constrains the *object*.**

- **Core (~40, closed):** `lives_in`, `works_at`, `job_title`, `relationship_status`, `has_children`, `seeking`, `dealbreaker`, `hard_constraint`, `dietary_restriction`, `allergy`, `schedule_constraint`, … Single-valued ones get the unique index. `matchable=true` on the subset phase 2 joins.
- **Open:** `predicate='topic'|'owns'|'did'|'believes'` with verbatim free-text objects. Vector-indexed. **Never queried by SQL.** Always multi-valued.

### 6.5 The write path

| Pass | Fires | Model | Sync? | Cost/run | Monthly @ mid |
|---|---|---|---|---|---|
| **P0 Ingest** | every turn | none | sync, <50ms | $0 | $0 |
| **P1 Extract** | **session end**, or 10-min inactivity sweeper | luna, own prefix | async, seconds | ~$0.0014 | **$170** |
| **P2 Resolve** | immediately after P1, multi-valued only | **Sonnet 5** | **async but sync-class: seconds, never Batch** | ~$0.0048 | **$230** |
| **P3 Commit** | after P2 | **none — deterministic** | sync | $0 | $0 |
| **P4 Core rebuild** | budget overflow / ≥N new hard facts | luna | async | ~$0.0012 | **$14** |
| **P5 Nightly sleep** | 03:00, users who spoke that day | Sonnet 5 **Batch** | async ≤24h | ~$0.014 | **$168** |
| **P6 Weekly** | Sunday | Sonnet 5 Batch | async | — | ~$20 |

**P0 — Ingest.** Insert the episode keyed on the client's `turn_id` (idempotent — a reconnect can never spawn a second LLM call). Return to the user. Embed async.

**P1 — Extract, once per session. This is the single largest cost decision in the memory layer.** Hermes' shape — a post-turn review fork replaying ~20k tokens — is **$9,000–36,000/month at 1k DAU**. Session-end extraction is **$170**. That is a 50–200× spread between two designs that look like a preference. It is also *better*, not just cheaper: the model sees the whole exchange, which is what you need to judge stance, hedging, and event time.

> **Adjudication against the "extraction as a tool call on the live turn is ~free" position.** It is not free and it is not right. Extraction output is ~250 tokens/turn × 20 turns × 1,000 users × 30 days = **150M output tokens/month = $180 on luna, $1,500 on Sonnet 5** — and output is the expensive token class. Worse, the extraction tool definition would then live in the *chat* cached prefix, and **tool-definition changes invalidate all three cache tiers** — so every iteration on your extractor, the thing you iterate on most, cold-starts every user in the system. Give extraction its own prefix and its own cadence.
>
> The one real cost of session-level extraction: a fact learned at turn 2 is not in the store at turn 3. Mitigation is free — the conversation history already carries it within the session, and an in-session scratchpad can be appended as a mid-conversation message that never reaches the fact store.

Prompt shape:

```
[SHARED PREFIX — byte-identical across all users and sessions, ~3,500 tok, cached]
  JSON schema · closed predicate vocabulary · 15-20 few-shot examples
  Graphiti (Apache-2.0, attribute), verbatim:
    "Leave both fields null if no explicit or resolvable time is stated."
    "Do NOT hallucinate or infer dates from unrelated events."
    NEVER generalize: 'Gamecube' stays 'Gamecube'; 'three screenplays' stays 'three'.
  Hermes (MIT), verbatim, FOR THE FACTS TABLE ONLY:
    "Write entries as declarative facts, not instructions to yourself:
     'User prefers concise responses' ✓ — 'Always respond concisely' ✗
     (imperative phrasing gets re-read as a directive in later sessions
      and can override the user's current request)."
  Hedge rule: preserve the hedge VERBATIM in hedge_span; set stance accordingly.
  THE QUESTION HERMES' _MEMORY_REVIEW_PROMPT DOES NOT ASK:
    "Is anything I already believe about this user now FALSE?"
[/cache breakpoint]
session transcript + currently-active facts for the predicates plausibly touched
```

Output is schema-constrained. Candidates land `status='staged'`. **A write is not a belief commit** — PASB measured mean downstream failure jumping from **45.0% (session-only) to 71.9% (once committed to durable memory), +27.0pp in every model run.**

**Preserve the hedge verbatim.** mem0 and LangMem each laundered a casual one-line remark into a confident dated standing fact on **5/5 phrasings**, versus 0/5 for a verbatim control; downstream agents then granted unauthorised requests at 0.69 and 0.75 (arXiv:2606.29279). *"I might quit my job"* persists as `stance='hypothetical'`, not as a job change. **Voice caveat, unresolved in the literature: every benchmark here runs on typed text, and ASR is exactly where hedges die** ("I might", "kinda", "I guess"). Mitigation: extract from the ASR word-confidence output, not the 1-best string, and **default `stance='hedged'` on low-confidence spans** rather than requiring the hedge word to survive transcription.

**P2 — Resolve. Deterministic first, classifier second.**

- **Single-valued predicate → the unique index does it. Zero LLM.** This is most of your traffic.
- **Multi-valued → one constrained call.** Deterministic SQL prefilter first (active facts with same subject+predicate, plus a capped kNN/BM25 top-K). Then **Graphiti's exact contract: two numbered lists in, two lists of *integer indices* out** — `duplicate_ids` (only from EXISTING) and `contradicted_ids` (from either range). **The model can never author replacement text for a stored fact.** That is what structurally eliminates the confabulated merge Letta measured: Nova Micro splicing an old street onto a new city to produce *"12 MG Road, Pune 411001"* — an address present nowhere in the input, in 3/3 runs.
- **Restraint policy in the prompt:** *supersede only when new evidence explicitly establishes staleness; otherwise record the new observation as a coexisting fact; never weaken a `durability='hard'` fact on a single anecdote.* Adopt it — it is cheap and directionally right — but **do not quote "92%" to yourself**: letta PR #4097 is an unreviewed, unmerged, self-graded prompt-only change on a 4-case × 10-model matrix whose own report concedes it *"does not execute the complete memory-editing runtime."*

> **P2 must never go on the Batch API.** Anthropic's docs: most batches finish in under an hour, but *"batches expire if processing does not complete within 24 hours"* and expired requests return `expired` with no result. The product thesis is that when the user says they moved to Berlin, "lives in London" stops being asserted. On Batch, the clone confidently says London for up to a day — or forever if the batch expires and nothing resubmits. **Nightly regeneration on Batch: correct. Supersession on Batch: product-breaking.** A cost-only analysis gets this wrong.

**P3 — Commit. Deterministic, zero LLM. Six gates, all free.**

| Gate | Rule | Why |
|---|---|---|
| **G1 Single-valued** | The unique index enforces it. UPDATE + INSERT in one txn. | mem0 #4956 fails on exactly these fields |
| **G2 Corroboration** | A `soft` fact with `corroboration_count < 2` from *independent* episodes may be `active` but **may not enter `core_profile` or be asserted as fact**. | With a second independent source the wrong-grant rate is **0.00**; the passive "unverified" *tag* leaked at 0.52/0.77. **Passive annotation is the intervention that was measured to fail.** |
| **G3 Origin class** | `untrusted` and `system` excluded **structurally, before the prompt is built** — not score-penalised. Default to untrusted when provenance is undetermined. | *"No amount of recall frequency promotes untrusted content into the curated core."* Needed day one: in phase 2, facts arrive from other users' agents — an adversarial source |
| **G4 Stance** | `hedged` / `hypothetical` / `reported` never become standing facts | Manufactured Confidence |
| **G5 Loss rail** | Reject any consolidation removing >25% of prior entries (`maxPriorEntryLossFraction: 0.25`) | Cheapest possible guard against a bad rewrite nuking a profile |
| **G6 Atomic batch** | Retire-old + assert-new is **one transaction**, validated against the **final state only** | Hermes' `apply_batch` — exactly the shape of a supersession transaction |

**Never DELETE on supersession** — write `valid_to`. (Erasure is a separate path; §6.8.)

**Skip dependency/cascade propagation in v1 — but for the honest reason.** StateMem's ablation runs in *opposite directions* on its two models (DeepSeek 0.373 without vs 0.363 with; Qwen-3.5-9B 0.222 without vs 0.233 with), and both deltas are ~3 graded probes out of 322. That is noise, not a result, and MemTX prescribes the opposite. Defer it on cost and unprovenness, not because it was measured net-negative.

**P4 — Core rebuild. Selection is SQL; the LLM only phrases.** `SELECT … ORDER BY durability, corroboration_count, retrieval_count DESC, importance, recency` until the 1,500-token budget fills. **Promotion is by recall, not by confidence** — `retrieval_count` and `used_in_reply_count` are free, observed, and self-correcting; a model's write-time confidence float is the weakest available signal. *"Memory graduates because it kept being useful, not because it was written confidently."*

Rebuild **on cadence, not per write.** A clone agent that learns is a clone agent whose cached prefix keeps changing; rebuilding per-write invalidates that user's entire cache on every supersession. Between rebuilds new facts ride in the (uncacheable anyway) retrieved-facts tail.

**P5 — Nightly sleep. Batch API, 1-hour cache TTL, active users only, ≤3 calls.** Dedupe near-identical facts (same predicate + cosine > threshold → merge, keep earliest `valid_from`, union provenance). Demote unreinforced soft facts by lowering `importance` — never delete. Generate 3–5 reflections as new facts with `origin_class='agent'`. **Enqueue unresolved conflicts as next-session clarifying questions.** Academic backing for batching over per-turn: sleep-time compute measures *"~5x"* less test-time compute and *"2.5x"* lower average cost per query (arXiv:2504.13171 — note the authors are Letta's founders; we reject Letta the product and adopt Letta the research, and we say so because it will be questioned).

**P6 — Weekly.** Entity canonicalisation (deterministic scores 5% on identifier obfuscation and **0% cross-lingual** — this genuinely needs an LLM). Embedding backfill on model change. Sample the audit log for status promotion and attribution removal — PASB measured those at **51.4%** and **33.1%** of episodes.

### 6.6 Read path

1. `core_profile` blocks, inlined verbatim (~1,500 tok) + `directives`
2. **Current state via plain SQL** on active facts for the ~40 core predicates relevant to the turn
3. Semantic recall over `episodes ∪ facts(open tier)`: pgvector cosine ∪ Postgres FTS → **RRF to blend the two channels only** → top-5
4. Recency and importance as **multipliers capped at ±20%** — they reorder ties, never override relevance
5. Time-sensitive queries: **deterministic regex date parsing in v1.** LLM date-range extraction is worth +11.3% recall, but only with a strong model — Llama 3.1 8B made it *worse* (0.384 vs 0.421). Gate it behind the eval.
6. **Reader instruction says "recompute the user's current state from these facts," not "answer from these facts."** That single instruction was worth 0.301 → 0.363 in StateMem's ablation — the second-largest component after supersession marking.

**No cross-encoder rerank in v1.** In the same cost study this design draws on, the rerank-heavy system is the most expensive measured — $0.240–0.243 per 100 turns — and breaks even against full-transcript resubmission *"only at turn 356."* Retrieve top-5 instead: ~130 tokens per call versus ~4,600 for naive inlining of a 200-entry store.

### 6.7 Hermes: copied verbatim vs done differently

**Copy verbatim (all MIT):**

1. **The batch contract.** *"The batch applies atomically and the char limit is checked only on the FINAL result — so a single call can remove/replace stale entries to free room AND add new ones, even when an add alone would overflow."* This is exactly the shape of a retire-and-assert supersession transaction. → G6.
2. **Refusal-as-teaching.** An over-budget write returns `current_entries` + `usage` + *"Consolidate now… then retry this add — all in this turn."* Never silent eviction.
3. **Three anti-loop guardrails**, each a production incident someone else already paid for: `_MAX_CONSOLIDATION_FAILURES_PER_TURN = 3` with a terminal *"stop retrying memory calls… continue with your reply to the user"* (a failed memory side effect must never block the turn's reply); success responses that **deliberately omit the entry list** because *"echoing entries invites the model to 'find more to fix' and re-issue the same ops"*; refuse-to-empty.
4. **The declarative-fact prompt rule**, word for word, ✓/✗ examples included — **for the `facts` table only**.
5. **The `MemoryProvider` ABC lifecycle** (`initialize → system_prompt_block/prefetch/sync_turn → tool dispatch → shutdown`, plus `on_session_end`, `on_pre_compress`, `on_memory_write`) as the internal seam shape.
6. **The stable/context/volatile prompt tiering** for cache discipline.
7. **`write_approval` staging plus a user-visible prune-and-edit surface.** For a dating clone, "the agent saved a wrong assumption about me" is a product-critical failure, and Hermes already built the consent UX.

**Do differently:**

| Hermes | Us | Why |
|---|---|---|
| Two flat Markdown files, `"\n§\n"`-delimited, **2,200 + 1,375 chars** | Postgres rows with `tenant_id`, `fact_id`, S/P/O, bi-temporal columns | The USER profile holds ~5–10 facts. A clone needs thousands. That is a different data structure, not a bigger number |
| Addressed by unique-substring match on `old_text` | Addressed by `fact_id` | *"Multiple entries matched — be more specific"* is not an addressing scheme |
| **Supersession is an emergent side effect of the char cap** — the model reconciles only when it runs out of room | Explicit write-time constraint + constrained classifier | **Raising the cap, which a clone agent must do, deletes the only force driving reconciliation.** A grep for `supersede\|stale\|contradict` across the whole core returns only capacity-pressure strings |
| Whole store injected as a **frozen snapshot at session start** to protect the prefix cache | Per-turn retrieval, retrieved block placed at the **end** of the prompt | Hermes can do this because its memory is tiny and always present; a retrieval store cannot |
| `_MEMORY_REVIEW_PROMPT` asks only *"Has the user revealed things about themselves?"* | **Adds: "Is anything I already believe now false?"** | Hermes' review prompt contains no instruction to check whether an existing belief became false |
| Post-turn review fork: a **second full model call per turn**, 16 iterations, 600k input tokens, fail-open. Their own docs concede it *"can burn a meaningful share of total tokens"* | **One call per session** | $9,000–36,000/mo vs $170/mo at 1k DAU |
| Tenant unit is a filesystem directory (`HERMES_HOME` via a ContextVar) — **zero occurrences of `user_id`/`tenant` in the memory path** | `tenant_id` + `user_id` on every row, RLS on both | Confirms the prior build-your-own decision |

**One contradiction to resolve explicitly, because two good sources disagree.** Hermes says memory entries must be *declarative* ("User prefers concise responses" ✓, "Always respond concisely" ✗). OpenClaw says entries *are* imperative directives ("Always", "Never", "Prefer") and *"a changed preference rewrites the directive; it never appends a contradicting one."* **Both are right, for different tables.** Observed facts about the person → `facts`, declarative, bi-temporal. Behavioural instructions the user gave the agent → `directives`, imperative, supersede-in-place. **Apply per-table. Never globally.**

### 6.8 GDPR — resolving "never delete" against "must delete"

A dating clone stores relationship status and partner preference, from which sexual orientation is inferrable: **Article 9 special-category data, requiring explicit consent, not legitimate interest.** And bi-temporal invalidation is **retention, not erasure** — `valid_to` means a fact stopped being *true*, not that it was *forgotten*. Resolve it in the schema, not in a policy document:

```
DELETE /v1/me  →  erasure job:
  1. hard DELETE from facts, episodes, entities, core_profile, directives,
     fact_conflicts, llm_calls  WHERE user_id = $1   (cascades to embeddings + FTS)
  2. object storage: delete audio by user prefix
  3. memory_audit: replace payloads with salted hashes; retain row counts + timestamps only
  4. provider purge: assert zero-retention on every configured provider; record in erasure_log
  5. VERIFY: assert 0 rows remain for user_id across every table. Fail loudly.
```

Design against Graphiti issue #1489's exact failure — `delete_episode` *"performs shallow deletion… leaves orphaned edges and entities, causing silent graph corruption."* **Test erasure against a fixture user in CI, every build.** Delete raw audio at 30 days by lifecycle rule unless the user opts in — keeps the transcript, kills a storage line, shrinks the erasure surface.

**Also build Article 20 export.** Same regulation, same DSAR clock, and all three prior designs built erasure and forgot portability. `GET /v1/me/export` → a JSON bundle of episodes, facts (with full supersession lineage), entities and profile.

**Open risk, flagged not solved (§10).** Anthropic's default API data retention is *"indefinitely unless a custom retention period is set,"* and custom retention is an **Enterprise-plan** setting ([privacy.claude.com](https://privacy.claude.com/en/articles/10440198-how-long-do-you-store-personal-data)). Step 4 above assumes zero-retention is obtainable on Build/Scale. **Get that answer in writing from Anthropic before the schema freezes.**

---

## 7. Model swap seam

**One file — `llm/port.py` — is the only module in the codebase that imports `pydantic_ai`.** Pydantic AI (MIT, v2.40.0, releases every 1–3 days, storage-free, no-breaking-changes-in-minors) wins on the criterion that matters: it exposes provider-native 2026 features instead of flattening them. **Do not trust it** — it shipped the same bug class as everyone else (#4392: `CachePoint` silently discarded on OpenRouter because it inherited OpenAI's filter). That is *why* the seam is yours.

```python
ModelRef = tuple[Provider, ModelId]     # never a bare string at a call site
Task = Literal["chat", "extract", "resolve", "reflect", "render_profile", "canon"]

@dataclass(frozen=True)
class Caps:
    cache_style: Literal["none", "explicit_breakpoints", "automatic_toplevel"]
    cache_scope: Literal["content_addressed", "machine_affine"]
    min_cacheable_tokens: int          # Haiku 4.5 = 4096. Sonnet 5 = 1024. Opus 5 = 512.
    max_breakpoints: int               # Anthropic = 4
    cache_ttls: tuple[str, ...]
    thinking_shape: Literal["budget_tokens", "adaptive_effort", "always_on"]
    supports_effort: bool              # Haiku 4.5: NO. Sonnet 4.5: NO.
    supports_mid_conversation_system: bool   # Opus 5/4.8/Fable/Mythos: yes. Sonnet 5: NO.
    supports_prewarm: bool             # blocked by thinking:enabled, structured out, stream, batch
    tokenizer_family: Literal["claude_4_7_plus", "legacy"]   # +30% tokens for identical text
    supports_native_schema: bool
    batch_available: bool
    supports_inference_geo: bool       # us == 1.1x on EVERY token category
    max_context: int
    retirement_date: date | None       # ← assert in CI. Haiku 4.5 = 2026-10-15.

@dataclass
class LLMRequest:
    task: Task
    instructions: str; messages: list; tools: list; output_schema: type | None
    output_mode: Literal["native", "tool", "prompted"]
    effort: str | None
    cache: tuple[CacheHint, ...]       # scope: instructions|tools|history, ttl: 5m|1h
    max_output_tokens: int
    tenant_id: UUID; user_id: UUID     # REQUIRED — budget gate needs them
    inference_geo: str | None

@dataclass
class Usage:
    input_tokens: int; cached_read_tokens: int; cache_write_tokens: int
    output_tokens: int; reasoning_tokens: int
    provider: str; model_id: str
    cost_usd: Decimal                  # from YOUR price table

class LLMPort(Protocol):
    async def complete(self, req: LLMRequest, *, model: ModelRef) -> LLMResponse: ...
    def     stream(self, req: LLMRequest, *, model: ModelRef) -> AsyncIterator[Event]: ...
    def     capabilities(self, model: ModelRef) -> Caps: ...
```

**Routing table — config, not code:**

| Task | Primary | Fallback | Note |
|---|---|---|---|
| `chat` | GPT-5.6-luna, `prompt_cache_key=user_id` | GPT-5-mini → Sonnet 5 | 30-min reuse window beats Anthropic's 5 min for burst usage |
| `extract` | GPT-5.6-luna, **own prefix**, `prompt_cache_key` sharded 4 ways | Sonnet 5 | 4,000 sessions/day ≈ 2.8 rpm — **under** OpenAI's 15 rpm per-machine ceiling, so a small number of shared keys legitimately concentrates a warm cache |
| `resolve` | **Sonnet 5, synchronous** | Opus 5 | The 50%-failure subset. Quality here *is* the product |
| `reflect` | **Sonnet 5 Batch** (50% off), **1h TTL** | luna Batch | The only legitimate Batch use |
| `render_profile` | luna | — | Selection is SQL; the model only phrases |
| `canon` | Sonnet 5 Batch | — | Deterministic scores 0% cross-lingual |

**Six rules that make it non-leaky:**

1. **Call sites pass a `Task`, never a model.** A swap is a config change.
2. **No silent degradation.** If a `CacheHint` or `output_mode` cannot be expressed on the target, raise `UnsupportedCapability`. Every documented 2026 failure was a degradation, not a crash — Vercel AI SDK relocated the first Anthropic breakpoint and deleted the rest when merging tool messages (#17507); LiteLLM mapped dict-valued `reasoning_effort` to `{}` for Anthropic (#24599). **Make degradation impossible to ship.**
3. **`cost_usd` from your own price table**, never the library. LiteLLM undercounted OpenRouter prompt tokens **67%** (4,469 reported vs 13,797 actual) because usage arrives in a chunk *after* `finish_reason` and it stopped iterating. LangChain reported `cache_creation = 0` on a real 1,875-token write. Every call writes an `llm_calls` row.
4. **Streaming normalises to a closed event set** — `TextDelta | ReasoningDelta | ToolCallStart/Delta/End | FactProposed | ConflictRaised | UsageFinal | Error | Heartbeat`. Usage arrives **only** on `UsageFinal`; adapters read to stream *termination*, never stop at `finish_reason`.
5. **`capabilities()` asserted in CI**, including `retirement_date`. A provider changing a parameter shape (`budget_tokens` → `adaptive`+`effort`) breaks your build, not your invoice. A model within 90 days of retirement fails the build.
6. **Per-tenant daily dollar cap enforced in your service, before the call.** No abstraction layer gives you this, and for an unfunded solo dev the realistic catastrophe is not a dropped breakpoint — it is one looping tenant burning hundreds of dollars overnight.

### The prompt-caching pitfalls, in priority order

```
[1] shared system + tool defs + few-shot   ~2,300 tok  ← breakpoint 1
[2] per-user core_profile + directives     ~1,150 tok  ← breakpoint 2
[3] conversation history                   ~1,540 tok  ← breakpoint 3
[4] retrieved facts (this turn)              ~615 tok    uncacheable
[5] user message                              ~77 tok    uncacheable
```

- **Never interpolate the date, user name, session id, or model version into [1].** Cache hits require 100% identical prompt segments.
- **Never edit [2] mid-session.** Rewriting the soul file invalidates that user's whole cache — and a clone that learns is a clone whose prefix keeps changing. Where the model supports it, append newly-learned facts as a **mid-conversation system message inside `messages[]`** so they land *after* the cached prefix. Available on Opus 5, Opus 4.8, Fable/Mythos 5.x — **not on Sonnet 5**, which is why `supports_mid_conversation_system` is a first-class `Caps` field.
- **3 of 4 breakpoints used.** Adding a 4th plus top-level automatic caching returns a 400.
- **The 20-block lookback.** Each breakpoint walks back at most 20 positions. A turn appending more than 20 content blocks pushes the prior entry out of the window and every subsequent request silently rewrites the whole prefix with byte-identical payloads — **indistinguishable from a real invalidation in the usage fields.** Cap blocks per turn.
- **The concurrent-request race.** A cache entry is readable only after the first response *begins streaming*. N parallel requests over one prefix all pay full price and none read. **Fire one, await first token, then fan out.** This will bite in the matchmaking phase.
- **5-minute TTL for chat, 1-hour inside Batch** (Anthropic's batch docs say so explicitly; `max_tokens:0` pre-warming is not supported in a batch). **Build no keep-alive** — holding a 3,000-token entry alive over 4 idle hours costs 53 pings × 3,000 × 0.1 = 15,900 effective tokens versus 3,750 for one cold rewrite, 4.2× worse.
- **Thinking off on chat turns.** Adaptive thinking is **on by default** on Sonnet 5 and Opus 5 and `budget_tokens` was removed (400s). Thinking tokens bill at the output rate; output is already 30–45% of a Sonnet 5 bill, so a modest 500-token trace roughly doubles it. Use `thinking:{type:"disabled"}` on Sonnet 5, `output_config:{effort:"low"}` on Opus 5 (disabling thinking on Opus 5 leaks tool calls into visible text).
- **`inference_geo:"us"` is 1.1× on every token category including cache reads** on Claude 4.6+. Budget +10% if residency is required; the parameter 400s on earlier models.
- **`temperature`/`top_p`/`top_k` 400 on Claude 4.7+**, and the Python SDK v1.0+ removed them, so passing them raises `TypeError`.

**Rejected, with reasons:** LiteLLM proxy (a second stateful service needing Postgres + Redis + a pinned worker replica, to buy team-governance features you have no team for — and its March 2026 PyPI compromise shipped a `litellm_init.pth` that executes on **every interpreter start in the environment**, whether or not you import it). OpenRouter on the primary path (5.5% credit fee, provider variance on the same slug, ~73 minutes of 80–100% failure across two Feb 2026 incidents from one caching dependency — keep it as a `FallbackModel` target only). Vercel AI Gateway (silently downgrades the 1-hour Anthropic cache to 5 minutes). The model layer in TypeScript.

---

## 8. Build order

Twelve weeks. Each week has a definition of done that is a command you can run or a thing you can show.

### Week 1 — A clone in your own hands, and the control that could kill the project
- FastAPI + Postgres 17 + pgvector on **one Hetzner CAX21** (arm64 — all CX x86 models are sold out across every EU datacentre; €10.49 excl. IPv4). `tenant_id`/`user_id`/RLS in the first migration.
- WebSocket chat, token streaming, `turn_id` idempotency, 15s heartbeats.
- `llm/port.py` with one task (`chat`), one adapter (luna), a hand-written soul file you edit by hand, and `llm_calls` metering.
- `episodes` table, append-only, embedded async.
- Expo dev build on your own phone, text only.
- **Half a day: the verbatim-episode-RAG control.** Embed episodes, retrieve top-5, inline them. This is your baseline *and* your fallback product.

**Done when:** you have talked to your own clone for an evening from your own phone, `llm_calls` has rows with a `cost_usd` you computed yourself, and the RAG control answers a question about something you said two days ago.

### Week 2 — The store, and supersession for free
- `predicates` (~40 core, cardinality + durability + matchable), `facts` with `facts_single_valued_current`.
- P1 session-end extraction on its own cached prefix. P3 commit with G1/G4/G6.
- Hedge, `source_quote`, `origin_class`, `corroboration_count`, `embedding_model` all populated.
- `tenant_budget` + per-tenant daily dollar cap enforced **before** every LLM call. Trial turn cap.
- **Instrument, from the first user: median session length, turns/day, voice minutes/day, cache read ratio.**

**Done when:** you tell the clone you moved city, and `SELECT * FROM facts WHERE predicate='lives_in' AND user_id=you` returns exactly one active row and one superseded row, with no LLM having decided anything.

### Week 3 — The eval, and the gate that can stop the project
- The supersession matrix (§9): 60–120 cases, rubric written **before** adjudication.
- promptfoo wired to CI with the cache assertion, the min-prefix assertion and the token-delta assertion.
- **Run the fact store against the verbatim-RAG control.**

**Done when:** `promptfoo eval` exits non-zero on a deliberately broken prompt, and you have a number for fact-store vs RAG on your own matrix. **If the fact store does not beat the control, stop and re-scope to §10 risk 14. You will have lost two weeks, not six months.**

### Week 4 — Judgment
- P2 resolve on Sonnet 5 for multi-valued predicates only, Graphiti's two-integer-list contract, restraint policy.
- G2/G3/G5 commit gates. `memory_audit` on every mutation.
- `fact_conflicts` → clarifying questions surfaced in the next session.
- P4 core rebuild on cadence, 1,500-token budget asserted in CI.

**Done when:** an anti-trap case ("I stayed at my sister's for two weeks") does **not** move `lives_in`, and the conflict lands in `fact_conflicts` with a question the clone asks you the next day.

### Week 5 — Voice in
- `expo-audio` push-to-talk. Silero VAD. On-device STT for live screen partials only. Cloud Whisper for the canonical transcript, async.
- ASR word-confidence → default `stance='hedged'` on low-confidence spans.
- **Platform TTS out, sentence-buffered**, playback starting on the first complete sentence.

**Done when:** you can lock your phone mid-sentence and the recording survives, and a hedged spoken statement lands as `stance='hedged'` with the hedge span preserved.

### Week 6 — The mirror and the law
- **The profile screen** — grouped by predicate, with confirm / retract / edit, and supersession lineage visible.
- Consent screen with the server-driven provider string (`GET /v1/config`), EU AI Act disclosure, **per-session AI disclosure line**, Play report/flag control, block-user and published-contact surfaces, age-restriction gate.
- SB 243: self-harm classifier on the input path → crisis-referral response → **published protocol page on the website**.
- `DELETE /v1/me` erasure job + `GET /v1/me/export`, both tested against a fixture user in CI.

**Done when:** the CI erasure test asserts zero rows across every table, and the self-harm path produces a crisis referral in a manual test.

### Week 7 — Consolidation
- P5 nightly on the Batch API, active users only, ≤3 calls, 1-hour TTL. P6 weekly canonicalisation.
- Recall-driven promotion (`retrieval_count`) wired into P4 selection.
- Metering dashboard reading `llm_calls` and `tenant_budget`.

**Done when:** a deliberate runaway test (a scripted client sending 500 turns) is cut off by the per-tenant cap, and the invoice-vs-`llm_calls` reconciliation is within 3%.

### Week 8 — Migrate to durable
- Supabase Pro + Large + PITR. Migrate. Pooler config verified for asyncpg (`statement_cache_size=0` under Supavisor transaction mode, which **does not support prepared statements** — the corpus finding about PgBouncer 1.24+ does not apply to Supavisor).
- **RLS penetration test over the pooled connection**, `SET LOCAL` on every path.
- PgBouncer/pooler sizing, second API container, hash partitioning applied.
- **Restore drill from PITR before a single non-founder user's data exists.**

**Done when:** you have restored the database from a backup into a scratch project and diffed it, and a deliberate cross-tenant query returns zero rows.

### Weeks 9–10 — Beta, 20–50 real users
- Provider tier ramp: **open Anthropic and OpenAI billing accounts and run production-shaped metered traffic now**, weeks before launch, so tier history exists.
- Load test at 2.5 turns/s.
- Shadow-mode the supersession eval against real conversations.

**Done when:** you have real numbers for median session length, voice minutes/day and TTS opt-in — and you have re-run §3 with them.

### Weeks 11–12 — Launch
- Gradual DAU ramp (acceleration limits: *"429 errors because of acceleration limits if your organization has a sharp increase in usage… ramp up your traffic gradually"*).
- App Review submission with the consent flow, age gate, report/block/contact surfaces, and the published safety protocol.

**Deferred, and why deferring is safe:**

| Deferred | Why safe |
|---|---|
| **Matchmaking** | Needs only `origin_class`, the `matchable` core predicates, and `entities` — all free today, brutal to retrofit. Everything else is a later service reading the same tables |
| **Realtime speech-to-speech / barge-in** | $0.016–0.05 per conversation-minute is 10–50× the extraction bill, and the LiveKit Expo plugin is six months stale. Push-to-talk first |
| **Dependency propagation** | Measured delta ≈ 3 probes, opposite signs on two models |
| **Cross-encoder rerank** | Most expensive measured component; break-even at turn 356 |
| **Cloud TTS** | Paid-tier feature, metered. $2,700–18,000/mo |
| **On-device LLM** | Tripwires, all four required: ≥32K usable context at <2.5GB peak RSS on a median device *in your installed base*; >85 on BFCL-v4 multi-turn at ≤2B; >0.85 on **your** supersession eval; and **both** platforms lifting the background restriction. None is close, and the last is a policy decision you cannot forecast |
| **Any gateway or proxy** | The one thing it gives you — per-key spend caps — is ~40 lines in your own service |

---

## 9. The eval harness

This is the acceptance criterion the prior study said was missing. Define it now, build it in week 3, gate every prompt and model change on it forever.

### 9.1 Where the corpus comes from — the chicken-and-egg, answered

All three competing designs gate everything on 60–120 hand-adjudicated cases built from conversations that do not yet exist. The answer: **you are user #1, and you script the ground truth by living it.**

- **Weeks 1–2 you talk to the clone daily.** That produces real transcripts with real hedges, real digressions, real ASR errors.
- **Deliberately act out 30 supersession scenarios** across those two weeks: announce a move three sessions before you "arrive"; mention a job you're considering, then take it, then mention it as past; break up; change a dietary restriction; stay somewhere temporarily and say so.
- **Write 30 more from your own life history** — things that were true about you five years ago and are not now.
- Each becomes a **probe**: a question with a closed answer pool.

Sixty cases from your own life beats six hundred synthetic ones, and it is the only corpus that has real ASR output in it — which matters, because **no published benchmark in this space (HorizonBench, StateMemBench, LongMemEval, LoCoMo, PersonaMem) uses ASR output at all**, and your central anti-laundering safeguard is untested on your primary input modality.

### 9.2 The matrix

Every probe's answer pool contains **the correct answer, plus the "drift" answer an anchored agent would give**, plus 1–2 neutral distractors. That is what measures *stale-state bias* rather than generic failure — HorizonBench found that when models err on an evolved preference they pick the user's **original, now-stale** value on >1/3 of wrong answers, 1.5× the uniform rate, across all 25 models, rising to **47.7% on short histories**.

| Axis | Cases | Example |
|---|---|---|
| **Action — single-valued** | 15 | "I now work at B" → old employer retired |
| **Action — multi-valued** | 10 | compatible split: added an interest without dropping one |
| **Restraint — temporary** | 10 | "staying at my sister's for two weeks" ≠ new home |
| **Restraint — anecdote** | 10 | one prawn curry ≠ shellfish allergy retracted |
| **Restraint — hedged intent** | 10 | "I might quit my job" ≠ job change |
| **Restraint — confidence preservation** | 5 | weak new evidence must not overwrite a `hard` fact |
| **Anti-trap** | 15 | the anchored answer is **still correct** — catches over-eager supersession |
| **Mechanical modes** | 15 | Status (anchors on earliest), Salience (frequency wins), Sequence (derived quantity not recomputed), Compound |
| **Confabulation** | 10 | does the model ever produce an object present nowhere in the input? |

### 9.3 Gates — the numbers, and they block the ship

| Gate | Threshold | Rationale |
|---|---|---|
| **G0 — beats the control** | fact store > verbatim-episode RAG on the full matrix | MemDelta measured **verbatim RAG matching full context (47.2% vs 49.8%, p=0.34)** and **agent self-memory at 42% *losing* to basic retrieval at 47%**. If this gate fails, the LLM write path is a net negative and you ship the control |
| **G1 — action, single-valued** | **≥ 98%** | Enforced by the unique index, not the model. Anything below 98% is a bug in your writer, not the model |
| **G2 — action, multi-valued** | ≥ 90% | LLM action passes measure 100% in the wild |
| **G3 — restraint** | **≥ 80%** | The frontier baseline is 50%. This is the gate that actually measures the product |
| **G4 — anti-trap** | ≥ 90% | Over-eager supersession is as damaging as under-eager and nobody measures it |
| **G5 — confabulation** | **exactly 0. Hard fail.** | Nova Micro produced "12 MG Road, Pune 411001" in 3/3 runs. The two-integer-list contract makes this structurally impossible; if it fires, the contract leaked |
| **G6 — cache** | `cached_read_tokens > 0` on the second of two identical requests; `cache_write_tokens` only on the first; plus the six-minute TTL test | A caching regression is silent and shows up only on the bill |
| **G7 — min prefix** | shared prefix > `Caps.min_cacheable_tokens` for every routed model | Silent, no error, `cache_creation_input_tokens: 0` |
| **G8 — token delta** | record input tokens for a fixed corpus per model | The ~30% Claude 4.7+ tokenizer shift must appear as a number, not a surprise |
| **G9 — schema** | submit the real extraction schema to every candidate | Anthropic's grammar subset excludes recursion, `minimum`/`maximum`, `minLength`/`maxLength`, external `$ref`, and array constraints beyond `minItems: 0\|1` |
| **G10 — retirement** | no routed model within 90 days of `retirement_date` | Haiku 4.5 is at 38 days today |

### 9.4 Rules that are not negotiable

- **Write the rubric before adjudicating.** Letta's own report documents failure counts drifting **15 → 17 on identical runs** once written rules replaced intuition.
- **Never a generous LLM judge.** The April 2026 LoCoMo audit found a gpt-4o-mini judge **accepting 63% of intentionally wrong answers**, plus 99 errors in 1,540 questions (6.4% of the answer key itself wrong) and 56% of published per-category comparisons statistically indistinguishable from noise. **Treat every vendor LongMemEval/LoCoMo score as marketing** — Zep and Mem0 published 65.99% vs 75.14% for the same system.
- **Gate every model swap on G1–G5.** Restraint failures cluster by **model family, not size**: Pixtral Large failed 3/3 on inferential restraint where Llama 3.3 70B passed. **A swap can flip memory safety from 100% to 0% with identical prompts.** A swap also invalidates the 1,500-token core budget tuning (the optimal retrieved-token budget is reader-dependent) and any LLM date-range extraction. **The honest answer to Q5: swappability at the chat layer is nearly free; at the write path it costs a day of re-adjudication and a re-tune per swap.** Budget that as recurring engineering time.
- **Vendor promptfoo at a pinned version.** OpenAI acquired it in March 2026 with a public commitment to keep the licence, and the MIT grant on shipped versions is irrevocable — but the tool that decides whether you may switch away from OpenAI is now owned by OpenAI. Pinning costs nothing.

---

## 10. Risks, and what bites in month 3

Ordered by expected damage.

| # | Risk | Evidence | Mitigation |
|---|---|---|---|
| **1** | **The memory layer does not beat verbatim RAG, and you find out in month 3 instead of week 3.** | MemDelta: verbatim RAG 47.2% vs full context 49.8%, p=0.34; agent self-memory 42% **below** basic retrieval 47%. HorizonBench best-of-25 = **52.8%** where humans get 56–64%, ten models below chance. StateMem's best configuration of *this exact architecture* is **0.363 absolute**. | **G0 in week 3.** Build the control first. The fallback — verbatim RAG + ~40 deterministic single-valued slots + the clarifying-question loop — is a strictly cheaper system that may be most of the value. **Build so collapsing to it is a config change: the fact store must be additive over a retrieval baseline that stands alone, never load-bearing beneath it.** |
| **2** | **Median session length is 1 turn, and the whole caching model is a surcharge.** | At exactly one message per session, 5-minute caching costs **125% of uncached**. Nobody has this number. | Instrument in week 2. If median < 2 turns, cache only the shared prefix and delete breakpoints 2 and 3. |
| **3** | **Anthropic AUP termination.** Verbatim prohibitions: *"Engage in erotic chats"*, *"Depict or request sexual intercourse or sex acts"*, *"Generate content related to sexual fetishes or fantasies"*, with *"we may throttle, suspend, or terminate your access."* A dating-adjacent clone receives sexual input on day one. | [anthropic.com/legal/aup](https://www.anthropic.com/legal/aup) | **This is a real reason the provider split is right, not just a cost decision.** Chat (where the raw content lands) runs on OpenAI; Anthropic sees only structured fact payloads and resolve prompts. Plus: an input classifier before any provider call, a documented moderation path, the per-session AI disclosure, and a second provider warm in `FallbackModel`. Never one org key. |
| **4** | **California SB 243** — $1,000/violation private right of action, no small-operator exemption, and the definition of "companion chatbot" is this product's spec sheet. Annual reporting to the Office of Suicide Prevention from 2027-07-01. | [SB-243](https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260SB243) | Week 6: self-harm classifier, crisis referral, **published protocol page**, minor break reminders. Get counsel on extraterritorial reach before launch. |
| **5** | **Voice output is the cost cliff you were not looking at.** | tts-1 $2,700/mo, ElevenLabs v3 $18,000/mo, realtime speech-to-speech $2,400–7,500/mo — against a $170/mo extraction bill this document spent most of its rigour on. | Platform TTS default, cloud TTS metered and paid-tier. **Instrument voice minutes/day in week 5 and re-run §3.** |
| **6** | **Groq STT stops at ~190 DAU.** Free tier: 28,800 audio-seconds/day = 8 hours; you need 41. Developer-tier limits for that model are **unpublished**. | [console.groq.com/docs/rate-limits](https://console.groq.com/docs/rate-limits) | Budget $450/mo (OpenAI Whisper). Verify Groq's developer ceiling in week 5. Groq is a $400/mo upside, not a plan. |
| **7** | **Spend caps take you offline with no retry-after.** Anthropic: Start $500 / Build $1,000 / Scale $200,000, **nothing between**; HTTP 429, `enforced_spend_limit_reached`, *"the response has no retry-after header"* — dead until 00:00 UTC on the 1st. New orgs may start on **Evaluation tier, below the published limits**. **Priority Tier is no longer purchasable at any price.** Gemini Tier 1 caps at $250/mo. | [rate-limits](https://platform.claude.com/docs/en/api/rate-limits) | Week 9: open accounts, run metered production-shaped traffic, request the raise. This is a **calendar item**, not an engineering one. Also: acceleration limits fire on *"a sharp increase in usage"* — ramp gradually. |
| **8** | **RLS over the pooled connection silently leaks across tenants.** Supavisor transaction mode **does not support prepared statements** (asyncpg uses them by default), and Supabase publishes no guidance on RLS over the pooler. | [supabase.com/docs](https://supabase.com/docs/guides/database/connecting-to-postgres) | `statement_cache_size=0`; `SET LOCAL app.user_id` inside an explicit transaction on **every** path; a cross-tenant penetration test in CI, week 8. The failure mode is silent. |
| **9** | **Anthropic retains API data indefinitely by default; the control is Enterprise-only.** | [privacy.claude.com](https://privacy.claude.com/en/articles/10440198-how-long-do-you-store-personal-data) | Get zero-retention terms in writing before schema freeze. This is upstream of your own database and it is the weakest link in the Art. 17 story. |
| **10** | **DB growth invalidates your own sizing at month 12.** 1,000 DAU × 20 turns × 365 = **7.3M episodes/year** ≈ 7,300 vectors/user ≈ **11 GB of raw vectors** before index overhead. The "1–5k vectors/user → exact scan, single-digit ms, 4GB DB" claim is true at month 3 and false at month 12. | own arithmetic | Episode tiering: keep the last 90 days hot and vector-indexed; roll older episodes to a cold partition with FTS only, and reach them via the fact store's provenance links. Design it now, ship it at month 9. |
| **11** | **An embedding-model migration is undetectable and unsafe without a version column.** Embeddings from different models are not comparable. | none of the three prior designs had the column | `embedding_model` + `embedding_version` on every embedded table, from the first migration. Re-embedding a year of data costs ~$35 at $0.02/MTok — trivial. Doing it blind on 11.7M rows is not. |
| **12** | **The heavy user.** Every model here is per-DAU-average. Someone who talks six hours a day is ~720 turns/day — 36× the modelled load. A per-day dollar cap fires **after** the money is spent, and a single streaming call can burn `max_tokens` before any cap evaluates. | | Per-**session** token ceiling, conversation-history compaction at a fixed token budget, and `output_config.task_budget` where supported (min 20,000 tokens, exposed by Pydantic AI as `anthropic_task_budget`). |
| **13** | **App-store commission (15%) and refunds.** $19.99 nets $16.99. A user consumes 30 days of inference then refunds through the store. | [Apple SBP](https://developer.apple.com/app-store/small-business-program/), [Play fees](https://support.google.com/googleplay/android-developer/answer/112622) | Commission is already in §3.4. Refund reconciliation: flag `llm_calls` against refunded subscription periods and rate-limit any account with a refund in the last 90 days. |
| **14** | **Account takeover.** The single most valuable object in this product is one person's complete psychological profile, and no prior design mentioned device revocation, re-auth on sensitive read, or export throttling. | | Session list + revoke in the profile screen; re-auth before `GET /v1/me/export` and `DELETE /v1/me`; export rate-limited to 1/day; email on every new device. |
| **15** | **No LLM tracing.** Debugging a 0.363-accuracy supersession pipeline without traces is guessing. | Pydantic AI ships native OTel/Logfire instrumentation | Turn it on in week 1. It is free and it is the difference between iterating and guessing. |

**What actually bites in month 3, in one paragraph.** Not scale — you will be running at 5% of one container. Not the bill — $1,950/month is survivable. What bites is that **you will have 30 real users, a fact store with a few thousand rows, and no way to tell whether it is better than the RAG control you built in week 1** — because the only in-band quality signal in the entire design is `fact_conflicts` and its clarifying-question loop, and the out-of-band signal (churn) arrives weeks later, unattributable to any single pass. That is why the conflicts queue is the **primary** user-facing mechanism and not a fallback: a clone that asks *"you mentioned prawn curry — should I update your shellfish note?"* is measurably better than one that silently guesses right 52.8% of the time, and it is the only thing in this architecture that turns a wrong answer into a logged, resolvable event. Put it at the centre. If you have to cut one thing from the build order to make room, cut the nightly reflection pass, not the audit log.