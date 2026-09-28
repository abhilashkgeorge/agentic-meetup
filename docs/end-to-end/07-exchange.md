## 7. The agent-to-agent exchange

The name suggests two chatbots talking freely. **By default they do not.** Free
conversations between agents exist in the code but are switched off
([server/src/matching/rendezvous.ts:75] `export const RUNS = Number(process.env.RENDEZVOUS_RUNS ?? 0);`).
What runs instead is **the talk**: one model call per pair that may only **point**, at a
fixed list of questions and at each person's own numbered sentences. Code then builds
every line a person reads out of those real sentences. The only words a model writes that a
person ever reads are the **date idea**, and code checks those.

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| Arjun's and Meera's own sentences (up to 20 each) | Loaded under each person's own database session, filtered | Code | Nothing | Nobody | [server/src/matching/orchestrator.ts:312] `loadQuotes(plan.a, { predicates: TALK_SOURCES, limit: TALK_SENTENCES })` |
| Both lists, 12 questions, 4 reactions | The model picks questions and sentence numbers, and writes one date idea | {AI:talk} | Nothing yet | Nobody | [server/src/matching/talk.ts:105] `You never write a sentence about a person. You choose:` |
| The model's reply | Code rebuilds the lines from the real sentences and drops anything that breaks a rule | Code | The talk, inside both cards | Each person, on their own card, on their turn | [server/src/matching/talk.ts:244] `lines.push({ by, kind: 'say', text: s.text, ...(s.practice ? { practice: true } : {}) });` |
| The date idea | Checked for length, person words, claims, verdict words, private topics, contact details, and made-up facts | Code | Inside both cards | Both, then in chat after both say yes | [server/src/matching/talk.ts:193] `PERSON.test(idea) || CLAIM.test(idea) || VERDICT.test(idea) || !mayRepeat(idea)` |
| A question one agent could not answer | Shown as "I don't know"; recorded as something to ask that person later | Code | `unknown_asks` row | That person, as a question of the day | [server/src/matching/talk.ts:234] `lines.push({ by, kind: 'dunno', text: "I don't know." });` |
| No talk (a side has no sentences, or the call failed) | The card falls back to pre-built answer sheets | Code | Inside both cards | Each person, their own card | [server/src/matching/talk.ts:312] `if (!a.length || !b.length) return { talk: null, costUsd: 0 };` |

### Arjun and Meera

- **What goes in for Arjun:** things he typed himself and allowed to be shared, for example
  "I spend Sunday mornings at the Cubbon Park run club." A sentence qualifies only if it
  is public, current, not an interview tap, 12 to 300 characters, found word for word in
  something he typed, and names no private topic and no contact detail
  ([server/src/matching/brief.ts:264] `AND f.disclosure = ANY($3::text[])`,
  [server/src/matching/brief.ts:267] `AND length(btrim(f.source_quote)) BETWEEN 12 AND 300`,
  [server/src/matching/brief.ts:270] `WHERE e.user_id = $1 AND e.role = 'user'`,
  [server/src/matching/brief.ts:203] `return !namesCoreValue(text) && contactDetail(text) === null;`).
  Things his clone learned in chat stay private until he taps "OK to share" (stage 4), so
  they do not go in ([server/migrations/0063_learned_is_private.sql:25] `UPDATE facts SET disclosure = 'matchable_only'`).
- **The same for Meera,** loaded under her own session.
- **The model's job:** pick questions from a fixed bank ("What do you do on weekends?",
  and 11 more) and answer each with the **number** of one of that person's sentences, or
  "don't know"; add fixed reactions ("Oh, nice.", "Love that.", "Ha!", "Fair enough."); name
  up to two pairs of sentences the two share; and write one date idea
  ([server/src/matching/answer-sheet.ts:59] `{ id: 'weekends', ask: 'What do you do on weekends?', short: 'Weekends' },`,
  [server/src/matching/talk.ts:65] `nice: 'Oh, nice.',`,
  [server/src/matching/talk.ts:113] `up to 2 pairs of sentence numbers, one from A's list and one from B's`).
- **What Arjun reads on his card** (when it is his turn): "DATE IDEA", "SOMETHING YOU SHARE",
  and "Read what your agents said", which opens the lines as "Your agent" and "Their agent".
  Every answer line is Meera's or Arjun's own sentence, word for word
  ([app/src/features/matches/matches-screen.tsx:58] `{ color: p.textSecondary }]}>DATE IDEA</Text>`,
  [app/src/features/matches/matches-screen.tsx:67] `SOMETHING YOU SHARE</Text>`,
  [app/src/features/matches/matches-screen.tsx:79] `open ? 'Hide the chat' : 'Read what your agents said'`,
  [app/src/features/matches/exchange.ts:153] `speaker: l.who === 'you' ? 'Your agent' : 'Their agent',`).
