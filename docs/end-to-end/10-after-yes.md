## 10. After both say yes

The second yes turns the pair into an **introduction**: a private chat opens between the
two people, with the agents' date idea offered at the top. From here on, the humans talk
to each other; no agent speaks for anyone. Code does all of it; the only model-written
words are the date idea, written earlier (stage 7).

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| The second yes | Pair becomes `introduced`; chat opens | Code | `rendezvous.introduced_at` | Both | [server/src/matching/orchestrator.ts:604] `UPDATE rendezvous r SET status = 'introduced', introduced_at = now()` |
| A message | Sent over a live connection; delivered, read receipts | Code | `messages` row | The two people | [server/migrations/0025_messaging_fixes.sql:37] `AND r.status = 'introduced'));` |
| "Propose this date" | Sends "How about this: <idea>?" as the person's own message, once per chat | Code | `messages` row (kind `date_idea`) | The two people | [server/src/api/date-idea.ts:31] `How about this: ${idea}?` |
| Two quiet days | A one-time nudge for each person | Code | `nudged_at` on each person's card row | Each person, once | [app/src/features/dm/date-idea.ts:17] `export const QUIET_LINE = 'Quiet for two days. Say hello?';` |
| 72 hours after the introduction | The after-date check-in inside the chat | Code | `date_checkins` row per person | The person who answered; one bit is shared if both say "see again" | [server/src/api/dating.ts:121] `const MET_ASK_AFTER_MS = Number(process.env.MET_ASK_AFTER_HOURS ?? 72) * 60 * 60_000;` |
| Block or report | Both are kept apart everywhere; a report is queued for the reviewer, with a copy of their chat | Code | `blocks` row, `reports` row, and the chat's last 200 messages in `report_messages` | Reviewer sees reports and the copied chat | [server/src/messaging/store.ts:220] `await block(c, args.reporterId, args.reportedId);` |
| Reviewer bans | Sessions revoked, hidden from everyone, phone and handset remembered | Code | `bans`, `ban_marks` | Reviewer | [server/migrations/0065_bans_stick.sql:70] `UPDATE device_sessions SET revoked_at = now() WHERE user_id = target AND revoked_at IS NULL;` |

### Arjun and Meera

1. **Arjun taps "Yes, share mine back".** He sees the "both said yes" moment: the two characters walk
   in and meet, then "You both said yes" / "Meera can message you now, and nobody else can."
   and a "Say hello" button ([app/src/features/matches/moment.ts:27] `export const MOMENT_TITLE = 'You both said yes';`,
   [app/src/features/matches/moment.ts:29] `can message you now, and nobody else can.`,
   [app/src/features/matches/both-yes-moment.tsx:88] `<Button label="Say hello" variant="primary" onPress={onHello} />`).
2. **Meera gets no moment.** Her waiting card disappears and "Arjun" appears in Chats with
   "Say something"; only now can she see his photos and first name, which his yes shared with her
   ([server/migrations/0073_consent_first_reveal.sql:42] `AND b.human_says_yes IS TRUE));`,
   [server/src/matching/orchestrator.ts:617] `notify(other, { type: 'match.introduced', rendezvousId, agent: agentRef(other, userId) });`,
   [app/src/features/dm/conversations-screen.tsx:94] `: 'Say something'`). If her app is closed,
   her phone is woken: "You can talk now" (stage 9.5); a message to a closed app wakes the phone
   too, at most once every two minutes per chat, saying only "New message"
   ([server/src/api/chat.ts:281] `if (!online) void wake(pair.otherId, 'message', msg.rendezvousId);`,
   [server/src/push/index.ts:39] `const MESSAGE_QUIET_MS = 2 * 60_000;`).
3. **The chat** opens with the agents' date idea at the top: "YOUR AGENTS' DATE IDEA", the idea,
   "Propose this date", "It goes as a message from you. You two pick the day." Below it: "You
   both said yes. Nobody else can message you here."
   ([app/src/features/dm/date-idea.ts:39] `title: "YOUR AGENTS' DATE IDEA", line: s.idea!`,
   [app/src/features/dm/thread-screen.tsx:254] `It goes as a message from you. You two pick the day.`,
   [app/src/features/dm/thread-screen.tsx:278] `You both said yes. Nobody else can message you here.`).
4. **Arjun taps "Propose this date".** Meera receives an ordinary message from Arjun, for example
   "How about this: Sunrise walk in Cubbon Park, then filter coffee?". The idea card disappears
   for both.
5. **If neither writes for two days**, each sees once: "Quiet for two days. Say hello?" in the
   Chats list and "IT HAS BEEN QUIET FOR TWO DAYS" in the chat.
6. **72 hours after the introduction**, each is asked privately inside the chat: "Did you two
   meet up? They are not told what you say." (stage 10.4).

### 10.1 Chat

- **Only introduced pairs can write**, enforced by the database policy and by the live
  connection; a message can only be addressed to a pair, never to a person, so nobody can
  message a stranger ([server/migrations/0024_messages.sql:12] `-- there is. Unsolicited contact is not policed, it is unrepresentable.`,
  [server/src/api/chat.ts:233] `send(ws, { type: 'dm.rejected', messageId: msg.messageId, reason: 'not introduced yet' });`).
