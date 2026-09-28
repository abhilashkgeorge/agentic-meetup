## 5. Wants: from a sentence to a check

A **want** is a sentence a person writes about who they want, or who they could not be
with. The app never turns a want into a filter on its own. Each want ends up in one of
three shapes:

- **Tied to a question.** If the words match one of 12 fixed questions, the app offers
  that question and the person ticks the answers they would accept. Code then compares
  the other person's answer. Only a tied want set to **Must have** can hide anybody.
- **Private.** If the words touch a private topic (faith, kids, drinking, smoking, diet,
  politics, health...), the want is never tied and never quoted. A model maps it to one of
  six cards; code compares the other person's card answer. The card never says how that came
  out (since 2026-09-28); the check only moves a not-met person later in the round, silently.
- **Untied.** Everything else. A model reads up to 10 of the other person's own sentences
  and points at one that settles the want, or says nothing does.

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| Arjun types "What would you love in someone?" | Saved as one `seeking` fact, match-only | Code | `facts` row + an episode with his words | Arjun; his agent's checks; the founder's list (topic words or shared text only) | [server/src/onboarding/stories.ts:150] `predicate: want ? 'seeking' : 'prompt_answer'` |
| Answer to "Anyone else you couldn't be with?" | Saved as a `dealbreaker` fact; a model may also propose a card change | Code, plus {AI:dealbreaker} | `facts` row | Same as above | [server/src/api/interview.ts:341] `predicate: 'dealbreaker',` |
| A want's words match a question | The question is offered; Arjun ticks the answers he accepts | Code (word patterns) | `preferences` row: field, ticked values, strength | Arjun, on "Looking for" | [server/src/matching/want-questions.ts:84] `if (w.pattern.test(text)) return { want: w` |
| Arjun taps "Must have" | The rule becomes a hard filter, both directions | Code (SQL) | `preferences.strength = 'dealbreaker'` | Arjun | [server/src/matching/candidates.ts:81] `// The only place a personal rule excludes anybody. Both directions.` |
| A round meets Meera: tied want | Her answer is compared with his ticks | Code | Status on the card record | Arjun sees "Matches", "Doesn't match" or "We can't check this one yet." | [server/src/matching/want-questions.ts:113] `return ask.accepted.includes(v) ? 'met' : 'not_met';` |
| A round meets Meera: untied or private want | One model call checks all of Arjun's untied wants against his first 12 candidates | {AI:wants}, then code | Status (+ her sentence) on the card record | Untied: her sentence, or "Nothing they've said covers this yet." Private: only "A private topic. Their answer is never shown." | [server/src/matching/wants.ts:257] `task: 'extract',` |
| Meera never answered the question | The want reads "can't check"; a request to ask Meera is recorded | Code | `unknown_asks` row about Meera | Meera may get it as a question of the day; the asker is never named | [server/src/matching/unknowns.ts:127] `INSERT INTO unknown_asks (tenant_id, user_id, question_id)` |

### Arjun and Meera

- **Arjun writes his wants.** On "Things to talk about" → "What would you love in someone?"
  he types: "I want someone who saves money, not an impulse spender. Someone kind." That
  is one `seeking` fact, split into two wants when read
  ([server/src/matching/wants.ts:84] `text.split(/(?<=[.!?;])\s+|\n+/)`).
- **The first want gets a question.** "saves", "money" and "spender" match the windfall
  question, which comes before the "impulse" question in the list, so Arjun is offered:
  "You get an unexpected ₹50,000. What happens to most of it?"
  ([server/src/matching/want-questions.ts:35] `{ questionId: 'sit-windfall',`,
  [server/src/onboarding/questions.ts:329] `You get an unexpected ₹50,000. What happens to most of it?`).
  "Someone kind" matches nothing, so it stays a sentence.
