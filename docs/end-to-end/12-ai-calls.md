<a id="ai-calls"></a>
## 12. Every AI model call

**Which model.** Every call goes through one router that picks a model per task
([server/src/llm/index.ts:38] `export function modelFor(task: Task): ModelRef {`). The code's default for
most tasks is Claude Sonnet 5 ([server/src/env.ts:89] `CHAT_MODEL: z.string().default('anthropic:claude-sonnet-5'),`);
the development configuration (`server/.env`, not in git) sets every task to **Google Gemini 3.5 Flash-Lite**
and embeddings to Gemini Embedding 001. The typed decision model and a separate judge model are not set, so
they are off.

**Price** (from the repository's own table): Gemini 3.5 Flash-Lite costs $0.30 per million input tokens and
$2.50 per million output tokens ([server/src/llm/caps.ts:151] `'google:gemini-3.5-flash-lite': {`,
[server/src/llm/caps.ts:153] `input: 0.3, output: 2.5,`). The embedding model has no price in the repository.
"Measured" below means averages from the development database's call ledger, queried on 2026-09-28; the ledger
holds 8,158 calls and $7.02 in total, all since 2026-09-08. Where a call has never run on this model, the cost
is an estimate from its output limit.

**Metering.** Each call is recorded against one person (`llm_calls`) and counted against their day: at most
$2.00 and at most **10 model calls** per person per day, for every account; setup calls (AI-1 on the first screen,
AI-2 to AI-5, and the answer sheet the first sentence builds) are counted apart, up to 40 a day, since 2026-09-28
([server/src/metering.ts:73] `if (row.setup_used >= env.SETUP_CALLS_PER_DAY) {`); the day resets at midnight UTC
([server/src/metering.ts:70] `if (spent >= costCap) throw new BudgetExceeded('daily_cost', spent, costCap);`,
[server/src/metering.ts:79] `throw new BudgetExceeded('daily_turns', row.turns_used, row.turn_cap);`,
[server/src/metering.ts:61] `WHERE tenant_id = $1 AND user_id = $2 AND day = CURRENT_DATE`). Embeddings are not
metered. The server refuses to start if a routed model has no verified price or retires within 90 days
([server/src/llm/index.ts:118] `if (!caps.price.verified && !env.ALLOW_UNVERIFIED_PRICING) {`).

### Summary

| # | Call | Task | When | On by default? | Output limit | Cost per call |
|---|---|---|---|---|---|---|
| AI-1 | Fact extraction | extract | The first setup sentence; 5 minutes after any chat goes quiet | Yes | 4,096 tokens | Measured ≈ $0.0006 (27 calls) |
| AI-2 | Sample reply ("Is this you?") | chat | Setup's first screen; the self-test | Yes, on use | 300 | Measured ≈ $0.00013 (3 calls) |
| AI-3 | "Couldn't be with" → card proposal | extract | Answering that interview question | Yes | 512 | Not measured; ≤ $0.0015 |
| AI-4 | Paste import | extract | "Paste from another AI" | On use | 8,192 | Not measured; ≤ $0.02 + input |
| AI-5 | Style note from WhatsApp | extract | "Now, how you talk" | On use | (not set) | Not measured |
| AI-6 | Own-clone chat reply | chat | Every message to your clone | Yes | 2,048 | Measured ≈ $0.00045 (5 calls) |
| AI-7 | Embeddings | (none) | Every chat message | Yes | n/a | Not metered, not priced |
| AI-8 | Conflict resolver | resolve | Inside AI-1, when a multi-answer field may conflict | Yes, sometimes | (not set) | Not measured |
| AI-9 | Profile summary | render_profile | Inside AI-1, when 3+ facts changed | Yes, sometimes | (not set) | Not measured |
| AI-10 | Answer sheet | extract | When shareable sentences changed: after learning, opening "How you appear", sending out | Yes, sometimes | 600 | Not measured; ≤ $0.002 |
| AI-11 | The agents' talk | extract | Each pair in a round | Yes | 1,500 | Not measured; ≤ $0.004 + input |
| AI-12 | Want check | extract | Once per round for the sender's untied wants; once per real person met for theirs | Yes, when such wants exist | 2,000 | Not measured; ≤ $0.005 + input |
| AI-13 | Agent conversations (talker + judge) | chat, resolve | Each pair, several runs | **No** (`RENDEZVOUS_RUNS=0`) | 200 / 400 | Measured in the old design ≈ $0.0004 per message |
| AI-14 | Typed decision model | decide | "Couldn't be with" (instead of AI-3); a "second evening" score per pair | **No** (`DECIDE_MODEL` unset) | n/a | — |
| AI-15 | Face check | none (runs on the server) | "Check your photos" | **No** (`FACE_CHECK=off`) | n/a | No vendor, no credits |

Two routed tasks, `reflect` and `canon`, are never called, and an old "file score" function is dead code
([server/src/llm/index.ts:32] `reflect: env.REFLECT_MODEL,`, [server/src/matching/score.ts:205] `NOT CALLED SINCE 2026-09-23.`).
No model is ever sent a photo: requests carry text only ([server/src/llm/port.ts:29] `content: string;`).

**A default round** makes 0–1 answer-sheet call at the tap, 0–1 want check for the sender, and per pair 0–1
talk and 0–1 want check for the other person: up to 8 calls, charged to the sender. Estimated at well under
$0.02; not measured, because no round has run since the talk was added.

<a id="ai-1"></a>
### AI-1. Fact extraction

- **Task / model:** `extract` → Gemini 3.5 Flash-Lite ([server/src/memory/extract.ts:175] `const model = modelFor('extract');`).
- **When:** the first setup screen, at once; and for every chat session, about 5 minutes after it goes quiet
  ([server/src/api/tell.ts:73] `out = await metered(ctx, 'extract', () => extractSessionFacts(`,
  [server/src/memory/session.ts:29] `export const SESSION_IDLE_MS = Number(process.env.SESSION_IDLE_MS ?? 300_000);`).
  Story and question-of-the-day answers are also swept later, and a first-screen sentence is extracted a second
  time by the sweeper ([server/src/memory/session.ts:325] `AND (x.last_turn_index IS NULL OR MAX(e.turn_index) > x.last_turn_index)`).
- **What goes in:** the person's own lines from the session -- never the clone's (since 2026-09-28) --
  plus their current facts; a session with nothing they typed makes no call. Key instructions: "You extract
  durable facts about ONE person from what they typed to their AI clone.", "NEVER generalise the object.",
  "when in doubt choose the weaker stance", "Silence is not evidence."
  ([server/src/memory/extract.ts:187] `const said = input.transcript.filter((t) => t.role === 'user');`,
  [server/src/memory/extract.ts:67] `You extract durable facts about ONE person from what they typed to their AI clone.`,
  [server/src/memory/extract.ts:79] `NEVER generalise the object.`,
  [server/src/memory/extract.ts:91] `when in doubt choose the weaker stance`,
  [server/src/memory/extract.ts:99] `Silence is not evidence.`).
- **What comes out:** a list of facts (field, words, how sure, the exact quote, when), facts that may now be
  false, and what the session was for ([server/src/memory/extract.ts:203] `outputSchemaName: 'extraction',`).
- **Code checks:** the reply must parse, or nothing is kept; unknown fields and under-18 birth years are
  refused; tapped fields are held; anything not asserted is held; learned facts start match-only
  ([server/src/memory/extract.ts:213] `const parsed = Extraction.safeParse(res.parsed);`,
  [server/src/memory/facts.ts:119] `if (!isAdult(parsed)) {`). The model never sees the clone's words, so a
  fact cannot come from them; a first name is refused whatever the model says (it is set on a screen).
- **Stored:** facts, an audit trail, questions the clone wants to ask, session intents.

<a id="ai-2"></a>
### AI-2. Sample reply ("Is this you?")

- **Task / model:** `chat` → Flash-Lite; recorded under the label `render_profile`
  ([server/src/memory/selftest.ts:86] `const model = modelFor('chat');`,
  [server/src/api/selftest.ts:44] `metered(ctx, 'render_profile', () => nextSelfTest(db, ctx), { db, setup: true }));`).
- **When:** right after the first sentence ("Now it's you"), on "Test it" in setup, and Settings → "Test it again".
- **In:** the profile summary, every live fact, the style note, and a fixed question such as "A friend asks
  what you have been up to lately. What do you say?". Instructions: "You are answering AS this person, in a
  message to a friend." "Never invent a fact to make the answer richer."
  ([server/src/memory/selftest.ts:36] `'A friend asks what you have been up to lately. What do you say?',`,
  [server/src/memory/selftest.ts:48] `You are answering AS this person, in a message to a friend.`,
  [server/src/memory/selftest.ts:53] `Never invent a fact to make the answer richer.`).
- **Out:** up to 300 tokens of text. **Checks:** none beyond trimming. **Stored:** the answer and the person's
  grade. Shown only to the person; it gates nothing.

<a id="ai-3"></a>
### AI-3. "Couldn't be with" → card proposal

- **Task / model:** `extract` → Flash-Lite, 512 tokens ([server/src/onboarding/dealbreaker.ts:281] `modelFor('extract'),`).
- **When:** the interview's "Anyone else you couldn't be with?" is answered.
- **In:** the sentence alone. Instructions: "Only map what is actually there." "Prefer null over a loose fit."
  "Use only the values listed for the field. Never invent one."
  ([server/src/onboarding/dealbreaker.ts:128] `Only map what is actually there.`,
  [server/src/onboarding/dealbreaker.ts:130] `Prefer null over a loose fit.`,
  [server/src/onboarding/dealbreaker.ts:132] `Use only the values listed for the field. Never invent one.`).
- **Out:** one of the five card fields (or none) and the answers the sentence excludes.
- **Checks:** only the five cards, only real answers, frequencies closed upward, never "exclude everything"
  ([server/src/onboarding/dealbreaker.ts:94] `if (closed.length === field.values.length) {`).
- **Stored:** nothing from the model. The phone shows a proposal ("Change this card?") and only "Keep this" writes a rule.

<a id="ai-4"></a>
### AI-4. Paste import

- **Task / model:** `extract` → Flash-Lite, 8,192 tokens ([server/src/memory/pasteImport.ts:160] `maxOutputTokens: 8192,`).
- **When:** "Paste from another AI", "In your words", "Catch it up fast".
- **In:** the pasted text, up to 60,000 characters. Instructions: "Extract only what the text actually says." "A
  guess is NEVER a fact." ([server/src/memory/pasteImport.ts:81] `Extract only what the text actually says.`,
  [server/src/memory/pasteImport.ts:87] `A guess is NEVER a fact.`).
