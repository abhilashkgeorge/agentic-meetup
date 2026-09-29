## 3. How the agent learns about its person

**No model is trained or fine-tuned.** A search of the whole repository for fine-tuning, training
jobs, adapters or tuned model ids finds nothing in the project's code; every model the app can use is
a stock vendor model in the price table ([server/src/llm/caps.ts:151] `'google:gemini-3.5-flash-lite': {`,
[HOW-IT-WORKS.md:172] `no per-user model and no fine-tune`). "Learning" means **writing rows in the
database**: facts, the raw messages, a style note, answer sheets and a matching profile. A model is
used only to **extract** facts from what a person typed, to **point** at their own sentences, or to
**phrase** a chat reply. The rows are the agent.

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| A tap in the interview or setup | Saved as a fact, live at once | Code | `facts` (+ `question_answers`) | The person; matching | [server/src/api/interview.ts:456] `extractorModel: 'interview',` |
| A message to your own clone | Stored; about 5 minutes after the chat goes quiet, a model reads the whole session and pulls out facts | {AI:extract} | `episodes` (both sides), then `facts` | The person; learned facts are private until "OK to share" | [server/src/memory/session.ts:28] `export const SESSION_IDLE_MS = Number(process.env.SESSION_IDLE_MS ?? 300_000);` |
| A heard answer on a "tapped" field (city, cards, work, exercise...) | Held, not live, until the person says "Yes, that's right" | Code | `facts` with status `staged` | The person, as a question | [server/src/memory/extract.ts:237] `originClass: TAPPED_PREDICATES.has(f.predicate) ? 'untrusted' : 'owner',` |
| A story ("Things to talk about") | Saved word for word | Code | Episode + fact, shareable | Others' cards, via the agents | [server/src/onboarding/stories.ts:150] `predicate: want ? 'seeking' : 'prompt_answer'` |
| Question of the day | Saved like a story and put on the answer sheet | Code | Episode + fact + answer sheet | Others, via the agents | [server/src/matching/unknowns.ts:212] `INSERT INTO answer_sheets (user_id, tenant_id, answers, basis)` |
| A paste from another AI | A model extracts facts; every one is held for checking | {AI:paste} | `facts` (all `staged`); the pasted text is not kept | The person | [server/src/memory/pasteImport.ts:188] `originClass: 'untrusted',` |
| A WhatsApp export | A model describes how the person writes | {AI:voice} | A style note only | The person's own clone | [server/src/memory/chatImport.ts:55] `Ignore the CONTENT of what they discuss. You are describing the voice, not the topics.` |

### Arjun and Meera

- **Arjun tells his clone** "I work in AI and run most mornings." His phone sends it over the live
  chat connection; the server stores it, and the clone replies. No fact is written yet
  ([server/src/api/chat.ts:315] `const stored = await episodes.append(c, {`).
- **About five minutes after he stops**, a background sweep runs the extractor over the whole
  session ({AI:extract}) ([server/src/index.ts:150] `}, Math.min(SESSION_IDLE_MS, 60_000));`).
  Likely results (they depend on the model; unverified): work field "AI", exercise "runs most
  mornings". Both are fields a must-have can depend on, so both are **held**
  ([server/src/onboarding/questions.ts:415] `'works_in', 'exercise_habit', 'sleep_pattern', 'relocation_openness',`).
- **What Arjun sees** on the YOU tab: "Your agent heard something", the claim with his own words,
  "Is that right? Nothing changes until you say so.", and "Yes, that's right" / "No"
  ([app/src/features/profile/profile-screen.tsx:130] `<Card label="Your agent heard something">`,
  [app/src/features/profile/profile-screen.tsx:136] `Is that right? Nothing changes until you say so.`,
  [app/src/features/profile/profile-screen.tsx:139] `<Chip label="Yes, that's right" selected={false} disabled={judging}`).
- **If he taps Yes**, the claim becomes his live answer, and it stays match-only: "that's right" is
  not "OK to share", so nobody else hears his work sentence until he shares it on "How you appear"
  ([server/src/memory/pasteImport.ts:337] `...learnedDisclosure(row.predicate),`,
  [server/src/matching/brief.ts:109] `return TAPPED_PREDICATES.has(predicate) && !QUOTABLE.has(predicate) ? {} : { disclosure: 'matchable_only' };`).
  One side effect remains (Known gaps): "runs most mornings" is not one of the exercise answers, so
  his exercise answer becomes "unknown" for matching
  ([shared/src/values.ts:37] `export const FREQUENCY = ['never', 'rarely', 'sometimes', 'often', 'daily'] as const;`).
