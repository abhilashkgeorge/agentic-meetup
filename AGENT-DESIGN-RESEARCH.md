# Agent design research: what the dating agent should be

**Short version: the agent should be a record of your answers and your no's, not a copy of you. Everyone answers the same 5 short cards. Code compares two records both ways. Agent-to-agent conversations are switched off. Nothing about matching can be proven until real women join, because today all 6 real users are men looking for women.**

- Date: 2026-09-23.
- Asked by: the founder, after reading the Typesafe Jev launch post.
- Readers: the founder (read the bold lines; each section opens with its answer) and a future engineer (read the tables and the evidence).
- How it was made: a research workflow of 24 agent runs. 4 read our code and database. 6 researched the literature and products. 4 wrote competing designs. 3 judged them. 1 merged them. 4 attacked the merged design, and 1 more checked what everyone had missed. A last step wrote the final answer, which is the design in section 7.
- Status: phases 0, 1a, 1b and 1c of the build order (section 9) are being built now. Phases 2 and 3 wait for their triggers.
- Line numbers such as `next-question.ts:40` point at the code as it was read during the research pass, before those fixes. Some will move as the fixes land.
- Every database number here comes from a read-only query. None of the research called a model. Where a number was re-run while this file was written, the text says so.

## Contents

1. The question asked
2. The answer in plain words
3. What we found in our own code and database
4. The evidence, topic by topic
5. The four designs that competed
6. The attack pass
7. The final design in full
8. Open questions for the founder
9. Build order
10. Sources

---

## 1. The question asked

**Should the agent copy the user, carry their wants and no's, or copy their judgement? Do both agents need to answer the same questions? And is the whole thing overcomplicated?**

The founder's words, lightly cleaned (2026-09-23):