- **What Arjun sees** on YOU → Manage → "What you're looking for": his first want in
  quotes, "We can ask people this. Tick the answers that are fine for you.", the question,
  five answer chips and "Use this question". Under "Someone kind": "Checked against what
  people write. It can only move people down, never hide them."
  ([app/src/features/preferences/wants-state.ts:42] `We can ask people this. Tick the answers that are fine for you.`,
  [app/src/features/preferences/wants-card.tsx:67] `We ask: “{q.text}”`,
  [app/src/features/preferences/wants-card.tsx:78] `w.accepted ? 'Save changes' : 'Use this question'`,
  [app/src/features/preferences/wants-state.ts:39] `Checked against what people write. It can only move people down, never hide them.`)
- **He ticks** "Saved or invested" and "Pays off something I owe". The server stores the
  values `save-invest` and `pay-off`, strength "Really want"
  ([server/src/api/wants.ts:101] `predicate: wq.question.predicate, operator: 'in', value: ticked,`).
- **Meera's side, round one.** Situation questions are never asked during onboarding, so
  Meera has most likely not answered the ₹50,000 question. Arjun's card about her then
  says "We can't check this one yet." for that want, and the app records that Meera
  should be asked it ([server/src/onboarding/next-question.ts:110] `// SITUATIONS ARE NEVER ASKED HERE. They exist for other people's wants and arrive`,
  [server/src/matching/unknowns.ts:88] `if (r.question && r.status === 'cant_check' && CARD_QUESTIONS.has(`).
- **What Meera sees** later, if it is her most-asked gap: a "A question for you" chip in
  the town; the screen says "MONEY", the question, and "Other agents needed this once
  lately to check who fits, and yours could not say. One tap. Nobody ever sees your
  answer." ([app/src/features/world/hud.tsx:155] `<Chip label="A question for you" selected onPress={onQuestion} />`,
  [app/src/features/question/question-state.ts:45] `lately to check who fits, and yours could not say. One tap. Nobody ever sees your answer.`).
  She is never told whose want it was, or what the want said.
- **If Meera had answered** "Saved or invested", Arjun's card says "Matches"; if she
  answered "A treat: a trip, a gadget, a night out", it says "Doesn't match" and she moves
  later in Arjun's order, never out
  ([server/src/matching/wants.ts:297] `[c.synthetic ? 1 : 0, notMet.get(c.userId) ?? 0, i]`).
- **If Arjun had tapped "Must have"**, a Meera who answered "A treat" would never be met by
  Arjun's agent, and Arjun would never be met by hers: each person's must-haves apply to
  both searches ([server/src/matching/candidates.ts:91] `AND NOT ${passes('b')})`,
  [server/src/matching/candidates.ts:95] `AND NOT ${passes('a')})`). A Meera who never answered
  still passes.
- **"Someone kind"** goes to the model with up to 10 of Meera's own public sentences. If
  the model points at one, Arjun's card shows "You asked for “Someone kind”" and "They
  said" with her sentence, with no verdict word. Otherwise: "Nothing they've said covers
  this yet." ([app/src/features/matches/exchange.ts:205] `label, want, prefix: 'They said',`,
  [app/src/features/matches/exchange.ts:169] `export const NOTHING_YET = "Nothing they've said covers this yet.";`).
- **Meera never sees Arjun's wants**, or that he has any. Her card about Arjun lists only
  her own wants ([server/src/matching/orchestrator.ts:386] `forB: wantRows(bChecked ? bChecked.results[0] : cantCheck(wantsB)),`).

### 5.1 Where wants come from