- **Meera reads the same talk** with the sides swapped, on her own card
  ([server/src/matching/talk.ts:286] `const who = (by: 'a' | 'b'): TalkLine['who'] => (by === reader ? 'you' : 'them');`).
- **If Meera's agent had no sentence about reading**, her line reads "I don't know", and the
  reading question may later become Meera's question of the day
  ([app/src/features/matches/exchange.ts:18] `export const DONT_KNOW = "I don't know";`).

### 7.1 Who speaks, how long, which topics

- **The model chooses** the order and the questions; the prompt asks for 6 to 12 lines "that
  bring out what the two have in common"
  ([server/src/matching/talk.ts:116] `Keep it to 6-12 lines. Ask what brings out what the two have in common.`).
- **Code enforces the shape:** at most 12 lines; each bank question once; an answer only right
  after a question, once per side per question; each sentence used once; a reaction only
  right after the other side's sentence; a question nobody answered is dropped; a talk with
  fewer than two answers is thrown away
  ([server/src/matching/talk.ts:58] `export const MAX_LINES = 12;`,
  [server/src/matching/talk.ts:225] `if (!q || askedIds.has(q.id)) continue;`,
  [server/src/matching/talk.ts:241] `if (i < 0 || i >= list.length || used.has(i)) continue;`,
  [server/src/matching/talk.ts:256] `if (kept.filter((l) => l.kind === 'say').length < 2) return null;`).
- **The 12 topics** are fixed and the same for everybody: weekends, food, music, watching,
  reading, travel, work, goal, pets, active, evening, learning
  ([server/src/matching/answer-sheet.ts:59] `{ id: 'weekends', ask: 'What do you do on weekends?', short: 'Weekends' },`,
  [server/src/matching/answer-sheet.ts:70] `{ id: 'learning', ask: 'What are you learning at the moment?', short: 'Learning' },`).

### 7.2 "I don't know"

The prompt tells the model to use "don't know" "rather than stretch a sentence to fit";
code turns it into the line "I don't know."
([server/src/matching/talk.ts:108] `an agent has no sentence that answers the question. Use it rather than stretch`,
[server/src/matching/talk.ts:234] `lines.push({ by, kind: 'dunno', text: "I don't know." });`).
Each one is recorded against that real person and can become their question of the day
(stage 3) ([server/src/matching/unknowns.ts:127] `INSERT INTO unknown_asks (tenant_id, user_id, question_id) VALUES ($1,$2,$3)`).
The sender's recap also lists them: "It had to say "I don't know" about …. Tell it, and it
will know next time." ([app/src/features/matches/recap.ts:22] `It had to say "I don't know" about ${list(r.unsure)}. Tell it, and it will know next time.`).

### 7.3 The date idea

- **Written by the model**, "under 12 words, says what to do and where, and never mentions
  either person", built on one sentence from each side, and "nothing about kids, faith,
  politics, smoking, drinking or diet"
  ([server/src/matching/talk.ts:114] `The idea is under 12 words, says what to do and where, and never mentions either person`).
- **Checked by code** before it is kept: 8 to 80 characters, at most 14 words, no person
  words (I, you, they...), no claim verbs (loves, likes, enjoys...), no verdict words (match,
  compatible, chemistry, score...), no private topic or contact detail, no quotation marks
  ([server/src/matching/talk.ts:191] `if (idea.length < 8 || idea.length > 80) return null;`,
  [server/src/matching/talk.ts:121] `loves?|likes?|enjoys?|hates?|prefers?|adores?|fan of|into`,
  [server/src/matching/talk.ts:131] `match(es|ed|ing)?|compatib\w*|chemistry|clicks?|clicked`).
- **"Adds no facts":** every content word must come from the two cited sentences or from a
  fixed list of going-out words and Bengaluru public places; otherwise the idea is dropped
  ([server/src/matching/talk.ts:181] `!STOP.has(w) && !DATE_STEMS.has(stem(w)) && !theirs.has(stem(w))`,
  [server/src/matching/talk.ts:156] `'bengaluru', 'bangalore', 'cubbon', 'lalbagh', 'ulsoor', 'nandi', 'hebbal', 'sankey',`).