> Now that Typesafe's Jev (https://typesafe.ai/blog/introducing-system-one-models-and-jev) is in the picture: do we need to redesign the onboarding flow and the business logic with fresh eyes to get the output we want? Research the best way to get it working. Am I overcomplicating things, or can we do it much cleaner? What a user looks for in a partner is set during onboarding, and we can learn more about the user through chat and questions. The problem is that it is not structured. Everything is my idea built out, not something proven to work.
>
> My biggest question: how should the agent clone work? Is it (a) a clone that mimics the user, (b) an agent that knows the user's wants and no's, or (c) something with the user's behavioural intelligence that makes the best choices?
>
> If the agent goes out to pick a partner by actually talking to the partner's agent, don't we need a set of questions that both agents can answer, and then compare their answers, instead of two random statements that are completely different? For example, user 1 says "I like trekking on weekends" and says nothing about food. User 2 says "I like Belgian waffles" and says nothing about weekends. It is impossible to match these two, because we have no structured questions we can ask each of them, with Jev or anything else. Right?
>
> Akinator (https://en.akinator.com/) asks a sequence of questions and reaches the answer after N of them. With Jev we could do the same with agents, provided the agents know the answers. So an agent should only be sent out once everyone has answered a set of questions. Without that, matching cannot work, right?
>
> But users must also be able to give extra information about themselves, because we cannot fit everyone into a fixed set of questions.
>
> So how do we build an agent for the user that is proven to work here? We are not cloning the whole user, only his brain about what kind of partner he wants. We are not trying to clone chemistry. We only want to know whether, on paper, these two people are a match.

He then asked for this research to be written to a file in detail, and for the fixes to be built.

---

## 2. The answer in plain words

**Option (b). Yes, both agents need the same questions, and a short required set comes first. Yes, the decision part is overcomplicated. The base it rests on is under-built.**

### The five-year-old version (the final answer, word for word)

> Yes, you are overcomplicating it. Yes, you need the same questions for everyone.
> Your agent should know your answers, who you would date, and your no's. It should not pretend to be you.
> No study shows a copy of you picks better, and ours made things up. On one real user's card it invented a comedy-club life.
> Today no real user has ever seen the lifestyle questions. A bug ends the interview after 3 questions.
> Fix: everyone answers 5 short cards: kids, one partner or open, smoking, drinking, food. Each card asks about you and about who you would date.
> If you untick an option, those people never show up. That is the whole match "on paper".
> Two agents talking doesn't add anything. Turn it off. A round then costs almost nothing.
> You don't need Akinator or Jev to compare two people. If both answered the same cards, a simple check does it.
> Jev can help later: turning what people say in chat into answers they confirm.
> Nobody can predict chemistry before two people meet. So the goal is to get the right people talking fast.
> The real blocker isn't the design. All 6 real users are men looking for women, so there is no real pair to test yet.
> Next step: get real women through the 5 cards.

### Verdict 1: what the agent is

**Option (b): an agent that knows your answers, who you would date, and your no's. Not (a), a mimic. Not (c), a judge with your behaviour, until your own yes/no taps can teach it.**

- Before two people meet, you can only know who they would consider. You cannot know whether they will click. With 100+ shared questions, 0% of the pair-specific part of desire was predicted (Joel, Eastwick & Finkel 2017).
- A copy of a person guesses a stereotype on anything the person never said (Peng, Toubia et al., "Digital Twins as Funhouse Mirrors", 2025).
- Here, the mimic made up a life for a 3-line real profile. The judge's concerns about that invented life reached the real user's card (live database, round of 2026-09-22; section 3.5).
- Behaviour can only be learned from real decisions, pooled over thousands of pairs. That is far away.
- Today the code is none of the three. No model ever sees the user's wants. A spokesperson for a few public facts does the talking, and a generic judge decides.

### Verdict 2: are we overcomplicating it?

**Yes on the decision, no on the foundation.**

- Overbuilt: 5 simulated conversations per pair, a judge, verdict words, 4 competing scorers, voice mimicry, and an entropy question picker in onboarding. The conversations are 60 of 63 model calls per pair, about 95% of the $0.055 a round costs, and they invent facts.
- Under-built: the shared questions. A bug means the interview never shows them. For a new user the candidate pool is empty, so every question scores 0 (`interview.ts:62-64`, `next-question.ts:40,131`). The preference questions can only say "same as me" (`interview.ts:198-208`).
- Most of what is needed already exists: closed fields, two-way filters, a preferences table, a check-in after the date. It just is not fed.
- The cleanest version: 5 cards, each asking "you" and "who's fine". An unticked option is a hard filter. Real people are picked first. The brief is written by code. Both humans tap yes. Conversations are off. That costs $0 in model calls per round.
- Ranking, random picks, learning and measurement wait until real people exist on both sides.

### The founder's questions, answered one by one

**Each of his questions has a short answer. The table points to the section with the detail.**

| He asked | Answer | Where |
|---|---|---|
| Mimic, wants-and-no's, or behaviour? | Wants-and-no's (b). Behaviour (c) only later, learned from real taps. Mimic (a) never, for matching. | 7.1 |
| Do both agents need the same questions? | Yes. 7 Basics plus 5 cards, the same for everyone. Once both answered, comparing them is plain code. | 7.4 |
| Akinator between agents, with Jev? | No. Akinator works because a fixed hidden answer exists. "Will these two click?" has none. Once both people answered the same cards, the check is a lookup, not a guessing game. | 7.5 |
| Should the agent go out only after a required set is answered? | Yes. The 5 cards join the existing pool requirement. Answered or "prefer not to say" both count. | 7.3 |
| Can users add more than the template? | Yes, as their own words, shown to the other human as quotes. Free text never becomes a filter unless the person confirms it on a card. Wants beyond the cards ("must love dogs") are not supported in phase 1. | 7.3, 7.4 |
| Trekking vs waffles? | Right, they cannot be compared as raw text. They are compared on the 12 shared fields everyone is asked (7 Basics, 5 cards). The hobbies go to the other human as conversation material. | 7.4 |
| Is it proven to work? | Nothing here is proven, and nothing can be until real-vs-real pairs exist. Today there are 0. | 3.5, 7.10 |
| Am I overcomplicating it? | Yes on the decision step. No on the base, which is missing. | above |

---

## 3. What we found in our own code and database

**The structured parts the founder asked for mostly exist already: a closed list of fields, filters that check both people the same way, and a preferences table. They are just not being fed. A bug stops real users from ever seeing the questions. The agent conversation, the part that is unproven, makes things up and costs most of each round.**

Four code readers went through the repo, and each queried the live database read-only. Their findings are summarised in 3.1 to 3.4. Section 3.5 lists the facts the orchestrator verified again, with how each one was checked. Section 3.6 gives the measured spend.

### 3.1 Onboarding as built

**The question bank exists (24 questions). For a new user it stops after 3 questions and a sentence, so no real user has ever answered a lifestyle question.**

Order on the phone: invite, consent, start screen (type one sentence; one model call pulls facts out of it; the clone writes one reply as you and you grade it), then the interview (or paste, then the interview), then essentials if not yet in the pool, then voice import, self-test, character, photos (`start-screen.tsx:44-51,100`; `interview-screen.tsx:71-73`; `essentials-screen.tsx:56-66`; `self-test-screen.tsx:70-74`).

The bank (`server/src/onboarding/questions.ts:64-271`):

| Kind | Count | Contents |
|---|---|---|
| Fact chips, fixed options | 18 | gender, who you want to meet, intent, diet, kids, monogamy, drinking, smoking, exercise, how much religion matters, how much politics matters, education, field of work, sleep, money, media, transport, relocation |
| Preference follow-ups | 5 | diet, kids, smoking, religion-importance (answered as "I couldn't" / "I'd prefer" / "doesn't matter"); works_in (multi-choice) |
| Free sentence | 1 | "Who could you absolutely not spend time with?" |

How the next question is picked (`next-question.ts:80-141`):

1. The 3 GATING questions first: gender, seeking, intent (`questions.ts:276`). They cannot be skipped (`interview.ts:123-128`).
2. Any preference whose paired fact was asked.
3. The chip whose field best splits the candidate pool, by normalised Shannon entropy over up to 500 candidates. Stop when the best split is under 0.15 (`:131`).
4. The free sentence (`:136`), then nothing (`:140`).

This is Akinator-shaped, but it narrows the pool, not the person.

The catch: candidates are computed only if the person is already in the pool (`interview.ts:62-64`). Being in the pool needs birth year, city and consent, and those come later, in essentials. With an empty candidate list, `splitPower` returns 0 for every chip (`next-question.ts:40`). Nothing clears 0.15, no preference is unlocked, and the interview goes gender, seeking, intent, dealbreaker sentence, end. Nothing in the app leads back into the interview afterwards: only `start-screen.tsx:100` and `paste-screen.tsx:54,82` route there. The test that walks the interview (`server/tests/interview.test.ts:79-110`) posts answers straight to question ids, so it never saw this.

How answers are stored:

- A fact answer is committed as an owner fact with a derived enum value (`interview.ts:152-166`).
- A strength-type preference stores `predicate in [YOUR OWN answer]` (`interview.ts:193-217`). So every structured preference means "same as me". It is wrong for smoking: the screen asks "Could you be with a smoker?" (`questions.ts:147`), and a daily smoker who answers "No" gets a dealbreaker that only daily smokers pass.
- 10 of the 14 lifestyle questions have no "what do you want in them" question at all.
- The free sentence is stored as a `dealbreaker` fact, then one model call (or Jev, if switched on) tries to map it to a `not_in` rule on one of 8 fields (`values.ts:303-312`). Most sentences map to nothing.
- `age_range_sought` is read by the matcher (`profile.ts:93-97`) but no screen writes it, so for real users the age filter only runs one way.

When the agent may go out: `in_pool` needs the 5 POOL_REQUIRED fields (gender, seeking_gender, birth_date, lives_in, relationship_intent; `values.ts:67-73`), every required consent, and age 18+ (`profile.ts:146-182`). The orchestrator checks only `in_pool` (`orchestrator.ts:103`). The self-test's "It's ready. It can go out" is shown on screen but gates nothing (`selftest.ts:197-207`).

What free text adds: `/v1/tell` and clone-chat extraction write facts about the self only, into 59 closed predicates or 4 open ones (topic, owns, did, believes; `extract.ts:65-73`). No path except the interview ever writes a preference. Free-text interests join only on an exact string, so `interest:trekking` never meets `interest:hiking`. Paste import stages untrusted facts that need confirming (`pasteImport.ts:184-193`). Voice import stores writing style only.

Downstream: real profiles carry 3 to 6 comparable trait keys; synthetic ones average 15.2 keys and 9 tags. Synthetic profiles have no preference rows at all.

Docs that overstate the flow: `HOW-IT-WORKS.md:53` says "about 25" questions (real users see 3 or 4). `HOW-IT-WORKS.md:46-47` says a paste export can put someone in the pool before essentials; it cannot, because pasted facts are staged and `deriveValue` returns null for the object-shaped birth_date and lives_in (`values.ts:232`).

### 3.2 The matching decision, end to end

**The filters compare the same field on both sides, which is right. The ranker was producing 0 on every recorded pair, so the top 3 were effectively arbitrary. Everything after the filters reads free text.**

| Stage | What it does | Model? | State at the research pass |
|---|---|---|---|
| 0. Profile | Matchable facts with a typed value become `traits`; each string value also becomes a tag like `diet:vegetarian` (`profile.ts:67-130`). Open-tier facts have no value shape and are skipped (`:69`). | No | Real users: 3-6 trait keys |
| 1. Filters | Pure SQL (`candidates.ts:21-85`). Both in pool, synthetic visibility, no block. Each clause checked both ways and passing on NULL: gender vs seeking, age vs age band, distance (shorter max), intent overlap, dealbreakers on the same field via `match_pref_satisfied` (NULL passes, `0020_match_functions.sql:21`), active in 60 days. Top 500 returned real-first, then most recent (`:103-107`). | No | Working as designed |
| 2. rank_score | Forward and backward preference fit (strong=3, mild=1), 0.6875 x preference + 0.3125 x Ochiai tag overlap per direction, geometric mean, shrunk by common/(common+3) where `common` counts only testable preferences (`score.ts:148-205`). | No | 16 of 75 pairs recorded; all 16 were 0.000 |
| 3. llm_file_score | One call reads both public dossiers, writes a concern and a 0-1 "second evening" score (`score.ts:232-258`). | Yes | n=16, range 0.05-0.35, mean 0.184 |
| 4. jev_file_score | One Jev yes/no over both dossiers, "each would want a second evening" (`score.ts:282-318`). | Jev | Off; 0 pairs |
| 5. agreement | 5 runs per pair, 5 prober messages per side plus 2 sealed assessor calls each run (`rendezvous.ts:43,53,276`). The prober is told never to ask about values or what the other person is looking for (`:78-86`). agreement = both-yes runs / counted runs. | Yes | Mean 0.604 over 75 pairs |
| 6. Brief | 2 calls per pair; the model pairs quotes by index (`brief.ts:100-252`). | Yes | Concern text printed on the card |
| 7. Humans | List ordered by agreement, then rank_score (`dating.ts:451-453`). The app shows "Your agents got on / were not sure / could not tell" (`matches-screen.tsx:211-213`). Both must tap yes. | No | 3 real decisions (2 yes) |

Why rank_score was always 0: synthetic profiles have no preferences, and the whole database had 1 live preference row (a smoking `not_in` dealbreaker). If either side has no testable soft preference, the geometric mean is 0 whatever the overlap. On top of that, the re-fetch in `rank()` has no ORDER BY (`score.ts:169-172`), so the real-first order from the filter step is probably lost. (That was tested as the owner role; the real query runs under row-level security and could plan differently.)

Cost per round (`orchestrator.ts:50,239-300`): per pair, 5 runs x (10 prober + 2 assessor) = 60 calls, plus 1 file score and 2 briefs = 63 calls. K=3 pairs, so about 189 calls a round. Measured: 6 finished rounds averaged $0.055 (max $0.065, 2.67 pairs each). Conversations averaged $0.0199 per pair over 74 pairs, about 95% of the spend.

How the "right" scorer would be chosen (`compare-scorers.ts`, `evaluate.ts`): AUC for each scorer against "both said yes" and "reported meeting", with a Hanley-McNeil standard error; under 10 labelled pairs it prints a smoke test only (`compare-scorers.ts:70-73`). The reader found three flaws in that measurement:

1. rank_score was a constant 0, so its AUC would be exactly 0.5 whatever the truth.
2. agreement is shown to the humans as words and orders their list. So the label is partly caused by the scorer (the OkCupid 2014 effect), and agreement's AUC is inflated against scorers that are never shown.
3. Only the top K pairs are ever scored and labelled, so no scorer is tested on the other ~497 candidates.

All four scorers predict "second evening", which is roughly chemistry. None measures the founder's "on paper, field by field" question.

### 3.3 What the agent is today

**None of the founder's three options. It is a spokesperson for a few public facts plus a generic judge whose taste belongs to the base model. It never sees the user's wants, and one prompt line is all that stops it inventing.**

What one conversation is built from, per side (`orchestrator.ts:136-140,174-177`):

1. Dossier: `predicate: value` lines from public facts only (`rendezvous.ts:293-326`; row-level security agrees, `0028_matchmaker.sql:46-48`).
2. Voice: a style block, written only by the WhatsApp-export import (`chatImport.ts:113-134`). 0 of 6 real users have one.
3. Quotes: used by the brief only.
4. The other person's public tags.

What the agent never gets:

- The preferences table. Only SQL reads it (`score.ts:80-81`, `candidates.ts:75-79`).
- The free-text dealbreaker sentence. It is not in PUBLIC_BY_DEFAULT (`facts.ts:71-82`), so it is stored `matchable_only` and the matchmaker role cannot read it. The comments at `interview.ts:233-236` and `dealbreaker.ts:12-17` say the agent can quote it. It cannot.
- gender, seeking_gender, age range, smoking, drinking, how much religion and politics matter.
- Episodes and pgvector recall (only the personal chat uses them).

What stops invention:

- Structural: the agent cannot leak private facts (row-level security).
- Structural: brief quotes are picked by index and read back from the database (`brief.ts:189-197`).
- Everything else rests on one prompt line, "Never invent a detail" (`rendezvous.ts:84`). Nothing checks transcript claims against the dossier, and no test covers it.

Unknowns are dead ends. When an agent says "I don't know", nothing asks the human. The judge's `learned` list is thrown away (`rendezvous.ts:276-283`). Transcripts cannot be read by the app (`0028:68-73`).

The judge (`rendezvous.ts:238-272`) sees its own person's public dossier, the other side's public tags and the transcript. It does not see its person's preferences or dealbreakers. Its yes-test is generic: "you would spend a real evening on this". Every pair gets a brief whatever the verdict; agreement only orders the list (`orchestrator.ts:274-278`).

Mimic machinery exists, but belongs to the personal clone: the chat prompt "speaks with their voice and judgement" (`chat.ts:31-39`), and the self-test probes style ("How do you say no?", `selftest.ts:35-55`). The self-test is built from all facts plus the core profile, not the public-only dossier that goes out, so what the owner grades is not what goes out.

Live numbers at the research pass (read-only, 2026-09-23): 75 rendezvous. 49 synthetic-vs-synthetic pairs averaged 0.791 agreement; 23 real-vs-synthetic pairs averaged 0.164; 0 real-vs-real. (Re-run while writing this: the same 49 at 0.791 and 23 at 0.164. The total pair count had moved because of test fixtures, see 3.5.) Real users' public facts: min 2, median 3, max 20. In real-vs-synthetic runs, the thin real side used an "I don't know"-type phrase in 21.5% of 550 messages against 32.7% for the richer synthetic side. That is a word-match signal only, but it fits the idea that a thin file fills gaps by inventing.

### 3.4 Jev as wired today

**Jev is switched off and has never made a real call. It is wired for two jobs: mapping the dealbreaker sentence, and one "second evening" score per pair. That second job uses Jev in its weakest mode.**

Status at the research pass: 0 rows in `llm_calls` with provider typesafe; 0 of 75 pairs with a `jev_file_score`. None of the Jev code was committed: every file was untracked or an uncommitted edit dated 2026-09-23. Migration 0060 was applied. `server/.env` has no `DECIDE_MODEL` and no `TYPESAFE_API_KEY`.

What the adapter does (`server/src/llm/adapters/typesafe.ts`): one POST with `{state, model, questions}`. Two question types are built: `noul` (yes/no, returns p from 0 to 1) and `choice` (closed set, returns the top choice, a confidence and the full distribution). A missing noul becomes 0.5 ("no information"), never 0. A choice outside the options becomes "" with confidence 0. `complete()` and `stream()` throw, because Jev writes no text. Price from our own table: $0.042 per million input tokens, output $0 (`caps.ts:173-222`). The vendor docs also offer a third type, `score` (2-10 rubric levels), and JSON-object state; the adapter leaves both out on purpose.

The two uses, only when switched on:

1. Dealbreaker mapping (`dealbreaker.ts:61-184`): 1 choice over the 8 mappable fields plus "none", and 39 yes/no questions, one per value. A rule is written only if the field is chosen at 0.6+, each excluded value scores 0.7+, and not every value is excluded. Stored as `not_in`, so unknowns still pass.
2. `jevFileScore` (`score.ts:260-318`): state is both dossiers pasted together, with ONE yes/no: "After one evening together, each of these two people would want a second one." The code says a battery of sub-questions would be "a different, better-informed scorer -- worth trying later" (`score.ts:272-275`). That deferred battery is exactly the founder's "same questions to both sides" idea.

What was deliberately not done (from code comments): no text tasks; no `score` type; not used in filtering or ranking ("the cheap price changes what is worth TESTING, not what is true"); no confidence column (the test of calibration is the spread of the column: "a confident, spread-out distribution would be evidence it is wrong"); not used to pick the next interview question; no SDK.

What the reader concluded: Jev's natural unit is one person, not a pair of agents talking. It answers many typed questions against one state in one request, so a shared checklist could be asked of each person once, at a cost that grows with people (N), not pairs (N squared). It physically cannot be option (a), because it writes no text. Its calibration is a vendor claim, not measured here.

Stale wording found: CLAUDE.md and `compare-scorers.ts:4` say "three" pre-human scores; there are four. HOW-IT-WORKS §1 says "six filters" and §4 says "seven rules". The Jev test headers say negative controls are recorded in a commit that does not exist yet.

### 3.5 Verified facts, and how each was checked

**These were checked again against the live database or the code on 2026-09-23. They are the ground truth the design is built on.**

| # | Fact | How it was checked |
|---|---|---|
| 1 | The interview ends after gender, seeking and intent (plus the free sentence). Every real user who went through it (3 of the 6) answered exactly those; the other 3 have no interview answers at all. The chips are scored against an empty candidate pool: `splitPower` returns 0 when there are fewer than 2 candidates (`next-question.ts:40`), nothing clears the 0.15 floor (`:131`), and GATING is only 3 questions (`questions.ts:276`). | Code read (`interview.ts:62-64` fetches candidates only when in the pool). In the research pass, the compiled `next-question.js` was run in memory with an empty candidate list and returned q-gender, q-seeking, q-intent, q-dealbreaker, then null. Read-only query of `question_answers` for real users, re-run while writing this: q-gender 3, q-seeking 3, q-intent 3, q-dealbreaker 2, and nothing else. |
| 2 | There are 6 real users and all 6 are men seeking women. So there are 0 eligible real-vs-real pairs. There are 5,008 synthetic profiles. | Read-only query of `match_profile`, re-run while writing this: 6 real rows, all `gender = man`, `seeking_gender = {woman}`; 5,008 synthetic. (A few minutes later the "real" count read 16. Test suites were running at the same time against the same local database, and the tests insert fixture users, which is the likely cause. The 6 is the count taken before those rows appeared, and it matches the research pass.) |
| 3 | The agent invented a comedy-writer life, and it reached a real user's card. That user has 9 facts and 1 episode, and none of them mention comedy. 2 of his 3 briefs describe him as a comedy writer (for example "comedy writing and sitcom rotations"). | Read-only query, re-run while writing this: facts (all statuses), episodes and brief headline plus concern text for each real user, matched against comed / comic / stand-up / open-mic / sitcom. Result for that user: 9 facts, 1 episode, 0 facts and 0 episodes matching, 3 briefs, 2 matching. The concern is printed word for word on the match card (`matches-screen.tsx:244`), under "Your agents got on" and "BOTH AGENTS SAID YES" (`:203-216`). |
| 4 | The dealbreaker mapper lets daily smokers through a "no smokers" rule. Smoking values are never, rarely, sometimes, often, daily (`values.ts:37`). The few-shot example says "Someone who smokes is smoking: exclude often, sometimes" (`dealbreaker.ts`, the few-shot line, 53 in today's working tree). So daily and rarely both pass. | Code read of the prompt text and the FREQUENCY enum. |
| 5 | The preference questions write "same as me". A strength-type answer stores `in [my own value]` (`interview.ts:198-208`; `const mine = rows[0]?.object_value` at 206). A daily smoker who answers "No" to "Could you be with a smoker?" gets a rule only daily smokers pass. | Code read. |
| 6 | Chat can silently overwrite a card answer. Every extracted chat fact is stamped `originClass: 'owner'` (`extract.ts:223`). An owner fact on a single-valued field retires the current value (`memory/facts.ts:170-185`), which can be the answer tapped on a card. If the chat wording is not an enum word ("I drink socially"), `deriveValue` returns null, the card value is retired anyway, and the person becomes unknown and passes everyone's drinking rule. | Code read (`extract.ts:223`; `facts.ts:74,122,170-185`; `profile.ts:35-50`; `values.ts:222-226`). |
| 7 | Lifetime model spend is $7.02. See 3.6. | Read-only query of `llm_calls`, re-run while writing this. |

### 3.6 Measured spend

**Lifetime model spend is $7.02. Agent conversations are about 95% of the cost of a round. The biggest line so far, though, is the "extract" task, which covers chat and import extraction and also the brief-writing call.**

Read-only query of `llm_calls`, run while writing this:

| Task | Spend | Share | Calls | Dates | What it meters |
|---|---|---|---|---|---|
| extract | $4.27 | 61% | 1,470 | 2026-09-08 to 09-17 | Chat extraction (`extract.ts:185`), paste import, chat import, the dealbreaker mapper, and the brief call (`brief.ts:151` is metered as `extract` too). 486 distinct user ids. |
| rendezvous | $1.57 | 22% | 3,897 | 2026-09-14 to 09-22 | Agent conversations in rounds. |
| measure | $1.17 | 17% | 2,777 | 2026-09-14 only | `scripts/measure-cohort.ts:107`, which runs `converse()` on synthetic cohorts. So this is agent conversation spend too. |
| chat | $0.01 | 0.1% | 11 | 2026-09-08 to 09-14 | Personal clone chat. |
| render_profile | $0.0004 | 0% | 3 | 2026-09-15 to 09-17 | |
| **Total** | **$7.02** | | **8,158** | | |

Two readings:

- Per round, conversations are most of the cost: 60 of 63 calls per pair, $0.0199 per pair, about 95% of $0.055.
- Over the project's life, the extract line is the largest. Conversations in rounds plus in the measurement script together come to $2.74 (39%).

### 3.7 Where the founder is right, and where the code already does what he fears is missing

**He is right that the talk has no shared questions, that nothing is proven, and that the structured core is not being collected. The building blocks for his idea already exist; what is missing is asking the questions, requiring them, and measuring anything.**

Right, and worse than he thought:

- The structured bank exists but is never asked (3.1).
- The trekking-vs-waffles problem bites in four places: the two file scorers read prose with no common questions; the conversation's topics are free by design; Ochiai overlap on free tags gives zero for different subjects; and the brief pairs quotes that do not line up.
- The "on paper" ranker was producing zeros (3.2).
- Unknowns are dead ends (3.3).
- A thin file makes the agent invent (3.5, fact 3).

Already exists:

- A closed vocabulary of 59 predicates with comparable enum values (`facts.ts:106-188`, `values.ts:29-42`).
- Facts and preferences kept apart; dealbreaker vs strong vs mild; unknown treated as unknown, never as a miss; declined answers recorded.
- Symmetric SQL filters (`candidates.ts`).
- An Akinator-style entropy picker (`next-question.ts:1-20`), aimed at the pool rather than the person.
- A required core before the agent goes out (POOL_REQUIRED), though it holds nothing about fit.
- A Jev adapter that already asks many typed questions in one call.
- A structural anti-invention pattern in the brief (quotes by index).

Missing: the question set being asked, the requirement to answer it, a correct flow, a way for free text to produce a want, and any measurement on real pairs.

---

## 4. The evidence, topic by topic

**Six researchers looked at six questions. They agree: a copy of a person is not better than a record of their answers; nobody can predict chemistry before two people meet; everyone who compares people uses one shared set of fields; and learning from real behaviour works, but only at a scale we do not have.**

Strength is the researcher's own rating (strong, moderate or weak). It is not upgraded here. Where the later science attack (section 6.3) said a citation was misread or stretched, a "Correction" note says so under the table.

### 4.1 Can an AI agent stand in for one person's preferences and judgement?

**It can reproduce a person's answers on things they were actually asked. It cannot guess what they never said; it falls back to a stereotype. So "unknown" has to be a code path, not a request in a prompt. Agents talking to each other are too agreeable. Simulated dates did no better than a plain regression.**

Researcher's summary: the evidence supports option (b), an agent that holds the person's own typed answers (facts, wants and above all no's) and compares them against another person's typed answers. It does not support (a), mimicking the person, or an open-ended (c) that makes the person's choices. Grounded agents beat demographic or persona agents by about 10-15 points, but only in domains the person answered. A structured survey works as well as a two-hour interview. Off the grounded questions, twins collapse toward a stereotype and drift toward agreeable, normative answers. Agent-to-agent talk adds its own biases. Even perfect stated preferences predict none of the pair-specific part of attraction.

| # | Claim | Evidence | Strength | Source |
|---|---|---|---|---|
| 1 | Agents built from a person's own answers beat demographic and persona-paragraph agents by about 14-15 points. A bullet summary of the facts keeps almost all of the gain; tone of voice is not what makes prediction work. | Park et al. 2024 (v1): 1,052 US adults, 2-hour AI interviews. GSS items: 0.85 normalized accuracy (68.85% raw / 81.25% own 2-week retest); demographic 0.71, persona 0.70. Big Five normalized r: 0.80 / 0.55 / 0.75. Economic games 0.66, no difference between agent types. Removing 80% of the transcript still gave 0.79; a bullet summary with linguistic features removed gave 0.83. | strong | https://arxiv.org/abs/2411.10109v1 |
| 2 | In the latest version, structured surveys work as well as the 2-hour interview. Extra data stops helping once a domain is covered. | Park et al. v3 (28 June 2026): interview-only 83%, survey-only 82%, combined 86%, demographics-only 74% (relative to own retest). Authors: benefits "begin to asymptote once the model has observed sufficient evidence within a domain". | strong | https://arxiv.org/abs/2411.10109 |
| 3 | The format of the grounding (JSON, prose, summary) barely matters. Twins still fall about 10 points short of the person's own consistency and are too "normative". | Twin-2K-500 (Toubia et al. 2025): 2,058 people, 500 questions each. Twins 71.72% vs human retest 81.72% (ratio 87.67%), random 59.17%. Text 71.72%, JSON 70.48%, LLM summary 68.02%. 4% of twins refused a vaccine vs about 45% of humans. | strong | https://arxiv.org/abs/2505.17479 |
| 4 | On questions the person never answered, a twin falls back to a stereotype: barely better than a demographics-only twin, and far more uniform than real people. | "Digital Twins as Funhouse Mirrors" (Science Advances): 19 pre-registered studies, 164 outcomes, 1,784 people. Correlation with humans on new outcomes: full twin r=0.197, demographics-only 0.145, empty persona 0.080. Twin spread lower than human spread in 154 of 164 outcomes (93.9%). | strong | https://arxiv.org/abs/2509.19088 |
| 5 | The more of a persona an LLM writes, the more the simulation drifts one way (positive, progressive). | Li, Chen, Namkoong, Peng 2025: about 1M personas, 6 open models. As personas moved from sampled tables to LLM-written text, simulated US elections drifted until every state voted Democratic. | moderate | https://arxiv.org/html/2503.16527 |
| 6 | LLMs answering personality questions shift toward the socially desirable answer once they sense evaluation. | Salecha et al. 2024, PNAS Nexus: GPT-4 moved about 1.22 SD toward desirable traits, Llama 3 about 0.98 SD; models spotted a personality survey with over 90% accuracy after 5 questions. | strong | https://academic.oup.com/pnasnexus/article/3/12/pgae533/7919163 |
| 7 | Simulated conversations between LLM agents are unrealistically agreeable, most of all when one model plays both sides. | Zhou et al., EMNLP 2024: in Craigslist bargaining, single-model "script" simulations reached a deal 94% of the time vs 30% for separate agents with private information. In-repo: an agent "went into five conversations with an empty dossier and agreed twice anyway" (`rendezvous.ts:300`). | strong | https://arxiv.org/html/2403.05020v2 |
| 8 | Agents that see each other's statements converge on agreement, and this spreads between agents. | Sharma et al. 2023: sycophancy across five production assistants. "Too Polite to Disagree" (2026): 6-agent discussions, post-discussion sycophancy 19.6% (over 30% for small models); majority accuracy 80.4%, rising to 90.9% when peers' credibility was shown. | strong | https://arxiv.org/abs/2310.13548 ; https://arxiv.org/html/2604.02668v2 |
| 9 | In agent-to-agent markets, even frontier agents take the first offer, do worse with more options, and can be manipulated by the other side's text. | Microsoft Magentic Marketplace (Nov 2025): first-proposal acceptance Claude Sonnet 93.3%, GPT-4o 100%; welfare fell as results rose from 3 to 100 (Sonnet 4 about 1,800 to 600); some models sent all payments to a manipulative agent. Zhu et al. 2025: agent deals "inherently imbalanced". | strong | https://www.microsoft.com/en-us/research/blog/magentic-marketplace-an-open-source-simulation-environment-for-studying-agentic-markets/ ; https://arxiv.org/abs/2506.00073 |
| 10 | Simulating a date with LLM agents does not predict speed-dating outcomes better than a plain regression on the same profiles. Even with real transcripts, LLM prediction of attraction is weak. | "Love First, Know Later" (preprint): Columbia data, 8,378 dates, 552 people. Simulation observer AUC 0.60, logistic regression 0.61, similarity 0.54. Real transcripts: ChatGPT r=.12-.23 on 964 speed dates; Claude Sonnet 4.6 / GPT-5.4 r of about .16-.26 on 1,248 Japanese speed dates, against a partner-consensus baseline of .36-.48. | moderate | https://arxiv.org/html/2512.11844 ; https://arxiv.org/abs/2407.10989 ; https://arxiv.org/html/2607.23037v1 |
| 11 | Published agent-to-agent dating results are weak: claims without baselines, and a clone-dating app that shut down. | CogniPair reports 77.8% "match prediction accuracy" with no baseline, but 83.5% of the Columbia dates are non-matches, so always saying "no match" scores higher. Volar (2023) let AI versions of users hold first-date chats and shut down in 2024; reviewers said the bots repeated topics and made inaccurate statements. | weak | https://arxiv.org/abs/2506.03543 ; https://www.openml.org/api/v1/json/data/qualities/40536 ; https://www.scientificamerican.com/article/the-rise-of-ai-chatfishing-in-online-dating-poses-a-modern-turing-test/ |
| 12 | Stated partner preferences, however well captured, predict almost none of who a specific person will desire. | Joel, Eastwick & Finkel 2017: N=350 speed-daters, 100+ measures; random forests predicted 4-18% of actor and 7-27% of partner variance, none of the relationship variance. Eastwick et al. 2014 meta-analysis (k=97): attractiveness r of about .40 and earning prospects about .10 for both sexes (difference .03). Eastwick & Finkel 2008: stated preferences did not match in-person preferences. | strong | https://journals.sagepub.com/doi/abs/10.1177/0956797617714580 ; https://psycnet.apa.org/record/2013-12483-001 ; https://pubmed.ncbi.nlm.nih.gov/18211175/ |
| 13 | People weigh dealbreakers more than dealmakers; no's are the more useful thing to capture. | Jonason, Garcia, Webster, Li & Fisher 2015: 6 studies, more than 6,500 people. | moderate | https://journals.sagepub.com/doi/10.1177/0146167215609064 |
| 14 | LLMs guess rather than abstain, state 80-100% confidence regardless of accuracy, and follow option order. A prompt saying "say you don't know" cannot be relied on. | Kalai et al. 2025 (OpenAI): training "rewards guessing over acknowledging uncertainty". Xiong et al., ICLR 2024: verbalized confidence clusters at 80-100%. Dominguez-Olmedo et al., NeurIPS 2024: survey answers driven by ordering and labelling. Typesafe's own launch post says its hallucination figure "is not empirical". | strong | https://arxiv.org/abs/2509.04664 ; https://arxiv.org/abs/2306.13063 ; https://arxiv.org/abs/2306.07951 ; https://typesafe.ai/blog/introducing-system-one-models-and-jev |
| 15 | Jev is built for the shape of option (b): a structured state plus many typed questions, typed answers with probabilities, no free text, one cheap call. | Typesafe launch post: "type-safe structured values" with "calibrated probabilities"; 70-500 ms; $0.042 per million input tokens, output free; cannot generate strings; up to 255 choices. | moderate | https://typesafe.ai/blog/introducing-system-one-models-and-jev |

Corrections from the science attack (6.3):

- Row 1-2: Park predicted survey and Big Five answers, not partner choice. "Voice adds almost nothing" is shown for surveys only.
- Row 5: our 5,008 synthetic profiles are sampled from tables, not written by an LLM (`synthetic.ts:6-9`, "STRUCTURE IS SAMPLED, NEVER GENERATED"). The real reason synthetic results do not transfer is that synthetic people make no decisions.
- Row 7: the 94% is "script" mode, one generation writing both sides. Our rendezvous makes separate calls per side with private dossiers, which is the 30% arm. The study does not indict our conversations directly.
- Row 11: Volar is one startup's closure.

What it means for us:

- Ground the agent in the person's own answers, stored as facts. Voice and style mimicry are cosmetic for matching.
- A short structured questionnaire is enough, if it covers the domain being matched on.
- For anything the person never answered, code returns "unknown" and no model is asked. The current `rendezvous.ts:84` prompt line is the kind of rule models are trained to break.
- Hard no's must be enforced as data (SQL filters on typed answers), never left to a model to voice or weigh.
- Do not let an agent's conversational choice decide who a person meets. Treat anything the other person wrote as untrusted input.

### 4.2 What predicts romantic compatibility, and how much can be known before two people meet?

**Only two things can be known before a meeting: who is eligible (the few things people really filter on) and how choosy or generally desirable each person is. Whether these two will click is close to 0% predictable. So "on paper" matching is a filter, not a forecast.**

Researcher's summary: the pair-specific part is close to 0% predictable from self-reports; when both people answered the same 100+ questions, machine learning explained 0% of it (Joel 2017). Across 11,196 couples the partner's traits added nothing beyond a person's own reports, and similarity added nothing (Joel 2020). Personality similarity adds about 0.5%. Ideal-preference matching falls to r of about 0 once general desirability is removed. So use a small required shared core, symmetric hard filters only where the user truly means no, and a light ranking that does not pretend to measure fit. Then get the two humans talking fast. The founder's shared-questions instinct is right for filtering; Akinator works because it has a fixed answer to find, and compatibility before meeting has none.

| # | Claim | Evidence | Strength | Source |
|---|---|---|---|---|
| 1 | Two people's answers to the same 100+ pre-meeting questions predict essentially 0% of the pair-specific part of attraction. They do predict choosiness and general desirability. | Joel, Eastwick & Finkel 2017: two samples (N=163, 187), about 12 four-minute dates each, 182/112 constructs. Relationship variance was the largest share (about 31-36%), yet random forests explained -4.6% to +1.3% of it (out-of-sample r = -.06 and .02). Actor 4-18%, partner 7-27%. Post-date ratings, chemistry first, explained 16-29%. | strong | https://gwern.net/doc/psychology/2017-joel.pdf |
| 2 | In established couples, relationship quality is predicted by each person's own view of the relationship; partner traits add almost nothing, and similarity adds nothing. | Joel et al. 2020, PNAS: 43 datasets, 11,196 couples. Actor relationship variables 45% at baseline; actor individual differences 19%; partner individual differences 5%; actor plus partner 21%. No actor-by-partner interactions found. | strong | https://www.pnas.org/doi/10.1073/pnas.1917036117 |
| 3 | While singles size up real prospects, "this type suits that type" explains at most about 3%, and matching to stated ideals shows no effect. | Eastwick et al. 2023 (preregistered): 208 singles, 1,065 potential partners, 7,179 data points over 7 months. Individual differences about 7%; target-specific perceptions about 31%; perceiver-by-target compatibility 3% at best; ideal matching unsupported. Only 11% of potential partners became dating partners. | strong | https://pscresearch.faculty.ucdavis.edu/wp-content/uploads/sites/112/2024/11/eastwick-blozis-2023-predicting-romantic-interest.pdf |
| 4 | What people say they want does not predict whom they desire after meeting. Apparent ideal-match effects are mostly everyone wanting the same desirable traits. | Eastwick & Finkel 2008 (N=163): ideals before the event "failed to predict what inspired their actual desire". Eastwick, Finkel & Simpson 2019 (N=281, 27 months): the ideal-match effect of r=.19 dropped to -.04 once normative desirability was removed. | strong | https://faculty.wcas.northwestern.edu/eli-finkel/documents/EastwickFinkel2008_JPSP.pdf |
| 5 | Stated preferences do shape who people pick, so they are valid selection rules. But once together, how well the partner fits them does not reliably predict relationship quality. | Gerlach et al. 2019 (N=763, 5 months): preferences predicted later partners' traits. Driebe et al. 2024 (322 relationships, 13 years): a closer match went with more commitment, not quality. Conroy-Beam et al. 2016: satisfaction unrelated to preference fulfilment in 2 of 3 studies. | moderate | https://pubmed.ncbi.nlm.nih.gov/28921999/ |
| 6 | Actual similarity drives liking most when people have not interacted (reading a profile) and nearly vanishes once they interact. Perceived similarity persists. | Montoya, Horton & Kirchner 2008 (313 studies): r=.59 with no interaction, .21 after short interaction, .08 (ns) in relationships; perceived similarity about .39 throughout. Tidwell, Eastwick & Finkel 2013 (2,184 date reports): perceived, not actual, similarity predicted liking. | strong | https://faculty.wcas.northwestern.edu/eli-finkel/documents/InPress_TidwellEastwickFinkel_PersonalRelationships.pdf |
| 7 | Personality similarity adds about half a percent to marital satisfaction. Personality matters as a main effect ("easy to be with"), not as a match. | Dyrenforth et al. 2010 (N=23,250, three national panels): own personality about 6%, partner's 1-3%, similarity about 0.5%. Attachment meta-analyses: actor effects larger than partner effects. Dissent: Luo & Klohnen 2005 (N=291) found similarity did predict. | strong | https://faculty.wcas.northwestern.edu/eli-finkel/documents/2012_FinkelEastwickKarneyReisSprecher_PSPI.pdf |
| 8 | Couples are strongly alike on religion, politics, drinking and education, and nearly unalike on personality. This is there from the start (people choose on it). | Alford et al. 2011 (about 4,000-5,000 spouse pairs): church attendance .71, political attitudes .65, drinking .60, party .60, education .50, smoking .21, neuroticism .08, extraversion .005. Politics already .59 in year one. Contrast: Kurzban & Weeden 2005 (HurryDate, N=10,526) found religion, education and income "played very little role" in 3-minute meetings. | strong | https://genepi.qimr.edu.au/contents/p/staff/Alford_NGM_JrnlPolitics362-379_2011.pdf |
| 9 | In India, marriage stays highly endogamous by religion and caste, so for many users religion (and for some, community) is the first filter. | IHDS 2005 (nationally representative): inter-religious marriages 1.6% (1981) to 2.7% (2005); inter-caste 3.5% to 6.1%. Naik et al. 2026 audited five LLM families rating matrimonial profiles: same-caste matches rated up to 25% higher. | moderate | https://iussp.org/sites/default/files/event_call_for_papers/Final%20revised%20Edited%20Mixed%20Marriage%20Paper%5B1%5D.pdf |
| 10 | Real online daters screen first with a few hard cutoffs, then weigh the survivors. | Bruch, Feinberg & Lee 2016, PNAS: 1.1M decisions by 1,855 users. Women up to 400x less likely to browse an unacceptable age; everyone about 20x less likely to browse a profile without a photo and about 10x less likely to browse a smoker. The screening model fit better than additive models. | strong | https://pmc.ncbi.nlm.nih.gov/articles/PMC5035909/ |
| 11 | People weigh dealbreakers more than dealmakers, but most dealbreakers people name cannot be checked on paper. | Jonason et al. 2015 (Singles in America, N=5,541): long-term dealbreakers were disheveled 67%, lazy 66%, too needy 63%, no humour 54%, lives 3+ hours away 49%, bad sex 47%, doesn't want kids 14%, has kids 13%. Differing religion and relationship goals were stronger long-term. | strong | http://www.mysmu.edu/faculty/normanli/jonasongarciawebsterlifisher2015.pdf |
| 12 | People overestimate how firmly they will reject someone who breaks their rules; in real choices they lean toward moving forward. | Joel, Teper & MacDonald 2014: less willing to reject when the situation was real. Joel & MacDonald 2021 review: about 10,000 speed-daters said yes to about 40% of dates (34% women, 49% men). | moderate | https://pubmed.ncbi.nlm.nih.gov/25344347/ |
| 13 | Expert consensus: no compelling evidence that matching algorithms work; pre-meeting information explains only a small share of long-term outcomes. Platforms can widen access, allow brief contact and screen. | Finkel, Eastwick, Karney, Reis & Sprecher 2012, PSPI (64-page review). | strong | https://faculty.wcas.northwestern.edu/eli-finkel/documents/2012_FinkelEastwickKarneyReisSprecher_PSPI.pdf |
| 14 | The one text signal with evidence of predicting mutual interest comes from the two humans' own words to each other, not from profiles. | Ireland et al. 2011: language style matching predicted mutual interest in 40 speed-date transcripts (OR 3.05) and still dating at 3 months in 86 couples' messages (OR 1.95). Small samples. | moderate | https://elifinkel.com/s/2011_IrelandSlatcherEastwickScissorsFinkelPennebaker_PSci.pdf |

Corrections from the science attack (6.3):

- Row 1: "0%" is a non-detection in 350 undergraduates with little spread on faith, intent or kids. It does not show those fields are useless as filters in a mixed adult pool.
- Row 2: Joel 2020 studies established couples, who have already sorted on similarity. It does not study first judgements.
- Row 6: Montoya's r=.59 comes from attitude-similarity "bogus stranger" experiments. It does not carry over to lifestyle tags like diet or transport.
- Row 8: Alford is US spouse data. It shows who ends up married, not that filtering on these fields improves dates, and the US caveat applies to faith and drinking as much as to politics.
- Row 9: the 2.7% describes a mostly arranged-marriage population, not what Bengaluru app users prefer.
- Row 11: in the same data, "doesn't want kids" (14%) and "has kids" (13%) were minority dealbreakers.

What it means for us:

- The shared core is for filtering, not predicting. Expect every pre-meeting scorer to sit near chance on pair-specific yes; a file-based ranker mostly ranks general desirability and look-alike files.
- Keep the current shape: SQL filters first, then a light rank. It matches how real daters behave.
- Do not add a personality or attachment compatibility layer.
- The horizontal things couples sort on (children, observance, drinking, smoking, intent, and in India faith and community) are the legitimate core. Faith and community are a legal and product call for the founder.
- Most real dealbreakers (lazy, needy, humourless) only show up in interaction. The humans' first chat has to catch them.
- A well-calibrated pair score should sit near the base rate. A confident, spread-out score is a red flag.

### 4.3 Typesafe Jev: what it is and what it is good for

**Jev is a cheap, fast function that answers yes/no, multiple-choice or rating questions about text you send it, with a probability. It is not an agent and cannot be the clone: no memory, no per-user training, no text, no conversation. Its calibration is a vendor claim. Once both people answered the same cards, comparing them is plain code, so Jev's real job is small: turning free text into proposed answers the person confirms.**

Researcher's summary: $0.042 per million input tokens, output free, about 100-250 ms per call. A Jev-based "clone" is option (b): a structured record that code and Jev read. The founder is right that both sides must answer the same questions, and that fits Jev, but once both have answered, the comparison is code or SQL. Jev's real job is filling the shared bank from free text with an explicit "not stated" option. Typesafe publishes no calibration error, and its benchmarks grade against frontier-LLM labels. An independent test found one broad Jev question much worse than Claude Haiku, while five narrow questions with fitted weights tied it at far lower cost. The current `jevFileScore` asks one broad two-person question, Jev's weakest mode.

| # | Claim | Evidence | Strength | Source |
|---|---|---|---|---|
| 1 | Jev is a typed-judgement function, not a chat model or agent. One state plus a map of closed questions in; one typed answer per question out; three question types. | Noul: probability of yes; 0.5 means "equally likely", not "medium". Choice: up to 255 options, returns argmax, probabilities, confidence (from how spread the distribution is). Score: 2-10 ordered levels (11 errors). Questions in one request are evaluated "in parallel and in isolation". Our adapter supports only noul and choice with a string state (`typesafe.ts:39-43`, `port.ts:92-117`). | strong | https://docs.typesafe.ai/api.md ; https://docs.typesafe.ai/primitives.md ; https://docs.typesafe.ai/primitives/noul.md ; https://docs.typesafe.ai/primitives/choice.md ; https://docs.typesafe.ai/primitives/score.md ; https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery.md |
| 2 | It is cheap enough to run a whole question bank per user in one call; the ceiling is tokens, not question count. | jev-1.13.0: $0.042/MTok input, output free; 64k tokens per request, 32k for state plus the longest question; 1,200 requests/min and 250k tokens/s ("can change without notice"); text only, "English is the primary training language". Latency: vendor about 100 ms; one independent run p50 239 ms. Batching 13 questions: 12.2x cheaper, 10x faster, same answers. | strong | https://docs.typesafe.ai/models.md ; https://typesafe.ai/blog/introducing-system-one-models-and-jev ; https://docs.typesafe.ai/cookbooks/parallel_questions.md ; https://github.com/anisselbd/jev-phishing-bench |
| 3 | The calibration claim is asserted, not shown. No ECE, Brier score or reliability diagram is published; "accuracy" means agreement with frontier LLMs. | Launch post and primer define calibration but publish no metric. Workflow evals score against "an average of the responses of GPT-6 Astra and Claude Fable 5.1", with no case counts, built by Typesafe staff ("some bias could exist"). Repeat runs: std dev about 0.01; Jev flipped its top label on 2 of 8 close Choice questions. Typesafe: "None of this shows accuracy or superiority." | strong | https://typesafe.ai/blog/introducing-system-one-models-and-jev ; https://docs.typesafe.ai/introduction/machine-learning-primer.md ; https://evals.typesafe.ai/ ; https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook.md ; https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook.md |
| 4 | One broad Jev question does badly; several narrow questions with weights fitted in code do well. Our `jevFileScore` uses the broad pattern. | jev-phishing-bench (independent, 2,000 emails): one verdict question 62.6% (AUROC 0.689, ECE 0.154) vs Claude Haiku 4.5 81.3% (0.837, 0.097). Five narrow nouls with logistic weights fitted on 1,000 emails: 95.0% (AUROC 0.982) vs Haiku on the same five 93.2%, gap not significant. Cost $0.04 vs $1.02 per 1,000. Docs: "If a question has two conditions, ask two Nouls and combine them in code." | strong | https://github.com/anisselbd/jev-phishing-bench ; https://docs.typesafe.ai/primitives/noul.md |
| 5 | On Typesafe's own benchmark, Jev in a decomposed workflow roughly matches mid-tier LLMs at about 1/300 of the cost. Its weakest task was the numeric one. Decomposition helped every model more than switching models. | evals.typesafe.ai: Jev workflow 67.8% at $0.0004 and 0.4 s per case; Claude Opus 5 workflow 73.1% at $0.1761; single prompt 64.8%. Invoices (numeric) Jev 61.8% vs Opus 78.4%. Haiku 4.5 went from 18.1% as a prompt to 53.6% as a workflow. Self-graded, no case counts. | moderate | https://evals.typesafe.ai/ |
| 6 | Typesafe names what Jev is bad at, and several items apply to text users write about themselves. | Jaggedness page: literal reading; math, counting, numeric closeness ("not a calculator"); date comparison; multi-hop; accuracy falls as unrelated state grows; state is not treated as hostile (text that argues for itself can move the answer); a noul and its negation summed to 1.19. | strong | https://docs.typesafe.ai/model-jaggedness/jev-1.13.md ; https://docs.typesafe.ai/introduction/coding-agents.md ; https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md |
| 7 | Jev cannot be the clone. No memory between calls, no per-user weights, cannot talk to another agent. | Models page: "not fine-tuned or LoRA-adapted with customer data… the same weights serve every account". Stateless; dependent judgements need "a second request in code". "System One is… for building AI-powered software, not agents." | strong | https://docs.typesafe.ai/models.md ; https://docs.typesafe.ai/primitives.md ; https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md |
| 8 | Answering a shared question bank for a user from their own facts, with a "don't know" outcome, fits Jev, but "not stated" must be built in on purpose and checked in code. | Docs recommend a Choice with an explicit "not stated" option. In Typesafe's own date cookbook, a document with no date still returned a date mode; code caught it only because the parts did not add up (confidence 0.46). A noul's 0.5 cannot tell "unclear" from "absent". | moderate | https://docs.typesafe.ai/model-jaggedness/jev-1.13.md ; https://docs.typesafe.ai/cookbooks/date_extraction_cookbook.md ; https://docs.typesafe.ai/primitives/noul.md ; https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery.md |
| 9 | Checking A's preferences against B's answers in bulk is mostly not a Jev job. Once both sides answered the same bank, it is exact code. Jev only helps where one side is free text. | Noul docs: fixed state, one question per record. About 100-200 candidates fit per call; 1,000 candidates at 350 tokens is about $0.015. Docs: do not use Jev for anything "code can compute exactly". | moderate | https://docs.typesafe.ai/primitives/noul.md ; https://docs.typesafe.ai/models.md ; https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md |
| 10 | Picking the next most informative question cannot be done by Jev itself. The Akinator step belongs in code, and this repo already has one. | Questions in one request are independent. Typesafe's hierarchical cookbook narrows sequentially with code choosing between requests. How Akinator itself chooses is proprietary. | moderate | https://docs.typesafe.ai/primitives.md ; https://docs.typesafe.ai/cookbooks/hierarchical_classification.md ; https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery.md |
| 11 | No published comparison of Jev against embeddings exists. Structurally Jev reading two profiles is a cross-encoder, and embeddings a bi-encoder: embeddings or SQL for retrieval, Jev for re-ranking a short list. | Rerank cookbook vs BM25 only (CLERC legal: top-1 5% to 18%). Sentence-Transformers: cross-encoders are better but do not scale (10,000 sentences: about 65 hours vs 5 seconds). Embedding similarity cannot express "A wants X, B is X". | moderate | https://docs.typesafe.ai/cookbooks/rerank_typesafe.md ; https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery.md ; https://www.sbert.net/examples/cross_encoder/applications/README.html |
| 12 | No model can be calibrated to "will these two click" before they meet, because the signal is not in pre-meeting data. | Joel 2017: no relationship variance predicted from any combination of pre-date measures. Jev's calibration is learned from Typesafe's targets and has never seen a dating outcome. | strong | https://journals.sagepub.com/doi/abs/10.1177/0956797617714580 ; https://docs.typesafe.ai/models.md |
| 13 | Five things the founder may be assuming Jev can do, which it cannot. | (1) Hold a conversation between agents. (2) Know an answer the user never gave. (3) Choose or write the next question. (4) Compare numbers, ages, distances or dates reliably. (5) Give probabilities calibrated to our outcomes, or say "I don't know" on its own. Also: zero data retention is enterprise-only, so sending dating facts is a new subprocessor decision. | strong | https://docs.typesafe.ai/introduction/coding-agents.md ; https://docs.typesafe.ai/models.md ; https://docs.typesafe.ai/model-jaggedness/jev-1.13.md ; https://docs.typesafe.ai/primitives.md |

Notes from the attack pass:

- Row 4 rests on one GitHub repo, and its 95% used weights fitted on 1,000 labelled emails, which we do not have. "Narrow beats broad" quietly needs labels (completeness critic, 6.5).
- The Jev and fabrication attack (6.4) found the planned pre-fill shape does not fit Jev as specified: a Choice returns one option, so it cannot answer multi-valued fields; on ordered fields probability spreads across neighbouring levels; "confidence" is spread, not the chosen option's probability; and a 1-tap "Right?" confirm measures agreeableness, not accuracy.

What it means for us:

- Jev is option (b) machinery. It cannot be (a) and it cannot hold (c).
- Keep every number (age, height, distance, dates) in SQL.
- Do not ask Jev to compare two answers that are already structured.
- The `jev_file_score` column measures Jev in its weakest mode. A bad AUC there would not show Jev is useless; it would show one broad question is weak.
- Pin `jev-1.13.0`, not `jev-latest`, before any threshold depends on it. English-first matters for Hinglish and Kannada text.
- Sending facts to Typesafe needs the privacy text to name it. That is the founder's to handle.

### 4.4 How real dating products structure what they learn, and what worked

**Every product that compares people does it through one shared set of fields: free-form in, fixed schema out. Long questionnaires shrank because people would not finish them. No questionnaire has been shown to predict who will like whom. The big apps moved to behaviour plus an outcome question after the date. No agent-to-agent dating product has published outcomes.**

Researcher's summary: OkCupid scores only questions both people answered, with a penalty for few in common. eHarmony gave everyone one fixed questionnaire. Keeper and Sitch take chat or voice and map it into fixed trait and preference fields scored both ways. So the founder is right that trekking vs waffles cannot be matched; the fix is a small required core, not a 300-question test (eHarmony shrank from 436 questions to about 80). Tinder dropped Elo for activity; Hinge's Most Compatible learns from likes and passes; Hinge's "We Met" asks whether the date happened. AI-native matchmakers report 20-57% match-to-date, all self-reported. The one test of "simulate the conversation, then judge" tied a plain regression.

| # | Claim | Evidence | Strength | Source |
|---|---|---|---|---|
| 1 | OkCupid made answers comparable by giving everyone the same bank and scoring only questions both answered. Each question asks your answer, the answers you would accept, and how much it matters. Few shared questions are penalised. | Importance weights 0 / 1 / 10 / 50 / 250. Satisfaction computed each way, combined by geometric mean. With 2 shared questions the ceiling is 50%. Users answered about 300 on average; OkCupid's help page says aim for 50-100. No outcome validation published. | strong | https://blogs.ams.org/mathgradblog/2016/06/08/okcupid-math-online-dating/ ; https://okcupid-app.zendesk.com/hc/en-us/articles/22982200783771-How-Does-OkCupid-Work-Our-Complete-Guide-to-Match-Questions-the-Algorithm-and-Setting-Up-Your-Account ; https://www.research-live.com/article/features/data-date/id/4012946 |
| 2 | The number OkCupid showed changed behaviour about as much as the real match did. | "We Experiment On Human Beings" (July 2014): bad matches (30%) shown as 90% reached a 4-message conversation more often (secondary reporting about 10% to 17%). Rudder: "the mere myth of compatibility works just as well as the truth". Sample size not given. | strong | https://gwern.net/doc/psychology/okcupid/weexperimentonhumanbeings.html ; https://medium.com/@asnyder/okcupids-data-just-doesnt-match-bf1f75ece484 ; https://theweek.com/speedreads/449182/okcupid-admits-experimented-users |
| 3 | OkCupid found questions chosen by outcome data beat the questions users rated most important. | OkTrends 2011: label from account deletion ("I met somebody"). Agreement on three casual questions (horror films, travelled alone abroad, live on a sailboat) best predicted a relationship: 32% of successful couples agreed on all three, 3.7x chance; the trio beat the top three user-rated questions. | moderate | https://gwern.net/doc/psychology/okcupid/thebestquestionsforafirstdate.html |
| 4 | eHarmony is the purest "everyone answers one fixed questionnaire". It kept shrinking for commercial reasons, and there is no independent evidence the matching works. | 436 questions over 29 dimensions originally; about 150 by 2017, optional in 2016-17 for a 10-minute signup; now about 80. Refused outside inspection. The eHarmony-funded Cacioppo et al. 2013 (N=19,131) found online-met marriages 5.96% vs 7.67% breakup, a tiny difference about meeting online in general. | strong | https://ocw.mit.edu/courses/15-071-the-analytics-edge-spring-2017/9a6b539841f8c9f7804373dee5cec78b_MIT15_071S17_Unit9_eHarmony.pdf ; https://faculty.wcas.northwestern.edu/eli-finkel/documents/2012_FinkelEastwickKarneyReisSprecher_PSPI.pdf ; https://www.eharmony.com/tour/what-is-the-compatibility-quiz/ ; https://journalistsresource.org/media/marital-satisfaction-break-ups-differ-online-offline-meeting-venues/ ; https://money.cnn.com/2016/12/16/technology/eharmony-removed-questionnaire/index.html |
| 5 | A major review found no compelling evidence that any matching algorithm works. Similarity explains almost nothing about outcomes. | Finkel et al. 2012. Dyrenforth et al. 2010: similarity adds about 0.5%. Montoya 2008: similarity's effect on satisfaction in real relationships not different from zero. | strong | https://faculty.wcas.northwestern.edu/eli-finkel/documents/2012_FinkelEastwickKarneyReisSprecher_PSPI.pdf ; https://journals.sagepub.com/doi/abs/10.1177/1529100612436522 |
| 6 | Even 100+ self-report measures could not predict which specific person someone would desire. | Joel 2017 (as in 4.2 row 1). Joel 2020: relationship-specific perceptions up to 45%, individual differences up to 21%, and those only exist once people are together. | strong | https://journals.sagepub.com/doi/abs/10.1177/0956797617714580 ; https://gwern.net/doc/psychology/2017-joel.pdf ; https://www.pnas.org/doi/10.1073/pnas.1917036117 |
| 7 | What people say they want does not match whom they end up wanting. Behaviour reveals preferences better. | Eastwick & Finkel 2008. Hitsch, Hortaçsu & Ariely 2010, AER: preferences estimated from first contacts of about 22,000 users, fed into Gale-Shapley, reproduced the site's actual matches and sorting. | strong | https://pubmed.ncbi.nlm.nih.gov/18211175/ ; https://www.aeaweb.org/articles.php?doi=10.1257/aer.100.1.130 |
| 8 | Hinge's "Most Compatible" learns from likes and passes, not a questionnaire, and Hinge added direct outcome feedback. Gains are vendor-reported with no sample sizes. | TechCrunch 2018: learns from liking and passing, uses Gale-Shapley; "8x more likely" to swap numbers (no test size). "We Met" asks both people privately a few days after swapping numbers whether they met and would meet again; beta: 90% said the date was great, 72% wanted a second. | moderate | https://techcrunch.com/2018/07/11/hinge-employs-new-algorithm-to-find-your-most-compatible-match-for-you/ ; https://techcrunch.com/2018/10/16/hinge-is-first-dating-app-to-actually-measure-real-world-success ; https://help.hinge.co/hc/en-us/articles/360010692913-What-is-We-Met |
| 9 | Free-form text (Hinge prompts) drives engagement and dates, but is conversation material, not a way to compare people. | 3 prompts from about 85-105 options, so two users rarely answer the same. Hinge internal data: likes on prompts 47% more likely to lead to a date than likes on photos. 63% of daters struggle with what to write. | moderate | https://hinge.co/newsroom/prompt-feedback ; https://www.swipestats.io/blog/hinge-prompt-list ; https://techcrunch.com/2025/01/15/hinge-new-ai-feature-determines-if-your-prompt-response-is-too-basic/ |
| 10 | Tinder dropped its Elo desirability score for activity and preferences. Its 2025-26 AI "Chemistry" moves to questions plus one daily pick, with no outcome data published. | Tinder engineering 2019: "Elo is old news". Chemistry piloted in Australia/NZ from Nov 2025; no pilot results, no question count. | moderate | https://www.engadget.com/2019-03-18-tinder-dumps-desirability-scores.html ; https://www.tinderpressroom.com/2026-03-12-Tinder-Debuts-Inaugural-Product-Keynote-Tinder-Sparks-2026-Start-Something-New ; https://techcrunch.com/2025/11/05/tinder-to-use-ai-to-get-to-know-users-tap-into-their-camera-roll-photos/ |
| 11 | AI-native matchmakers take conversational input but convert it into a fixed schema of traits and preferences, scored both ways. | Keeper: fixed "Basic Traits" and "Basic Preferences", 100+ questions in 20-30 min, "your preferences always take priority", human review. Sitch: about 50 questions mapped to 75+ parameters. Timeleft: about 30 questions. Wavelength (Bengaluru): an agent learns "preferences, non-negotiables, and intent". Ditto: chat intake, one date a week. | moderate | https://www.keeper.ai/posts/how-keeper-works-our-method-for-soulmate-matching ; https://www.alleywatch.com/2025/12/keeper-ai-matchmaking-dating-relationship-science-jake-kozloski/ ; https://techcrunch.com/2025/06/25/sitch-wants-to-fuse-human-personality-and-ai-for-matchmaking ; https://timeleft.com/post/timeleft-algorithm-the-maestro-of-your-dinners/ ; https://www.antler.co/blog/why-we-invested-in-wavelength ; https://techcrunch.com/2026/08/06/gen-z-dating-apps-like-ditto-ditch-swiping-in-favor-of-ai-matchmaking/ |
| 12 | The outcome numbers AI matchmakers report are all self-reported: about 20-60% of proposed matches become dates. | Ditto: "about 20%" go on a date. Known: 26-minute voice intake, about 50% of proposed dates accepted, 70% want a second. Keeper: 57% mutually accepted, 50% of those lead to dates, "10% of first dates result in marriage" (unaudited). None published with methods. | weak | https://www.globenewswire.com/news-release/2026/02/03/3231154/0/en/ditto-raises-9-2m-to-replace-swiping-with-real-dates-for-college-students.html ; https://www.globaldatinginsights.com/featured/known-raises-on-voice-ai-to-push-dating-back-offline/ ; https://sfist.com/2026/05/06/new-ai-dating-app-out-of-sf-says-half-its-matches-say-yes-to-real-dates/ ; https://www.keeper.ai/posts/how-keeper-works-our-method-for-soulmate-matching ; https://www.globaldatinginsights.com/featured/ai-dating-startup-amata-launches-with-6m-in-funding/ |
| 13 | No agent-to-agent dating product has published outcome evidence. The big apps' 2026 launches are assistants, not agents that date for you. | Volar (2024): bots ran about 10-message first dates; no outcome data. Bumble's founder (2024): "your dating concierge could go and date for you"; what shipped in 2026 is "Bee", an assistant. MoltMatch (Feb 2026) used a real model's photos without consent. Grindr's "wingman" ranks profiles. | moderate | https://www.psychologytoday.com/us/blog/a-funny-bone-to-pick/202401/ai-chatbots-can-now-go-on-first-dates-for-you ; https://www.globaldatinginsights.com/news/volar-where-ai-avatars-go-on-first-dates-for-you/ ; https://www.cnbc.com/2024/05/10/bumble-founder-whitney-wolfe-herd-says-ai-could-date-for-you.html ; https://techcrunch.com/2026/03/12/bumble-introduces-an-ai-dating-assistant-bee/ ; https://techxplore.com/news/2026-02-hot-bots-ai-agents-dating.html ; https://www.grindr.com/2026-product-roadmap |
| 14 | The one published test of "simulate the conversation, then judge" found it no better than a plain regression on the same fields. | Love First, Know Later: AUC 0.60 vs 0.61 (similarity 0.54); "Performance is modest overall." A 2026 study giving Claude real transcripts got about r=0.16-0.25. | moderate | https://arxiv.org/abs/2512.11844 ; https://arxiv.org/html/2512.11844 ; https://arxiv.org/html/2607.23037v1 |
| 15 | Theory and the best clone-fidelity study both say an AI copy is good enough to screen but loses to meeting in person. | Liang 2025: "a finite number of in-person encounters yields a better expected match than search over infinite AI representations" when personality is high-dimensional. Park 2024: interview agents reproduce survey answers at 85% of retest consistency. | moderate | https://arxiv.org/abs/2501.16996 ; https://arxiv.org/abs/2411.10109 |

Correction from the science attack: Hinge's "47%" is the company's own unpublished data, and people who like prompts may differ from people who like photos.

What it means for us:

- Our scoring is already OkCupid-shaped (geometric mean both ways, shrink by shared count). The gap is that no shared core is required or collected.
- Never show a number, and never let verdict words ("your agents agreed") vary with a score. They move the human's yes and contaminate the labels.
- Pick the core by what predicts a mutual yes once real outcomes exist, not by intuition. Add a We-Met-style outcome question; our 0058 check-in already is one.
- Free text is conversation material for the humans, and a source of mapped answers when it fits a field. It is not compared raw, agent against agent.
- The founder's bar ("beat 20% match-to-date") compares against self-reported numbers.
- Agent-to-agent talk is the novel, unproven and expensive part. Treat it as a hypothesis, not the core.

### 4.5 Adaptive questioning: the fewest questions that still decide a match

**With a bank this small, a fixed short list does about as well as clever adaptive ordering. So onboarding should ask a short fixed core, the no's people answer crisply, and stop. Adaptive picking only pays later, with a bigger bank. Our "Akinator" picker does nothing for a new user today.**

Researcher's summary: the scoring is not overcomplicated; `rank_score` already works like OkCupid. The real gap is that the structured core is never collected. The literature points to a short required core of no's (about 15 taps), with free text mapped onto the same fixed fields so two people who answered different things still land on comparable coordinates. Adaptive ordering pays only with a large calibrated bank. Stop on a decision, not a count. Learn weights from revealed choices, because self-rated importance predicts choices poorly.

| # | Claim | Evidence | Strength | Source |
|---|---|---|---|---|
| 1 | In our code, the "Akinator" picker does nothing for a brand-new user. The 18 structured chips are never asked, and the app has no route back into the interview. | Code read: `interview.ts:62-64`; `next-question.ts:40`, `:131-140`; preference chips gated on their fact (`:95,113-114`); only `start-screen.tsx:100` and `paste-screen.tsx:54,82` route to the interview; `interview.test.ts:142-167` uses a fixture with no birth date or city and never checks chips are offered. | strong | server/src/api/interview.ts:62 ; server/src/onboarding/next-question.ts:40,131-140 |
| 2 | 20Q (and, by the only public account, Akinator) keeps every candidate with a weight instead of deleting, picks the question that halves the likely set, and survives wrong answers. | 20Q patent: objects "prioritized, not filtered"; "balance" and "confirmation" methods. Inventor: by "the sixth or seventh question it doesn't believe you". 80% right at 20 questions, 98% at 25. Akinator's method is proprietary. | moderate | https://patents.google.com/patent/US20060230008A1/en ; https://scienceline.org/2006/07/tech-schrock-20q/ ; https://www.tubefilter.com/2025/04/25/akinator-guessing-genie-ai-algorithm-elokence/ |
| 3 | Choosing questions by how evenly answers split (our `splitPower`) is measurably worse than expected information gain. | BED-LLM (ICLR 2026): EIG-based choice raised 20 Questions success by 37.4 points on average over direct prompting; "Split" and "Entropy" baselines lost to EIG; entropy gave no gain on preference elicitation (200 simulated film profiles). | strong | https://arxiv.org/abs/2508.21184 |
| 4 | Pure entropy selection breaks in practice because it ignores whether people can answer and how many people the number rests on. | Rashid et al. 2002 (MovieLens, about 300 new users): pure entropy was "unusable"; two users had to look at several hundred movies. "A movie with only two ratings, a 1 and a 5, has high entropy but little value." Our `splitPower` counts only candidates who have the trait (`next-question.ts:43-46`), so a field 2 of 500 answered, differently, scores a perfect 1.0. | strong | https://cs.fit.edu/~pkc/apweb/related/rashid-iui02.pdf ; https://dl.acm.org/doi/10.1145/502716.502737 |
| 5 | Adaptive testing roughly halves test length at equal precision, but only with a large calibrated bank. With a small bank, a fixed "best few items" does almost as well. | Weiss & Kingsbury 1984: 40-60% fewer items. CAT-DI 2012 (N=1,614): 12 items gave r=0.95 with the 389-item score. NEO PI-R (Reise & Henson 2000, N=1,059): the best 4 items per facet given non-adaptively "would have produced similar results for many scales". | strong | https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1745-3984.1984.tb01040.x ; https://adaptivetestingtechnologies.com/wp-content/uploads/2016/09/CAT-DI-JAMA-Psychiatry-2012.pdf ; https://journals.sagepub.com/doi/10.1177/107319110000700404 |
| 6 | The trekking-vs-waffles problem has a standard answer: questions land on a shared set of dimensions, so people who answered different questions are compared on the same scale. | PROMIS: scores from any mix of items in one calibrated bank land on the same metric; at least 4 items advised. eHarmony: 29 dimensions from 436 questions. | moderate | https://healthmeasures.net/implement/scoring/calculate-scores/ ; https://ocw.mit.edu/courses/15-071-the-analytics-edge-spring-2017/9a6b539841f8c9f7804373dee5cec78b_MIT15_071S17_Unit9_eHarmony.pdf |
| 7 | Stop on a decision rule, not a question count. Sequential tests stop as soon as the answer is clearly on one side of the cut. | PROMIS default: 4-12 items, observed means 5.3-8.7. Computerized classification tests (Wald's SPRT; Eggen 1999) reach accurate classification with a fraction of a fixed form's items. | strong | https://journals.sagepub.com/doi/10.1177/01466219922031365 ; https://en.wikipedia.org/wiki/Computerized_classification_test ; https://assess.com/computerized-adaptive-testing/ |
| 8 | Value-of-information elicitation asks only questions that could change the decision, and in practice needs very few, easy questions. | Chajewska, Koller & Parr 2000 (prenatal-testing decision): 2.3-3.9 questions on average at one threshold, 5.9-9.0 at a stricter one, vs 7.55 for the earlier method. | moderate | https://cdn.aaai.org/AAAI/2000/AAAI00-056.pdf |
| 9 | How important people say something is predicts their choices poorly. Forced trade-offs and tracked weights predict better. | Netzer & Srinivasan 2011 (N=154, 12 attributes): adaptive constant-sum trade-offs predicted choices 35-52% better than conjoint and plain self-explication; without trade-offs "respondents tend to state that all attributes are important". OPEN (Handa et al. 2024): self-reported rankings "not a good indicator". | moderate | https://business.columbia.edu/sites/default/files-efs/pubfiles/3067/Netzer%20and%20Srinivasan%20Adaptive%20Self-Explication.pdf ; https://arxiv.org/abs/2403.05534 |
| 10 | LLMs left to choose their own questions do badly; explicit uncertainty tracking fixes it. | MediQ (NeurIPS 2024): prompting LLMs to ask questions "degrades performance"; confidence and abstention added 22.3%. Uncertainty of Thoughts (NeurIPS 2024): +38.1% with information-gain planning. OPEN users: LM questioning was repetitive, "as though it had its own agenda". | strong | https://arxiv.org/abs/2406.00922 ; https://arxiv.org/abs/2402.03271 ; https://arxiv.org/abs/2403.05534 |
| 11 | EIG-driven questioning is expensive with generative LLMs. A model that returns calibrated probabilities for many typed questions in one call makes it cheap, but only if the calibration is real. | BED-LLM samples many answers per question; ASIG (July 2026) cuts that more than 25x. Jev's calibration is a vendor claim, and our Jev has never made a real call. | weak | https://arxiv.org/abs/2607.03426 ; https://typesafe.ai/blog/introducing-system-one-models-and-jev |
| 12 | The no's are the right shared core: people weigh dealbreakers most and answer them crisply. | Jonason et al. 2015 (6 studies, N>6,500). Weaker, observational: OkCupid found couples do better when both care equally about politics than when they share the same view. | strong | https://journals.sagepub.com/doi/10.1177/0146167215609064 ; https://www.pbs.org/newshour/nation/the-3-first-date-questions-that-will-predict-your-romantic-compatibility |
| 13 | People give fewer and worse answers as questions pile up. Successful products ask a small required set and let the long tail come over months. | SurveyMonkey (100,000 surveys): drop-off rises most steeply up to about 15 questions; time per question falls from 75 s to 19 s; abandonment rises past 7-8 minutes. Galesic & Bosnjak 2009: longer stated length, fewer starts and completions, worse late answers. OkCupid: 15 required, average user answers 50. eHarmony: about 450 required to 150 and optional. | moderate | https://www.surveymonkey.com/curiosity/survey_questions_and_completion_rates/ ; https://www.surveymonkey.com/curiosity/survey_completion_times/ ; https://academic.oup.com/poq/article-abstract/73/2/349/1939196 ; https://www.refinery29.com/en-us/okcupid-profile-questions-matches ; https://en.wikipedia.org/wiki/EHarmony |
| 14 | An agent built from someone's own words can answer questions its person never answered at about 85% of the person's own consistency. People are themselves noticeably inconsistent. | Park et al. 2024: 85% of 2-week retest; interview 83%, survey 82%, combined 86%, demographics 74%. | moderate | https://arxiv.org/abs/2411.10109 |
| 15 | Our ranking already has OkCupid's shape. The "both agents answer the same questions" requirement is already built; the gap is coverage, not design. | OkCupid (answer, acceptable answers, importance; both ways; margin of error). `score.ts:63-66` skips preferences the other person has no answer for; `:186-193` geometric mean shrunk by common/(common+3). | moderate | https://blogs.ams.org/mathgradblog/2016/06/08/okcupid-math-online-dating/ ; server/src/matching/score.ts:63-66,186-193 |

Corrections from the science attack (6.3):

- Rows 4 and 5 are about whether people have seen a film (Rashid) and about adaptive testing of one latent trait (Reise & Henson, CAT). A handful of independent factual cards loses nothing by not being adaptive. The conclusion (a fixed core) is harmless; the reason given is stretched.
- Row 6: PROMIS can compare different items only because they are calibrated to one trait. Our optional items are separate fields with nothing linking them, so like-for-like comparison exists only on the required fields.
- Row 8: the synthesis later called its daily-question formula "value of information". It never computes whether an answer would change the top 3; it is still an entropy-style score.
- Row 9: Netzer & Srinivasan's winning method is itself a stated-importance method with trade-offs. The paper argues for a better importance question, not for none, and it studied consumer products.

What it means for us:

- Fix the order bug first: a fresh user must be offered the core. Add a test that plants a fresh user and checks the chips are offered.
- A short fixed core of no's, in a fixed order. No entropy picking during onboarding.
- Budget about 15 taps for the required part; the rest comes later.
- Do not let a chat model decide what to ask. Code decides which field; a model may only phrase or parse.
- Weights should be learned from revealed choices (yes/no on briefs), not from "how important is this to you".

### 4.6 Two-sided recommendation: trust what users say, what they do, or both?

**Both, in different jobs. What people say sets the few hard rules and a starting point. What they do corrects everything else, but that needs far more real decisions than we will have for months. Scoring both directions is the single biggest win, and we already do it. Once anything learns from taps, it will pile attention onto a few popular people unless it is capped.**

Researcher's summary: reciprocal scoring roughly doubles success (RECON: 23% to 42%), and the repo already does this. Stated preferences predict on-paper judgements but barely predict who people contact or like once they meet. Pair-specific chemistry cannot be predicted before a meeting. Learning from behaviour beats profile matching at scale but needs a large pool and drifts toward the popular. For one person's own weights: not within a handful of decisions (roughly 10 yeses per weight puts it at months). Pooled re-weighting across users comes much sooner. The code records `human_says_yes` but nothing learns from it.

| # | Claim | Evidence | Strength | Source |
|---|---|---|---|---|
| 1 | Making the match two-sided is the largest single improvement in people-to-people recommendation. | RECON (Pizzato et al., RecSys 2010), a large Australian dating site: reciprocity raised top-10 success from 23% to 42%; 26% for new users. Directions combined with a harmonic mean. | strong | https://dl.acm.org/doi/10.1145/1864708.1864747 ; https://api.openalex.org/works/doi:10.1145/1864708.1864747 ; https://link.springer.com/article/10.1007/s11257-012-9125-0 |
| 2 | What people say they want predicts poorly whom they actually contact. Behaviour carries preferences people do not state. | Whyte & Torgler 2017: 219,013 contact decisions by 41,936 RSVP users; press coverage says under 1% of messages went to people meeting all stated criteria. Hitsch et al. 2010: same-race preferences people "might not truthfully reveal in a survey". OkCupid 2014: survey answers on race became less biased while behaviour stayed the same. Todd et al. 2007 (n=46): stated preferences "did not predict actual choices". | strong | https://journals.sagepub.com/doi/full/10.1089/cyber.2016.0528 ; https://www.sciencedaily.com/releases/2017/02/170221110744.htm ; https://link.springer.com/article/10.1007/s11129-010-9088-6 ; https://gwern.net/doc/psychology/okcupid/raceandattraction20092014.html ; https://doi.org/10.1073/pnas.0705290104 |
| 3 | Stated ideals do predict judgements made "on paper" about people not yet met. They stop predicting face to face. | Eastwick, Luchies, Finkel & Hunt 2014 meta-analysis (k=97): ideals "demonstrate predictive validity when participants evaluate hypothetical targets but not face-to-face targets". | strong | https://static1.squarespace.com/static/504114b1e4b0b97fe5a520af/t/5365a745e4b0cbe1c025abd7/1399170885689/Eastwick2014PBull.pdf |
| 4 | Trait-by-trait "what I asked for vs what you have" explains very little; most of the effect is general desirability. | Eastwick et al. 2025, JPSP registered report: N=10,358, 43 countries, 35 attributes. Level metric average β=.04; corrected pattern metric β=.19, falling to .11 with a normative term. Eastwick, Finkel & Simpson 2019: "Negligible evidence". | strong | https://pmc.ncbi.nlm.nih.gov/articles/PMC12622239/ ; https://www.sciencedirect.com/science/article/abs/pii/S0022103118305961 |
| 5 | Before two people meet, how much they will want each other specifically cannot be predicted. The predictable parts are who likes people in general and who is liked in general. | Joel 2017; Joel 2020; Eastwick & Hunt 2014 (consensus on attractiveness falls and unique variance grows with acquaintance). | strong | https://gwern.net/doc/psychology/2017-joel.pdf ; https://www.pnas.org/doi/10.1073/pnas.1917036117 ; https://pubmed.ncbi.nlm.nih.gov/24611897/ |
| 6 | LLM agents talking from profile personas predict mutual matches no better than logistic regression on the same fields. LLMs reading real transcripts predict weakly. | Love First, Know Later: AUC 0.60 vs 0.61, cosine 0.54. Scientific Reports 2026: ChatGPT on 964 real 4-minute transcripts r=0.12, the same as human transcript readers (0.13); humans watching video 0.31. | moderate | https://arxiv.org/html/2512.11844v1 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC13350872/ |
| 7 | At scale, recommenders that learn from behaviour beat profile matching by a wide margin, but need a large pool and push users toward popular people. | Krzywicki et al. 2014 (deployed trial, 6 weeks, 10% of users each, "hundreds of thousands of active users"): collaborative filtering +94.6% success over users' own search; profile rules +11.2%. Profile rules sent 78.7% of contacts to non-highly-popular users, CF 57.2%; CF needed rules to demote popular candidates. | strong | https://cdn.aaai.org/ojs/19032/19032-13-22868-1-10-20211006.pdf ; https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/2599 |
| 8 | Behaviour can guide a new user from their first action if borrowed from similar users. One person's own weights need far more data than a few rounds provide. | CCR (Akehurst et al. 2011, 216,662 users): top-10 success 65.8% vs 27.7% baseline after 1 expression of interest. Hitsch et al. 2010: about 128 decisions each, still pooled weights. Peduzzi 1996: about 10 events per weight. | moderate | https://www.ijcai.org/Proceedings/11/Papers/367.pdf ; https://people.duke.edu/~dandan/webfiles/PapersUpside/Matching%20and%20Sorting%20Dating.pdf ; https://pubmed.ncbi.nlm.nih.gov/8970487/ |
| 9 | How importance is asked matters. Free ratings let people mark everything important; forced trade-offs and scarce signals reveal what matters. | Li et al. 2002 ("mate dollars"): with a small budget people buy necessities first. Lee & Niederle 2015 (613 people): a scarce "rose" raised acceptance by 3.3 points (20% relative). Jonason 2015. OkCupid's steep 0/1/10/50/250 scale. | moderate | https://psycnet.apa.org/record/2002-02942-006 ; https://web.stanford.edu/~niederle/Lee.Niederle.Rose.ExpEcon.2015.pdf ; https://doi.org/10.1177/0146167215609064 ; https://blogs.ams.org/mathgradblog/2016/06/08/okcupid-math-online-dating/ ; https://ed.ted.com/lessons/inside-okcupid-the-math-of-online-dating-christian-rudder |
| 10 | Attention in dating markets piles onto a small top tier. A learner trained on "who gets a yes" mostly learns general desirability and sends everyone to the same few people. | Bruch & Newman 2018 (4 US cities): steep desirability hierarchy; people message people 23-26% more desirable than themselves; reply rate never above 21%; the most-contacted woman got 1,504 messages in a month. Hitsch 2010: 71% of men's first contacts got no reply. OkCupid 2009: two-thirds of men's messages to the best-looking third of women. | strong | https://pmc.ncbi.nlm.nih.gov/articles/PMC6082652/ ; https://gwern.net/doc/psychology/okcupid/yourlooksandyourinbox.html |
| 11 | Two-sided platforms get more matches when the recommender accounts for congestion and for who moves first, not only fit. | Rios, Saban & Zheng 2023 (major US app): having matched recently lowers the chance of liking again; accounting for it gave at least 27% more matches in two field experiments. Kanoria & Saban 2021: make the short or selective side propose first. | strong | https://pubsonline.informs.org/doi/abs/10.1287/msom.2022.1107 ; https://spiral.imperial.ac.uk/server/api/core/bitstreams/2e71c36d-4b6f-4626-a286-ffcab6948057/content ; https://pubsonline.informs.org/doi/10.1287/mnsc.2020.3794 |
| 12 | Showing people a compatibility number changes behaviour about as much as real compatibility does. | OkCupid 2014 (numbers from contemporary coverage): 30% shown as 30% about 10%; 30% shown as 90% about 17%; 90% shown as 30% about 16%; 90% shown as 90% 20%. | moderate | https://gwern.net/doc/psychology/okcupid/weexperimentonhumanbeings.html ; https://www.yahoo.com/news/facebook-okcupid-experimented-users-120208243.html |
| 13 | An agent built from a long interview reproduces a person's self-reported answers almost as well as the person does two weeks later. What it reproduces is self-report. | Park et al. 2024: 83% / 82% / 86% of retest; demographics 74%. | strong | https://arxiv.org/abs/2411.10109v2 |

Corrections from the science attack (6.3):

- Row 1: RECON is one site, measured offline, and its preferences are learned from each user's messaging. It does not show that scoring stated "who's fine" rules both ways gains that much.
- Row 2: the "under 1%" comes from press coverage, not the paper.
- Row 3: in our app the yes/no is tapped on the reveal screen, where photos show (`reveal-screen.tsx:176-179`). So a brief-yes is not a pure on-paper judgement; attractiveness (r of about .40) will drive much of it.
- Row 8: "10 events per weight" (Peduzzi) limits coefficient bias. It is not a sample-size rule for a prediction model. With 12 predictors and the weak signal expected, Riley et al. 2020 gives about 5,300 pairs (https://www.bmj.com/content/368/bmj.m441; see also van Smeden 2019, https://journals.sagepub.com/doi/10.1177/0962280218784726).

What it means for us:

- Keep the symmetric filters and the two-way combination. They are the part the evidence backs most.
- Stated answers set the hard rules. Nothing learns from taps yet, and with 6 real users nothing can.
- Real-first ordering in a small pool floods the scarce side even before any learning. A per-person weekly cap on real rounds is needed as soon as the real pool exists.
- The busier side deciding first, no number shown, and 3 candidates per round are all supported.
- Brief framing must be constant, or `compare-scorers` measures the wording, not the matching.

---

## 5. The four designs that competed

**Four designers each took a different angle. All four agreed on the big things: the agent is option (b), the conversations come out of the decision, and a short shared core is required. The "ask as little as possible up front" design scored highest overall, and the final design is a smaller version of it.**

### 5.1 The four designs

**A: cut to what the evidence supports. B: a per-person model of your judgement. C: ask as little as possible up front. D: a shared answer sheet filled partly by Jev.**

| Design | Angle | Agent | Required onboarding | Pipeline | Conversations | Jev | Round cost (estimate) |
|---|---|---|---|---|---|---|---|
| A. Evidence-first minimalist | Build only what the research supports; cut anything it calls weak, even if built. | Strictly (b): your answer, who you'd accept, up to 3 confirmed dealbreakers. Pooled learning later. | Essentials first, then 10 core dimensions (age range, distance, intent, kids, monogamy, smoking, drinking, religion importance...), about 12 screens and 20 taps; a "pick up to 3 dealbreakers" screen with "Even if everything else fit?". | SQL filter; rank on soft accept-sets, Ochiai removed; 2 ranked + 1 random "explore" pick (new `pick_reason` column); data-built brief with at most 1 small call. | Dropped from the decision; delete after about 50 decisions unless a real A/B wins. | Optional, only to map the dealbreaker sentence. | about $0.001 |
| B. Grounded simulacrum | Treat the agent as a proxy for the person's judgement, checked the way Park checked interview agents. | (b) as data plus a narrow learned (c): a per-person model of "would my human say yes to this card?". | Essentials first, 10 core dimensions each with mine / who's fine / how much it matters, plus 8 "which would you rather meet?" cards; about 25 screens, 5-6 minutes. | Filter; rank by a per-person logistic "proxy score"; a structured agent "exchange" on the top 20 (agenda of up to 5 fields, Jev for free-text wants, gap questions to humans); top 3 briefs. | Replaced by the structured exchange; 1 free-form run kept on 1 in 3 pairs as an experiment. | Mapping free text onto the bank; checking free-text wants in the exchange. | about $0.01 |
| C. User-burden-first | About 4 minutes and 12 required taps, first briefs in the same sitting; learn the rest afterwards. | (b): a record, corrected by the person's taps over time. | One Basics screen first (age range and distance pre-filled), then 5 cards (kids, smoking, drinking, food, faith) with "any is fine" pre-selected, then Send. | Filter; rank with the `common` fix; 2 ranked + 1 random slot; exposure cap; Jev demotes shortlisted candidates on an unmapped sentence; code-written "on paper" lines; 1 optional question a day; "Not for me" chips. | Dropped from the default round; code kept; returns only as a randomised arm. | Dealbreaker mapper; weekly pre-fill from chat for 1-tap confirm; shortlist demotion. | about $0.004-0.006 |
| D. Shared answer sheet plus Jev | Every agent carries the same typed answer sheet; Akinator-style questions only where they pay. | (b), made precise: an answer sheet with provenance on every answer (asked, confirmed, chat, inferred, declined). | Essentials first (age range, distance pre-filled), then 6 core items (kids, one-or-open, smoking, drinking, food, faith) each with you / who'd be OK / importance, at most 3 musts; about 14 screens. | Filter; rank with inferred answers at half weight; a value-of-information question picker over the top 20; a per-pair "pair check" with a sequential stop; an Answer sheet screen. | Out of the decision path; code kept; one hidden run on real pairs if wanted. | Per-person sheet fill from chat (gated per item on at least 20 confirmations at 80%+); per-pair checks of free-text wants. | about $0.005-0.01 |

Every design found the same two bugs (the empty-pool interview and the "same as me" writer), the same zeroed `rank_score`, and the same invention incident.

### 5.2 How the judges scored them

**C (ask as little as possible) scored highest overall, A (evidence-first) second. The per-person proxy (B) scored lowest on every lens.**

Three judges each used one lens. Scores are out of 10.

| Design | User experience and trust | Buildability and cost | Evidence | Total |
|---|---|---|---|---|
| C. User-burden-first | 7.5 | 8 | 7 | **22.5** |
| A. Evidence-first minimalist | 6 | 7 | 8 | 21 |
| D. Shared answer sheet plus Jev | 7 | 5 | 5.5 | 17.5 |
| B. Grounded simulacrum | 4 | 3 | 4.5 | 11.5 |

What each judge said, in short:

- **User experience and trust.** C had the best time-to-value and the least chance of misrepresenting anyone, but every narrowed chip silently became a hard filter, the pre-filled age and distance were filters the user never chose, and the "About 1,240 people near you" counter was nearly all practice profiles. D had the best trust surface (an Answer sheet screen showing every answer and where it came from), but let chat-extracted values count as stated without a confirm. A had the strongest guarantee against invention, but its brief named the other person's private answers ("You drink sometimes; they never do"). B had the worst drop-off (about 25 screens) and kept a free-form conversation arm guarded only by a prompt, the same guard that failed.
- **Buildability and cost.** C had the best ratio of build to first measurement (0 model calls to onboard, two nullable columns, reuses the existing gate). But its all-hard rules meant `rank_score` would collapse to pure tag overlap, and its live counter would read 0 because `candidates.ts:25` needs the asker to be in the pool. A was the smallest build, but removing Ochiai while defaulting every accept-set to "all" would put the constant-zero bug back. D needed at least 4 migrations and two new modules. B needed 4 new user tables and months of work before it could say anything a small version could not.
- **Evidence.** A claimed only what the evidence allows and was the only design with an honest power calculation. C was the only design that dropped self-rated importance, the best-supported choice in the set. D's Akinator machinery was the founder's intuition in weak-transfer citations (20Q patent, prenatal-testing decisions, simulated 20 Questions). B invested most in what cannot be learned early: 8 hypothetical cards cannot fit about 10 personal weights, and card "fidelity" would mostly measure whether stated preferences agree with themselves.
- **One point cut against all four** (evidence judge): the case for dropping the conversations rests mostly on what happened in this repo (invention, cost, label contamination). The predictive evidence is thin: one preprint and one bargaining study. The winner should say so plainly.

### 5.3 Why the winner won

**C won on the combined score: it is the fastest for a new user, the cheapest to build, and the best supported on what not to ask. Its weak spots were patched with pieces from the others, and then the attack pass cut the patched version back down.**

- It is the only design that gives briefs in the first session and fits under the roughly 15-question drop-off point.
- Its required path makes 0 model calls, reuses the existing pool gate, and needs almost no new schema.
- It asks no "how important is this" question, which the evidence judge rated the best-supported single choice.

### 5.4 The merged design, before the attacks

**The merge kept C's short flow and added the best pieces of the other three. It was still too big, which the attack pass showed.**

A synthesis step took C as the base and grafted in: A's honesty rules, dealbreaker budget (up to 3, with "Even if everything else fit?"), random explore pick and power arithmetic; D's Answer sheet screen and per-item Jev accuracy gate; B's politics slot and 14-day retest. It resolved ten contradictions between the designs, for example:

- Narrowing "who's fine" would be soft; only a separate pick screen made a rule hard.
- `rank_score` would count fields both people answered, and a direction with no rules would count as fully met (1.0), not 0.
- A new `agent_ready` flag would sit next to `in_pool`, so the live counter kept working during onboarding.
- The core would be Basics plus 6 cards (kids, one-or-open, smoking, drinking, faith, food), with politics as the first daily question.
- The brief would name the other person's value only for public facts, and carry a "Not known yet" line.
- Nothing inferred would count until confirmed.
- About 250-280 decided real-vs-real pairs would be needed to compare ranked against random picks.

That merged design is what the four attackers went after.

---

## 6. The attack pass

**Four skeptics and one completeness checker attacked the merged design. They found that it leaked private answers, that its ranker would have buried real people under practice profiles, that its measurement plan would have "proven" the ranker through the brief's wording, that chat could still overwrite a card answer, and that almost everything it measured had zero possible input, because all real users are men seeking women. The final design is much smaller as a result.**

### 6.1 User and trust

**The promises on screen were not true: private answers leaked through seven side routes, and "passes your rules" was false for soft rules and for unknowns.**

Fatal:

- The "never public" limit leaked through routes that do not go through the agent: (a) kids answers `have_and_want_more` / `have_and_done` are in the public `wants_children` field (`facts.ts:76`, `values.ts:36`), so every parent's never-public `has_children` reached strangers; (b) card answers are saved with `source_quote = question + raw value` (`interview.ts:160`), for example "Children? have_and_done", and `loadQuotes` serves any public fact with a 12-300 character quote (`brief.ts:62-70`), so these became a real user's "own sentences"; (c) a missing "fits your rules on smoking" line tells you the other person's value; (d) a "Not for me" chip naming the field that differed; (e) "Keep this rule?" prompts that reveal specific people; (f) a per-rule "removes N people" count with real and practice split, an oracle in a pool of 0-10 real people; (g) a "Not known yet: faith" line reveals a declined faith answer.
- The headline promise "3 people who pass your rules both ways" was true only of hard rules. A random pick ignores soft rules by construction; the brief never names smoking, so the user finds out at the date; and unknown passes every rule, so a practice profile with no faith trait was declared a fit on faith.

Serious:

- The tap count was about half the real one. "Basics, one screen" is really the essentials wizard (`essentials-screen.tsx:208-232`), about 14 taps; the whole flow after consent is about 30-40 interactions, not 12-18. The design also removed the one moment of delight ("clone replies as you").
- Pre-ticking every "who's fine" row makes people look more open than they are (defaults stick), flattens the ranker, and corrupts the rule "narrowing near 0 means demote the card".
- Declining cost you (it failed other people's hard rules) while lying cost nothing, so the design paid people to lie.
- A cap of 3 hard no's does not fit a common Bengaluru profile (vegetarian, teetotal, non-smoking, same faith = 4).
- Users could not see or fix how they appear: only essentials, height and diet are editable (`fields.ts:49-84`); no endpoint changes a fact's disclosure although `facts.ts:68` says one exists; "Open" on monogamy is public by default.
- Cold start: the random pick is over 99% practice profiles; new users would see "0 real people" during onboarding.
- The scarce side gets flooded by real-first ordering before any exposure cap ships.
- A chat-to-dating pre-fill with no stated default for the Settings switch; "Right?" confirms measure agreeableness.

Fixes proposed: split has_children out or make `have_*` values non-public; exclude interview-origin quotes; one constant line on every brief; fixed "Not for me" chips; no real counts below a threshold and no per-rule real deltas; two explicit states per option instead of pre-ticking; honest length ("about 3 minutes, 25 taps") and keep the clone-reply hook; card edits and a "How you appear" preview in phase 1; explore pick from real survivors only; a weekly cap on real rounds shipped with the real pool; the chat switch off by default and pre-fill scored blind.

### 6.2 Overcomplication

**A read-only query showed all 6 real users are men seeking women. So everything that ranks, explores, learns or measures pairs has zero input. The design's ranker would also have pushed real people below practice profiles. Most of the rest already exists in the repo.**

Fatal:

- The pick stage buries real people. `candidates.ts:103-107` puts real people first, but `rank()` re-fetches with no ORDER BY (`score.ts:169-172`) and re-sorts by score (`:204`). The merged design scored a direction with no rules as 1.0; synthetic profiles have 0 preference rows, so every synthetic candidate got a perfect backward score. The random pick was uniform over about 5,008 synthetic against 5 or fewer real. Real-vs-real pairs would get rarer, not more common. The simple version (take the first K fresh ids in `candidateIds` order) cannot fail this way.
- Every ranking, measuring or learning part has zero possible input: 6 of 6 real users are men seeking women, 0 eligible real-vs-real pairs, and synthetic sides say yes automatically (`orchestrator.ts:375-397`).

Serious:

- `agent_ready` (new column, migration, candidates change, orchestrator change, synthetic backfill) exists only to keep a live counter working that would read 0 real people anyway. Adding the cards to the existing pool requirement (`profile.ts:146-160`) plus the existing "It needs a few more things" card (`matches-screen.tsx:120-126`, `fields.ts:127-130`) gives the same gate with no migration.
- Reordering screens is not needed to fix the bug. Returning a fixed CORE list right after GATING in `next-question.ts` is about 5 lines.
- The hard-no pick screen, cap, confirm and swap flow rebuild what `/preferences` already offers (Must have / Really want / Nice to have with a live pool count, `preferences-screen.tsx:24-28`). And soft rules change nothing at this scale: with 5 or fewer real survivors and 3 picks a round, every eligible real person is met within 2 rounds whatever the order. A soft rule only reorders practice profiles, and someone who narrowed smoking will still get a smoker's brief.
- "Declined" as a trait value adds behaviour in 4 places to guard against gaming in a pool of 6 men.
- The brief's 2 model calls would have empty quote lists to pick from (tap-only users have no quotes, `brief.ts:134-141`), and the opener is model-written prose, breaking the design's own rule.
- Phase 0 relied on an env var while the code default is 5 (`rendezvous.ts:43`): a fresh machine or a lost `.env` line brings the conversations and the invention harm back.
- The daily-question formula over a user's top 20 would be scoring synthetic profiles.
- The faith card is the most complex item, waits on a legal call, and no synthetic profile has a religion trait to test it against.
- Many phase 2-3 items have triggers the product cannot reach for months.

Fixes proposed: pick without `rank()`; move the explore arm, `pick_reason` and the rank rewrite behind "build when" triggers; add the cards to the existing pool requirement; fix CORE order in `next-question.ts`; make narrowed answers hard filters, loosened on `/preferences`; treat declined as unknown; a code-only brief with 0 model calls and no `llmFileScore`; conversations off by code default; 5 cards now, faith after the legal call. The number to watch: eligible real-vs-real pairs.

### 6.3 Science

**The design was humble about prediction but not about measurement. Its brief would have told ranked pairs "you both..." more often than random ones, so the one test of the ranker would have measured the wording. Several citations were read too strongly.**

Fatal:

- The brief changed with fit. "You both want marriage. You both want kids someday." appears only when answers agree, and ranked pairs are chosen for agreement. That manipulates perceived similarity, which predicts liking at every stage (Montoya 2008 r=.39; Tidwell et al. 2013). Telling people they match raised contact about as much as real compatibility (OkCupid 2014). True pair compatibility is 3% or less (Eastwick 2023). So a large ranked-vs-random gap would most likely come from the copy. The design removed verdict words and left in a verdict made of facts.

Serious:

- The explore arm would be almost all synthetic, and the two arms would come from different populations.
- The core cards are justified by who couples end up with (Alford), then judged on a second date, where Kurzban & Weeden found religion, education and income "played very little role". Core membership is a product judgement and should be labelled so.
- The yes/no is not on paper: it is tapped on the reveal screen with photos (`reveal-screen.tsx:176-179`; `0032_photos.sql:64-80`). A has_photo flag cannot absorb attractiveness (r of about .40).
- The learning plan ignored that pairs share people (actor and partner effects) and used the wrong sample-size rule. Riley et al. 2020, with 12 predictors and a weak signal (Cox-Snell R² of about 0.02), needs about 5,300 pairs; 100-120 mutual yeses is roughly 7x too few.
- The test was sized for an effect the design's own sources rule out: 30% vs 15% assumes ranking doubles mutual yes. A realistic 3-point lift (18% vs 15%) needs about 1,900 pairs per arm.
- The headline label is biased and too rare: `checkin_mutual_again` counts "no answer" as no (`0058_date_checkins.sql:72-74`), and see_again exists only for pairs who met. Roughly 15% mutual yes x 50% meet x 50% see again is about 4% of proposed pairs, about 10 events in 250-280 pairs.
- With everything pre-ticked, the ranker mostly scores look-alike files.
- The bank would be curated by what people say (narrowing rates), not by what they do.
- The age and distance defaults are the strongest filter and have no evidence behind them; Bruch 2016 found age thresholds differ by sex.

Overstated citations, corrected: RECON learned preferences from behaviour; Netzer & Srinivasan argue for a better importance question, not none; Zhou's 94% is single-script mode (the repo uses separate agents); the synthetic profiles are sampled, not LLM-written; PROMIS comparability holds only on the required fields; the "value of information" formula is entropy-style; Reise & Henson and Rashid do not really bear on factual cards; Joel 2020 studied established couples; Joel 2017's 0% is a non-detection in undergraduates; the IHDS 2.7% describes arranged marriages; kids were minority dealbreakers in Jonason; Park predicted survey answers, not partner choice; Volar is one closure; "file thickness, not fit" cannot be separated from template text; one-sided power is about 95 per arm, not 120; Hinge's 47% is company data.

Fixes proposed: the same fixed fields and line count on every brief, never "you both"; explore picks from real survivors only; a pre-photo "interested from the brief" tap as a cleaner label; random effects for chooser and chosen, AUCs bootstrapped by person; Riley-style sample sizes in pairs; ranked vs random reframed as a pre-registered futility check; see_again over all proposed pairs with non-response coded apart; a within-person test of whether breaking one's own rule lowers one's yes rate; log how often the age default is accepted.

### 6.4 Jev and fabrication

**Even with conversations gone, the design could still state things the user never gave grounds for: chat extraction silently overwrote card answers, "fits your rules" printed over unknown values, and "own sentences" were not proven to be the person's own words.**

Fatal:

- The chat extractor gets around "nothing inferred counts until confirmed". `extract.ts:223` stamps every chat fact `owner`; an owner fact becomes active and retires the current value on a single-valued field (`memory/facts.ts:170-185`), which can be the card answer. "I drink socially" becomes `drinking/'socially'`, `deriveValue` returns null (`values.ts:222-226`), the card value is retired anyway, and the person becomes unknown on drinking and passes everyone's drinking rule, while `question_answers` still says the card was answered.
- Code-written lines turn "unknown passes" into "fits". `match_pref_satisfied` returns true when the other side has no value (`0020:21`), yet the brief printed "Fits your rules on faith" about practice profiles with no faith value, and about 1 in 5 on smoking (synthetic traits are dropped about 20% of the time on purpose, `synthetic.ts:189-193`). A tracing test would pass, because the line traces to a template. Tracing to a source is not the same as being true.

Serious:

- Quotes are not proven to be the person's words. `source_quote` for chat facts is written by the extraction model, and transcripts include clone turns that "speak with their voice" (`chat.ts:33`). A first-person line the clone made up can come back as "their own sentence". Card answers save "question + answer" strings as quotes (`interview.ts:160`).
- Public open-tier facts (topic, did, believes; `facts.ts:80-81`) can quote "I quit drinking last year" or "I go to church every Sunday" even after "Prefer not to say" on the card, and no endpoint lets the person pull a quote back.
- The default dealbreaker mapper gets "no smokers" wrong (`dealbreaker.ts`, few-shot: "exclude often, sometimes"), so daily and rarely pass; the Jev path judges values in isolation and can return gaps.
- "Declined fails a hard rule" held only for `in` rules; sentence-mapped rules are `not_in` (`interview.ts:269`), and `NOT(wanted @> actual)` lets "declined" through (`0020:24`).
- The Jev pre-fill accuracy gate could never open (no guess is shown until it opens, so no confirmation arrives), and once open would measure agreement, not accuracy; a flat 80% is passed by always guessing the commonest answer.
- The pre-fill shape does not fit Jev (multi-valued fields, ordered fields, confidence meaning spread, no evidence sentence to show, politics eligible for inference).
- The Jev state was undefined and would probably be second-hand (extracted facts are already an LLM's paraphrase; raw episodes include clone turns).
- The brief opener was still model prose about a person; pointing at a quote index checks the pointer, not the text.
- Keeping `jev_file_score` as a baseline wastes Jev's only measurement on its weakest mode.

Fixes proposed: in `commit()`, stage chat facts on Basics and core fields as untrusted, never retiring an interview fact; three code-written states per rule ("fits" only for a known passing value, "not known yet" for null, nothing for hidden values) and "people who never smoke, or haven't said"; quotes only if the text appears word for word in a user-role episode, never from the interview; a missing disclosure endpoint; fix the few-shot and close frequency exclusions upward in code; store mapped rules as `in` over accepted values; score pre-fill blind in the background before showing any guess; one noul per option for multi-valued fields; user-role text only as Jev state; a template opener around a verbatim quote; drop `jev_file_score`.

### 6.5 Completeness critic

**The critic listed what nobody had covered: real pairs almost never form, rounds are not rate-limited, the reveal order biases labels, wants beyond the cards have no home, the town code still shows verdicts, and the design contradicts the founder's recorded strategy without saying so.**

- Real-vs-real pairs will almost never form (the `rank()` re-sort and a synthetic-heavy random pick), so the measurement plan cannot be reached.
- Nothing limits how often rounds run for normal tenants (`turn_cap` null, `metering.ts:33-50`; the $2 daily cap stops nothing at about $0.005 a round). A pair meets only once, so a user who keeps tapping uses up a small real pool in days. No estimate of how many real users are needed, and the founder's recorded idea of Ditto-style one-a-week scarcity was not addressed.
- The sequential reveal biases labels. When the first mover says no, the pair lapses and the second person is never asked (`orchestrator.ts:420-426`), and `compare-scorers` only counts pairs where both answered (`:62`). A first-mover no must count as a mutual no. The power maths treats pairs as independent though people repeat. Check-in non-response is not random.
- "Users must be able to add more" is answered only for facts about themselves, not for wants ("someone outdoorsy", "must love dogs"). The founder should be told plainly.
- With everything pre-ticked, the ranker may flatten again; guard test "rank > 0" does not check spread.
- The town and world code was left out of phase 0: "Your agents got on" in `agent-sheet.tsx:18-43`, the verdict bubble (`bridge.ts:79,92`; `world.ts:228`). With conversations off, every sheet would read "could not tell". Targeted "send my agent over" rounds (`dating.ts:750-790`, priced "~$0.02 each") are a fourth way pairs are picked.
- The cap of 3 and "no mild" were not enforced where rules are written: `POST /v1/preferences/strength` (`dating.ts:374-409`) accepts `mild` and promotes any rule with no count check. `satisfies()` in `values.ts:237` must change in step with the SQL.
- The kids card leaks has_children, and "fits your rules" can claim a fit nobody checked.
- Lying and strategic answers were not considered; the check-in only asks about what the reveal showed (photos, age, name, city, 2 tags; `checkin/questions.ts`).
- The daily adaptive question would be tuned to synthetic people.
- One core for every intent was never questioned (Jonason: faith and goals matter much more for long-term).
- The clash with the founder's recorded strategy (agent-to-agent talk plus importing a person's AI memory as the edge over Ditto and Wavelength) was never addressed. A pasted AI-memory export could pre-fill the core cards as 1-tap confirms.
- Single or weak sources carry real weight: the Jev phishing bench (one repo, fitted on labels we lack); one preprint for cutting conversations; Whyte & Torgler's "<1%" from press coverage; the core resting on US spouse data plus one IHDS figure, with no Indian dating-app data; an unsourced 30% vs 15% effect; vendor-reported benchmarks.
- Nothing gives evidence before there are many real users. Cheap options: replay filter-then-rank on the public Columbia speed-dating data (8,378 dates, OpenML 40536), or a few moderated usability sessions.
- Smaller choices were made silently over open founder decisions: 15 km distance (his 10 km vs whole-city call is open), own age ±5 for everyone (ignores the sex difference), and nonbinary and same-gender pools are thinner while every cited speed-dating study is heterosexual.

### 6.6 What changed after the attacks

**The design got smaller and stricter. 19 changes, each tied to an attack.**

1. Every "who's fine" narrowing is now a hard filter. The soft level, the separate hard-no screen and the cap of 3 are gone. With 5 or fewer real survivors, soft rules only reorder practice profiles, would break "passes your rules", and a random pick ignores them.
2. The brief is written entirely by code, with 0 model calls. Every pair gets the same line, "Passes your rules both ways, on everything they've answered". It never names a core value except intent. This fixes the wording-varies-with-fit problem and the has_children leak.
3. The model-written opener is replaced by a template around a verbatim quote. The model-written "shared" phrase is gone.
4. Quotes must appear word for word in a user-role episode. Interview-origin facts are excluded. The person can hide any quote on a "How you appear" preview, which needs the disclosure endpoint `facts.ts:68` promises.
5. Chat extraction can no longer overwrite a card answer. Chat facts on Basics or core fields are staged as untrusted and cannot retire an interview fact.
6. Picking is real-first from `candidateIds` order, without `rank()`.
7. Removed from phase 1: the explore arm, `pick_reason`, the rank rewrite, `agent_ready`, migration 0061, "declined" as a trait value, the daily-question formula, and Jev pre-fill. They return behind read-only-query triggers.
8. The cards join the existing pool requirement (`profile.ts:146-160`); the existing missing-fields card and `setupRoute` are reused.
9. Onboarding order stays. The bug is fixed where it lives: fixed CORE order after GATING in `next-question.ts`.
10. Faith is cut from the core until the founder's legal call. The core is 5 cards on existing enums.
11. "Who's fine" is no longer pre-ticked. One explicit tap: "Anyone is fine" or "Let me choose".
12. Declined is treated as unknown. Making it fail other people's rules would pay people to lie.
13. Mapper fixes: the few-shot, frequency exclusions closed upward in code, and mapped rules land only on card fields.
14. Conversations are off by code default, not env alone. Verdict text is removed from the town and world code too. `llmFileScore` is stopped.
15. The real-exposure cap moved into phase 1.
16. Counts are real plus practice combined, rounded, never below 20 real.
17. Measurement fixes: first-mover no counts as mutual no; see_again over all introduced pairs with non-response coded apart; person random effects; Riley sample sizes; ranked vs random as a futility check.
18. Citations corrected (see 6.3 and the correction notes in section 4).
19. The tap count is stated honestly (about 25, an estimate), and the "clone replies as you" hook is kept.

---

## 7. The final design in full

**The smallest honest system, built on pieces that already exist. Your agent is a record of the Basics plus 5 cards (you, and who's fine). Code checks two records both ways. An option you untick means those people never appear. Real people come first. The brief is written by code and reads the same for every pair. Both humans decide. The 72-hour check-in is the outcome that counts. It costs $0 per round and needs no Jev and no migration.**

Why this and not the richer merged design: 0 real-vs-real pairs are possible today, so anything that ranks, explores, learns or measures pairs has no input. Those parts wait behind "build when" triggers, each tied to a read-only query.

This section is the spec being built now (phases 0 to 1c).

### 7.1 The agent model

**Option (b) now. (c) only later, and only learned from real decisions. (a) never, for matching.**

The agent is a record, not a persona. For each shared field it holds your answer, who you'd be fine with, and where the answer came from (asked, confirmed, or declined). Code reads it. No model speaks as you or judges for you.

- Stated preferences do predict choices made on paper and who people consider (Eastwick et al. 2014 meta-analysis, k=97; Gerlach 2019; Bruch, Feinberg & Lee 2016, where screening on hard cutoffs fit behaviour better than weighing everything together).
- They do not predict pair-specific chemistry (Joel 2017).

Not (a), a mimic:

- A bullet list of facts predicted as well as a 2-hour transcript (0.83 vs 0.85; Park et al. 2024). This was on survey answers, not partner choice.
- On anything the person never answered, twins fall back to a stereotype (arXiv 2509.19088).
- Here, it invented facts that reached a real card.

(c) only later, and only learned:

- It comes from pooled real decisions and see-again outcomes, with the person as a random effect.
- Realistic sample sizes are thousands of pairs (Riley 2020), not 100 yeses.
- It re-ranks only. It never excludes anyone.

What changes for the story: the honest claim becomes "my agent knows my no's and only brings people who pass them both ways, on everything they've answered."

### 7.2 What the agent may and may not do

**It may hold your answers and apply your rules both ways. It may not write a sentence about anyone, name a private answer, talk to another agent, decide for you, or change a rule by itself.**

| | Rule | Why, or where in the code |
|---|---|---|
| MAY | Hold, for each shared field: your answer, the options you'd be fine with, and where the answer came from (asked / confirmed / declined). | OkCupid's answer / acceptable shape, without the importance slider. |
| MAY | Exclude a person only through a rule you set: the Basics (gender, age range both ways, distance, intent) or an option you unticked on a card. Rules apply both ways. A person who hasn't answered passes, and the copy says so: "people who never smoke, or haven't said". | `candidates.ts:48-87`; NULL passes at `0020:21`. |
| MAY | Say "unknown" for any field without an answer. Code skips it. No model ever guesses a value that can filter someone. | Models guess rather than abstain (Kalai 2025). |
| MAY NOT | Let chat extraction overwrite a card answer. A chat fact on a Basics or core field is staged as untrusted, waits for a 1-tap confirm, and never retires a fact from the interview. | Fixes `extract.ts:223` (every chat fact marked `owner`) and `memory/facts.ts:170-185` (which retires the card answer). |
| MAY | Show the other human up to 2 of its person's own sentences. Each must appear word for word in a user-role episode, must not come from the interview, and must not be one the person hid on the "How you appear" preview. | Today `brief.ts:62-70` serves strings like "Children? have_and_done", built at `interview.ts:160`. |
| MAY NOT | Write any sentence about a person. The brief is fixed code templates, the person's own verified quotes, and shared public tags, with 0 model calls. The opener is a template around a quote or tag ("Ask them about: ..."). | The invented comedy-writer life (3.5, fact 3). |
| MAY NOT | Name any core-card value on a brief except relationship intent. Smoking, drinking, faith, politics, kids and monogamy are never named. Every brief carries the same line, "Passes your rules both ways, on everything they've answered", so the wording never varies with fit. | `WANTS_CHILDREN` includes `have_and_done`, which reveals never-public has_children (`values.ts:36`). Wording that varies with fit contaminates labels (6.3). |
| MAY NOT | Show real-person counts below 20, or how many people a single rule removes. Pool counts are real plus practice combined, rounded to the nearest 10. | Otherwise rules can probe another person's private answers (6.1). |
| MAY NOT | Hold a conversation with another agent on the default path, show a percentage or verdict words, or forecast chemistry. | 7.6; OkCupid 2014; Joel 2017. |
| MAY NOT | Say yes, message, or accept a date for its person. Both humans tap yes, and the busier side still decides first. | `brief.ts:306`. |
| MAY NOT | Change a rule by learning. Only the person edits rules, on the existing `/preferences` screen and on card edits. | People state stricter rules than they act on (Joel, Teper & MacDonald 2014). |
| MAY NOT | Filter on caste or community. Faith is not a card until the founder makes the legal call. No model ever makes a filter decision. | LLMs carry same-community priors (Naik et al. 2026). |

### 7.3 Onboarding

**Keep the current screen order and fix the question picker. Everyone answers 5 cards, each with an explicit "who's fine" tap. The agent can go out only when all 5 are answered or declined.**

The bug is `next-question.ts:40` and `:131`: with an empty pool every chip scores 0. The fix: after GATING, return a fixed CORE list in order, the same way GATING is handled at `:107-108`. Then the optional sentence, then null. No entropy picking during onboarding. That is about 5-20 lines. The interview-then-essentials order and the routes (`start-screen.tsx:100`, `paste-screen.tsx:54,82`) stay.

**Core: 5 cards on existing enums, one per screen.**

1. Kids (`WANTS_CHILDREN`).
2. One person or open (`MONOGAMY`).
3. Smoking (`FREQUENCY`).
4. Drinking (`FREQUENCY`).
5. Food (`DIETS`).

Each card:

- A "You" row, with "Prefer not to say".
- A "Who's fine" row, NOT pre-ticked. One explicit tap: "Anyone is fine" or "Let me choose". Defaults stick (Johnson & Goldstein 2003), and a pre-ticked row makes people look more open than they are.
- Any option unticked becomes a hard filter, stored as a preferences row `{operator 'in', value [accepted], strength 'dealbreaker'}`.
- "Anyone is fine" writes no rule but is recorded as a choice, separate from "untouched".
- This replaces the "same as me" writer at `interview.ts:198-208`.

Why hard, with no separate hard-no screen or cap: at today's scale a soft rule only reorders practice profiles. A person who unticked smokers and then gets a smoker reads it as the agent ignoring them. The loosening path already exists: `/preferences` (`preferences-screen.tsx:24-28`) with a live pool count.

Faith waits for the founder's legal call. If added: which faith plus who's fine, NEVER_PUBLIC, no importance half. Politics stays optional.

**Essentials.** Add 2 pre-filled age-range fields, and let `/v1/essentials` accept `age_range_sought`. Nothing writes it today (`profile.ts:93-97`), so the age filter runs one way for real users. The pre-fill is own age ±5, visible and editable. Log how often it is accepted unchanged. The distance default is the founder's open 10 km vs whole-city call; do not silently set 15 km.

**Optional sentence ("Anyone else you couldn't be with?").**

- The mapper proposes unticked options on an existing card, shown as editable chips. It never adds a rule on a field nobody is asked.
- Fix the few-shot in `dealbreaker.ts`: "someone who smokes" must exclude rarely, sometimes, often and daily. Today it leaves out daily (and rarely).
- In code, close frequency exclusions upward: excluding one level also excludes every more frequent level.
- If nothing maps: "We can't check this on paper. You'll spot it in the first chat."

**Send gate.** Add the 5 core fields to the pool-required list (`profile.ts:146-160`). A card counts as done when it has a `question_answers` row, answered or declined. No new column, no migration. The existing "needs a few more things" card on Matches (`matches-screen.tsx:120-126`) and `setupRoute` (`fields.ts:127-130`, changed to route to the interview) bring the 6 existing users back. For the founder: open Matches on each phone, tap the card, answer the 5. Self-test, voice, photos and character gate nothing, and the self-test copy must stop implying they do.

**Send screen.**

- A code-written readback: "I'll only bring you people who want marriage, are 26-34, and never smoke or haven't said."
- A "How you appear on a brief" preview, with a hide button on each quote.
- This needs the missing endpoint that changes a fact's disclosure, which `facts.ts:68` already promises.
- Card answers become editable from the profile. Today only the essentials, height and diet are (`fields.ts:49-84`). (The build order in section 9 puts card edits in phase 2; the spec lists them here as well.)

**Honest length.** About 25 taps after consent plus typing year and city. Roughly 3 minutes, an estimate to be measured. The copy says "a few quick questions", never "six". Change "it will not make you fill in a form" (`start-screen.tsx:107-108`).

**Keep the hook.** The "clone replies as you" moment at the door stays (2 calls, about $0.0008). It is the delight, and it gates nothing.

**Free-form information.** Chat, tell and paste keep writing facts about the self. They feed only two things: quotes (after the verbatim check and the person's preview) and, later, confirm cards for blank optional fields. A pasted AI-memory export could pre-fill the 5 cards as 1-tap confirms. That is the natural bridge to the founder's import idea (phase 3).

### 7.4 The question bank

**One shape for every question: your answer, and who's fine, over the same closed options. 7 Basics and 5 cards are required. Everything else is optional and never filters unless the person unticks something.**

Shape (`questions.ts`):

```
{ id, predicate, tier: basics | core | optional | free, mine: closed options, whoFine: multi-select over the same options, declinable }
```

It sits on the existing closed predicates (`facts.ts:106-188`) and enums (`values.ts:29-42`).

| Tier | Fields | Rule |
|---|---|---|
| Basics (required) | gender, seeking_gender, birth_date, lives_in (+ area), relationship_intent, age_range_sought, max_distance_km | Built-in symmetric filters. |
| Core (required, declinable) | kids, monogamy, smoking, drinking, food | Unticked "who's fine" options are hard filters. |
| Optional (asked later) | politics, relocation, languages, exercise, education, works_in, sleep, spending, media, transport, interests | Never filters until the person unticks. Education and work are never ranked as a ladder. |
| Free | the dealbreaker sentence, prompts, tell, chat | Mapped onto cards only with confirmation; otherwise kept as the person's own quotes. |

Why these five core cards:

- They are dealbreakers people can check on paper (Jonason 2015; Bruch 2016).
- Couples sort on them (Alford 2011, US spouses: drinking .60, smoking .21, observance .71).
- They are a product judgement, not proof that filtering on them improves dates.
- Food is in on local judgement.

Storage:

- "Mine" becomes a fact (`interview.ts:152-166`).
- A narrowed "who's fine" becomes an `in` dealbreaker.
- Declined is stored as `predicate_status 'declined'` and treated as unknown everywhere. Revisit only if real decline rates pass 30%, because making declines costly pays people to lie.
- `mild` is never written. The strength endpoint (`dating.ts:374-409`), which still accepts `mild`, is kept for loosening.
- Remove `q-diet-pref`, `q-kids-pref`, `q-smoke-pref` and `q-religion-pref` (`questions.ts:101-175`). Today a daily smoker who answers "No" to "Could you be with a smoker?" gets a rule only daily smokers pass.

Trekking vs waffles:

- Both people always answered the same 7 Basics and 5 cards, so the comparison on those is exact code.
- Trekking and waffles are shown to the other human as quotes: conversation material, not a verdict.
- Optional items are separate fields with no shared scale, so like-for-like comparison exists only on the required fields. That is the honest limit.

Wants beyond the cards ("someone outdoorsy", "must love dogs"): not supported in phase 1, and the founder should know this. Later, once real survivors outnumber picks, a free-text want becomes one-direction Jev yes/no checks against each shortlisted candidate's own facts, used to rank, never to exclude.

How the bank changes: by measured decline rate and "chose narrowing" rate (among people who actually chose, not defaults). Once real explore pairs exist: a within-person test of whether breaking a stated rule lowers that person's yes rate.

### 7.5 The matching pipeline

**Gate, filter in SQL, pick real people first, brief by code, humans decide, check in after the date. No model calls anywhere in a round.**

| Stage | What happens |
|---|---|
| 0. Gate | `in_pool`, now including the 5 cards. Plus a real-exposure cap: a person appears in at most about 5 new real rounds a week. The cap ships with the real pool, not later, because in a small pool real-first ordering floods the scarce side (Bruch & Newman 2018). |
| 1. Filter (SQL, no model) | `candidates.ts` unchanged. Now fed with age both ways, `in` dealbreakers from the cards, and a mapper fixed to close frequency upward. |
| 2. Pick | Take the first K fresh ids in `candidateIds` order: real first, then most recent (`candidates.ts:103-107`). Do not re-sort through `rank()`: its re-fetch has no ORDER BY (`score.ts:169-172`) and its sort (`:204`) buries real people under 5,008 synthetic ones. `rank_score` may still be logged, re-fetched with ORDER BY `array_position`, but it does not pick. |
| 3. Brief (code only, 0 model calls) | Intent, age, area; shared public tags; the constant line "Passes your rules both ways, on everything they've answered"; up to 2 verified, unhidden quotes; a template opener. No concern text, no verdict, no number. Display order: newest round first, then a hash of the id, not agreement (`dating.ts:453`). |
| 4. Humans | Unchanged. For measurement, a first-mover "no" counts as a mutual no. Today it lapses silently (`orchestrator.ts:420-426`) and drops out of `compare-scorers` (`:62`). |
| 5. Outcome | The 0058 check-in. Report see_again over all introduced pairs. Code "no response" separately; `checkin_mutual_again` lumps it in with "no". |

**Akinator.** Not between agents: it converges only when a fixed answer exists, and "will they click" has none. Once both people answered the same cards, the comparison is a lookup. Entropy picking returns later only for one optional question a day, when real pools exist.

**Jev.**

- Not in the default path.
- Not for filters, rank, numbers, comparing two stated answers, or anything a human reads.
- Kept: the adapter and `llm.decide`. The dealbreaker mapper may use it, but only proposes, and the person confirms.
- Later, after the privacy text names TypeSafe: (1) a fail-closed check that hides quotes which may reveal faith, politics, health, smoking, drinking or kids, where a false positive only hides a quote; (2) pre-filling blank optional fields from user-role text only, one yes/no per option for multi-valued fields, never NEVER_PUBLIC fields, pinned to `jev-1.13.0`, and scored blind in the background against blank answers before any guess is shown.
- `jevFileScore` stays off. One broad question is Jev's weakest mode (62.6% vs 95% for fitted narrow questions, on one independent phishing benchmark).

**Build when** (read-only query triggers):

- Ranking among real survivors plus a real-only random pick: when median real survivors per real user exceeds weekly picks.
- Pooled weights: at thousands of decided real pairs, fitted with person random effects.

### 7.6 Agent-to-agent conversations

**Off now, by code default. Deleted once the new flow passes its tests; git keeps the history. They come back only as a hidden A/B on real pairs, which needs many hundreds of decided pairs. This goes against the founder's recorded differentiator, so it is his call.**

Step one: change the code default in `rendezvous.ts:43` from 5 to 0. An env var alone is not enough: a fresh machine or a lost `.env` line would bring the conversations back. (Or remove the `converse()` call at `orchestrator.ts:258`.) Guard test: a round writes 3 briefs, no concern, agreement null.

Step two: remove the verdict and concern text everywhere it appears:

- `matches-screen.tsx:203-216, 244`
- `app/src/features/world/agent-sheet.tsx:18-43`
- the town verdict bubble (`bridge.ts:79,92`; `world.ts:228`)
- the "~$0.02" price on targeted "send my agent over" rounds, which now cost $0.

Also stop `llmFileScore` (`orchestrator.ts:249`). It is logged only on real-vs-synthetic pairs, which never transfer.

Why:

- Harm: an invented comedy-club life reached a real user's card, and the only guard was a prompt line (`rendezvous.ts:84`).
- Cost: 60 of 63 calls per pair.
- Label contamination: agreement is shown as words and orders the list.
- Designed to miss the point: the prober is told never to ask what the other person wants (`rendezvous.ts:81`).
- It tracks how rich a file is: 0.79 on synthetic-vs-synthetic pairs vs 0.16 on real-vs-synthetic. (The science attack notes file richness and the synthetic template text vary together, so "not fit" cannot be proven either.)

The predictive evidence is thin either way: one preprint found simulated dates tie plain regression (AUC 0.60 vs 0.61). The core logic: a conversation holds no information that is not already in the two files.

The town keeps the "agents met" feeling at $0, with template bubbles that carry no values and no dialogue.

### 7.7 Keep, change, cut

**Most of the system stays. Phase 0 switches off the conversations and the verdict text. Phase 1 fixes the questions, the brief, the picking and the measurement, with no migrations.**

Keep:

- `facts.ts` vocabulary and disclosure sets.
- `values.ts` enums and `satisfies`.
- `candidates.ts` filters and `poolBreakdown`.
- `0020` `match_pref_satisfied`.
- The facts/preferences split.
- The `/preferences` screen with its live pool count.
- `brief.ts` `busierSide`.
- `orchestrator` `decide()` and the intro when both say yes.
- 0058 check-ins.
- `compare-scorers` and `evaluate`.
- `dealbreaker.ts`, with its prompt fixed.
- The Jev adapter, off.
- The personal clone chat, voice and self-test, on the personal side only.
- The start-screen clone moment.

Change, phase 0 (today):

- The `rendezvous.ts:43` default becomes 0.
- Remove the verdict and concern text in matches-screen, agent-sheet, bridge and world.
- List order at `dating.ts:453`.
- Stop `llmFileScore`.

Change, phase 1:

1. `next-question.ts`: fixed CORE after GATING.
2. `questions.ts`: 5 cards with mine + whoFine. Delete the 4 "same as me" preference questions.
3. `interview.ts:193-217`: write `in [accepted]` as a dealbreaker; "Anyone is fine" writes nothing. Delete the false claims at `:233-236` and `dealbreaker.ts:12-17`.
4. `dealbreaker.ts`: fix the few-shot, close frequency upward in code, map onto card fields only.
5. Essentials: accept `age_range_sought`.
6. `profile.ts:146-160`: the 5 cards join the pool requirement. `setupRoute` goes to the interview.
7. `memory/facts.ts` `commit()`: chat facts on Basics or core fields are staged as untrusted and never retire an interview fact.
8. `brief.ts`: all code, 0 model calls. Quotes need a verbatim match in a user-role episode, and interview-origin facts are excluded. No core values except intent. One constant line.
9. A new endpoint to change a fact's disclosure, plus the "How you appear" preview on the Send screen.
10. Pick real-first without `rank()`.
11. A weekly real-exposure cap.
12. `compare-scorers`: first-mover no counts as mutual no; see_again over all introduced pairs.
13. Docs: `HOW-IT-WORKS.md:46-47`, `:53` and §8a; CLAUDE.md's "three" scores should read four.

No migrations are needed for phase 1. If a later one is added, it follows the header rule in CLAUDE.md.

Cut, once the new flow is tested: rendezvous `runOnce`, the prober and assessor prompts, `synthetic-voice.ts` "ordinary week", `completion.ts` `askNext`, and entropy picking in onboarding.

Deferred, out of the plan until a trigger fires: the explore arm, `pick_reason`, the rank rewrite, the daily-question formula, Jev pre-fill, the Answer sheet, "Teach your agent".

Guard tests. Each plants the failing case and fails on today's code; negative control per CLAUDE.md; model stubbed with `vi.mock('../src/llm/index.js')`.

| Test | What it plants and checks | Phase |
|---|---|---|
| (a) | A fresh user is offered all 5 cards in order. | 1a |
| (b) | A daily smoker who accepts only [never] excludes daily smokers, and an unknown still passes. | 1a |
| (c) | Card drinking = sometimes, then chat saying "I drink socially": the trait stays "sometimes" and a pending confirm exists. | 1b |
| (d) | Brief text never contains have_and_done, smoking, drinking or monogamy values, nor a "Question? value" string. | 1b |
| (e) | A made-up first-person clone turn never becomes a quote. | 1b |
| (f) | A round with the default settings makes 0 model calls and writes 3 briefs. | 0 |
| (g) | A real survivor is picked before any synthetic one. | 1c |
| (h) | The mapped rule "no smokers" excludes rarely through daily. | 1c |
| (i) | A user missing one card is neither sent out nor a candidate. | 1a |

### 7.8 Learning over time

**Nothing learns statistically yet, because nothing can: there are 0 real pairs. For now, collect clean labels. Learning comes in stages, each gated on real data, and it only ever re-ranks.**

Now (0 real pairs possible): the person changes their agent through card edits and `/preferences`. Collect:

- brief yes per side;
- first-mover no, counted as a mutual no;
- met;
- see_again over all introduced pairs, with non-response coded separately.

Nothing measured on synthetic pairs counts: synthetic sides say yes automatically (`orchestrator.ts:375-397`).

Phase 2 (once real women exist):

- One optional question a day, from a fixed list.
- "Not for me" chips from a fixed list, identical for every pair and never built from the field that differed.
- A 14-day retest of 2 core items, to learn each person's own consistency ceiling.
- "Were they what your agent said on paper?" added to the check-in, asking only about fields the brief showed.

Later:

- Ranking and a real-only random pick, once survivors outnumber picks.
- Analysis uses person random effects (actor and partner), and AUCs are bootstrapped by person.
- Ranked vs random is a pre-registered futility check. At about 280 pairs it can see only a lift of roughly 15 points. A realistic 3-point lift needs about 1,900 pairs per arm.
- Pooled weights need thousands of decided pairs (Riley 2020), not 100 yeses.
- Learning re-ranks only. It never removes anyone and never edits a rule.
- The exposure cap is already in place before any of this.

### 7.9 Cost

**Today a round costs about $0.055, almost all of it agent conversations. After the change a round costs $0 in model calls.**

| | Today (measured, read-only, 2026-09-23) | Proposed |
|---|---|---|
| Per round | about $0.055 (6 rounds, max $0.065); about 189 calls at K=3; conversations about 95%, $0.0199 per pair | $0 in model calls: filter, pick and brief are SQL and TypeScript |
| Onboarding, required path | 0 calls in the interview; the start screen spends 2 | 0 calls |
| Start-screen clone moment | 2 calls | kept as the hook, 2 calls (about $0.0008) |
| Optional sentence | 1 mapping call | 1 mapping call (about $0.0004) |
| Later Jev (estimate from the $0.042/MTok price) | none | quote screen well under $0.0001 per brief; pre-fill about $0.0008 per full fill; never run over the synthetic profiles |
| 1,000 users x 1 round a day x 30 days | about $1,650 | about $0 in rounds |

The Seeker test account's daily cap stays as it is.

### 7.10 How we will know it works

**Every number comes from a read-only query run at report time. Right now there are only three things to check. The number that matters next is eligible real-vs-real pairs, which is 0 today.**

Now, at 6 real users:

1. The 6 real users each have 5 card answers (today 0 of 6).
2. Round spend is $0.
3. The guard tests pass.

The number that matters next: eligible real-vs-real pairs. Today 0, because 6 of 6 real users are men seeking women.

At 20-30 real signups:

- Median consent-to-in_pool time, and drop-off per screen.
- Decline rate per card: over 30% means reword.
- "Chose narrowing" rate per card, among people who chose.
- How often the age default is accepted unchanged.
- Share of users whose rules leave fewer than 10 real people.
- A few moderated sessions watching people use the flow would help sooner. They cost no model money.

Outcomes:

- Mutual yes, met and see_again over all introduced pairs, with check-in response rates reported.
- The first read is a smoke test only.
- The founder's bar is to beat about 20% match-to-date. Ditto's 20% and Known and Keeper's about 50% are self-reported.

Trust:

- By tests: no core values and no unverified quotes on briefs.
- By the check-in question "what your agent said on paper?", once it ships.

Scorers: `compare-scorers` stays as the referee. Under 10 labelled pairs it prints a smoke test only. Expect near 0.5 on pair-specific yes; the core's job is filtering.

Optional, $0: replay filter-then-rank offline on the public Columbia speed-dating data (8,378 dates), with no model. It shows how the ranker behaves before real data exists.

### 7.11 Risks

**The story gets smaller, the supply of real women is the blocker, and hard filters on small pools can empty them. Each risk has a mitigation or is named as the founder's call.**

- The story gets smaller. "My clone dates for me" becomes "my agent knows my no's". This goes against the founder's recorded differentiator (agent-to-agent talk plus importing AI memory). It is his call.
- Supply, not design, is the blocker. All real users are men seeking women. Nothing about matching can be learned until real women join.
- Hard filters on small real pools can empty them, and people state stricter rules than they act on (Joel, Teper & MacDonald 2014). Mitigation: explicit "Let me choose", a combined rounded pool count, easy loosening on `/preferences`, and an honest message when 0 real people fit.
- Unknown passes. A person who never answered a field passes that rule, and a liar passes everything. The copy says "or haven't said". Declining is kept cheap so honesty isn't punished. The check-in question "what your agent said on paper?" is the only check.
- Privacy leaks by inference. Any filter reveals a little ("they passed your rule"). Mitigation: the same line on every brief, no per-rule counts, no real counts below 20, no field-specific "Not for me" chips.
- The first session is longer than today's 4 answers: about 25 taps. Measure drop-off per screen.
- The 6 existing users, including both of the founder's phones, drop out of candidate lists until they answer the 5 cards.
- Nobody can predict chemistry before a meeting (Joel 2017; Joel 2020). Never sell "finds the one".
- The core rests on US spouse data (Alford 2011) and local judgement, not Indian app data. Faith, community and gender-specific age defaults remain open.
- Same-gender and nonbinary pools are thinner. Hard filters empty them faster, and every cited speed-dating study is heterosexual.
- Jev is unmeasured here (0 calls). It is English-first, a new subprocessor, and its calibration is only claimed by the vendor. It stays out of the default path.

---

## 8. Open questions for the founder

**Nine decisions only the founder can make. The first two matter most: whether to accept the smaller story, and how real women will get into the pool.**

1. Agent-to-agent conversations were your recorded differentiator. The evidence and this repo say to turn them off. Do you accept the smaller story ("my agent knows my no's"), or keep conversations as a hidden A/B for later?
2. How will real women get into the pool? Nothing can be learned until eligible real-vs-real pairs exist, and today there are 0.
3. Faith (which religion), politics, and any community option: offer them as filters or not? This is a legal and ethical call, raised once here.
4. Round cadence: one pick a day, or Ditto-style one a week? A pair meets only once, so a small real pool runs out fast.
5. Distance default: 10 km or the whole city? Age default: the same ±5 for everyone, or different for men and women?
6. Should people looking for something casual also answer the kids card, or skip it?
7. Should synthetic profiles be reseeded with core answers by code ($0), so practice briefs look complete?
8. Add "eggetarian" and "jain" to the food options?
9. Update the privacy text to name TypeSafe before any Jev use?

---

## 9. Build order

**Phases 0, 1a, 1b and 1c are being built now. Phases 2 and 3 wait for their triggers; the first trigger is simply real women in the pool.**

| Phase | What it proves | What is in it | Guard tests | Status |
|---|---|---|---|---|
| 0 (today) | Spend drops to about $0, and no more invented facts reach a card. | Code default of 0 conversations; verdict and concern text removed from matches, agent-sheet, bridge and world; list order no longer uses agreement; `llmFileScore` stopped. | (f) a round makes 0 model calls and writes 3 briefs | Being built now |
| 1a | Real users finally get the shared questions. | Fixed CORE order in `next-question.ts`; 5 cards with "you" and "who's fine"; `in` dealbreakers; the "same as me" questions removed; the 5 cards added to the pool requirement; `setupRoute` sends people back. Then answer the 5 cards on both phones. | (a), (b), (i) | Being built now |
| 1b | The brief cannot leak or invent. | Code-only brief; quote verification; the disclosure endpoint; the "How you appear" preview; chat cannot overwrite a card answer. | (c), (d), (e) | Being built now |
| 1c | Real people come first and nobody gets flooded. | Real-first picking; the weekly real-exposure cap; the mapper fixed; age range in essentials; the `compare-scorers` label fixes. | (g), (h) | Being built now |
| 2 | Onboarding works and outcomes can be read. | Funnel metrics at 20-30 signups; check-in "what your agent said on paper"; fixed "Not for me" chips; one optional question a day; card edits in the profile. | Written when built | Waits for real women in the pool |
| 3 | The parts that need real data. | Ranking plus a real-only random pick when survivors outnumber picks; the Jev quote screen and blind pre-fill after the privacy text names TypeSafe; pooled weights at thousands of decided real pairs; a conversation A/B only if the founder wants it. | Written when built | Waits for its read-only-query triggers |

Every fix in phases 0 to 1c ships with a guard test that plants the failing case and fails on the old code, with the negative control (revert the fix, watch the test fail, restore it) run and reported, per CLAUDE.md.

---

## 10. Sources

**Every URL cited anywhere in the research, once each. Where one paper was cited at several addresses, they share a line.**

### Cited by the founder

- https://en.akinator.com/ — Akinator, the question-by-question guessing game the founder used as the model.
- https://typesafe.ai/blog/introducing-system-one-models-and-jev — Typesafe launch post for System One and Jev: typed answers with probabilities, price, latency, and the vendor's calibration claim.

### Typesafe Jev documentation and tests

- https://docs.typesafe.ai/api.md — API reference: noul, choice and score question types; state as string, object or array; error codes.
- https://docs.typesafe.ai/models.md — Models page: jev-1.13.0 and jev-latest, $0.042 per million input tokens, 64k/32k token limits, rate limits, no per-customer tuning, zero retention for enterprise only.
- https://docs.typesafe.ai/primitives.md — The three question types; questions in one request are answered in isolation.
- https://docs.typesafe.ai/primitives/noul.md — Yes/no type: 0.5 means "equally likely"; split two conditions into two questions; one question per record.
- https://docs.typesafe.ai/primitives/choice.md — Closed choice over up to 255 options with probabilities and a spread-based confidence.
- https://docs.typesafe.ai/primitives/score.md — Rubric score over 2 to 10 ordered levels.
- https://docs.typesafe.ai/model-jaggedness/jev-1.13.md — Known weak spots: literal reading, numbers, dates, multi-hop, long unrelated state, text that argues for itself, negations that do not sum to 1.
- https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md — "For building AI-powered software, not agents"; do not use it for what code computes exactly.
- https://docs.typesafe.ai/introduction/coding-agents.md — Jev does not write replies or hold a conversation.
- https://docs.typesafe.ai/introduction/machine-learning-primer.md — Defines calibration; publishes no calibration metric.
- https://docs.typesafe.ai/cookbooks/parallel_questions.md — Batching 13 questions: 12.2x cheaper and 10x faster with the same answers.
- https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook.md — Repeatability of Choice answers; the top label flipped on 2 of 8 close questions.
- https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook.md — Repeatability of Noul answers (std dev about 0.01).
- https://docs.typesafe.ai/cookbooks/date_extraction_cookbook.md — A missing date was not reported as "not stated"; only a code cross-check caught it.
- https://docs.typesafe.ai/cookbooks/hierarchical_classification.md — Sequential narrowing where code chooses the next question between requests.
- https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery.md — Free text turned into a fixed table of answers used as features; embedding baseline untested.
- https://docs.typesafe.ai/cookbooks/rerank_typesafe.md — Re-ranking vs BM25 on legal queries (top-1 5% to 18%).
- https://evals.typesafe.ai/ — Vendor benchmark graded against frontier-LLM consensus labels; Jev workflow 67.8% at $0.0004 a case.
- https://api.typesafe.ai/v1/systemone — The API endpoint our adapter posts to (default `TYPESAFE_API_URL`); an address, not a document.
- https://github.com/anisselbd/jev-phishing-bench — Independent 2,000-email test: one broad Jev question 62.6% vs five narrow questions with fitted weights 95.0%.

### Can an AI stand in for a person?

- https://arxiv.org/abs/2411.10109 ; https://arxiv.org/abs/2411.10109v1 ; https://arxiv.org/abs/2411.10109v2 — Park et al., agents built from 1,052 people's interviews and surveys; a bullet summary keeps most of the accuracy; a survey works as well as an interview.
- https://arxiv.org/abs/2505.17479 — Twin-2K-500: 2,058 people, 500 questions; twins reach about 88% of human consistency and lean normative.
- https://arxiv.org/abs/2509.19088 — "Digital Twins as Funhouse Mirrors": off the answered questions, twins fall back to stereotype.
- https://arxiv.org/html/2503.16527 — Li et al. 2025: LLM-written personas drift one way as more text is generated.
- https://academic.oup.com/pnasnexus/article/3/12/pgae533/7919163 — Salecha et al. 2024: LLMs shift toward socially desirable personality answers.
- https://arxiv.org/html/2403.05020v2 — Zhou et al., EMNLP 2024: single-script simulations reach deals 94% vs 30% for separate agents.
- https://arxiv.org/abs/2310.13548 — Sharma et al. 2023: sycophancy across production assistants.
- https://arxiv.org/html/2604.02668v2 — "Too Polite to Disagree" (2026): sycophancy spreads in multi-agent discussion.
- https://www.microsoft.com/en-us/research/blog/magentic-marketplace-an-open-source-simulation-environment-for-studying-agentic-markets/ — Magentic Marketplace: agents accept first offers and can be manipulated.
- https://arxiv.org/abs/2506.00073 — Zhu et al. 2025: agent-to-agent deals are imbalanced.
- https://arxiv.org/abs/2512.11844 ; https://arxiv.org/html/2512.11844 ; https://arxiv.org/html/2512.11844v1 — "Love First, Know Later" (preprint): simulated agent dates AUC 0.60 vs regression 0.61.
- https://arxiv.org/abs/2407.10989 — ChatGPT reading 964 real speed-date transcripts: r = .12-.23.
- https://arxiv.org/html/2607.23037v1 — LLMs reading 1,248 Japanese speed-date conversations: r about .16-.26 vs partner consensus .36-.48.
- https://pmc.ncbi.nlm.nih.gov/articles/PMC13350872/ — Scientific Reports 2026: ChatGPT on real transcripts r=.12, like human readers; video watchers .31.
- https://arxiv.org/abs/2506.03543 — CogniPair: 77.8% "accuracy" reported without a baseline.
- https://www.openml.org/api/v1/json/data/qualities/40536 — Columbia speed-dating dataset: 83.5% of 8,378 dates are non-matches.
- https://arxiv.org/abs/2509.04664 — Kalai et al. 2025: why language models hallucinate (training rewards guessing).
- https://arxiv.org/abs/2306.13063 — Xiong et al., ICLR 2024: verbalized confidence clusters at 80-100%.
- https://arxiv.org/abs/2306.07951 — Dominguez-Olmedo et al., NeurIPS 2024: LLM survey answers follow option order and labels.
- https://arxiv.org/abs/2501.16996 — Liang 2025: meeting in person beats search over AI copies when personality is high-dimensional.

### What predicts compatibility

- https://gwern.net/doc/psychology/2017-joel.pdf ; https://journals.sagepub.com/doi/abs/10.1177/0956797617714580 — Joel, Eastwick & Finkel 2017: 100+ pre-date measures predicted about 0% of pair-specific desire.
- https://www.pnas.org/doi/10.1073/pnas.1917036117 — Joel et al. 2020, PNAS: 11,196 couples; own views of the relationship predict quality; similarity adds nothing.
- https://pscresearch.faculty.ucdavis.edu/wp-content/uploads/sites/112/2024/11/eastwick-blozis-2023-predicting-romantic-interest.pdf — Eastwick et al. 2023: compatibility explains 3% at best among real prospects.
- https://faculty.wcas.northwestern.edu/eli-finkel/documents/EastwickFinkel2008_JPSP.pdf ; https://pubmed.ncbi.nlm.nih.gov/18211175/ — Eastwick & Finkel 2008: stated ideals did not predict desire at speed dating.
- https://static1.squarespace.com/static/504114b1e4b0b97fe5a520af/t/5365a745e4b0cbe1c025abd7/1399170885689/Eastwick2014PBull.pdf ; https://psycnet.apa.org/record/2013-12483-001 — Eastwick et al. 2014 meta-analysis (k=97): ideals predict on paper, not face to face.
- https://www.sciencedirect.com/science/article/abs/pii/S0022103118305961 — Eastwick, Finkel & Simpson 2019: negligible evidence people desire partners who uniquely fit their ideals.
- https://pmc.ncbi.nlm.nih.gov/articles/PMC12622239/ — Eastwick et al. 2025, N=10,358 in 43 countries: trait-by-trait ideal matching β about .04.
- https://pubmed.ncbi.nlm.nih.gov/24611897/ — Eastwick & Hunt 2014: agreement on who is attractive falls with acquaintance.
- https://pubmed.ncbi.nlm.nih.gov/28921999/ — Gerlach et al. 2019: preferences predict later partners' traits.
- https://faculty.wcas.northwestern.edu/eli-finkel/documents/InPress_TidwellEastwickFinkel_PersonalRelationships.pdf — Tidwell, Eastwick & Finkel 2013: perceived, not actual, similarity predicts liking; reports Montoya 2008's stage figures.
- https://faculty.wcas.northwestern.edu/eli-finkel/documents/2012_FinkelEastwickKarneyReisSprecher_PSPI.pdf ; https://journals.sagepub.com/doi/abs/10.1177/1529100612436522 — Finkel et al. 2012 review: no compelling evidence matching algorithms work.
- https://genepi.qimr.edu.au/contents/p/staff/Alford_NGM_JrnlPolitics362-379_2011.pdf — Alford et al. 2011: spouse correlations on religion, politics, drinking, smoking, personality (US).
- https://doi.org/10.1016/j.evolhumbehav.2004.08.008 — Kurzban & Weeden 2005 (HurryDate): religion, education and income played little role in 3-minute meetings.
- https://iussp.org/sites/default/files/event_call_for_papers/Final%20revised%20Edited%20Mixed%20Marriage%20Paper%5B1%5D.pdf — Goli, Singh & Sekher (IHDS): inter-religious marriage 2.7%, inter-caste 6.1% in India, 2005.
- https://pmc.ncbi.nlm.nih.gov/articles/PMC5035909/ — Bruch, Feinberg & Lee 2016, PNAS: online daters screen with a few hard cutoffs first.
- http://www.mysmu.edu/faculty/normanli/jonasongarciawebsterlifisher2015.pdf ; https://journals.sagepub.com/doi/10.1177/0146167215609064 ; https://doi.org/10.1177/0146167215609064 — Jonason et al. 2015: dealbreakers weigh more than dealmakers; the common ones only show in interaction.
- https://pubmed.ncbi.nlm.nih.gov/25344347/ — Joel, Teper & MacDonald 2014: people reject less when the choice is real.
- https://elifinkel.com/s/2011_IrelandSlatcherEastwickScissorsFinkelPennebaker_PSci.pdf — Ireland et al. 2011: language style matching in the humans' own words predicts interest.
- https://www.science.org/doi/10.1126/science.1091721 — Johnson & Goldstein 2003: defaults stick.

### Real dating products

- https://blogs.ams.org/mathgradblog/2016/06/08/okcupid-math-online-dating/ — How OkCupid's match maths works: your answer, acceptable answers, importance, both ways.
- https://okcupid-app.zendesk.com/hc/en-us/articles/22982200783771-How-Does-OkCupid-Work-Our-Complete-Guide-to-Match-Questions-the-Algorithm-and-Setting-Up-Your-Account — OkCupid help page on match questions.
- https://www.research-live.com/article/features/data-date/id/4012946 — Interview with Rudder: users answer about 300 questions on average.
- https://ed.ted.com/lessons/inside-okcupid-the-math-of-online-dating-christian-rudder — TED-Ed: the maths of OkCupid.
- https://www.refinery29.com/en-us/okcupid-profile-questions-matches — OkCupid requires 15 answers; users average 50.
- https://gwern.net/doc/psychology/okcupid/weexperimentonhumanbeings.html — OkCupid 2014, "We Experiment On Human Beings": a shown match number moves behaviour.
- https://medium.com/@asnyder/okcupids-data-just-doesnt-match-bf1f75ece484 — Secondary analysis of the 2014 experiment's numbers.
- https://theweek.com/speedreads/449182/okcupid-admits-experimented-users — News coverage of the 2014 experiment.
- https://www.yahoo.com/news/facebook-okcupid-experimented-users-120208243.html — News coverage giving the 2014 experiment's percentages.
- https://gwern.net/doc/psychology/okcupid/thebestquestionsforafirstdate.html — OkTrends 2011: outcome-chosen questions beat user-rated ones.
- https://gwern.net/doc/psychology/okcupid/raceandattraction20092014.html — OkTrends 2014: stated race answers changed while behaviour did not.
- https://gwern.net/doc/psychology/okcupid/yourlooksandyourinbox.html — OkTrends 2009: two-thirds of men's messages go to the best-looking third of women.
- https://www.pbs.org/newshour/nation/the-3-first-date-questions-that-will-predict-your-romantic-compatibility — OkCupid's three first-date questions; caring equally about politics.
- https://ocw.mit.edu/courses/15-071-the-analytics-edge-spring-2017/9a6b539841f8c9f7804373dee5cec78b_MIT15_071S17_Unit9_eHarmony.pdf — MIT case on eHarmony: 436 questions, 29 dimensions.
- https://www.eharmony.com/tour/what-is-the-compatibility-quiz/ — eHarmony's current compatibility quiz page.
- https://journalistsresource.org/media/marital-satisfaction-break-ups-differ-online-offline-meeting-venues/ — Summary of the eHarmony-funded Cacioppo et al. 2013 study.
- https://money.cnn.com/2016/12/16/technology/eharmony-removed-questionnaire/index.html — eHarmony made its questionnaire optional.
- https://en.wikipedia.org/wiki/EHarmony — eHarmony background, including the questionnaire's shrinking.
- https://techcrunch.com/2018/07/11/hinge-employs-new-algorithm-to-find-your-most-compatible-match-for-you/ — Hinge "Most Compatible" learns from likes and passes.
- https://techcrunch.com/2018/10/16/hinge-is-first-dating-app-to-actually-measure-real-world-success — Hinge "We Met" asks both people whether the date happened.
- https://help.hinge.co/hc/en-us/articles/360010692913-What-is-We-Met — Hinge help page on "We Met".
- https://hinge.co/newsroom/prompt-feedback — Hinge: likes on prompts 47% more likely to lead to a date (company data).
- https://www.swipestats.io/blog/hinge-prompt-list — List of Hinge's roughly 85-105 prompts.
- https://techcrunch.com/2025/01/15/hinge-new-ai-feature-determines-if-your-prompt-response-is-too-basic/ — Hinge's AI prompt feedback feature.
- https://www.engadget.com/2019-03-18-tinder-dumps-desirability-scores.html — Tinder dropped its Elo desirability score.
- https://www.tinderpressroom.com/2026-03-12-Tinder-Debuts-Inaugural-Product-Keynote-Tinder-Sparks-2026-Start-Something-New — Tinder's 2026 "Chemistry" launch, no outcome data.
- https://techcrunch.com/2025/11/05/tinder-to-use-ai-to-get-to-know-users-tap-into-their-camera-roll-photos/ — Tinder Chemistry pilot with a camera-roll scan.
- https://www.keeper.ai/posts/how-keeper-works-our-method-for-soulmate-matching — Keeper's method: fixed trait and preference questionnaires, scored both ways; self-reported outcomes.
- https://www.alleywatch.com/2025/12/keeper-ai-matchmaking-dating-relationship-science-jake-kozloski/ — Interview on Keeper's approach.
- https://techcrunch.com/2025/06/25/sitch-wants-to-fuse-human-personality-and-ai-for-matchmaking — Sitch: about 50 questions mapped to 75+ parameters.
- https://timeleft.com/post/timeleft-algorithm-the-maestro-of-your-dinners/ — Timeleft's grouping algorithm from about 30 questions.
- https://www.antler.co/blog/why-we-invested-in-wavelength — Wavelength (Bengaluru): an agent that learns preferences and non-negotiables.
- https://techcrunch.com/2026/08/06/gen-z-dating-apps-like-ditto-ditch-swiping-in-favor-of-ai-matchmaking/ — Ditto and other Gen Z apps replacing swiping with AI matchmaking.
- https://www.globenewswire.com/news-release/2026/02/03/3231154/0/en/ditto-raises-9-2m-to-replace-swiping-with-real-dates-for-college-students.html — Ditto: about 20% of matches go on a date (self-reported).
- https://www.globaldatinginsights.com/featured/known-raises-on-voice-ai-to-push-dating-back-offline/ — Known: 26-minute voice intake; about 50% of proposed dates accepted.
- https://sfist.com/2026/05/06/new-ai-dating-app-out-of-sf-says-half-its-matches-say-yes-to-real-dates/ — Known's reported acceptance and second-date rates.
- https://www.globaldatinginsights.com/featured/ai-dating-startup-amata-launches-with-6m-in-funding/ — Amata: a few questions, a token per planned date.
- https://www.psychologytoday.com/us/blog/a-funny-bone-to-pick/202401/ai-chatbots-can-now-go-on-first-dates-for-you — Volar: AI versions of users go on first dates.
- https://www.globaldatinginsights.com/news/volar-where-ai-avatars-go-on-first-dates-for-you/ — Volar launch coverage.
- https://www.scientificamerican.com/article/the-rise-of-ai-chatfishing-in-online-dating-poses-a-modern-turing-test/ — AI "chatfishing"; reports Volar's shutdown in 2024.
- https://www.cnbc.com/2024/05/10/bumble-founder-whitney-wolfe-herd-says-ai-could-date-for-you.html — Bumble's founder on AI concierges dating each other.
- https://techcrunch.com/2026/03/12/bumble-introduces-an-ai-dating-assistant-bee/ — What Bumble shipped: "Bee", an assistant, not an agent that dates.
- https://techxplore.com/news/2026-02-hot-bots-ai-agents-dating.html — MoltMatch: agents that swipe and message; used a real model's photos without consent.
- https://www.grindr.com/2026-product-roadmap — Grindr's AI "wingman" roadmap.

### Asking questions: adaptive testing, elicitation and survey length

- https://patents.google.com/patent/US20060230008A1/en — The 20Q patent: candidates are weighted, not deleted.
- https://scienceline.org/2006/07/tech-schrock-20q/ — Interview with 20Q's inventor: 80% right at 20 questions.
- https://www.tubefilter.com/2025/04/25/akinator-guessing-genie-ai-algorithm-elokence/ — Akinator's method is proprietary.
- https://arxiv.org/abs/2508.21184 — BED-LLM (ICLR 2026): expected information gain beats split and entropy question choice.
- https://cs.fit.edu/~pkc/apweb/related/rashid-iui02.pdf ; https://dl.acm.org/doi/10.1145/502716.502737 — Rashid et al. 2002: pure entropy question choice was unusable on MovieLens.
- https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1745-3984.1984.tb01040.x — Weiss & Kingsbury 1984: adaptive tests need 40-60% fewer items.
- https://adaptivetestingtechnologies.com/wp-content/uploads/2016/09/CAT-DI-JAMA-Psychiatry-2012.pdf — CAT-DI (Gibbons et al. 2012): 12 adaptive items match a 389-item bank.
- https://journals.sagepub.com/doi/10.1177/107319110000700404 — Reise & Henson 2000: the best 4 fixed items do about as well as adaptive ones.
- https://healthmeasures.net/implement/scoring/calculate-scores/ — PROMIS scoring: any items from one calibrated bank land on one metric.
- https://journals.sagepub.com/doi/10.1177/01466219922031365 — Eggen 1999: classification tests that stop at a decision.
- https://en.wikipedia.org/wiki/Computerized_classification_test — Background on sequential (SPRT) classification tests.
- https://assess.com/computerized-adaptive-testing/ — Background on computerized adaptive testing.
- https://cdn.aaai.org/AAAI/2000/AAAI00-056.pdf — Chajewska, Koller & Parr 2000: ask only questions that could change the decision.
- https://business.columbia.edu/sites/default/files-efs/pubfiles/3067/Netzer%20and%20Srinivasan%20Adaptive%20Self-Explication.pdf — Netzer & Srinivasan 2011: trade-off importance questions beat plain importance ratings.
- https://arxiv.org/abs/2403.05534 — OPEN (Handa et al. 2024): self-reported rankings poorly reflect real preferences.
- https://arxiv.org/abs/2406.00922 — MediQ (NeurIPS 2024): LLMs choosing their own questions do worse without uncertainty tracking.
- https://arxiv.org/abs/2402.03271 — Uncertainty of Thoughts (NeurIPS 2024): information-gain planning improves LLM questioning.
- https://arxiv.org/abs/2607.03426 — ASIG (2026): cheaper expected-information-gain questioning.
- https://www.surveymonkey.com/curiosity/survey_questions_and_completion_rates/ — SurveyMonkey: drop-off rises most steeply up to about 15 questions.
- https://www.surveymonkey.com/curiosity/survey_completion_times/ — SurveyMonkey: time per question falls as surveys get longer.
- https://academic.oup.com/poq/article-abstract/73/2/349/1939196 — Galesic & Bosnjak 2009: longer surveys get fewer starts and worse answers.

### Two-sided recommendation, markets and learning from behaviour

- https://dl.acm.org/doi/10.1145/1864708.1864747 ; https://api.openalex.org/works/doi:10.1145/1864708.1864747 — RECON (Pizzato et al. 2010): reciprocity raised top-10 success from 23% to 42%.
- https://link.springer.com/article/10.1007/s11257-012-9125-0 — Pizzato et al. 2013 follow-up on reciprocal recommenders.
- https://journals.sagepub.com/doi/full/10.1089/cyber.2016.0528 — Whyte & Torgler 2017: RSVP contact decisions vs stated criteria.
- https://www.sciencedaily.com/releases/2017/02/170221110744.htm — Press coverage giving the "under 1% met all criteria" figure.
- https://www.aeaweb.org/articles.php?doi=10.1257/aer.100.1.130 ; https://people.duke.edu/~dandan/webfiles/PapersUpside/Matching%20and%20Sorting%20Dating.pdf — Hitsch, Hortaçsu & Ariely 2010 (AER): preferences revealed by behaviour reproduce real matches.
- https://link.springer.com/article/10.1007/s11129-010-9088-6 — Hitsch, Hortaçsu & Ariely 2010 (QME): preferences people would not state in a survey.
- https://doi.org/10.1073/pnas.0705290104 — Todd et al. 2007, PNAS: stated preferences did not predict speed-dating choices.
- https://cdn.aaai.org/ojs/19032/19032-13-22868-1-10-20211006.pdf — Krzywicki et al. 2014: behaviour-based recommendation +94.6% vs profile rules +11.2%, and it had to demote popular users.
- https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/2599 — Wobcke et al. 2015, AI Magazine: write-up of the same deployed system.
- https://www.ijcai.org/Proceedings/11/Papers/367.pdf — CCR (Akehurst et al. 2011): borrowing from similar users helps from a user's first action.
- https://pubmed.ncbi.nlm.nih.gov/8970487/ — Peduzzi et al. 1996: about 10 events per variable in logistic models.
- https://psycnet.apa.org/record/2002-02942-006 — Li et al. 2002 ("mate dollars"): a small budget reveals necessities.
- https://web.stanford.edu/~niederle/Lee.Niederle.Rose.ExpEcon.2015.pdf — Lee & Niederle 2015: a scarce "rose" raised acceptance by 3.3 points.
- https://pmc.ncbi.nlm.nih.gov/articles/PMC6082652/ — Bruch & Newman 2018: attention piles onto a steep desirability hierarchy.
- https://pubsonline.informs.org/doi/abs/10.1287/msom.2022.1107 ; https://spiral.imperial.ac.uk/server/api/core/bitstreams/2e71c36d-4b6f-4626-a286-ffcab6948057/content — Rios, Saban & Zheng 2023: accounting for recent matches gave at least 27% more matches.
- https://pubsonline.informs.org/doi/10.1287/mnsc.2020.3794 — Kanoria & Saban 2021: let the short side propose; hiding quality can help.
- https://www.sbert.net/examples/cross_encoder/applications/README.html — Sentence-Transformers: cross-encoders are more accurate but do not scale; retrieve then re-rank.

### Statistics for the measurement plan

- https://www.bmj.com/content/368/bmj.m441 — Riley et al. 2020, BMJ: sample size for prediction models; about 5,300 pairs for our case.
- https://journals.sagepub.com/doi/10.1177/0962280218784726 — van Smeden et al. 2019: events-per-variable is not a sample-size rule for prediction.