- **Limits:** 1 to 4,000 characters; 60 events a minute per person ("Slow down a moment."); no
  daily cap ([shared/src/events.ts:54] `text: z.string().min(1).max(4000),`,
  [server/src/ratelimit.ts:216] `message: { max: 60, windowMs: 60_000 },`).
- **Contact details are allowed in chat.** The contact-detail filter guards what agents say,
  not what people type to each other; the app itself tells people to swap details in chat
  ([server/src/matching/brief.ts:199] `street address (shared/src/contact.ts). People swap those themselves, in chat, after`,
  [app/src/features/stories/stories-state.ts:29] `Swap those in chat after you both say yes.`).
- **Receipts:** "Sent", "Delivered", "Read", "typing…", always on
  ([app/src/features/dm/thread-screen.tsx:40] `state === 'queued' ? 'waiting to send'`).
- **Messages are never deleted by the app**; there is no delete route
  ([server/migrations/0025_messaging_fixes.sql:57] `-- No DELETE grant on messages, deliberately. "Delete for everyone" is`).

### 10.2 "Propose this date"

The server rebuilds the idea from the caller's own card, checks it again, and sends
"How about this: <idea>?" as a message from that person. Nothing typed on the phone is used.
Either person can do it, once per conversation in total; a second try gets "A date has
already been proposed here."
([server/src/api/date-idea.ts:10] `THE WORDS ARE BUILT HERE, NEVER TAKEN FROM THE PHONE. The idea is the one the two`,
[server/src/api/date-idea.ts:173] `message: 'A date has already been proposed here.'`).
If there is no checked idea, there is no button.

### 10.3 The nudge

Due when the pair was introduced at least 2 days ago, nobody has written in the last 2 days,
and this person has not been nudged for this match. It is shown in the app only (no push), once
per person per match; opening the chat marks it seen for good
([server/src/api/date-idea.ts:43] `AND r.introduced_at <= now() - interval '${QUIET_DAYS} days'`,
[server/src/api/date-idea.ts:136] `UPDATE rendezvous_briefs SET nudged_at = now()`).
The chat shows "IT HAS BEEN QUIET FOR TWO DAYS" and either the date idea with its button, or
"Say hello? You both said yes." ([app/src/features/dm/date-idea.ts:34] `'Say hello? You both said yes.'`).

### 10.4 The after-date check-in

- **When:** 72 hours after the introduction by default, inside the chat only
  ([server/src/api/dating.ts:771] `const state = seat.answered ? 'done' : seat.met === null ? (due ? 'ask_met' : 'not_yet') : 'ask';`).
- **Step 1:** "Did you two meet up? They are not told what you say." [Yes] [Not yet]. The first
  answer is final: a "Not yet" is never asked again
  ([app/src/features/dm/checkin.tsx:109] `Did you two meet up? They are not told what you say.`,
  [server/src/api/dating.ts:928] `// Own brief only, under RLS. An answer is final: the first one stands.`).
- **After "Not yet":** "What happened? Only you see this." with "Plans fell through", "They
  stopped replying", "I changed my mind", "Something else", or Skip
  ([app/src/features/dm/checkin.tsx:122] `What happened? Only you see this.`).
- **After "Yes"**, up to 6 questions, each [Yes] [No] [Not sure]: "Did they look like their
  photos?", "Did they seem about 29?", "Did they go by Arjun?", "Do they live around
  Bengaluru?", then up to two of the reader's matched wants ("You wanted “…”. Did they seem
  that way?"), then up to two of their tags ("Did climbing come up?", "Do they work in …?")
  ([server/src/checkin/questions.ts:46] `text: 'Did they look like their photos?', identity: true`,
  [server/src/checkin/questions.ts:66] `Did ${word} come up?`,
  [server/src/checkin/questions.ts:40] `const MAX_QUESTIONS = 6;`).
- **Then:** "Did you feel safe with them?" [Yes] [No]; on No: "Sorry. Do you want to stop
  hearing from Arjun?" [Block] [Block and report] [Not now]. Then "Would you see them again?"
  "They only hear this if you both say yes." Finally "Thanks. +50 points."
  ([app/src/features/dm/checkin.tsx:148] `Did you feel safe with them?`,
  [app/src/features/dm/checkin.tsx:167] `Would you see them again?`,
  [app/src/features/dm/checkin.tsx:63] `Thanks. +${r.awarded} points.`).
- **Stored:** one `date_checkins` row per person; final, cannot be changed
  ([server/migrations/0058_date_checkins.sql:54] `REVOKE UPDATE, DELETE ON date_checkins FROM clone_app;       -- an answer is final`).
- **Who sees it:** only the person who answered. One bit crosses: if both said yes to "see
  again", both see "You both said you'd see each other again."
  ([server/migrations/0058_date_checkins.sql:13] `-- WHO SEES WHAT. The answerer reads their own row. The other person never reads it,`,
  [app/src/features/dm/checkin.tsx:101] `You both said you'd see each other again.`).
