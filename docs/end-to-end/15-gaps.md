## 15. Known gaps and risks

Ordered by how much they matter. Items marked **(read, not run)** come from reading the code; they were not
reproduced.

### 15.1 Security: before anyone else uses the development server

The development server is reachable through a public tunnel so friends' phones can use it (stage 1). Three
development switches are on there. A production server refuses to start with any of them, but the development
server does not:

1. **A person's account id works as their password.** `ALLOW_LEGACY_TOKENS` defaults to on and is not set in the
   development configuration, so a bare account id is accepted as a sign-in token. The reveal and chat
   endpoints give each person the other's account id
   ([server/src/env.ts:199] `.default('true')`, [server/src/auth.ts:72] `if (/^[0-9a-f-]{36}$/i.test(token)) {`,
   [server/src/api/dating.ts:171] `userId: other.user_id,`). Fix: set `ALLOW_LEGACY_TOKENS=false` once no phone
   still holds an old-style token.
2. **The SMS code is sent back in the reply** (`SMS_DEV_ECHO=true`). Anyone who knows the tunnel address and a
   member's phone number can sign in as that member; the reply also shows whether a number has an account
   ([server/src/api/auth.ts:451] `...(env.SMS_DEV_ECHO ? { devCode: code, devEchoIsOn: true } : {}),`,
   [server/src/api/auth.ts:610] `return c.json({ status: 'signed_in', token: mintToken(sessionId), onboarded });`).
   Fix: turn it off; with the console sender the code is still in the server log for the founder.
3. **Full phone numbers and codes in the server log** (console sender)
   ([server/src/sms.ts:51] `log.warn({ to, code }, 'SMS (console sender) -- this is the code');`).

### 15.2 Introduced on 2026-09-28 (commit 34f33cf, "chat changes wait for a yes")

4. **A "Yes, that's right" now also shares.** Work field, exercise and sleep became held-for-confirmation fields.
   Confirming one keeps that field's default visibility, which is public, and those kinds are quotable, so a
   sentence the person said to their clone can reach strangers' cards, sheets and the talk without "OK to share".
   Before this change the same sentence stayed match-only
   ([server/src/memory/pasteImport.ts:335] `...(TAPPED_PREDICATES.has(row.predicate) ? {} : { disclosure: 'matchable_only' as const }),`,
   [shared/src/facts.ts:77] `'exercise_habit', 'diet', 'dietary_restriction', 'sleep_pattern',`,
   [server/src/matching/brief.ts:87] `'works_in', 'industry', 'exercise_habit', 'sleep_pattern', 'transport',`).
5. **The first setup screen can refuse to move on.** It advances only if a fact went live; a first sentence about
   work, exercise, sleep or moving cities (and, as before, city, gender or age) is only held, so the person reads
   "Got it. N to check on the You screen…" and stays on the screen. The first example sentence offered there can
   do this. Depends on how the model files the sentence (read, not run)
   ([app/src/features/onboarding/start-screen.tsx:46] `if (learned.learned === 0) { setNote(learned.message); return setStage('ask'); }`,
   [server/src/api/tell.ts:88] `if (r.outcome === 'staged') staged++;`).

### 15.3 Private information that can reach another person

6. **Reveal tags skip every privacy rule.** The reveal's up to eight interest and work tags come straight from the
   matching row: chat-learned (match-only) and hidden facts included, with no private-topic filter. "How you appear"
   does not show them ([server/src/api/dating.ts:155] `.filter((t) => t.startsWith('interest:') || t.startsWith('works_in:'))`,
   [server/src/matching/profile.ts:127] `if (typeof v === 'string') tags.push(`).
7. **The first name comes from chat.** No screen asks for a name; if the clone hears a full name, its first word is
   shown to matches, though a full name is a never-public kind ([server/src/matching/profile.ts:80] `displayName = String(v).trim().split(/\s+/)[0] ?? null;`,
   [shared/src/facts.ts:91] `'full_name', 'birth_date', 'works_at', 'has_children', 'close_to', 'lives_with',`).
8. **"Matches" / "Doesn't match" reveals card answers.** A want like "someone Hindu" or "never drinks" is checked
   against the other person's card answer and the result is shown; a want that accepts one answer reveals it. The
   other person was told "Nobody ever sees your answer." ([server/src/matching/wants.ts:198] `m.values.has(answer) ? 'met' : 'not_met'`,
   [server/src/onboarding/questions.ts:202] `why: 'Optional. Nobody ever sees your answer. It is only used to check who fits, both ways.',`).