- **Out:** facts, and guesses with a question for each.
- **Checks:** must parse; every fact is forced to "reported" and "untrusted", so it is held
  ([server/src/memory/pasteImport.ts:184] `stance: 'reported',`).
- **Stored:** held facts and questions; the pasted text is thrown away.

<a id="ai-5"></a>
### AI-5. Style note from a WhatsApp export

- **Task / model:** `extract` → Flash-Lite ([server/src/memory/chatImport.ts:83] `const model = modelFor('extract');`).
- **When:** "Now, how you talk", in first-time setup.
- **In:** up to 400 of the person's own messages (sampled from what the phone sent). Instructions: "Ignore the
  CONTENT of what they discuss. You are describing the voice, not the topics." "Use their actual words as
  examples. Quote short fragments." ([server/src/memory/chatImport.ts:55] `Ignore the CONTENT of what they discuss. You are describing the voice, not the topics.`,
  [server/src/memory/chatImport.ts:49] `Use their actual words as examples. Quote short fragments.`).
- **Out:** style, habits, things they never do. **Checks:** at least 20 messages; must parse
  ([server/src/memory/chatImport.ts:100] `const parsed = Voice.safeParse(res.parsed);`).
- **Stored:** only the note; it is added to every own-chat prompt.

<a id="ai-6"></a>
### AI-6. Own-clone chat reply