- **Meera pastes** a paragraph about herself from another AI. One model call pulls facts out of it
  ({AI:paste}); **every** fact is held for checking, and the paragraph itself is not stored. She sees
  "Held for checking" and "Nothing is treated as true until you say so."
  ([server/src/memory/pasteImport.ts:183] `stance: 'reported',`,
  [app/src/features/onboarding/paste-screen.tsx:60] `Nothing is treated as true until you say so.`).
  Until she confirms, nothing from the paste affects matching, her cards or her clone's "true right
  now" list. Even after she confirms, a pasted fact can never be quoted to anyone, because the
  quote check needs her own typed words and the paste was not kept
  ([server/src/matching/brief.ts:272] `WHERE e.user_id = $1 AND e.role = 'user'`).
- **Arjun never sees** anything of Meera's paste or chat unless she made it shareable and it passed the
  quote rules (stage 4).

### 3.1 What a "fact" is

One row per claim about the person ([server/migrations/0002_facts.sql:29] `-- VERBATIM. never generalised.`):

- **The words** exactly as said, plus a comparable value derived by code, never by a model
  ([server/src/memory/facts.ts:211] `JSON.stringify(cand.objectValue ?? deriveValue(cand.predicate, cand.objectText)),`).
- **Status:** live (`active`), held (`staged`), replaced, or withdrawn
  ([server/migrations/0002_facts.sql:42] `CHECK (status IN ('staged','active','superseded','retracted','needs_recheck','quarantined'))`).
  The database refuses to make an untrusted row live
  ([server/migrations/0010_origin_gate.sql:19] `CHECK (NOT (status = 'active' AND origin_class IN ('untrusted', 'system')));`).
- **How sure:** asserted, hedged, hypothetical, reported, negated; only an asserted claim by the person
  goes live ([server/src/memory/facts.ts:74] `return c.stance === 'asserted' && (c.originClass === 'owner' || c.originClass === 'agent');`).
- **Visibility:** public, match-only or private (stage 4).
- **Where it came from:** the exact quote, the messages, which extractor.

A single-answer field keeps one live fact; a new one replaces the old, which is kept
([server/migrations/0002_facts.sql:90] `CREATE UNIQUE INDEX facts_single_valued_current ON facts`).
The vocabulary is closed: 59 core fields, 4 open ones, and 8 situation fields
([shared/src/facts.ts:196] `export const OPEN_PREDICATES = ['topic', 'owns', 'did', 'believes'] as const;`,
[shared/src/facts.ts:211] `export const SITUATION_PREDICATES: readonly PredicateDef[] = [`).

**The matching profile** is one row per person rebuilt from **live** facts only; held facts never
reach it ([server/src/matching/profile.ts:45] `WHERE f.user_id = $1 AND f.status = 'active' AND f.valid_to IS NULL`).
It is rebuilt by the interview, setup, the pool check and "send my agent out", not by chat itself
([server/src/api/interview.ts:119] `profile: await rebuildMatchProfile(db, ctx),`).

### 3.2 The confirm step

- **What is held:** anything heard (chat, the first sentence, a paste) on a **tapped** field: gender, who
  they want to meet, birth year, city, intent, age range, distance, neighbourhood, the five cards,
  faith, the eight situation answers, and (since 2026-09-28) work field, exercise, sleep and moving
  cities; plus **everything** from a paste ([server/src/onboarding/questions.ts:403] `'gender', 'seeking_gender', 'birth_date', 'lives_in', 'relationship_intent',`).
- **What goes live at once:** everything else heard in chat (interests, things done, employer, wants
  and "could not be with" sentences...), but **match-only**: it may help matching, it is never said to
  anyone until "OK to share" ([server/src/memory/extract.ts:245] `...learnedDisclosure(f.predicate),`).
  A Yes on a held fact keeps it match-only too; only a tapped field that nothing ever quotes (the basics,
  the cards, faith, the situations) keeps its own default
  ([server/src/matching/brief.ts:109] `return TAPPED_PREDICATES.has(predicate) && !QUOTABLE.has(predicate) ? {} : { disclosure: 'matchable_only' };`).
