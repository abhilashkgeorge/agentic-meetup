# How it works

The whole product, end to end, in the order it happens to a person. Written so that
either a human or an agent can answer "where does X happen?" without reading 15,000
lines. Every section names the files that actually do the thing.

`ARCHITECTURE.md` says why the system is shaped this way. `ENGINE-DECISION.md` says why
we built the engine instead of adopting one. `AGENT-DESIGN-RESEARCH.md` says why the agent
is what it is now -- the evidence, the four designs that competed, and what changed on
2026-09-23. This file says what runs.

---

## The one-paragraph version

A person answers three basics and **five shared cards** -- kids, one person or open,
smoking, drinking, food -- each asking about *them* and about *who they would be fine
with*. Every answer becomes a **fact** (something true of them) or a **rule** (an option
they unticked). Those get flattened into one indexed row, `match_profile`. When they send
their agent out, SQL picks who is even possible -- symmetric filters, no model -- and the
round takes the first three in the query's own order, **real people first**, skipping
anybody real who has already been brought to five other real people this week. Each pair
gets a **brief written by code**: intent, age, area, interests they share, up to two of
the other person's own verified sentences, one line that is the same on every card, and
**what the two agents said to each other**: a short talk in which every sentence about
a person is one that person typed, a note of what the two share, and a first-date idea
(§7b). That talk is **the only model call in a round** -- one small call a pair, which
points at sentences and writes none. When it fails, the card carries the answer-sheet
exchange instead (§7a), which costs nothing. Both humans must tap yes before either can
send a message.

The agent is **a record of what you said and who you would be fine with** -- not a copy
of you, and not a judge of chemistry, which nothing can predict before two people meet
(`AGENT-DESIGN-RESEARCH.md` §2). The simulated agent-to-agent conversations still exist
and are **off by default** (§6).

---

## 1. Getting in

`app/src/features/auth/*`, `server/src/api/auth.ts`, `server/src/phone.ts`

Phone number, six digits by SMS, a session token, and an invite: **invite-only**. Each
person can bring in three people in all (`INVITES_PER_USER`): used invites count, open
ones count, one that runs out unused comes back; the reviewer has no limit. Who invited
whom is the invite's own row -- `created_by`, and `reserved_for`, written in the same
statement that claims the code, before the account exists.

Two testing shortcuts stay, **development-only** (the founder, 2026-09-25: keep them,
do not delete them): the reusable invite `KNOX-1010` (`ALLOW_REUSABLE_INVITES`) and
console SMS (`SMS_PROVIDER=console` prints the code to the server log; `SMS_DEV_ECHO`
puts it in the reply). A production server refuses to start with any of them on, or
with `ALLOW_UNVERIFIED_SIGNUP` -- `server/tests/boot-refusals.test.ts` starts it for
real to prove it. A reusable row restored into a real database is dead there.

---

## 2. Onboarding — what the agent is built from

The order on the phone (`app/src/features/onboarding/`):

```
start → interview → (essentials → voice → self-test) → character → photos → home
                 ↘ paste from another AI ↗
```

The middle three are skipped if the person is already `inPool` after the interview —
which only happens when a pasted memory export already supplied age and city.

### 2a. The interview — the spine

`server/src/onboarding/questions.ts` · `next-question.ts` · `server/src/api/interview.ts`

One question at a time, **no model call** on the required path. **A fixed order**:

1. **Basics** (`GATING`): who you are, who you want to meet, what you are here for.
   Cannot be skipped -- the candidate query cannot run without them. A basic already
   given in the essentials wizard counts as answered.
2. **Five core cards** (`CORE`), always in this order: kids, one person or open,
   smoking, drinking, food. Each card is **two rows on one screen**: *You* (with
   "Prefer not to say") and *Who's fine*, which opens with **nothing chosen** and needs
   one explicit tap -- "Anyone is fine" or "Let me choose". Every option unticked under
   "Let me choose" becomes one hard rule, `in [accepted]`. "Anyone" writes no rule but
   is stored as a choice. Re-answering retires the old rule; nothing is deleted.
3. **The sentence**: "Anyone else you couldn't be with?" (below).
4. **Optional chips**, which the person can stop at any time ("That's enough for now").
   Only here is the next question picked by how evenly it splits the candidate pool.

**Why a fixed order.** It used to be Akinator from the first question: ask whatever most
evenly splits *the people you could be matched with*. But during setup that pool is
empty, every question scored zero, and real users were asked the three basics and one
sentence and nothing else -- the five fields two people are compared on were never
reached. And comparing two people only works when both answered the *same* questions,
which is what the cards are.

**A person joins the pool only when all five cards are answered** ("Prefer not to say"
counts). The Home and "send my agent out" re-check this (`poolNow`), so a stored yes
from before the cards cannot send anybody out.

Every answer is one of:

| kind | asks | becomes |
|---|---|---|
| `fact` | something true of you ("How do you eat?") | a row in `facts` |
| `preference` | something you want in them ("Would it bother you if they ate differently?") | a row in `preferences` |
| `free` | one sentence | a fact, and a **proposal** the person confirms |

