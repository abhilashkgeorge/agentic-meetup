## 15. Known gaps and risks

Ordered by how much they matter. Items marked **(read, not run)** come from reading the code; they were not
reproduced.

### 15.1 Security: the development server

The development server is reachable through a public tunnel so friends' phones can use it (stage 1).
On 2026-09-28 the two switches that let a stranger sign in as a member were turned off in
`server/.env`: an account id no longer works as a sign-in token (`ALLOW_LEGACY_TOKENS=false`), and
the SMS code is no longer sent back in the reply (`SMS_DEV_ECHO=false`). What remains:

1. **Full phone numbers and codes in the server log** (the console SMS sender). Anyone who can read
   the server's log can sign in as that number while a code is fresh
   ([server/src/sms.ts:51] `log.warn({ to, code }, 'SMS (console sender) -- this is the code');`).
2. **The code default is still on.** A new development setup whose `.env` lacks the line turns the
   old sign-in method back on; only a production server refuses it
   ([server/src/env.ts:199] `.default('true')`,
   [server/src/env.ts:344] `if (env.NODE_ENV === 'production' && env.ALLOW_LEGACY_TOKENS) {`).

### 15.2 Private information that can reach another person

3. **Reveal tags skip every privacy rule.** The reveal's up to eight interest and work tags come straight from the
   matching row: chat-learned (match-only) and hidden facts included, with no private-topic filter. "How you appear"
   does not show them ([server/src/api/dating.ts:155] `.filter((t) => t.startsWith('interest:') || t.startsWith('works_in:'))`,
   [server/src/matching/profile.ts:127] `if (typeof v === 'string') tags.push(`).
4. **The first name comes from chat.** No screen asks for a name; if the clone hears a full name, its first word is
   shown to matches, though a full name is a never-public kind ([server/src/matching/profile.ts:80] `displayName = String(v).trim().split(/\s+/)[0] ?? null;`,
   [shared/src/facts.ts:91] `'full_name', 'birth_date', 'works_at', 'has_children', 'close_to', 'lives_with',`).
5. **"Matches" / "Doesn't match" reveals card answers.** A want like "someone Hindu" or "never drinks" is checked
   against the other person's card answer and the result is shown; a want that accepts one answer reveals it. The
   other person was told "Nobody ever sees your answer." ([server/src/matching/wants.ts:198] `m.values.has(answer) ? 'met' : 'not_met'`,
   [server/src/onboarding/questions.ts:202] `why: 'Optional. Nobody ever sees your answer. It is only used to check who fits, both ways.',`).
6. **A "no" shows by timing.** A no removes the other person's card at once; an unanswered card lasts three days
    ([server/src/api/dating.ts:559] `AND r.status NOT IN ('lapsed', 'expired')`).
7. **The message-history endpoint returns the other person's first name and account id for any pair**, before it
    is their turn, after a no, after expiry or a block. The app does not call it early, but anyone using the API
    directly can ([server/src/api/messages.ts:187] `'SELECT display_name, is_synthetic FROM match_profile WHERE user_id = $1', [pair]);`).
8. **"Send my agent over" can test a known person's card answer** (read, not run): the server says "That person has
    moved on." for free when the target fails your rules, so flipping your own must-have and asking again reveals
    their answer ([server/src/api/dating.ts:969] `if (!id) return c.json({ error: 'not_here' }, 404);`).
9. **The town shows the first mover's neighbourhood** to the second mover, which the plain card deliberately hides
    ([server/src/api/world.ts:202] `// for every seat, as for any stranger.`).
10. **Word lists have gaps.** The private-topic list is finite ("family", "wedding", "Diwali" are not on it), and the
    talk and answer sheets also use "goal" and "dislikes" sentences, which the card's own rule leaves out as the place
    "where faith, politics and children are said in prose"
    ([server/src/matching/answer-sheet.ts:79] `export const SHEET_SOURCES: readonly string[] = [...QUOTABLE, 'goal', 'dislikes'];`,
    [server/src/matching/brief.ts:81] `is where faith, politics and children are said in prose.`).
11. **The clone's words can become "the person's".** The extractor reads the clone's replies too, and recall labels
    them "things they said before" ([server/src/memory/extract.ts:182] `t.role === 'user' ? 'PERSON' : 'CLONE'`,
    [server/src/api/chat.ts:89] `Fragments recalled from things they said before:`).
12. **Deleting an account deletes reports against that person and both halves of their chats**
    ([server/migrations/0025_messaging_fixes.sql:100] `FOREIGN KEY (reported_id) REFERENCES app_users(id) ON DELETE CASCADE;`).
    If deletion fails part way, the app still says "Nothing was removed."
    ([app/src/features/settings/settings-screen.tsx:137] `Alert.alert('Not deleted', 'We could not reach the server. Nothing was removed.');`).
13. **Promises that are broader than the code.** "Nobody else has ever seen what your clone knows about you." and
    "Only things marked public ever leave your account." sit beside reveal tags, chat-learned first names, want
    answers, the reviewer's want topics, and AI providers processing the text
    ([app/src/features/settings/settings-screen.tsx:292] `Nobody else has ever seen what your clone knows about you.`).
