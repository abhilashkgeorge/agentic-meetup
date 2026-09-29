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
   [server/src/env.ts:374] `if (env.NODE_ENV === 'production' && env.ALLOW_LEGACY_TOKENS) {`).

### 15.2 Private information that can reach another person

**Closed on 2026-09-28**, each with a test that fails when the rule is taken out: reveal tags come only
from facts the person made shareable, with no private-topic word; the name others see comes only from
the setup screen, never from chat; a want on a private topic shows one fixed line, never "Matches";
the message history answers only for an introduced pair nobody has blocked; "Send my agent over" no
longer checks your rules at the tap, so a card answer cannot be read off it for free; the town keeps a
first mover in the viewer's own neighbourhood until they share; and the extractor and recall read only
the person's own lines (stages 2, 3, 5, 6, 9 and AI-1). What remains:

3. **A "no" shows by timing.** A no removes the other person's card at once; an unanswered card lasts three days
    ([server/src/api/dating.ts:583] `AND r.status NOT IN ('lapsed', 'expired')`).
4. **"Matches" on a situation want can say how someone answered.** A want tied to a situation question ("a
    saver") shows "Matches" or "Doesn't match"; if it accepts one answer, that tells the reader the other
    person's answer, though situation answers are "never repeated to anybody"
    ([server/src/matching/want-questions.ts:113] `return ask.accepted.includes(v) ? 'met' : 'not_met';`,
    [shared/src/facts.ts:209] `match and is never repeated to anybody (not in PUBLIC_BY_DEFAULT).`).
5. **The square itself can still be probed** (read, not run). Strangers in the square are people who pass your
    rules, so flipping a must-have and reopening the town shows whether a stranger you recognise by their character
    is still there; the sample is 40 nearest plus 24 recent and refreshes every 30 seconds
    ([server/src/api/world.ts:177] `const near = await candidateIdsNear(db, me, 40);`,
    [server/src/api/world.ts:94] `const SAMPLE_TTL_MS = 30_000;`).
6. **Word lists have gaps.** The private-topic list is finite ("family", "wedding", "Diwali" are not on it), and the
    talk and answer sheets also use "goal" and "dislikes" sentences, which the card's own rule leaves out as the place
    "where faith, politics and children are said in prose"
    ([server/src/matching/answer-sheet.ts:79] `export const SHEET_SOURCES: readonly string[] = [...QUOTABLE, 'goal', 'dislikes'];`,
    [server/src/matching/brief.ts:81] `is where faith, politics and children are said in prose.`).
7. **Deleting an account deletes reports against that person and both halves of their chats**
    ([server/migrations/0025_messaging_fixes.sql:100] `FOREIGN KEY (reported_id) REFERENCES app_users(id) ON DELETE CASCADE;`).
    If deletion fails part way, the app still says "Nothing was removed."
    ([app/src/features/settings/settings-screen.tsx:138] `Alert.alert('Not deleted', 'We could not reach the server. Nothing was removed.');`).
8. **Promises that are broader than the code.** "Nobody else has ever seen what your clone knows about you." and
    "Only things marked public ever leave your account." sit beside the first name, age and city on the reveal,
    "Matches" on situation wants, the reviewer's want topics, and AI providers processing the text
    ([app/src/features/settings/settings-screen.tsx:297] `Nobody else has ever seen what your clone knows about you.`).
9. **Latent:** the matchmaker role can read every profile summary, which is written from all facts including private
    ones; nothing reads it in a round today ([server/migrations/0028_matchmaker.sql:51] `GRANT SELECT ON core_profile TO clone_matchmaker;`).
10. **AI providers** receive everything typed to the clone and every message's text (embeddings); the in-app notice
    names the chat providers but not the embedding provider, and its privacy links point to pages the server does not
    serve ([server/src/api/config.ts:51] `privacyUrl: '/legal/privacy',`).

### 15.3 Behaviour a person would not expect

**Closed on 2026-09-28**, each with a test that fails when the rule is taken out: a practice profile never
decides first (the one open card where a real person waited behind one was moved to them); distance is each person's own
limit, both ways; the practice pool no longer expires; setup calls no longer use the day's ten; and phones are
woken for a new card, a share, an introduction, a message and a card fading today (stages 6 and 9).

11. **Ten model calls a day** for chat, learning and rounds together (setup is counted apart since 2026-09-28).
    Somebody who chats a lot can leave no call for a round, which then fails with "Your agent has been out enough
    for today", and in chat the reason is never shown ([server/src/env.ts:342] `TRIAL_TURN_CAP_PER_DAY: z.coerce.number().default(10),`,
    [app/src/lib/api.ts:361] `return res.ok ? ((await res.json()) as T) : null;`).
