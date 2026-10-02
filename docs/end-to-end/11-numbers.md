## 11. What the Numbers page and the "wants with no question yet" list measure

Both are for the **reviewer** only: an account listed in `ADMIN_USER_IDS`. For anyone else the server answers
"not found", and the Settings row does not appear
([server/src/api/admin.ts:44] `return admins().has(ctx.userId) ? ctx : null;`,
[server/src/env.ts:190] `ADMIN_USER_IDS: z.string().default(''),`).
The way in: YOU → Manage → Settings → "Help and safety" → "Numbers" ("How far matches get, real people only")
([app/src/features/settings/settings-screen.tsx:294] `<Row title="Numbers" subtitle="How far matches get, real people only"`).

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| The reviewer opens Numbers | One database function counts real people and pairs | Code (SQL) | Nothing | The reviewer | [server/migrations/0070_founder_funnel.sql:21] `CREATE FUNCTION founder_funnel() RETURNS TABLE (` |
| Same screen, lower card | Every real person's want sentences are read, private ones and those a question covers are dropped, the rest counted by people | Code | Nothing | The reviewer: topic words, and whole wants only when 2+ people wrote the same thing | [server/src/matching/want-gaps.ts:60] `want: who.size >= 2 ? key : null, topic: topicWords(key), people: who.size,` |

### Arjun and Meera

Neither ever sees these pages. If both wrote "Someone who loves theatre", the reviewer sees the want itself, "2
people"; if only Arjun wrote it, the reviewer sees only its topic word, "theatre · 1 person"
([app/src/features/admin/funnel.ts:28] `k === 1 ? 'person' : 'people'`).

### 11.1 Who counts as a "real person"

Every account that is not a practice profile, whose address is not a test fixture's (`@example.test`), and that
has signed in on a phone at least once ([server/migrations/0070_founder_funnel.sql:28] `WHERE NOT coalesce(p.is_synthetic, false)`,
[server/migrations/0070_founder_funnel.sql:29] `AND u.email NOT LIKE '%@example.test'`,
[server/migrations/0070_founder_funnel.sql:30] `AND EXISTS (SELECT 1 FROM device_sessions d WHERE d.user_id = u.id)`).
A **pair** counts only when both people are real and the round has finished
([server/migrations/0070_founder_funnel.sql:34] `AND r.user_a IN (SELECT id FROM real) AND r.user_b IN (SELECT id FROM real)`).

### 11.2 The numbers, top to bottom

Title "Numbers", "Real people only"; card "HOW FAR MATCHES GET"; counts only, no percentages
([app/src/features/admin/funnel-screen.tsx:39] `<ScreenTitle title="Numbers" subtitle="Real people only" />`,
[app/src/features/admin/funnel-screen.tsx:47] `<Card label="HOW FAR MATCHES GET">`):

| Row | Counts | Code |
|---|---|---|
| Matches | Pairs between two real people, whatever happened next | [server/migrations/0070_founder_funnel.sql:37] `(SELECT count(*) FROM pairs)::int,` |
| Both said yes | Pairs that were introduced | [server/migrations/0070_founder_funnel.sql:38] `(SELECT count(*) FROM pairs WHERE introduced_at IS NOT NULL)::int,` |
| First message | Introduced pairs with at least one message | [server/migrations/0070_founder_funnel.sql:40] `AND EXISTS (SELECT 1 FROM messages m WHERE m.rendezvous_id = x.id))::int,` |
| Date proposed | Pairs where someone tapped "Propose this date" | [server/migrations/0070_founder_funnel.sql:42] `m.kind = 'date_idea'` |
| Met | Pairs where either person said yes to "Did you two meet up?" | [server/migrations/0070_founder_funnel.sql:45] `OR EXISTS (SELECT 1 FROM date_checkins c WHERE c.rendezvous_id = x.id AND c.met)` |
| People | Real people, including those still setting up | [app/src/features/admin/funnel-screen.tsx:53] `<Row title="People" value={String(f.people)} />` |
| Expired, nobody answered | Pairs that ran out of time | [server/migrations/0070_founder_funnel.sql:46] `(SELECT count(*) FROM pairs WHERE status = 'expired')::int` |

Footer: "Invented people, test accounts and anybody who never signed in on a phone are left out. Met counts either
check-in." ([app/src/features/admin/funnel-screen.tsx:57] `Invented people, test accounts and anybody who never signed in on a phone are left out.`).

**Today's values** on the development database (queried 2026-09-28): People 11; Matches 0; every later step 0.
Of the 11, 4 are ready to be sent out. The pool also holds 5,008 practice profiles, which these numbers leave out.

### 11.3 "Wants with no question yet"

- **What goes in:** every live want sentence ("What would you love in someone?" and "couldn't be with") of every
  real person, read through a database function only the matchmaker role may call
  ([server/migrations/0072_founder_unmatched_wants.sql:30] `WHERE f.predicate IN ('seeking', 'dealbreaker')`,
  [server/migrations/0072_founder_unmatched_wants.sql:35] `GRANT EXECUTE ON FUNCTION founder_unmatched_wants() TO clone_matchmaker;`).
- **What is dropped:** any sentence naming a private topic, and any that one of the 12 questions already matches
  ([server/src/matching/want-gaps.ts:51] `if (namesCoreValue(w) || questionForWant(w)) continue;`).
- **How it is counted:** each sentence is lower-cased, punctuation removed and a leading phrase like "I want" or
  "someone who" stripped; then the number of **different people** per sentence is counted, and separately per
  content word ([server/src/matching/want-gaps.ts:30] `(i'd like|i want|i'd love|looking for|must be|must have|must|should be|should|someone who is`,
  [server/src/matching/want-gaps.ts:54] `(byWant.get(key) ?? byWant.set(key, new Set()).get(key)!).add(r.user_id);`).
- **What is shown:** card "WANTS WITH NO QUESTION YET": the 10 most common topic words ("theatre · 2 people"),
  then up to 10 whole wants that two or more people share, most people first; "Every want so far fits a
  question." when empty; footer "A want only one person has shows as its topic, never their words."
  ([app/src/features/admin/funnel-screen.tsx:62] `<Card label="WANTS WITH NO QUESTION YET">`,
  [app/src/features/admin/funnel-screen.tsx:69] `A want only one person has shows as its topic, never their words.`).
- **Why:** to tell the founder which situation questions to add next. It measures demand, not accuracy.

### 11.4 The want-check accuracy test (not in the app)

`server/evals/wants` holds 300 invented want/sentence pairs to be marked by hand on a local page that never shows
the app's own answer; a separate command scores the model against the marks, with a 90% target, and sends nothing
without `--go` ([server/evals/wants/accuracy.ts:19] `export const TARGET = 0.9;`,
[server/evals/wants/score.ts:35] `if (!args.includes('--go')) {`). As of 2026-09-28 no pair is marked and it has
never run.

### Docs vs code

- HOW-IT-WORKS.md §7e says "two ways of saying one want count once". Only wants whose cleaned-up words are identical
  are merged; different wordings are separate rows, joined only through shared topic words
  ([HOW-IT-WORKS.md:653] `Two ways of saying one want count once per person`).
- HOW-IT-WORKS.md §7e says a one-person want "shows as its topic words". The screen does not list one-person wants
  at all; it lists the top topic words across all wants ([HOW-IT-WORKS.md:654] `A want only one person has shows as its`).