- **Task / model:** `chat` → Flash-Lite, streamed, 2,048 tokens ([server/src/api/chat.ts:372] `const model = modelFor('chat');`,
  [server/src/api/chat.ts:397] `maxOutputTokens: 2048,`).
- **When:** every message a person sends to their own clone.
- **In:** the profile summary, style note, last 20 messages, **every** live fact (including private ones: it
  talks only to its own person), up to 5 recalled old messages. Instructions: "You are this person's clone: an
  agent that knows them and speaks with their voice and judgement." "Never invent a detail about them that is not
  in the fragments." "Speak plainly, in their register."
  ([server/src/api/chat.ts:35] `You are this person's clone: an agent that knows them and speaks with their voice and judgement.`,
  [server/src/api/chat.ts:41] `Never invent a detail about them that is not in the fragments.`,
  [server/src/api/chat.ts:43] `Speak plainly, in their register. No preamble, no hedging, no restating the question.`).
- **Out:** free text. **Checks:** none; streamed straight to the phone
  ([server/src/api/chat.ts:404] `send(ws, { type: 'text.delta', turnId: msg.turnId, text: ev.text });`).
- **Stored:** the reply, as a message in the person's history.

<a id="ai-7"></a>
### AI-7. Embeddings

- **Model:** Gemini Embedding 001, 768 numbers per text ([server/src/llm/adapters/google.ts:216] `model: env.EMBEDDING_MODEL.replace(/^google:/, ''),`).
- **When:** each chat message is embedded to search the person's past messages; after the reply, both messages
  are embedded and stored ([server/src/memory/retrieval.ts:64] `[vector] = await embed([query]);`,
  [server/src/api/chat.ts:470] `const vectors = await embed(todo.map(([, t]) => t));`).