- **Checked again** when the card is written, every time it is read (it disappears if the
  other person's sentence is no longer shareable), and when someone proposes it in chat
  ([server/src/matching/brief.ts:742] `const date = talk.date && keep(talk.date.theirs) ? talk.date : null;`,
  [server/src/api/date-idea.ts:87] `const idea = raw ? safeIdea(raw) : null;`).

### 7.4 The fallback: answer sheets

Each person has an **answer sheet**: for each of the 12 bank questions, a pointer to one of
their own sentences, or nothing. A model builds it outside the round, whenever their
shareable sentences change ({AI:sheet};
[server/src/matching/answer-sheet.ts:104] `For each question, give the number of the ONE sentence that answers it directly, or null.`,
[server/src/matching/answer-sheet.ts:183] `if (had.rows[0]?.basis === basis) return { built: false, answered: -1 };`).
Only fact ids are stored. When there is no talk, the card shows "WHAT YOUR AGENTS ASKED EACH
OTHER": questions both answered, then only theirs, then up to two the reader answered and
they did not ([server/src/matching/answer-sheet.ts:346] `const answered = [...both, ...onlyTheirs].slice(0, LINES);`,
[app/src/features/matches/matches-screen.tsx:372] `WHAT YOUR AGENTS ASKED EACH OTHER</Text>`).

### 7.5 What is saved, and what people can read

- **Saved:** one `rendezvous` row per pair and one card row per person (headline, shared tags,
  work, quotes, the talk or the sheet exchange, wants with their status, an opener). No
  transcript is saved on the default path, and the model's raw reply is not kept
  ([server/src/matching/brief.ts:619] `v: 2, shared: made.shared, work: made.work, quotes: made.quotes`,
  [server/src/matching/rendezvous.ts:625] `INSERT INTO rendezvous_runs`).
- **Readable:** each person reads only their own card, and only on their turn (stage 9)
  ([server/src/api/dating.ts:623] `const myTurn = r.first_mover === ctx.userId || r.other_decided === true;`).
  Nobody can read transcripts, scores or want statuses in the app
  ([server/migrations/0028_matchmaker.sql:73] `REVOKE ALL ON rendezvous_runs FROM clone_app;`).

### 7.6 The switched-off conversation mode

If `RENDEZVOUS_RUNS` were set above 0, each pair would hold that many short conversations,
5 messages a side ([server/src/matching/rendezvous.ts:85] `const TURNS_EACH = Number(process.env.RENDEZVOUS_TURNS ?? 5);`).
Each agent would get its person's public facts as a list and a sample of how they write,
plus the other person's public tags, with the instruction "Only say things you were actually
told about your person. Never invent a detail to keep it going."; a second model would read
each transcript and return yes, no or not enough ([server/src/matching/rendezvous.ts:116] `Only say things you were actually told about your person. Never invent a detail to keep it going.`,
[server/src/matching/rendezvous.ts:153] `verdict: z.enum(['yes', 'no', 'not_enough']),`). Transcripts
would be stored but never shown, and the verdicts gate nothing
([server/src/matching/orchestrator.ts:352] `const ok = RUNS > 0 && passes(runs.bothYes, runs.counted, RUNS);`).
Details: {AI:converse}.

### Docs vs code

- HOW-IT-WORKS.md calls the talk "the only model call in a round". The want checks are
  model calls in the same round ([HOW-IT-WORKS.md:27] `That talk is **the only model call in a round** -- one small call a pair`,
  [server/src/matching/orchestrator.ts:372] `await checkWants(spender, wantsB, [sentencesA],`).
- HOW-IT-WORKS.md §6 describes "Five runs per pair". That is only true if the switch is set
  to 5; the code default is 0 ([HOW-IT-WORKS.md:273] `**Five runs per pair, five messages each side.** One is politeness; a thousand is a`).
- HOW-IT-WORKS.md §7 says the model phase does "nothing by default". The talk and want checks
  run there by default ([HOW-IT-WORKS.md:316] `nothing by default (conversations off, §6)`).
- HOW-IT-WORKS.md §7a says the answer sheet passes "the same check a quote passes". The same
  verification, but two more kinds of sentence are allowed (goals and dislikes), which the
  card's quote list leaves out on purpose
  ([server/src/matching/answer-sheet.ts:79] `export const SHEET_SOURCES: readonly string[] = [...QUOTABLE, 'goal', 'dislikes'];`).

### Unverified

- How often the talk succeeds in practice: it was added on 2026-09-24 and no round has run
  on the development database since 2026-09-22 (query run 2026-09-28).