- **Stories screen.** "What would you love in someone?", with the hint "Only you see this.
  Your agent looks for it in what people say about themselves." and the label "Only for
  your agent" ([server/src/onboarding/stories.ts:57] `id: 'story-want', text: 'What would you love in someone?', forYou: true,`,
  [server/src/onboarding/stories.ts:58] `Only you see this. Your agent looks for it in what people say about themselves.`,
  [app/src/features/stories/stories-screen.tsx:79] `<Card key={s.id} {...(s.forYou ? { label: 'Only for your agent' } : {})}>`).
  12 to 300 characters ([server/src/onboarding/stories.ts:67] `export const STORY_MIN = 12;`,
  [server/src/onboarding/stories.ts:68] `export const STORY_MAX = 300;`). Saving writes one
  `seeking` fact, visibility "match-only"
  ([server/src/onboarding/stories.ts:154] `...(want ? { disclosure: 'matchable_only' as const } : {}),`).
  There is only ever one live `seeking` fact: saving again replaces the whole sentence
  ([server/src/onboarding/stories.ts:147] `single-valued, so a new one supersedes the old by itself`).
- **The interview's free sentence.** "Anyone else you couldn't be with?", up to 400
  characters, stored as a `dealbreaker` fact
  ([server/src/onboarding/questions.ts:220] `text: 'Anyone else you couldn\'t be with?',`,
  [server/src/api/interview.ts:209] `text: z.string().max(400).optional(),`). Several can
  stay live at once ([shared/src/facts.ts:138] `{ name: 'dealbreaker',`). The same sentence
  also goes to a model that may propose a change to one card's "Who's fine" row; only the
  person's "Keep this" writes it ({AI:dealbreaker}; [server/src/api/interview.ts:359] `const m = await metered(ctx, 'extract', () => mapDealbreaker(ctx, sentence));`).
- **Chat.** The chat extractor may also write `seeking` or `dealbreaker` facts. These fields
  are not "tapped" fields, so they go live at once, without a confirm step
  ([server/src/memory/extract.ts:237] `originClass: TAPPED_PREDICATES.has(f.predicate) ? 'untrusted' : 'owner',`).
  Unverified: how often this happens in practice.
- **How a want is read.** Only live `seeking` and `dealbreaker` facts count
  ([server/src/matching/wants.ts:43] `export const WANT_SOURCES = ['seeking', 'dealbreaker'] as const;`).
  Each is split into sentences, pieces under 4 characters dropped, duplicates removed, and
  only the **first five** kept, newest first
  ([server/src/matching/wants.ts:44] `export const MAX_WANTS = 5;`,
  [server/src/matching/wants.ts:105] `return await withAsks(who, out.slice(0, MAX_WANTS));`).
  A want from "could not be with" is marked `not`; a want naming a private topic is marked
  private ([server/src/matching/wants.ts:102] `kind: r.predicate === 'dealbreaker' ? 'not' : 'wants'`,
  [server/src/matching/wants.ts:102] `private: namesCoreValue(text)`).
- **Deleting a want.** There is no button to delete a single want. Re-saving the story
  replaces the `seeking` sentence; "Delete everything" removes all. Unverified beyond the
  route list the research checked.

### 5.2 Tying a want to a question

- **Matching is by word patterns, not by a model.** The first of 12 patterns that matches
  wins; no match leaves the want as a sentence
  ([server/src/matching/want-questions.ts:13] `FIRST MATCH WINS, in this order, and the words are narrow on purpose: a want that`,
  [server/src/matching/want-questions.ts:83] `for (const w of WANT_QUESTIONS) {`).
- **The 12 questions**, in match order: street food; the ₹50,000 windfall; the last
  unplanned big buy; the last book finished; looking after a friend's dog; weeknight
  dinner; "What field are you in?"; "How often do you move your body?"; "Early or late?";
  a long weekend with no plans; a 7 pm call about plans tonight; "Would you move cities for
  the right person?" ([server/src/matching/want-questions.ts:31] `export const WANT_QUESTIONS: readonly WantQuestion[] = [`,
  [server/src/onboarding/questions.ts:336] `A friend takes you to a tiny street stall. Amazing food, not very clean.`,
  [server/src/onboarding/questions.ts:345] `The last book you finished: when was it?`,
  [server/src/onboarding/questions.ts:259] `text: 'What field are you in?',`,
  [server/src/onboarding/questions.ts:312] `text: 'Would you move cities for the right person?',`).
  Eight are "situation" questions; four are optional profile questions. A want can never be
  tied to the basics, the five core cards or the faith card.