- **Checks / metering:** none; these calls bypass the meter and the ledger
  ([server/src/llm/embeddings.ts:26] `export async function embed(texts: readonly string[]): Promise<number[][]> {`).

<a id="ai-8"></a>
### AI-8. Conflict resolver

- **Task / model:** `resolve` → Flash-Lite ([server/src/memory/resolve.ts:89] `const model = modelFor('resolve');`).
- **When:** inside AI-1, when new facts share a multi-answer field with live ones.
- **In:** two numbered lists, existing and new. Instructions: "Return three lists of INTEGERS, referring to
  positions in EXISTING. Never return text." "When you cannot decide, choose uncertain_ids."
  ([server/src/memory/resolve.ts:41] `Return three lists of INTEGERS, referring to positions in EXISTING. Never return text.`,
  [server/src/memory/resolve.ts:63] `When you cannot decide, choose uncertain_ids.`).
- **Checks:** must parse; out-of-range numbers dropped. **Stored:** contradicted facts are retired, and the
  retirement recorded; uncertain ones become a question. It sees only sentences that became true, and never a
  card's answer (since 2026-09-29) ([server/src/memory/session.ts:147] `.filter((e) => !TAPPED_PREDICATES.has(e.predicate));`).

<a id="ai-9"></a>
### AI-9. Profile summary

- **Task / model:** `render_profile` → Flash-Lite ([server/src/memory/profile.ts:146] `modelFor('render_profile'),`).
- **When:** inside AI-1, when 3 or more facts changed, and only if the new summary would not drop more than a
  quarter of the old ([server/src/memory/session.ts:204] `if (asserted + superseded + resolvedContradictions >= 3) {`).
- **In:** up to 60 confirmed facts, any visibility. Instructions: "Write a short profile of this person from the
  facts given." "Use ONLY the facts given. Add nothing." ([server/src/memory/profile.ts:71] `Write a short profile of this person from the facts given.`,
  [server/src/memory/profile.ts:82] `Use ONLY the facts given. Add nothing.`).
- **Out / checks:** four text blocks, each cut to a length; no content check. **Stored:** the summary, used in the
  own chat and self-test.

<a id="ai-10"></a>
### AI-10. Answer sheet