- **Where the question appears:** the YOU tab, one at a time ("Your agent heard something"), and "What it
  knows" ("Is this right?", with "Yes" / "No", and "Good. It believes you now." / "Dropped. It will not use
  that.") ([app/src/features/knowledge/you-screen.tsx:112] `<Card label="Is this right?">`,
  [server/src/api/profile.ts:243] `message: verdict === 'yes' ? 'Good. It believes you now.' : 'Dropped. It will not use that.',`).
- **Before a Yes**, a held fact changes nothing in matching, cards, sheets, talk or want checks. Two
  exceptions: the person's own clone still sees the sentence in its recent chat, and a background
  resolver ({AI:resolve}) can retire a live answer on a multi-answer field (for example who they want to
  meet, or work field) on the strength of an unconfirmed sentence, with no Yes and no record of the
  change ([server/src/memory/session.ts:133] `const existing = await multiValuedExisting(c, ctx.userId, out.candidates);`,
  [server/src/memory/session.ts:142] `UPDATE facts SET valid_to = now(), invalidated_at = now(), status = 'superseded'`).
  Unverified whether this happens in practice.

### 3.3 Question of the day

- **Where it comes from:** every "I don't know" an agent gave in a round, and every want that could not be
  checked (stage 5), recorded against that person; the asker is not recorded
  ([server/migrations/0062_question_of_the_day.sql:13] `from the fixed bank (answer-sheet.ts SHEET) and when. NO COLUMN`).
- **Which one:** the most-asked gap in the last 14 days that they have not answered and did not skip in the
  last 7; at most two a day ([server/src/matching/unknowns.ts:29] `export const DAILY_QUESTIONS = 2;`).
- **Where:** a chip "A question for you" in the town. For a bank question: "Other agents asked yours this"
  … "Answer it, and next time it can say what you said.", with "Save and share" / "Not now"
  ([app/src/features/question/question-state.ts:10] `Answer it, and next time it can say what you said.`,
  [app/src/features/question/question-screen.tsx:104] `<Button label="Save and share" variant="primary" loading={busy}`).
  For a card or tied question it opens that one question in the interview.
- **What an answer writes:** a shareable fact in the person's own words, put straight on their answer
  sheet. An answer naming a private topic or a contact detail is kept but never said: "Those are only ever
  checked, never said." ([app/src/features/question/question-state.ts:23] `Those are only ever checked, never said.`).

### 3.4 Paste and import

- **Paste** (onboarding "Bring what it knows", YOU → "In your words", "Catch it up fast"): up to 60,000
  characters; one model call; every fact held; guesses become questions the clone "won't guess" about; the
  pasted text is thrown away ([shared/src/paste.ts:72] `export const PASTE_MAX_CHARS = 60_000;`,
  [server/src/memory/pasteImport.ts:86] `A guess is NEVER a fact.`).
- **WhatsApp export** ("Now, how you talk"): parsed on the phone; the person picks which speaker they are;
  only their own lines (at least 20, at most the last 2,000) are sent; one model call writes a style note;
  the messages are not stored ([app/src/features/onboarding/voice-screen.tsx:93] `const mine = chat.lines.filter((l) => l.speaker === speaker).map((l) => l.text);`,
  [app/src/features/onboarding/voice-screen.tsx:124] `Only this note is kept. The chat was never stored.`).

### 3.5 Background jobs

| Job | When | What it does | Model? | Code |
|---|---|---|---|---|
| Session sweeper | Every 60 s, for chats quiet 5+ minutes | Extracts facts; may resolve conflicts, re-render the profile, refresh the answer sheet | {AI:extract}, {AI:resolve}, {AI:profile}, {AI:sheet} | [server/src/index.ts:148] `const sweeper = setInterval(() => {` |
| Consolidator | Every hour | Merges exact duplicates, lowers the weight of old unused facts, re-opens one old question | No (plain SQL) | [server/src/memory/consolidate.ts:26] `Deliberately deterministic: every step here is SQL.` |
| Embeddings | After each chat reply | Turns both messages into vectors for recall | {AI:embed} (not metered) | [server/src/api/chat.ts:460] `void embedPair(ctx, [` |
| Round worker | Every 5 s | Runs rounds; records "I don't know"s for the question of the day | See stages 6–7 | [server/src/index.ts:156] `const rounds = setInterval(() => {` |