- **The screen** is YOU → Manage → "What you're looking for", titled "Looking for": "Only
  must-haves remove anybody. Everything else just ranks."
  ([app/src/features/profile/profile-screen.tsx:273] `<Row title="What you're looking for" subtitle="Your filters, and what each one costs"`,
  [app/src/features/preferences/preferences-screen.tsx:68] `title="Looking for" subtitle="Only must-haves remove anybody. Everything else just ranks."`).
  The "Your wants" card lists each want with one line
  ([app/src/features/preferences/wants-state.ts:38] `'Checked against your card. Nobody sees your answer.'`,
  [app/src/features/preferences/wants-state.ts:39] `Checked against what people write. It can only move people down, never hide them.`,
  [app/src/features/preferences/wants-state.ts:41] `? 'Checked against their answer to this question.'`,
  [app/src/features/preferences/wants-state.ts:42] `We can ask people this. Tick the answers that are fine for you.`),
  and ends "Nobody is told what you asked for, or that it was you."
  ([app/src/features/preferences/wants-card.tsx:28] `Nobody is told what you asked for, or that it was you.`).
- **Ticking.** Nothing is pre-ticked. "Use this question" is disabled until one answer is
  ticked; ticking every answer stores no rule at all ("Every answer is fine, so this rules
  nobody out and ranks nobody.")
  ([app/src/features/preferences/wants-state.ts:22] `export const startTicks = (w: WantView): string[] => w.accepted ?? [];`,
  [app/src/features/preferences/wants-card.tsx:75] `Every answer is fine, so this rules nobody out and ranks nobody.`,
  [server/src/api/wants.ts:96] `if (ticked.length === values.size) return;`).
- **What is stored** is a `preferences` row: field, operator `in`, the ticked **values**
  (not the labels), a strength that starts at "Really want", and the want's own words as
  its source ([server/src/api/wants.ts:101] `predicate: wq.question.predicate, operator: 'in', value: ticked,`,
  [server/src/api/wants.ts:103] `sourceQuote: want,`). "Stop checking" retires the rule;
  rules are retired, never deleted ([server/src/api/wants.ts:90] `// Whatever this want wrote before goes: retired, never deleted.`).

### 5.3 Must have, Really want, Nice to have

- **Three strengths**: Must have (`dealbreaker`), Really want (`strong`), Nice to have
  (`mild`) ([app/src/features/preferences/strengths.ts:11] `{ value: 'dealbreaker', label: 'Must have' },`,
  [app/src/features/preferences/strengths.ts:12] `{ value: 'strong', label: 'Really want' },`,
  [app/src/features/preferences/strengths.ts:13] `{ value: 'mild', label: 'Nice to have' },`).
- **Must have is allowed only on fields the person tapped themselves**: the basics, the
  five cards, faith, the eight situation answers, and (since 2026-09-28) work field,
  exercise, sleep and moving cities. On these fields a sentence said in chat waits for the
  person's Yes before it counts, so chat can never silently move someone into or out of a
  must-have ([server/src/onboarding/questions.ts:425] `export function mustHaveAllowed(predicate: string): boolean {`,
  [server/src/onboarding/questions.ts:426] `return TAPPED_PREDICATES.has(predicate);`,
  [server/src/onboarding/questions.ts:415] `'works_in', 'exercise_habit', 'sleep_pattern', 'relocation_openness',`).
  The server refuses a must-have anywhere else
  ([server/src/api/dating.ts:524] `A must-have only hides someone over an answer they tapped`).
- **What a Must have does.** It is the only personal rule that removes anybody, and it is
  checked both ways: Arjun's must-haves on Meera, and Meera's must-haves on Arjun
  ([server/src/matching/candidates.ts:90] `WHERE p.user_id = a.user_id AND p.strength = 'dealbreaker' AND p.retired_at IS NULL`,
  [server/src/matching/candidates.ts:94] `WHERE p.user_id = b.user_id AND p.strength = 'dealbreaker' AND p.retired_at IS NULL`).
  A field with several answers (the work field) passes if any of the other person's
  answers is ticked ([server/src/matching/candidates.ts:30] `THEN match_pref_satisfied_multi(p.predicate, p.operator, p.value,`).
- **What Really want and Nice to have do.** They feed a score (weight 3 and 1) that is
  recorded on each pair but **no longer decides who a round meets**
  ([server/src/matching/score.ts:25] `dealbreaker: 0, // already enforced by the filter; counting it again double-dips`,
  [server/src/matching/orchestrator.ts:167] `it just no longer decides who is met.`). The one place the
  score still orders people is the town's square, where the 40 strangers shown are the top
  of the score ([server/src/api/world.ts:180] `ids = (await rank(db, me, fresh, STRANGERS_IN_SQUARE)).map((r) => r.userId);`).
  In a round, what moves a person later is the want check: each "not met" want pushes that
  candidate later within their group (real people stay ahead of practice profiles),
  whatever the strength ([server/src/matching/wants.ts:284] `rs.filter((r) => r.status === 'not_met').length`).
- **The pool count.** "Who your agent can reach" shows how many people pass every filter,
  rounded to the nearest 10; below 20 it says "Under 20" and a warning such as "Very few
  people fit. Turn a must-have into a want to reach more."
  ([server/src/matching/candidates.ts:213] `export const SHOWN_FLOOR = 20;`,
  [app/src/lib/counts.ts:12] `return n === null || n === undefined ? 'Under 20' : n.toLocaleString();`,
  [app/src/features/preferences/preferences-screen.tsx:98] `Very few people fit. Turn a must-have into a want to reach more.`).

### 5.4 When the other person has not answered

- **The filter lets them through.** An unanswered field is "unknown", never a mismatch,
  even for a Must have ([server/migrations/0020_match_functions.sql:22] `WHEN actual IS NULL OR jsonb_typeof(actual) = 'null' THEN true`,
  [server/migrations/0071_must_have_fields_wait_for_yes.sql:40] `-- Nothing answered on this field: unknown, never a mismatch.`).
  Every card carries the same line: "Passes your rules both ways, on everything they've
  answered" ([server/src/matching/brief.ts:65] `export const BRIEF_LINE = "Passes your rules both ways, on everything they've answered";`).
- **The card says** "We can't check this one yet." for that want
  ([app/src/features/matches/exchange.ts:170] `export const CANT_CHECK = "We can't check this one yet.";`).
- **The other person may be asked.** A tied want that could not be checked records
  `ask:<question>` against the other person; a private want records `card:<field>`
  ([server/src/matching/unknowns.ts:88] `if (r.question && r.status === 'cant_check' && CARD_QUESTIONS.has(`,
  [server/src/matching/unknowns.ts:76] `if (r.private && r.status === 'cant_check' && r.card &&`).
  It becomes a candidate for their question of the day: the most-asked open gap from the
  last 14 days, at most 2 a day, and not again for 7 days after a skip
  ([server/src/matching/unknowns.ts:29] `export const DAILY_QUESTIONS = 2;`,
  [server/src/matching/unknowns.ts:31] `export const QUIET_DAYS = 7;`,
  [server/src/matching/unknowns.ts:33] `export const WINDOW_DAYS = 14;`).
  Practice profiles are never asked
  ([server/src/matching/orchestrator.ts:415] `(pair.b.synthetic ? [] : [{ tenantId: pair.b.tenantId`).
- **A written card is not updated** when the answer arrives later: the want results are
  stored with the card when the round runs
  ([server/src/matching/brief.ts:633] `wants: made.wants,`).

### 5.5 Untied and private wants: the model check

- **When.** Whenever the person starting a round has at least one untied or private want,
  one model call checks all of those wants against the first 12 people of the shortlist,
  10 sentences each. A second call checks each real person's own wants against the
  starter's sentences, for that person's card. Both calls are charged to the starter
  ([server/src/matching/wants.ts:307] `export const WANT_WINDOW = 12;`,
  [server/src/matching/wants.ts:308] `export const WANT_SENTENCES = 10;`,
  [server/src/matching/orchestrator.ts:214] `await metered(spender, 'rendezvous', () => checkShortlist(spender, wantsA, shortlist.order))`,
  [server/src/matching/orchestrator.ts:372] `await checkWants(spender, wantsB, [sentencesA],`).
  If every want is tied, no call is made
  ([server/src/matching/wants.ts:231] `wants.map((w) => asked(w, pi))), costUsd: 0`).
  Full details are in {AI:wants}.
- **Whose words go in.** The reader's own want text, and the other person's own public
  sentences: never interview answers, 12 to 300 characters, found word for word in
  something they typed, with no private topic and no contact detail
  ([server/src/matching/brief.ts:266] `AND f.extractor_model <> 'interview'`,
  [server/src/matching/brief.ts:268] `AND length(btrim(f.source_quote)) BETWEEN 12 AND 300`,
  [server/src/matching/brief.ts:279] `opts.includeHidden ? ['public', 'private'] : ['public']`).
  Another person's wants are never sent as sentences.
- **Code checks the answer.** A "met" or "not met" survives only with the number of one of
  that person's sentences; the quote shown is looked up by that number, never copied from
  the model's reply. Anything else becomes "unknown"
  ([server/src/matching/wants.ts:202] `c.sentence >= 1 && c.sentence <= list.length`,
  [server/src/matching/wants.ts:203] `if (!c || !s || !mayRepeat(s.text)) return`).
- **Private wants.** The model maps the want to one of six cards (kids, one person or open,
  smoking, drinking, food, faith) and the answers that satisfy it; code then compares the
  other person's answer on that card
  ([server/src/matching/wants.ts:196] `const answer = m ? cardsOf[pi]?.[m.card] : undefined;`,
  [server/src/matching/wants.ts:198] `m.values.has(answer) ? 'met' : 'not_met'`). The result is
  stored and moves a not-met person later in the round, but whatever it is -- met, not met, or no
  card to check (politics, health) -- Arjun's card says only "A private topic. Their answer is never
  shown." ([server/src/matching/brief.ts:446] `if (namesCoreValue(w.want)) return 'private';`).
  "Matches" beside "Someone who doesn't drink" used to tell him Meera's card answer, which she was
  promised nobody sees.
- **If the call fails**, every want on that side, tied ones included, reads "We can't
  check this one yet." (a private one keeps its private line) and nothing is recorded to ask later
  ([server/src/matching/wants.ts:238] `return r ? { results: merge(r.results), costUsd: r.costUsd } : null;`).

### 5.6 What the card shows

Section "WHAT YOU ASKED FOR", with each of the reader's own wants
([app/src/features/matches/matches-screen.tsx:388] `WHAT YOU ASKED FOR`):

| Kind of want | Label | Answer line |
|---|---|---|
| Untied, a sentence found | "You asked for" / "You couldn't be with" | "They said" + their sentence in quotes (a practice profile's line is marked "(practice)") |
| Untied, nothing found | same | "They said" + "Nothing they've said covers this yet." |
| Tied to a question | same | "Matches" or "Doesn't match" |
| Private topic | same | "A private topic. Their answer is never shown." whatever the check found |
| Could not be checked | same | "We can't check this one yet." |

Sources: [app/src/features/matches/exchange.ts:197] `const label = w.kind === 'not' ? "You couldn't be with" : 'You asked for';`,
[app/src/features/matches/exchange.ts:201] `w.check === 'matches' ? 'Matches' : w.check === 'doesnt_match' ? "Doesn't match"`,
[app/src/features/matches/exchange.ts:178] `export const PRIVATE_TOPIC = 'A private topic. Their answer is never shown.';`.
An untied want shows no verdict: "met" and "not met" look the same, and the reader judges
the sentence ([server/src/matching/brief.ts:708] `// NO STATUS. The want and the quote, side by side; the reader judges. A want tied to`).
Never shown: the other person's wants, their actual card answer, how a private-topic want came
out, and any quote beside a tied or private want
([server/src/matching/brief.ts:714] `want: w.want, kind: w.kind, theirs: w.private || check === 'private' ? null : w.theirs,`).

### 5.7 After a date

If a tied want showed "Matches" on the reader's card, the after-date check-in may ask
"You wanted “…”. Did they seem that way?" (or, for a could-not-be-with, "You didn't want
“…”. Were they fine on that?"), at most two such questions
([server/src/checkin/questions.ts:56] `You wanted “${w.text}”. Did they seem that way?`,
[server/src/checkin/questions.ts:42] `const MAX_WANTS = 2;`). See stage 10.

### Docs vs code

- HOW-IT-WORKS.md says a round's only model call is the agents' talk, and a comment above
  the round route says "A round makes no model call". The code also makes the want-check
  calls above, by default ([HOW-IT-WORKS.md:810] `since 2026-09-24 -- the agents' talk`,
  [server/src/api/dating.ts:944] `A round makes no model call (orchestrator.ts), so what limits it`,
  [server/src/matching/orchestrator.ts:23] `NO MODEL ON THE DEFAULT PATH, SINCE 2026-09-23.`).
- HOW-IT-WORKS.md says a want that names a card "is left out". The code keeps it as a
  private want and checks it ([HOW-IT-WORKS.md:522] `cards is left out, because the card already checks it exactly, both ways.`,
  [server/src/matching/wants.ts:22] `NEVER DROPPED SILENTLY (the founder, 2026-09-25). Every want is on the card.`).
- HOW-IT-WORKS.md says a want's status is "never sent to a phone". That is true for untied
  and private-topic wants; for a tied want "Matches"/"Doesn't match" and "can't check" are sent
  ([HOW-IT-WORKS.md:545] `brief for measurement and never sent to a phone.`,
  [server/src/matching/brief.ts:449] `w.status === 'met' ? 'matches' : w.status === 'not_met' ? 'doesnt_match'`).
- The app says wants "move people up the list". Nothing moves anybody up in a round: the
  score no longer picks, and the want check only moves people down
  ([app/src/features/preferences/preferences-screen.tsx:141] `These never remove anybody. They move people up the list.`).
- The app says a private want is "Checked against your card". It is checked against the
  **other person's** card ([server/src/matching/wants.ts:196] `const answer = m ? cardsOf[pi]?.[m.card] : undefined;`).
- The footer "Must-haves come from your cards" is no longer the whole story: a tied want
  set to Must have is a must-have too
  ([app/src/features/preferences/preferences-screen.tsx:171] `Must-haves come from your cards. Your agent never adds one by itself: what you`).
- The interview says a sentence no card holds "can't be checked on paper" ("We can't check
  that on paper. You'll spot it in the first chat."). Since 2026-09-25 that sentence is a
  want and is checked every round
  ([app/src/features/onboarding/sentence-proposal.ts:38] `We can't check that on paper. You'll spot it in the first chat.`).
- HOW-IT-WORKS.md §12 says no multi-answer field can be a must-have; since 0071 the work
  field can be ([HOW-IT-WORKS.md:891] `can never exclude anybody: no multi-valued predicate`).
- "How you appear" reads back only must-haves on the five cards; a must-have on a tied want
  is not read back ([server/src/api/me.ts:136] `[ctx.userId, ALL_CARDS.map((k) => k.predicate)]`).

### Unverified

- The real cost of one want-check call: it has never run on real data (the development
  database has had no rounds since 2026-09-22; query run 2026-09-28).
- The rule clashes in "Known gaps" (two wants on one question, orphaned rules) are read
  from the SQL, not run.
- Whether the model maps the same private want to the same card every round.