- **Task / model:** `extract` → Flash-Lite, 600 tokens ([server/src/matching/answer-sheet.ts:200] `maxOutputTokens: 600,`).
- **When:** only when the person's shareable sentences changed: after learning, when "How you appear" opens, and
  when they tap "Send my agent out" ([server/src/matching/answer-sheet.ts:185] `if (had.rows[0]?.basis === basis) return { built: false, answered: -1 };`).
- **In:** up to 40 of the person's own public, verified sentences, numbered, and the 12 bank questions.
  Instructions: "For each question, give the number of the ONE sentence that answers it directly, or null."
  "Never write any words of your own." "Null is always safe. A wrong number is shown to another person as
  something this person said." ([server/src/matching/answer-sheet.ts:104] `For each question, give the number of the ONE sentence that answers it directly, or null.`,
  [server/src/matching/answer-sheet.ts:111] `Null is always safe. A wrong number is shown to another person as something this person said.`).
- **Checks:** numbers must be in range, one sentence per question; the person's own question-of-the-day answers win.
  **Stored:** question → fact id, no words.

<a id="ai-11"></a>
### AI-11. The agents' talk

- **Task / model:** `extract` → Flash-Lite, 1,500 tokens, one per pair, charged to the sender
  ([server/src/matching/talk.ts:331] `modelFor('extract'),`, [server/src/matching/talk.ts:328] `maxOutputTokens: 1500,`).
- **In:** both people's shareable sentences (up to 20 each), the 12 questions, 4 reactions. Instructions: "You
  script a short, warm first chat between two dating agents, A and B." "You never write a sentence about a
  person. You choose:" … "Keep it to 6-12 lines." The date idea "is under 12 words, says what to do and where, and
  never mentions either person" ([server/src/matching/talk.ts:103] `You script a short, warm first chat between two dating agents, A and B.`,
  [server/src/matching/talk.ts:105] `You never write a sentence about a person. You choose:`,
  [server/src/matching/talk.ts:114] `The idea is under 12 words, says what to do and where, and never mentions either person`).
- **Out:** lines made of question ids, sentence numbers, reactions and "don't know"; shared pairs; one date idea.
- **Checks:** all shown words are rebuilt by code from the real sentences; the shape rules in stage 7; the date
  idea's word filters and "adds no facts" test ([server/src/matching/talk.ts:333] `const talk = checkTalk(res.parsed, a, b);`).
- **Stored:** inside both cards.

<a id="ai-12"></a>
### AI-12. Want check

- **Task / model:** `extract` → Flash-Lite, 2,000 tokens ([server/src/matching/wants.ts:257] `task: 'extract',`,
  [server/src/matching/wants.ts:264] `maxOutputTokens: 2000,`).
- **In:** the want-holder's untied and private wants, up to 10 sentences from each of up to 12 people, and the six
  cards' possible answers (never anyone's answer). Instructions: "You check what one person asked for in a partner
  against what other people wrote about themselves." "Judge only from the one sentence you cite." "Some wants are
  marked PRIVATE. Never use anybody's sentences for those"
  ([server/src/matching/wants.ts:150] `You check what one person asked for in a partner against what other people wrote`,
  [server/src/matching/wants.ts:159] `Judge only from the one sentence you cite.`,
  [server/src/matching/wants.ts:161] `Some wants are marked PRIVATE. Never use anybody's sentences for those`).
- **Out:** per person and want: met, not met or unknown, with a sentence number; for private wants, a card and the
  acceptable answers.
- **Checks:** a verdict survives only with a valid sentence number; the quote is looked up, never copied; private
  wants are decided by code from the other person's card
  ([server/src/matching/wants.ts:202] `c.sentence >= 1 && c.sentence <= list.length`,
  [server/src/matching/wants.ts:198] `m.values.has(answer) ? 'met' : 'not_met'`).
- **Stored:** on the cards; "not met" moves a candidate later.

<a id="ai-13"></a>
### AI-13. Agent conversations (switched off)