12. **"Really want" and "Nice to have" do not change who a round meets**; the screen says they "move people up the
    list" (stage 5).
13. **A city not on the list keeps a person out of the pool** unless they tap "Use my location"; they are told "It does
    not know where you are." ([server/src/matching/profile.ts:152] `if (p === 'lives_in') return lat === null;`).
14. **Someone who turns 18 this year is refused all year**, because only the birth year is asked
    ([shared/src/values.ts:118] `return typeof value.month === 'number' && value.month <= now.getUTCMonth() + 1;`).
15. **A mistyped invite code burns the sign-in ticket**; the retry says "That took too long. Ask for a new code.", and the
    invite screen has no back button ([server/src/api/auth.ts:194] `phone = await phoneSession((db) => spendTicket(db, body.data.ticket!));`).
16. **"Yes, that's right" can do more than agree.** A confirmed free phrase replaces a card answer with "unknown" (for
    example "socially" for drinking), and a confirmed city phrase without a map point takes the person out of the pool
    ([server/src/memory/pasteImport.ts:329] `objectText: row.object_text,`).
17. **Unconfirmed chat can still retire answers** on multi-answer fields such as who they want to meet or work field, with
    no Yes and no record (read, not run) ([server/src/memory/session.ts:142] `UPDATE facts SET valid_to = now(), invalidated_at = now(), status = 'superseded'`).
18. **Rule clashes.** Two wants tied to the same question overwrite each other's rule; a must-have outlives its want
    sentence and cannot be deleted, only changed in strength ([server/src/matching/profile.ts:414] `ON CONFLICT (user_id, predicate, operator) WHERE retired_at IS NULL`).
19. **Only one waiting card shows at a time.** Each card now wakes the phone when it arrives and the day it fades,
    but only after the founder's push setup; until then a second card can still run out unseen
    ([app/src/features/matches/matches-screen.tsx:322] `[...matches.filter((m) => m.waitingOnYou).slice(0, 1),`).
20. **Check-in details.** "Not yet" is final; tapping Block from "Did you feel safe?" drops the unsafe answer; "Not sure"
    counts toward "Confirmed by N people" ([app/src/features/dm/checkin.tsx:77] `const done = () => router.back();`,
    [server/migrations/0058_date_checkins.sql:67] `WHERE a.key IN ('photos', 'age', 'name', 'city') AND a.value = 'no'))`).

### 15.4 Money and operations

21. Embeddings are not metered or priced; Gemini's thinking tokens are recorded but not priced; Gemini calls have no
    retry and no timeout; the per-session output cap is not enforced; the in-repo spend report (`npm run stats`)
    reads through a role that sees no rows, so it shows zero; a first-screen sentence is extracted twice
    ([server/src/llm/adapters/google.ts:31] `cached ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });`,
    [server/src/db/stats.ts:5] `const u = await adminSession((c) => usage7d(c));`).
22. **Documentation drift.** HOW-IT-WORKS.md, ARCHITECTURE.md, ENGINE-DECISION.md, both READMEs and several code
    comments describe older designs; the "Docs vs code" notes in each stage list the specific disagreements.
23. **Park voice is untried at scale and has no host.** The whole park is one voice room, so everybody in it is
    told everybody else's visit id (never who they are) and every phone checks every voice four times a second;
    past a few hundred people talking at once the park needs splitting into rooms by area. The voice server runs on
    the laptop with LiveKit's public development keys, which a production server refuses to start with; a real host
    and keys are the founder's. A mic ban is automatic, with nobody reviewing it first
    ([server/src/env.ts:422] `if (env.NODE_ENV === 'production' && env.LIVEKIT_API_SECRET === 'secret') {`,
    [app/src/features/world/voice-room.ts:241] `const tick = setInterval(apply, 250);`).