**The sentence proposes; the person decides.** "Anyone else you couldn't be with?" in
their own words -- people are precise about what they cannot stand. The sentence is kept
whatever happens. `onboarding/dealbreaker.ts` maps it onto **one of the five cards** with
one model call (frequency exclusions closed upward in code: "no smokers" means rarely
through daily), and the answer route **writes nothing**: it returns a proposal -- that
card's Who's-fine row with the options the sentence ruled out already unticked, starting
from what the card already accepts. The app shows it; only "Keep this" writes the rule
(`POST /v1/interview/who-fine`). A sentence about something no card holds ("talks
through films") stays a sentence: "We can't check that on paper. You'll spot it in the
first chat." No model ever makes a filter decision on its own.

**What was removed, and why.** Four "same as me" preference questions ("Could you be
with a smoker?") copied the person's OWN answer into the rule: a daily smoker who said
"No" got `smoking in ["daily"]`, a rule only daily smokers pass. The cards replace them.
Guarded by `server/tests/core-cards.test.ts`.

**The faith card** (since 2026-09-25) is optional -- skippable whole, never a condition of
going out -- and asked straight after the five. Its answers are a faith or none: no
caste, no sect, no community (`FAITHS`). It is check-only: `religion` is never public,
never quoted, and used only to test its partner row both ways, like any card, and to
answer "matches / doesn't match" for a want about faith.

### 2b. The essentials

`server/src/api/dating.ts` → `POST /v1/essentials`

The five the pool cannot run without (`POOL_REQUIRED` in shared): gender, who you want
to meet, birth date, where you live, what you are here for. Plus the **age range you
would meet** (pre-filled at your own age ±5, visible and editable; without it the age
filter only ever ran one way for real users), and two optional ones asked while they are
still worth asking: how far you will travel, and which part of town.

"Prefer not to say" is an **answer**, recorded in `predicate_status` as `declined`, which
is how a declined field stops looking like a never-asked one and stops being re-asked
for ever.

City → a point on the map: `resolveLivesIn`. A listed city always resolves to the table's
centre so two people in one city sit on one point; otherwise the phone's own coarse
position is used, but only if it still names the same city the person typed.

### 2c. Voice, self-test, character, photos

- **voice** (`api/tell.ts`, `memory/*`): free paragraphs, extracted into facts. **On a
  field the person taps -- a basic or a card -- a sentence never changes the answer**:
  it is staged (`TAPPED_PREDICATES`, origin `untrusted`) and asked about one at a time
  ("Your agent heard something" on the profile). Everywhere else it is learned at once.
- **self-test** (`memory/selftest.ts`): the clone answers questions as you and you mark
  it right or wrong.
- **character** (`app/src/features/look/`): the 3D Mii. Purely how you are drawn; it
  never reaches matching.
- **photos**: not seen by any agent, not matched on, shown only after both say yes.

---

## 3. What the agent actually is

**A record, not a persona.** For every shared card it holds your answer, who you would
be fine with, and where the answer came from. Code reads it; no model speaks as you or
judges for you on the default path. The evidence for this and against a "clone" is in
`AGENT-DESIGN-RESEARCH.md`: stated preferences predict who people *consider* on paper,
not who they will click with; a copy of a person guesses a stereotype on anything they
never said; and ours, on a real user's card, invented a comedy-writer life he never
mentioned.

There is **no per-user model and no fine-tune**. For the conversations (off by default,
§6) an "agent" is three things, assembled per conversation:

1. **The dossier** — `buildDossier` in `server/src/matching/rendezvous.ts`. The facts
   this person marked **public**, and nothing else. The filter is in the SQL, not in the
   prompt: a model handed somebody's whole memory will repeat all of it to a stranger,
   and a structural exclusion cannot be talked out of.
2. **The voice** — `voiceText` in `server/src/memory/profile.ts`. How they write.
3. **Their own sentences** — `loadQuotes` in `server/src/matching/brief.ts`. Real
   quotes with dates, used for the brief, never invented by a model.

Everything else lives in `facts` (hash-partitioned 32 ways) and is retrieved on demand.

---

## 4. Who the agent is allowed to meet

`server/src/matching/candidates.ts` — **pure SQL, no model anywhere.**

The arithmetic that forces this: asking a model to look at a 1,000-person pool for one
user is about $7. Full pairwise at 10,000 agents is ~50 million pairs, about $350,000 a
sweep. Not expensive — impossible. The gap between that and a fraction of a cent is
entirely how much of the work lives in an index instead of a prompt.

**Seven rules, and nothing else may exclude anybody:**

| rule | what it does |
|---|---|
| blocks | final, checked before any spend, in `BASE` so no switch can turn it off |
| synthetic | real people see invented ones only while `sees_synthetic` is on; an invented profile never sees a real one |
| gender | symmetric: they must want you too |
| age | symmetric, both bands |
| distance | the **shorter** of the two willingnesses |
| intent | any overlap |
| dealbreakers | both directions, live rows only |
| active | seen in the last 60 days |

**Every clause is symmetric and every clause passes on NULL.** Symmetric because a
one-directional filter matches you with somebody who would never have accepted you.
Null-passing because an unknown is a question worth asking, never a mismatch.

Everything else that matters to somebody is a **preference that adds points**, because
filters multiply down and reach zero while points add up and never do.

`poolBreakdown` runs the filters one at a time so over-filtering is visible — watch the
number fall and decide whether the rule is worth it.

**Every count a person sees is rounded to ten, and under twenty it is not shown at all**
(`shownCount`, "Under 20" in the app). With the cards every real person has a value on
smoking, drinking, kids, monogamy and food, and an exact count taken before and after
flipping one rule is how many people hold the value that rule excludes -- a day apart,
one new person's answer.

---

## 5. Ranking the survivors -- recorded, no longer used to pick

`server/src/matching/score.ts` — **no model calls.**

**It no longer decides who is met.** A round picks in the candidate query's own order --
real people first, then the most recently active -- because re-sorting by this score
buried every real person under five thousand invented ones, whose richer tags win it.
A real person already brought by **five** other real people's rounds this week is not
picked again this week (`overExposed`, `WEEKLY_REAL_EXPOSURE`), so real-first does not
flood the scarce side. The score is still worked out and stored on every pair
(`rendezvous.rank_score`), because it is one of the scorers being measured (§8).

- **Preference score**, both directions. A preference the other person has no answer for
  is *skipped*, not failed.
- **Interest overlap**, Ochiai (shared / √(|a|·|b|)) — not cosine, which gives two people
  who share exactly one thing a perfect score.
- Combined **0.6875 preference + 0.3125 overlap**, each direction.
- **Geometric mean of the two directions**, not the average: two people who each satisfy
  the other 95% beat a pair at 100% and 90%, one of whom is settling.
- **Shrunk by how thin the data is**: × common/(common+3). Three answered fields can
  trivially score 100%.

The weights are hand-set and stay hand-set. Joel, Eastwick & Finkel (2017) ran random
forests over 100+ pre-date measures and could not predict relationship variance at all;
fitting weights to n=1 is fitting noise with extra steps.

---

## 6. The conversation -- off by default

`server/src/matching/rendezvous.ts` · `RENDEZVOUS_RUNS` (code default **0**)

**Off, and why.** Set to 0 in code on 2026-09-23, not only in `.env`, so a fresh machine
cannot bring it back by accident. The research and this repo agreed: the conversations
were about 95% of a round's model calls, a real user's card carried a concern about a
life his agent invented in them, the verdict words reached the screen and ordered the
list, and a 2025 study found simulated dates tie plain regression on the same profiles
(AUC 0.60 vs 0.61). A conversation holds no information that is not already in the two
files. They can be switched back on as an experiment on real-vs-real pairs; when they
are, their verdicts are recorded for the scorers and reach **neither the card nor the
town**. What follows describes that mode.

The idea is from *Hang the DJ*: the System runs a pair many times and the match is how
often they agree. The good part is not the number — it is that the score comes from
**watching the pair interact, repeatedly**, instead of comparing two questionnaires.

**Five runs per pair, five messages each side.** One is politeness; a thousand is a
bill. Four-of-five against one-of-five is a ranking that came from behaviour.

Four rules decide whether this measures anything at all:

1. **Runs are independent.** Each starts clean. Correlated runs measure as much as one.
2. **The writer is not the judge.** A `prober` writes the messages; a separate `assessor`
   reads the transcript and never its own earlier reasoning. Self-consistency pressure is
   the main engine of "we agreed on everything".
3. **The verdicts are sealed and simultaneous.** Both issued before either resolves.
4. **Each agent is given only what is PUBLIC about the other** — the same handful of tags
   a stranger could see, never the other dossier. This is what makes the conversation
   worth running: if both agents start with full disclosure, the talk can only rediscover
   the file.

**Three outcomes, not two.** `yes` / `no` / `not_enough`. A run where the agents stayed
abstract is a verdict about the *conversation*, not about the two people, and counting it
as a rejection makes a good pair look incompatible. Those runs count toward neither the
numerator nor the denominator.

**The assessor fills its answer in a fixed order** — what it learned, then its concern,
then the verdict — because a model asked for a verdict first produces a reservation mild
enough to live beside the answer it already gave.

**A dropped call is retried; a verdict never is.** Re-rolling a result we did not like is
optional stopping. Runs that died on the wire are topped up until there are five
*verdicts in hand*, because a majority of a smaller denominator is a bigger fraction and
the bar would otherwise be set by the network.

**The honest caveat, stated in the code:** both agents run on the same base model, so
their agreement is partly the model agreeing with itself. That is why this produces a
ranking and never a percentage shown to a human.

---

## 7. From conversation to a person's screen

`server/src/matching/orchestrator.ts` — three phases, and the middle one holds **no
database transaction**, because the first version kept one open for the eighteen minutes
the model took.

```
read    who to meet (real first, cap), claim the pairs    short transaction
model   nothing by default (conversations off, §6)         NO transaction
write   briefs — per pair, in its own short transaction
```

- A tap writes one row (`rounds`) and returns; a worker drains the queue
  (`matching/rounds.ts`). No mobile request survives five minutes.
- **One active round per person**, enforced by a unique index.
- **A pair meets once, ever.** Running the same two people again next week turns a match
  into a war of attrition.
- Claims are taken inside the read transaction so two rounds cannot run the same pair;
  a round that dies releases the claims it never used, or nobody could ever meet those
  people again.
- **Three candidates per round.** It used to be one, and five of the first seven real
  rounds ended in nothing. Scarcity is a feature before it is a cost control.

**The brief** (`matching/brief.ts`) is what the human reads. It is not a score, and
since 2026-09-23 it is **written entirely by code**: intent · age · area; interests both
people share; the line *"Passes your rules both ways, on everything they've answered"*,
identical on every card so its wording can never leak how well a pair fit; up to two of
the other person's own sentences; and an opener around one of them. A sentence is
quoted only if it appears **word for word** in something that person typed (a user-role
episode), never from the interview, never a line the clone said, and never one that
names a core value (kids, monogamy, smoking, drinking, food, faith, politics) -- only
relationship intent is ever named. No concern, no verdict, no number.

**The person sees and controls it.** "How you appear" (`GET /v1/me/appearance`) is
exactly what a card about them shows, built by the same code, with every sentence that
could reach a card and a **Hide** on each (`POST /v1/facts/:id/disclosure`; the kinds
`NEVER_PUBLIC` names can never be shown). Beside it, their own rules read back in words
(`GET /v1/me/readback`), including the half people are surprised by: anybody who has not
answered a card still passes it.

**A card is checked again every time it is shown** (`brief.ts liveCard`, 2026-09-25).
Cards are written once, when the agents meet, and keep the other person's sentences as
text; so every sentence of theirs on a card -- quote, "They said", talk line, date idea,
answer, opener -- must still be among their public, active, current sentences, and pass
today's rules, when `GET /v1/matches` serves it. A sentence they hid, took back or
replaced comes off every card already written; the want it stood beside stays listed.

**Learned is not shared** (2026-09-25). What the clone picks up in chat, "tell" or a
pasted memory starts match-only (extract.ts, pasteImport.ts): the agent uses it for
matching -- it is in the profile's traits and tags -- but it is quoted on no card, said in
no talk, answers no sheet and makes no "You both like" tag, until the person taps **OK to
share** under "Learned in chat" on "How you appear". Only answers written on purpose for
sharing start shareable: the five set questions (stories), and a question of the day,
whose button says "Save and share". Tags shown to others are chosen per fact, not per
kind (rendezvous.ts publicTags). Migration 0063 made the learned sentences already
there match-only too (29 on real accounts; nothing deleted, each change in memory_audit).

**Whoever has the larger inbox decides first** (`busierSide`). Dating apps run heavily
one-sided; without this the flooded side is flooded again here.

**Both humans must say yes.** A no is silent in both directions — the other person is
never told, their card simply never arrives. In a small pool where people compare notes,
an emitted rejection is unrecoverable.

Only on the second yes does `rendezvous.status` become `introduced`, which is the exact
condition the messaging RLS policy checks. Until then the two accounts cannot write to
each other at all.

---

## 7a. What the agents ask each other -- answer sheets

`server/src/matching/answer-sheet.ts` · migration `0061` · asked for by the founder on
2026-09-24

**The ask.** When an agent goes out -- "Send my agent out" or one of the day's visits --
the two agents ask each other the **same** questions, answer only from what their person
actually said, and say **"I don't know"** instead of inventing. This is the trekking-vs-
waffles problem solved where it lives: both agents answer the same questions, so the
answers line up, and the "I don't know"s become what the two people talk about.

**The bank:** twelve everyday questions, the same for everybody -- weekends, favourite
food, music, films and shows, reading, travel, work, goals, pets, staying active, a good
evening, learning. **Never the five cards**: kids, one person or open, smoking, drinking
and food are private and already checked by code; an agent saying "she smokes daily" on
a stranger's screen would leak exactly what the brief protects. Every answer also passes
the same core-value check a quote does (`namesCoreValue`).

**The rule that makes it safe: a model may point, never write.** A person's sheet is
built by showing a model their own **verified** sentences, numbered -- the same check a
quote passes: found word for word in something they typed, public, not from the
interview -- and asking which number answers each question, or none. Only the numbers
are kept, resolved to fact ids (`answer_sheets.answers`: question id → fact id). Nothing
the model writes is stored. No sentence → "I don't know".

**The trick that makes it free: answers do not depend on who is asking.** So the sheet
is built once, by the person's own session, when what they said changes (chat
extraction, "tell", "Send my agent out", opening "How you appear"); `basis` is a hash of
the sentences, so nothing changed means no call. A round only **reads** two sheets
(`readSheets`, as `clone_matchmaker`) and lines them up (`compareSheets`): questions both
answered first, then ones only they answered, up to four; then up to two they could not
answer and you could -- the first of those becomes the card's opener, "Ask them about
music". **Reading the sheets makes zero model calls** -- which is why they are what a
card carries when the agents' talk (§7b) fails or is switched off.

**Hidden means hidden, by the database.** The sheet stores fact ids, not words; the
matchmaker can read only public, current facts (0028), so a sentence the person hides,
retracts or replaces drops out of every sheet with no rebuild and no code on the read
path remembering to check.

**Where people see it** (when the agents did not talk; otherwise §7b's talk is shown):
- **The card** (`matches-screen.tsx`): "What your agents asked each other" -- each
  question with *Them* and *You*, their own words in quotation marks, or "I don't know".
  The second mover gets the plain card, with no exchange, until the first mover says yes.
- **The town** (`world/exchange-strip.tsx`): when the round you sent comes back, up to
  three questions play as speech bubbles above the button -- one agent asks, the other
  answers, then the asker answers the same question -- keeping one "I don't know" when
  there is one. Read from `/v1/matches`, so the reveal rule is applied first.
- **How you appear** (`appearance-screen.tsx`): your own sheet, exactly as a stranger's
  agent would hear it, with **Hide** on every answer, the questions it says "I don't
  know" to, and the hidden ones with **Show**.

**Practice profiles** have nothing they typed, so their sheet is templated from their
tags ("I work in logistics.") -- three answers at most, labelled practice on the card,
zero model calls.

**What to measure:** how often each question is answered, read off `answer_sheets`.
Keep the questions people actually answer; replace the ones nobody does.

---

## 7b. The agents talk -- and a filter could not do what they do

`server/src/matching/talk.ts` · `AGENT_TALK` (default on) · asked for by the founder on
2026-09-24

**The founder's question:** if everybody answers the same questions, a filter does the
matching -- so agent-to-agent talk only means something if it does what no filter can.
It does two things a filter cannot: it sees that "Nandi Hills at sunrise" and "I cycle
out of the city on weekends" are the same love of early mornings outdoors, and it comes
back with a first-date idea both people would say yes to. Who meets is still decided by
the cards and the filter; the talk changes nothing about that.

**Why a prompt is not the guard.** The old conversations (§6) already told the model
"Only say things you were actually told about your person. Never invent a detail" -- and
one invented a comedy-writer life on a real user's card. So here **the model writes
nothing about anybody. It points:** which bank question an agent asks, which of its OWN
person's numbered sentences it answers with (or "I don't know"), a reaction from a fixed
four, pairs of sentences that show something shared, and one date idea citing one
sentence from each side. `checkTalk` keeps only valid pointers -- in range, from the
speaker's own list, never a sentence twice -- and builds every word shown from the bank,
the reactions or the sentence lists. The date idea is the only text the model writes;
`safeIdea` refuses one that names a person, makes a claim ("loves ..."), judges the pair
("a perfect match", `VERDICT`), or touches a private card -- and `ungrounded` refuses one
with any word that is in neither of the two sentences it is built on nor a short list of
plain going-out words and the city's public places. So it states nothing about anybody
that is not in their own words, and it is shown with those two sentences.

**What it reads:** each side's sentences that pass the quote check (public, typed word
for word, not the interview, no core value), 20 at most. A practice profile's are the
"things they have said" template lines of its dossier, marked practice to the screen.

**Stories give it something to say** (`server/src/onboarding/stories.ts`, the app's
"Things to talk about"): five open questions -- a perfect Sunday, what you could talk
about for hours, a trip, what you are into lately, a first date you would love -- asked
after the cards in onboarding and reachable from the You tab and "How you appear". Each
answer is saved as a user-role episode plus a `prompt_answer` fact, so it passes the
quote check; answering again supersedes the old one; nothing calls a model.

**Where people see it:** the town plays the talk as bubbles when the round you sent
comes back (a person's sentence is the only thing in quotation marks), ending on the
date idea; the card shows the date idea, "Something you share", and "Read what your
agents said". The second mover sees none of it until the first mover says yes -- the
same plain-card rule as everything else about the first mover.

**Cost:** one structured call a pair on the extract model, on the starter's daily meter
(three turns a round of three). A failed call, a reply with fewer than two answers, or
`AGENT_TALK=off` leaves the answer-sheet exchange, and the round still completes.

---

## 7c. What you asked for -- evidence, never a verdict

`server/src/matching/wants.ts` · asked for by the founder on 2026-09-25

**Wants** are a person's own sentences about who they want or could not be with: the
interview's "Anyone else you couldn't be with?", anything chat heard as `seeking`, and
"What would you love in someone?" on the stories screen (match-only: never quoted, never
in a talk). Split a sentence at a time, five at most; a want that names one of the five
cards is left out, because the card already checks it exactly, both ways.

**The check:** for each want and each person, a model points at the ONE sentence of
theirs that shows it met or not met, or says unknown; `readWantChecks` keeps a met or
not-met only with a valid number, and looks the quote up.

**Private topics are check-only** (kids, one person or open, smoking, drinking, food,
faith). The model maps such a want to its card and the answers that satisfy it -- it is
never shown anybody's answer -- and code compares the other person's card answer. The
card says only "Matches" or "Doesn't match", never with a quote beside it.

**No want is dropped.** One nothing can check -- no card covers it (politics, say), they
never answered that card, or the check failed -- is on the card as "We can't check this
one yet".

**Only down, never out.** The starter's wants are checked against the first 12 of the
shortlist in one call, between the shortlist and the claims (outside any transaction).
A candidate with a not-met want moves later -- inside their own group, so a real person
is never put behind a practice profile -- and a met want lifts nobody. Nobody is removed:
with no one else to meet, they are still met. A failed call leaves the order alone.

**On the card:** "What you asked for" -- your want in your words, then "They said" and
their sentence, or "Nothing they've said covers this yet". The status is stored on the
brief for measurement and never sent to a phone. The other side's wants are checked
against the starter the same way, for their own card; the second mover sees none of it
until the first says yes.

---

## 7d. The question of the day -- asking the person what their agent could not answer

`server/src/matching/unknowns.ts` · migration `0062` · asked for by the founder on
2026-09-25

When an agent says "I don't know" in a meeting -- in the talk, or on the answer sheets --
the round records it against that person, by the bank question (`unknown_asks`). The
table has no column for who asked, so nothing can ever say who did. The person is then
offered the question asked most in the last two weeks that their sheet cannot answer:
**at most two a day**, answered or skipped, and a skipped one stays quiet for a week.
The reason shown is a count and nothing else ("Other agents asked yours this twice
lately"). The answer is saved as their own sentence (an episode and a quotable
`prompt_answer` fact tagged `sheet:<question>`), becomes that question's answer on their
sheet at once, and stays it through every rebuild (`withExplicit`). An answer holding a
contact detail, or naming a private topic, goes through the same rules as any sentence:
kept, never put on the sheet, never repeated -- and the screen says which it was. The
Town shows "A question for you" when one is waiting. No model call anywhere in it.

**A card topic opens the card** (2026-09-25). When a private want (§7c) could not be
checked because the other person has no answer on that card -- never answered, or "prefer
not to say" -- the round records `card:<predicate>` as their gap. Their question of the day
is then that card, both rows, answered through the card route
(`/v1/interview/next?card=`, then `/v1/question-of-day/done`), so the answer is a card
value -- checked by code, never said -- and not a sentence. A card they have a value on is
never offered.

---

## 8. The scorers, measured against each other

What each pair carries before any human looks:

| scorer | what it is | recorded |
|---|---|---|
| `rank_score` | the hand-weighted profile score (§5) | on every pair; no longer picks |
| `jev_file_score` | a System One model's probability from the two files (§8a) | only when `DECIDE_MODEL` is set |
| `agreement` | how often the conversations both said yes (§6) | only when conversations are switched on |
| `llm_file_score` | one model read both files | **stopped** 2026-09-23 |

`server/scripts/compare-scorers.ts` reports which one predicts a human yes, by AUC
(`matching/evaluate.ts`), and would-see-again over **every introduced pair**. Two
corrections made on 2026-09-23 (`pairOutcome`, `seeAgainOutcome`): a **first-mover no**
now counts as a no -- it lapses the pair, the second person is never asked, and it used
to fall out of the measurement -- and **no response** is its own bucket, never counted
as a no. It needs **~50 real decisions** before it is a finding, and there are **zero
possible real-vs-real pairs** today: every real user is a man looking for women.
**Never show a percentage to a human** — OkCupid 2014 measured that the number changes
behaviour more than it predicts it.

---

## 8a. The typed-decision model (off by default)

`server/src/llm/adapters/typesafe.ts` · `DECIDE_MODEL`

A **System One model** (TypeSafe's Jev) is a different shape from an LLM: unstructured
`state` plus a map of closed questions in, **one probability per question out**, in a
single round trip. It generates **no text at all** — so `complete()` on it raises rather
than doing something approximate, and it can never carry the conversation, the brief or
the chat.

Two places want a calibrated number rather than a paragraph, and both are wired to use
it when `DECIDE_MODEL` is set. Empty (the default) means nothing changes.

- **Mapping a written dealbreaker** (`onboarding/dealbreaker.ts`). One request asks a
  `choice` over the five card fields plus one `noul` per value — about forty questions
  at once. A mapping is proposed only when the field clears **0.6** confidence and a
  value clears **0.7**, and never when *every* value comes back excluded, which is a
  misreading rather than a preference. It is only ever a **proposal**: the person
  confirms it on the card before it removes anybody (§2a).
- **A fourth scorer** (`matching/score.ts` → `rendezvous.jev_file_score`, migration
  0060). One `noul` — "each would want a second evening" — from the two files alone.
  Recorded on every pair, **read by nobody**, compared in `compare-scorers.ts`.

**Why it is worth measuring.** Input is priced at $0.042/MTok and output at zero, so
scoring one person against a thousand candidates is about **four cents** where §4 records
it as seven dollars. That does not mean model-scoring everybody is a good idea — it means
we can finally afford to *test* whether it beats the SQL filter.

**Where the research landed** (`AGENT-DESIGN-RESEARCH.md`): Jev stays **out of the
default path** -- not for filters, not for ranking, not for comparing two answers to the
same card (that is a lookup), and not for anything a human reads. One broad question is
its weakest mode. The two uses kept for later, after the privacy text names TypeSafe: a
fail-closed check that hides quotes which might reveal a core value, and turning what
people say in chat into draft card answers they confirm.

**The calibration test.** The literature says this is close to unpredictable before two
people meet. A well-calibrated model should therefore return scores clustered near the
base rate. **A confident, spread-out distribution would be evidence it is wrong, not
evidence it is good.**

**The disclosure follows it.** When the task is routed, `decide` joins `disclosedTasks()`
and the per-session AI notice names TypeSafe alongside the others. A subprocessor nobody
is told about is the failure that screen exists to prevent — the privacy policy text is
the founder's to update.

## 8b. The park you walk in

`app/scripts/build-cubbon.mjs` → `app/assets/venues/cubbon-park/park.json` →
`app/src/features/world/cubbon.ts` → `garden-mesh.ts`

The city is a map you look at. **Cubbon Park is a place you walk in**, and since
2026-09-23 it is the real one: the boundary, all 185 footpaths, the ponds, the
buildings and the statues come out of OpenStreetMap (`way/22895320`, ODbL) at the size
the place actually is — **61.2 ha, 1,189 m × 1,382 m**.

**Scale: 1 unit ≈ 8.1 m**, derived from how tall a person is drawn (0.21 units) rather
than picked, which makes the park **147 × 171 units** — nine times the seeded garden it
replaced. Walking speed scales with the place, so it is about five minutes corner to
corner and one to two between landmarks.

Real: the outline, the paths, 5 ponds, 9 buildings (State Central Library, Band Stand,
Fern House), 7 statues, 42 surveyed trees. Invented, but placed against the real
geometry from a fixed seed: 700 more trees, 900 hedges, 179 benches, 233 lamps, 62,000
blades of grass, and the 120 places people stand.

**Grass is cut into a grid** of 16-unit cells, each its own instanced mesh with its own
bounding sphere. `follow()` switches off anything beyond 34 units every frame, so about
23,000 blades are drawn out of 62,000 and the rest costs nothing. Without that, matching
the old garden's density over nine times the area is 60,000 blades drawn always.

**Measured on the Pixel 6a, walking, 2026-09-23** (`dumpsys gfxinfo`, thermal status 1),
over 1,317 frames with 32 people in the park: p50 **13 ms**, p90 14 ms, p95 16 ms, 1.67%
janky. A locked 60, and better than the 26-unit garden it replaced.

**The crowd is not spread evenly.** Thirty-two people over 147 × 171 units is one
person every two thousand square units, and walking the park you meet nobody — which is
the one thing it exists for. Real crowds cluster: spots are thickest within 34 units of
the Band Stand and thin as 1/distance beyond it, so the far half keeps its paths,
benches and trees and has fewer people standing in them.

**A tree is two solids, and a building is its edges.** The collision only asks `h > 0`,
so height buys nothing for walking — and it costs the camera, which pulls itself in
against anything taller than the lens (0.95) and rises to look over the top. Correct for
a roof; absurd for foliage. So a tree is a wide knee-high solid (walk around it) plus a
thin tall trunk (the only part that blocks the view), and the park boundary is knee-high
too. Buildings are walled along every edge rather than at their corners, or a surveyed
footprint has a 3.4-metre hole in it.

Three bugs it shipped with, all of which drew perfectly happily:
- the wrong OSM id gave a **2.3-hectare courtyard**; there is an area check now
- Douglas-Peucker flattened the **closed boundary to a straight line**, because the
  first and last points of a ring are the same; `simplifyRing` cuts it in two first
- the lawn was tinted almost the **blades' own green**, so 62,000 tufts drew and none
  could be seen

...and four more found by walking it: you spawned **inside the bandstand**; the fountain
drew at radius zero as a **grey mushroom**; the camera **snapped to a plan view** every
time you brushed a tree or neared the boundary; and you could walk **through the wall of
the State Central Library**.

Any other venue still gets a seeded garden from `garden.ts` — a plausible park rather
than a wrong one.

## 9. The invented people

`server/src/matching/synthetic.ts` · `marginals.ts` · `synthetic-voice.ts`

A new person needs somebody to practise against. The structure is sampled from
hand-written distributions that are reviewable in a diff; a model is only ever allowed to
write the prose on top of a tuple that is already decided. Asking a model for "1,000
diverse profiles" gives you a thousand variations of one person — mode collapse is a
property of the sampler, not of the prompt.

An invented person has **no facts**, on purpose: migration 0010 forbids an
untrusted-origin fact from ever being active. Their dossier and quotes live on
`match_profile` instead, and are never presented as evidence about anybody.

They cannot open the app and tap yes, so `SYNTHETIC_AUTO_YES` is **off by default** —
with it on, a real person is introduced to somebody who will never reply.

---

## 10. Where the money goes

Every model call goes through `llm.complete` (`server/src/llm/index.ts`) — the single
metering choke point. `modelFor(task)` picks the model; nothing calls a vendor SDK
directly. One meter wraps a whole round, so the script, the endpoint and the worker are
all counted by the same code.

**A round costs one small call per pair** since 2026-09-24 -- the agents' talk (§7b), a
structured reply on the extract model; the filter, the pick and the brief are still SQL
and TypeScript. Between 2026-09-23 and then a round cost nothing; before, it was about
$0.055 (3 pairs × 5 conversations × 10 messages + assessments + a file score +
model-written briefs). What still spends: the
chat and "tell" extraction (the largest line so far -- $4.27 of $7.02 lifetime, measured
2026-09-23), the clone's own chat, the start-screen hook (2 calls), mapping the one
sentence (1 call), and building an answer sheet (1 small call, task `extract`, only when
what the person said has changed -- §7a). Rounds are limited by `ROUNDS_PER_DAY` (default 1) instead of by
spend.

---

## 11. The safety boundary

Row-level security, not application code. Five roles:

| role | sees |
|---|---|
| `clone_app` | one tenant's own rows |
| `clone_match` | across tenants: `match_profile` and dealbreaker preferences only |
| `clone_matchmaker` | two people at once, and only facts marked **public** |
| `clone_eraser` | deletion |
| `clone` (owner) | migrations, and the two sessions that need cross-tenant reads before a tenant exists |

The agent that goes out **cannot say more than the public facts, because the database
will not show it more than that.**

**No contact details, by code** (`shared/src/contact.ts`, since 2026-09-25). A sentence
holding a phone number (any run of eight digits, or spelled out), an email (also "at …
dot com"), an @handle or a platform id, a link, an off-app invitation ("dm me on
insta") or a street-level address ("12th Main", "flat 302", a pincode) is never repeated
to anybody: `loadQuotes` -- the one door every card, answer sheet, talk and want check
reads through -- drops it, so no model is even shown it, and every later step checks
again (`mayRepeat`). People swap those in chat after both say yes. Not caught: a company
or building named in words; "How you appear" lists every sentence that can be repeated. The answer sheets (0061) hold fact ids, not words:
`clone_app` reads and writes only its own row, `clone_matchmaker` reads every row, and
the words behind each id still come through the matchmaker's public-facts policy.

**Block, report, ban** (0064, since 2026-09-25). Every card, profile, chat, and the
town sheet of somebody you met has "Block or report" (`app/src/features/safety`). A
card names the match, never a person; the server works out the other half, and only of
a match you are half of. A report is one of seven fixed reasons (`REPORT_REASONS` in
`api/messages.ts`, mirrored in the app and checked by `app/tests/safety.test.ts`) and
blocks too. One database function, `apart(me, other)` = a block either way OR the
other is banned, is asked by every place two people meet: the matches list, the profile,
the yes/no, the town, the chat list and every message. A ban (`bans`, `ban_user()`)
revokes every session, takes the person out of the pool and hides them from everybody;
`auth.ts` refuses any session of a banned person, even one minted after. Reports wait
in Settings → "Reports to review", shown only to `ADMIN_USER_IDS`: No action, Hide
photos, or Ban. Settings → "Contact support" writes to abhilash@dabba.com (Apple asks
for report, block and a contact in any app where people talk). A ban outlives erasure
by design.

**A ban sticks to the number and the phone** (0065). The app sends which phone it is
at the four doors -- phone verify, invite redeem, device signup, token upgrade -- as
`X-Device-Id` (`app/src/lib/device.ts`: ANDROID_ID, or a keychain id on iPhone; both
survive a new SIM and deleting the app). The server keeps only a keyed hash of it
(`deviceMark`, same pepper as phone numbers) on the session it makes. A ban copies the
person's number and every phone their sessions were made on into `ban_marks`, and
every door asks `mark_banned()` before spending anything: a new SIM in a banned phone,
or the banned number on a new phone, gets "This account was closed after a report".
The reviewer's own phones are never marked. In production a door with no phone id is
refused ("Update the app"); in development it is let through. The limit: the id is
what the app says it is, so somebody who rewrites the app can send another --
attestation (Play Integrity) is the step after this.

---

## 12. Known-open, with the fix

- **A preference on a multi-valued field tests one arbitrary value.**
  `rebuildMatchProfile` writes `traits[predicate] = v` in a loop, so for `works_in`,
  `media_taste` and `transport` only the *last* value survives into `traits`; all of them
  do reach `attribute_tags`. Somebody in AI *and* software can miss a preference for AI.
  Today it costs ranking points and can never exclude anybody: no multi-valued predicate
  is reachable as a dealbreaker (`MATCHABLE_PREDICATES` are all single-valued). **Fix:**
  write an array into `traits`, add an `any_of` operator to `match_pref_satisfied` in a
  new migration, and teach `synthetic-voice` and the reveal to read arrays.
- **`rank()` is N+1.** It calls `loadPreferences` once per candidate, so 500 candidates
  is ~1,500 round trips inside the read transaction. Fix: load all candidates'
  preferences in one query keyed by user.
- **The typed-decision model is unmeasured.** The adapter, thresholds and fourth
  scorer column exist and are tested against a stubbed endpoint; no real call has been
  made. Set `TYPESAFE_API_KEY` and `DECIDE_MODEL=typesafe:jev-latest` to start
  collecting, then run `compare-scorers.ts` once there are ~50 human decisions.
- **The Face part of the character was removed** (2026-09-23) — it could not work, the
  heads have no morph targets.
- **No real pair can form yet.** All six real users are men looking for women. Nothing
  about matching can be learned until real women are in the pool.
- **Decisions left to the founder** (`AGENT-DESIGN-RESEARCH.md` §8): whether the age
  range is *required* (asked, not required today); faith and politics as cards; round
  cadence; the distance default; reseeding the invented profiles with card answers so
  practice cards look complete; the consent screen still says the agent "talks to other
  agents". Since 2026-09-24 they do talk (§7b) -- a talk built only from each person's own
  sentences -- so the copy is true again in that sense; it should say what the talk is.

---

## 13. The map from a question to a match

```
basics + 5 cards → facts / rules       onboarding/questions.ts, api/interview.ts
           → match_profile (one row)      matching/profile.ts
           → candidates (SQL, symmetric)  matching/candidates.ts
           → pick: real first, weekly cap matching/orchestrator.ts, candidates.ts
           → rank_score (recorded only)   matching/score.ts
           → answer sheets, lined up      matching/answer-sheet.ts (built per person, read per pair)
           → the agents talk (1 call)     matching/talk.ts (points at sentences; stories.ts gives them some)
           → wants beside quotes          matching/wants.ts (only lowers the pick; private = check-only)
           → "I don't know" → a question  matching/unknowns.ts (question of the day, 2 a day)
           → brief per person, by code    matching/brief.ts
           → both tap yes                 orchestrator.ts decide()
           → messaging unlocked           api/messages.ts, messaging/*
           → after 72h, check-in          checkin/questions.ts
           → compare-scorers.ts           which scorer was right
```