- **When:** only if `RENDEZVOUS_RUNS` is above 0; the code default is 0 and it is not set
  ([server/src/matching/rendezvous.ts:75] `export const RUNS = Number(process.env.RENDEZVOUS_RUNS ?? 0);`).
- **In:** its own person's public facts and style note, and the other person's public tags. The style note is read
  as its person, never through the round's role (since 2026-09-29)
  ([server/src/matching/orchestrator.ts:77] `const voiceOf = (who: { tenantId: string; userId: string }): Promise<string> =>`).
- **Talker:** `chat`, 200 tokens a message: "You represent ONE person, talking to an agent that represents somebody
  else." "Only say things you were actually told about your person. Never invent a detail to keep it going."
  ([server/src/matching/rendezvous.ts:110] `You represent ONE person, talking to an agent that represents somebody else.`).
- **Judge:** labelled `resolve` but routed to the chat model unless `ASSESS_MODEL` is set: "Warmth is not evidence."
  Returns yes, no or not enough ([server/src/matching/rendezvous.ts:190] `Warmth is not evidence. Two agents being polite to each other tells you nothing about`,
  [server/src/matching/rendezvous.ts:221] `const judge = env.ASSESS_MODEL ? (env.ASSESS_MODEL as typeof model) : model;`).
- **Stored:** transcripts that no app role can read; the verdicts gate nothing.

<a id="ai-14"></a>
### AI-14. Typed decision model (switched off)

With `DECIDE_MODEL` set, "Couldn't be with" would be mapped by typed yes/no questions instead of AI-3, and each
pair would get a hidden "after one evening together, each would want a second one" probability, stored and never
shown ([server/src/matching/score.ts:286] `if (!model) return { score: null, costUsd: 0 };`,
[server/src/matching/score.ts:298] `'After one evening together, each of these two people would want a second one.',`).

<a id="ai-15"></a>
### AI-15. Face check (switched off)

With `FACE_CHECK` on, two selfie frames are compared with the person's photos by a face model that runs on the
server itself, with no vendor; the frames are deleted and only the verdict is kept
([server/src/photos/face.ts:7] `Models load from node_modules over file://, never from the network.`,
[server/src/env.ts:345] `FACE_CHECK: z.enum(['off', 'tfjs-node', 'wasm']).default('off'),`).

### Docs vs code

- HOW-IT-WORKS.md §10 says "Every model call goes through llm.complete". The chat uses a streaming call, and
  embeddings bypass the router and the meter ([HOW-IT-WORKS.md:805] `Every model call goes through`).
- HOW-IT-WORKS.md §10 says "One meter wraps a whole round". There are two meters, each with its own budget check
  ([HOW-IT-WORKS.md:807] `One meter wraps a whole round`).
- `MAX_SESSION_OUTPUT_TOKENS` is configured but nothing enforces it
  ([server/src/env.ts:358] `MAX_SESSION_OUTPUT_TOKENS: z.coerce.number().default(60_000),`).
- ARCHITECTURE.md plans chat on GPT-5.6-luna, nightly batch jobs and a paid tier with a 10-turn trial. The code
  runs every task on one model, has no batch jobs and no payment code; the 10-call cap applies to everyone
  ([ARCHITECTURE.md:24] `Chat on GPT-5.6-luna, write path on Claude Sonnet 5.`,
  [ARCHITECTURE.md:127] `7-day trial hard-capped at 10 turns/day.`).
- ENGINE-DECISION.md recommends a Python FastAPI service and a matching cascade of embeddings, Haiku scoring and a
  Sonnet mediator. The server is TypeScript (Hono) and a round is SQL plus the talk and want calls
  ([ENGINE-DECISION.md:9] `a stateless FastAPI service over Postgres 18 + pgvector`).

### Unverified

- Whether Google bills Gemini's thinking tokens: the code records them but does not price them
  ([server/src/llm/adapters/google.ts:115] `reasoningTokens: u.thoughtsTokenCount ?? 0,`).
- The embedding model's price, and whether the Gemini key is on the free or paid tier (their data terms differ).