9. **Profiles and photos before any yes.** The first mover sees the other's first name, age, city, tags and photos
   before the other person does anything; several first movers can see the same photos at once. Sign-up and the
   photo screens promise "after both said yes" and "one person at a time" (stage 9)
   ([server/migrations/0032_photos.sql:76] `OR r.first_mover = viewer`,
   [app/src/features/photos/photos-screen.tsx:133] `<Card label="Only people you have both said yes to">`).
   The yes screen also says "Either way, they are never told what you chose", but a first mover's yes opens their
   profile to the other person ([app/src/features/matches/reveal-screen.tsx:151] `: 'Either way, they are never told what you chose.'}`).
10. **A "no" shows by timing.** A no removes the other person's card at once; an unanswered card lasts three days
    ([server/src/api/dating.ts:549] `AND r.status NOT IN ('lapsed', 'expired')`).
11. **The message-history endpoint returns the other person's first name and account id for any pair**, before it
    is their turn, after a no, after expiry or a block. The app does not call it early, but anyone using the API
    directly can ([server/src/api/messages.ts:187] `'SELECT display_name, is_synthetic FROM match_profile WHERE user_id = $1', [pair]);`).
12. **"Send my agent over" can test a known person's card answer** (read, not run): the server says "That person has
    moved on." for free when the target fails your rules, so flipping your own must-have and asking again reveals
    their answer ([server/src/api/dating.ts:939] `if (!id) return c.json({ error: 'not_here' }, 404);`).
13. **The town shows the first mover's neighbourhood** to the second mover, which the plain card deliberately hides
    ([server/src/api/world.ts:202] `// for every seat, as for any stranger.`).
14. **Word lists have gaps.** The private-topic list is finite ("family", "wedding", "Diwali" are not on it), and the
    talk and answer sheets also use "goal" and "dislikes" sentences, which the card's own rule leaves out as the place
    "where faith, politics and children are said in prose"
    ([server/src/matching/answer-sheet.ts:79] `export const SHEET_SOURCES: readonly string[] = [...QUOTABLE, 'goal', 'dislikes'];`,
    [server/src/matching/brief.ts:80] `is where faith, politics and children are said in prose.`).
15. **The clone's words can become "the person's".** The extractor reads the clone's replies too, and recall labels
    them "things they said before" ([server/src/memory/extract.ts:181] `t.role === 'user' ? 'PERSON' : 'CLONE'`,
    [server/src/api/chat.ts:89] `Fragments recalled from things they said before:`).
16. **Deleting an account deletes reports against that person and both halves of their chats**
    ([server/migrations/0025_messaging_fixes.sql:100] `FOREIGN KEY (reported_id) REFERENCES app_users(id) ON DELETE CASCADE;`).
    If deletion fails part way, the app still says "Nothing was removed."
    ([app/src/features/settings/settings-screen.tsx:137] `Alert.alert('Not deleted', 'We could not reach the server. Nothing was removed.');`).
17. **Promises that are broader than the code.** "Nobody else has ever seen what your clone knows about you." and
    "Only things marked public ever leave your account." sit beside reveal tags, chat-learned first names, want
    answers, the reviewer's want topics, and AI providers processing the text
    ([app/src/features/settings/settings-screen.tsx:292] `Nobody else has ever seen what your clone knows about you.`).
18. **Latent:** the matchmaker role can read every profile summary, which is written from all facts including private
    ones; nothing reads it in a round today ([server/migrations/0028_matchmaker.sql:51] `GRANT SELECT ON core_profile TO clone_matchmaker;`).
19. **AI providers** receive everything typed to the clone and every message's text (embeddings); the in-app notice
    names the chat providers but not the embedding provider, and its privacy links point to pages the server does not
    serve ([server/src/api/config.ts:51] `privacyUrl: '/legal/privacy',`).

### 15.4 Behaviour a person would not expect

20. **Ten model calls a day, for everyone**, counting chat, learning and rounds together. Setup alone can use most of
    them; then a round fails with "Your agent has been out enough for today", setup screens say "Could not reach the
    server.", and in chat the reason is never shown ([server/src/env.ts:321] `TRIAL_TURN_CAP_PER_DAY: z.coerce.number().default(10),`,
    [app/src/lib/api.ts:361] `return res.ok ? ((await res.json()) as T) : null;`).
21. **Stuck behind a practice profile.** A practice profile can be the first mover; it never answers, so the real
    person waits three days on "They are looking first", then the card disappears (read, not run)
    ([server/src/matching/brief.ts:757] `return a < b ? a : b;`).