- **Used for:** "Confirmed by N people who met them" on that person's future reveals (a check-in
  with no identity answer of "no" counts); reviewer flags when 2+ people say the photos or age
  were wrong, or 1+ felt unsafe (no automatic action); the founder's numbers
  ([server/migrations/0058_date_checkins.sql:67] `WHERE a.key IN ('photos', 'age', 'name', 'city') AND a.value = 'no'))`,
  [server/migrations/0058_date_checkins.sql:104] `OR count(*) FILTER (WHERE c.felt_safe = false) >= 1;`).
  Never written into anybody's facts.

### 10.5 Block and report

- **Where:** every card ("Block or report"), the reveal and chat headers ("⋯"), a met
  person's sheet in the town, and the check-in's "felt unsafe" step
  ([app/src/features/dm/thread-screen.tsx:226] `right={{ glyph: '⋯', label: 'Block or report', onPress: stop }}`).
- **Block:** "Block Meera?" / "You will never see each other again, anywhere in the app. They
  are not told." ([app/src/features/safety/safety-sheet.tsx:52] `'You will never see each other again, anywhere in the app. They are not told.',`).
- **Report:** "REPORT -- WHAT HAPPENED?" with seven reasons: "Harassment or threats",
  "Inappropriate messages or photos", "Fake profile", "Seems under 18", "Spam or a scam", "Made
  me feel unsafe", "Something else"; an optional note (up to 2,000 characters); the button
  "Report and block"; and "Something urgent? Write to" the support address
  ([app/src/features/safety/reasons.ts:17] `{ id: 'harassment', label: 'Harassment or threats' },`,
  [app/src/features/safety/reasons.ts:23] `{ id: 'other', label: 'Something else' },`,
  [app/src/features/safety/safety-sheet.tsx:118] `Something urgent? Write to {SUPPORT_EMAIL}`).
  A report always blocks too ([server/src/messaging/store.ts:220] `await block(c, args.reporterId, args.reportedId);`).
  Above the button: "If you have messages with Meera in Chats, the reviewer can read them." Since
  2026-09-29 the report takes a copy of their chat when it is made -- the last 200 messages, each
  marked "Them" or "Reporter", no names -- and the copy outlives both accounts, so deleting yours
  does not delete what you said to the person who reported you
  ([app/src/features/safety/safety-sheet.tsx:113] `If you have messages with {who} in Chats, the reviewer can read them.`,
  [server/migrations/0080_reported_chat_kept.sql:73] `CREATE TRIGGER reports_keep_chat AFTER INSERT ON reports`).
- **Effect, both ways:** the card, reveal, chat, town seat, photos and date idea disappear for
  both; sends are refused; they are never matched again
  ([server/migrations/0064_bans_and_apart.sql:54] `SELECT block_exists(me, other) OR is_banned(other)`).
  The blocked person is told nothing; a message they try to send shows "not sent"
  ([server/src/api/chat.ts:253] `send(ws, { type: 'dm.rejected', messageId: msg.messageId, reason: 'cannot send' });`).
- **No automatic action on reports**; a reviewer looks at them
  ([server/migrations/0039_trust_and_safety.sql:21] `--    AUTO-HIDING ON REPORT IS DELIBERATELY NOT DONE HERE. One malicious report would`).

### 10.6 Bans

- **Who:** only accounts listed in `ADMIN_USER_IDS` (the reviewer), from the "Reports to review"
  screen in Settings: "Ban <name>?" / "They are signed out, taken out of the pool and hidden from
  everybody, for good." ([app/src/features/admin/reports-screen.tsx:54] `'They are signed out, taken out of the pool and hidden from everybody, for good.',`).
- **What it does:** hides all their photos; records the ban; remembers the account's phone-number
  hash and the hashed id of every phone they signed in on; revokes every session; takes them
  out of the pool for good ([server/migrations/0065_bans_stick.sql:61] `SELECT banned, 'phone', u.phone_hmac FROM app_users u`,
  [server/migrations/0065_bans_stick.sql:64] `SELECT banned, 'device', s.device_hmac FROM device_sessions s`,
  [server/migrations/0065_bans_stick.sql:71] `UPDATE match_profile SET moderation_hidden = true WHERE user_id = target;`).
- **What the banned person sees:** they are signed out, and signing in again with the same
  number or the same phone gets "This account was closed after a report. If you think that is a
  mistake, write to" the support address
  ([server/src/api/auth.ts:125] `This account was closed after a report. If you think that is a mistake, write to ${SUPPORT_EMAIL}.`).
  A ban outlives account deletion, and no code lifts a ban.

### Docs vs code

- HOW-IT-WORKS.md says the "you both said yes" moment appears "when the second yes lands"; only
  the person whose tap made the introduction sees it
  ([HOW-IT-WORKS.md:635] `**The moment** (item 12, design only). When the second yes lands, the reveal no longer`).
- HOW-IT-WORKS.md says the "apart" check is asked "by every place two people meet … the chat list
  and every message". It is not asked when reading message history, for typing and read events,
  or by the check-in ([HOW-IT-WORKS.md:861] `other is banned, is asked by every place two people meet: the matches list, the profile,`).