14. **Latent:** the matchmaker role can read every profile summary, which is written from all facts including private
    ones; nothing reads it in a round today ([server/migrations/0028_matchmaker.sql:51] `GRANT SELECT ON core_profile TO clone_matchmaker;`).
15. **AI providers** receive everything typed to the clone and every message's text (embeddings); the in-app notice
    names the chat providers but not the embedding provider, and its privacy links point to pages the server does not
    serve ([server/src/api/config.ts:51] `privacyUrl: '/legal/privacy',`).

### 15.3 Behaviour a person would not expect

16. **Ten model calls a day, for everyone**, counting chat, learning and rounds together. Setup alone can use most of
    them; then a round fails with "Your agent has been out enough for today", setup screens say "Could not reach the
    server.", and in chat the reason is never shown ([server/src/env.ts:321] `TRIAL_TURN_CAP_PER_DAY: z.coerce.number().default(10),`,
    [app/src/lib/api.ts:361] `return res.ok ? ((await res.json()) as T) : null;`).
17. **Stuck behind a practice profile.** A practice profile can be the first mover; it never answers, so the real
    person waits three days on "They are looking first", then the card disappears (read, not run)
    ([server/src/matching/brief.ts:778] `return a < b ? a : b;`).
18. **Distance is not "both ways".** If either person has no maximum distance, neither limit applies, yet every card
    says "Passes your rules both ways" ([server/src/matching/candidates.ts:74] `OR a.max_distance_km IS NULL OR b.max_distance_km IS NULL`).
19. **"Really want" and "Nice to have" do not change who a round meets**; the screen says they "move people up the
    list" (stage 5).
20. **A city not on the list keeps a person out of the pool** unless they tap "Use my location"; they are told "It does
    not know where you are." ([server/src/matching/profile.ts:151] `if (p === 'lives_in') return lat === null;`).
21. **Someone who turns 18 this year is refused all year**, because only the birth year is asked
    ([shared/src/values.ts:118] `return typeof value.month === 'number' && value.month <= now.getUTCMonth() + 1;`).
22. **A mistyped invite code burns the sign-in ticket**; the retry says "That took too long. Ask for a new code.", and the
    invite screen has no back button ([server/src/api/auth.ts:194] `phone = await phoneSession((db) => spendTicket(db, body.data.ticket!));`).
23. **"Yes, that's right" can do more than agree.** A confirmed free phrase replaces a card answer with "unknown" (for
    example "socially" for drinking), and a confirmed city phrase without a map point takes the person out of the pool
    ([server/src/memory/pasteImport.ts:329] `objectText: row.object_text,`).
24. **Unconfirmed chat can still retire answers** on multi-answer fields such as who they want to meet or work field, with
    no Yes and no record (read, not run) ([server/src/memory/session.ts:127] `UPDATE facts SET valid_to = now(), invalidated_at = now(), status = 'superseded'`).
25. **Rule clashes.** Two wants tied to the same question overwrite each other's rule; a must-have outlives its want
    sentence and cannot be deleted, only changed in strength ([server/src/matching/profile.ts:391] `ON CONFLICT (user_id, predicate, operator) WHERE retired_at IS NULL`).
26. **Cards can expire unseen.** Only one "waiting on you" card shows at a time, and there are no push notifications
    ([app/src/features/matches/matches-screen.tsx:320] `[...matches.filter((m) => m.waitingOnYou).slice(0, 1),`).
27. **Check-in details.** "Not yet" is final; tapping Block from "Did you feel safe?" drops the unsafe answer; "Not sure"
    counts toward "Confirmed by N people" ([app/src/features/dm/checkin.tsx:77] `const done = () => router.back();`,
    [server/migrations/0058_date_checkins.sql:67] `WHERE a.key IN ('photos', 'age', 'name', 'city') AND a.value = 'no'))`).
28. **The practice pool will disappear around 2026-11-11.** Its 5,008 profiles keep their seeding date (2026-09-12 to
    14) as "last active", and the 60-day activity rule then removes them all, unless the pool is reseeded (query run
    2026-09-28) ([server/src/matching/candidates.ts:98] `AND b.last_active_at > now() - interval '60 days'`).

### 15.4 Money and operations

29. Embeddings are not metered or priced; Gemini's thinking tokens are recorded but not priced; Gemini calls have no
    retry and no timeout; the per-session output cap is not enforced; the in-repo spend report (`npm run stats`)
    reads through a role that sees no rows, so it shows zero; a first-screen sentence is extracted twice
    ([server/src/llm/adapters/google.ts:31] `cached ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });`,
    [server/src/db/stats.ts:5] `const u = await adminSession((c) => usage7d(c));`).
30. **Documentation drift.** HOW-IT-WORKS.md, ARCHITECTURE.md, ENGINE-DECISION.md, both READMEs and several code
    comments describe older designs; the "Docs vs code" notes in each stage list the specific disagreements.