Two configured model tasks, `reflect` and `canon`, have no caller: no reflection or canonicalisation runs
([server/src/llm/index.ts:32] `reflect: env.REFLECT_MODEL,`, [server/src/llm/index.ts:34] `canon: env.CANON_MODEL,`).

### 3.6 What the "agent" is at the moment it runs

**In a round** (the default path), the agent is not a chatbot. It is:

- a **row** of matching data (age, gender, who they seek, place, intent, tags, card answers) used by SQL
  ([server/src/matching/candidates.ts:34] `FROM match_profile a, match_profile b`);
- a **list of the person's own shareable sentences**, loaded under their own database session
  ([server/src/matching/orchestrator.ts:323] `loadQuotes(plan.a, { predicates: TALK_SOURCES, limit: TALK_SENTENCES })`);
- an **answer sheet** built earlier: 12 fixed questions, each pointing at one of those sentences
  ([server/src/matching/orchestrator.ts:313] `const sheets = await matchmakerSession((c) => readSheets(c, [`);
- the person's **wants** (stage 5);
- and one **model call per pair** that may only point at those sentences and write a date idea
  ({AI:talk}).

The matchmaker's database role can read a person's facts only where they are public, live and current
([server/migrations/0028_matchmaker.sql:48] `USING (disclosure = 'public' AND status = 'active' AND valid_to IS NULL);`).

**In the person's own chat**, the clone is a model prompt ({AI:chat}) that says "You are this person's clone:
an agent that knows them and speaks with their voice and judgement." and "Never invent a detail about them
that is not in the fragments." ([server/src/api/chat.ts:35] `You are this person's clone: an agent that knows them and speaks with their voice and judgement.`,
[server/src/api/chat.ts:41] `Never invent a detail about them that is not in the fragments.`). It is given the
profile summary, the style note, the last 20 messages of this chat, **every** live fact (private ones
included, since it talks only to its own person), and up to 5 recalled old messages
([server/src/api/chat.ts:98] `[...core, ...style, ...recent, ...truth, ...fragments,`). Its replies are not
checked by code. They are stored, but since 2026-09-28 neither the extractor nor recall reads them: facts
and "things they said before" come only from the person's own lines
([server/src/api/chat.ts:91] `Fragments recalled from things they said before:`,
[server/src/memory/retrieval.ts:81] `WHERE user_id = $1 AND role = 'user' AND embedding IS NOT NULL`).

### Docs vs code

- HOW-IT-WORKS.md §3 describes the agent only as the switched-off conversation setup (dossier, voice,
  quotes). The default-path agent (answer sheet, talk, wants, tags) is not described there
  ([HOW-IT-WORKS.md:173] `§6) an "agent" is three things, assembled per conversation:`).
- HOW-IT-WORKS.md §3 says no model "judges for you on the default path". A model decides which of a person's
  sentences answer another agent (the talk) and whether their wants are met, which reorders who they meet
  ([HOW-IT-WORKS.md:166] `judges for you on the default path.`).
- HOW-IT-WORKS.md §2c says chat facts are "learned at once". Only non-tapped, asserted facts are, and they
  stay private until "OK to share" ([HOW-IT-WORKS.md:153] `Everywhere else it is learned at once.`).
- ARCHITECTURE.md describes a nightly 03:00 job with a batch model, reflections, weekly canonicalisation and
  embedding backfill. The code runs an hourly SQL-only job, and none of the rest exists
  ([ARCHITECTURE.md:418] `03:00, users who spoke that day`,
  [server/src/memory/consolidate.ts:26] `Deliberately deterministic: every step here is SQL.`).
- ARCHITECTURE.md says extracted candidates "land staged". An asserted claim by the person goes live on first
  write ([ARCHITECTURE.md:450] `Output is schema-constrained. Candidates land`).

### Unverified

- Which fields the extractor picks for a given sentence, and whether it repeats identical words when it
  re-reads a session (model behaviour; nothing was run).
- Whether the background resolver retires tapped answers in practice.