22. **The wrong waiting line.** A first mover who said yes reads "They are looking first…", not the intended "You said
    yes…" ([server/src/api/dating.ts:637] `waitingOnThem: r.human_says_yes === true || !myTurn,`).
23. **Turn order is not enforced by the server.** A second mover can decide through the API before seeing anything
    ([server/src/api/dating.ts:815] `WHERE id = $1 AND status <> 'expired'`).
24. **Distance is not "both ways".** If either person has no maximum distance, neither limit applies, yet every card
    says "Passes your rules both ways" ([server/src/matching/candidates.ts:74] `OR a.max_distance_km IS NULL OR b.max_distance_km IS NULL`).
25. **"Really want" and "Nice to have" do not change who a round meets**; the screen says they "move people up the
    list" (stage 5).
26. **A city not on the list keeps a person out of the pool** unless they tap "Use my location"; they are told "It does
    not know where you are." ([server/src/matching/profile.ts:151] `if (p === 'lives_in') return lat === null;`).
27. **Someone who turns 18 this year is refused all year**, because only the birth year is asked
    ([shared/src/values.ts:118] `return typeof value.month === 'number' && value.month <= now.getUTCMonth() + 1;`).
28. **A mistyped invite code burns the sign-in ticket**; the retry says "That took too long. Ask for a new code.", and the
    invite screen has no back button ([server/src/api/auth.ts:194] `phone = await phoneSession((db) => spendTicket(db, body.data.ticket!));`).
29. **"Yes, that's right" can do more than agree.** A confirmed free phrase replaces a card answer with "unknown" (for
    example "socially" for drinking), and a confirmed city phrase without a map point takes the person out of the pool
    ([server/src/memory/pasteImport.ts:328] `objectText: row.object_text,`).
30. **Unconfirmed chat can still retire answers** on multi-answer fields such as who they want to meet or work field, with
    no Yes and no record (read, not run) ([server/src/memory/session.ts:127] `UPDATE facts SET valid_to = now(), invalidated_at = now(), status = 'superseded'`).
31. **Rule clashes.** Two wants tied to the same question overwrite each other's rule; a must-have outlives its want
    sentence and cannot be deleted, only changed in strength ([server/src/matching/profile.ts:391] `ON CONFLICT (user_id, predicate, operator) WHERE retired_at IS NULL`).
32. **Cards can expire unseen.** Only one "waiting on you" card shows at a time, and there are no push notifications
    ([app/src/features/matches/matches-screen.tsx:302] `[...matches.filter((m) => m.waitingOnYou).slice(0, 1),`).
33. **Check-in details.** "Not yet" is final; tapping Block from "Did you feel safe?" drops the unsafe answer; "Not sure"
    counts toward "Confirmed by N people" ([app/src/features/dm/checkin.tsx:77] `const done = () => router.back();`,
    [server/migrations/0058_date_checkins.sql:67] `WHERE a.key IN ('photos', 'age', 'name', 'city') AND a.value = 'no'))`).
34. **Access does not always end with the match.** Photos stay visible to the first mover after a card expires; the
    reveal's details stay readable after a no ([server/migrations/0032_photos.sql:73] `AND r.status <> 'lapsed'`,
    [server/src/api/dating.ts:672] `WHERE r.id = $1 AND r.status <> 'expired'`).
35. **The practice pool will disappear around 2026-11-11.** Its 5,008 profiles keep their seeding date (2026-09-12 to
    14) as "last active", and the 60-day activity rule then removes them all, unless the pool is reseeded (query run
    2026-09-28) ([server/src/matching/candidates.ts:98] `AND b.last_active_at > now() - interval '60 days'`).
36. **The reveal screen can confirm a decision that failed** (offline, or the card expired): it still says "Sent" or
    "Done" ([app/src/features/matches/reveal-screen.tsx:67] `setDecided(yes ? 'yes' : 'no');`).

### 15.5 Money and operations

37. Embeddings are not metered or priced; Gemini's thinking tokens are recorded but not priced; Gemini calls have no
    retry and no timeout; the per-session output cap is not enforced; the in-repo spend report (`npm run stats`)
    reads through a role that sees no rows, so it shows zero; a first-screen sentence is extracted twice
    ([server/src/llm/adapters/google.ts:31] `cached ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });`,
    [server/src/db/stats.ts:5] `const u = await adminSession((c) => usage7d(c));`).
38. **Documentation drift.** HOW-IT-WORKS.md, ARCHITECTURE.md, ENGINE-DECISION.md, both READMEs and several code
    comments describe older designs; the "Docs vs code" notes in each stage list the specific disagreements.
