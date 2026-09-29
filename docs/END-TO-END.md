# How the app works today, end to end

This describes what the **code** does, running with the development settings. It was first written on
2026-09-28 and is updated with every change that affects it.
It was written for a reviewer who has never seen the code. Where an older document or a code comment says
something else, a **Docs vs code** note says so. Where something could not be confirmed from the code, it says
**unverified**. No code was changed to write it.

## How to read this

- **Citations** are `path:line`, relative to the repository root. Every claim carries at least one.
- **Keeping it current.** This file is built from `docs/end-to-end/` by `npm run docs`. There each citation carries
  the text of the line it cites; the build checks every one against the code and corrects line numbers that moved.
  A server test (`server/tests/end-to-end-doc.test.ts`) fails if a cited line no longer says what the doc quotes,
  or if the doc was not rebuilt. Change the part, not this file.
- **Numbers from the database** (counts, costs) come from queries run on 2026-09-28 against the development
  database, and say so.
- Each stage has a short table: **input → what happens → AI or code? → what gets stored → who can see it**, plus a
  column naming the code. Then **Arjun and Meera**, then the details.
- AI model calls are numbered AI-1 to AI-15 and described once, in [section 12](#ai-calls).

## Words used here

| Word | Meaning |
|---|---|
| **Agent** / **clone** | A person's AI stand-in. The app uses both words. |
| **Fact** | One stored claim about a person ("works in AI"), with their exact words and where it came from. |
| **Live / held** | A live fact is used; a held fact waits for the person's "Yes, that's right". |
| **Shareable / match-only / hidden** | Who may hear a fact: others (through cards and agents), nobody (used only for matching), nobody (the person hid it). |
| **Tapped field** | An answer a person gives by tapping (city, the five cards, work field, exercise…). Chat can only propose a change to one. |
| **Want** | A sentence about who a person wants, or couldn't be with. |
| **Must have** | A rule that removes people who answered differently, checked both ways. |
| **Round** | One "send my agent out": the agent meets up to three people. |
| **Pair** | Two people a round brought together (`rendezvous` in the code). |
| **Card** | What one person sees about the other in a pair. |
| **First mover** | The person in a pair who decides first. |
| **Reveal** | The screen with the other person's first name, age, city, tags and photos. |
| **Practice profile** | An invented person (`synthetic` in the code), clearly labelled. |
| **Reviewer** | The founder's account, listed in `ADMIN_USER_IDS`. |
| **Real person** | Not a practice profile, not a test fixture, and has signed in on a phone. |

## The setup this describes

| Setting | Development value | Code |
|---|---|---|
| Every AI task (chat, extract, resolve, reflect, render_profile, canon) | Google Gemini 3.5 Flash-Lite (the code default is Claude Sonnet 5) | `server/src/env.ts:89` |
| Embeddings | Gemini Embedding 001, 768 dimensions | `server/src/env.ts:106` |
| Typed decision model, separate judge model | Not set (off) | `server/src/env.ts:104` |
| Agent conversations | Off (`RENDEZVOUS_RUNS` not set, default 0) | `server/src/matching/rendezvous.ts:75` |
| The agents' talk | On (`AGENT_TALK` not set, default on) | `server/src/matching/talk.ts:49` |
| SMS | `console`: no text is sent, the code goes to the server log only (`SMS_DEV_ECHO=false` since 2026-09-28) | `server/src/env.ts:221` |
| Reusable dev invite `KNOX-1010` | Works (`ALLOW_REUSABLE_INVITES=true`) | `server/src/env.ts:309` |
| Old-style sign-in (account id as token) | Off (`ALLOW_LEGACY_TOKENS=false` since 2026-09-28; the code default is on) | `server/src/env.ts:199` |
| Face check | Off | `server/src/env.ts:328` |
| Spend per person per day | $2.00 and 10 model calls, plus up to 40 setup calls counted apart (since 2026-09-28) | `server/src/env.ts:331`, `server/src/env.ts:340` |
| Push notifications | `console`: each push is written to the server log, nothing is sent, until the app has an Expo project and `PUSH_PROVIDER=expo` is set | `server/src/env.ts:229` |

The development values come from `server/.env`, which is not in git. A production server refuses to start with the
development shortcuts on (`server/src/env.ts:363`).

**The development database today** (queried 2026-09-28): 11 real people, 4 of them ready to be sent out; 5,008
practice profiles; no pair between two real people yet; no round since 2026-09-22.

## Meet Arjun and Meera

Two invented people we follow through every stage:

- **Arjun**: a man seeking women, 29, lives in Indiranagar, Bengaluru, works in AI, runs most mornings, climbs at
  weekends. His want: "I want someone who saves money, not an impulse spender. Someone kind."
- **Meera**: a woman seeking men, 27, lives in Jayanagar, Bengaluru, a designer who also climbs. She pastes a
  paragraph about herself from another AI assistant, and she has not answered any situation question yet.

Both are real people in the pool and pass each other's rules. Where the flow depends on who decides first, the text
says which case it shows. (The practice pool happens to contain invented people also named Meera and Arjun; they
are unrelated.)

## Contents

1. Install and sign-up
2. Onboarding
3. How the agent learns about its person
4. Privacy
5. Wants: from a sentence to a check
6. Sending the agent out
7. The agent-to-agent exchange
8. The card each person sees
9. Deciding
10. After both say yes
11. What the Numbers page and the "wants with no question yet" list measure
12. Every AI model call
13. What else the app does
14. What it does NOT do
15. Known gaps and risks
16. One-page summary

---

## 1. Install and sign-up

### 1.0 Install

The app is called "Clone" (id `com.clone.app` on both platforms)
(`app/app.json:3`, `app/app.json:22`).
Today it reaches a phone only as a **development build compiled on the founder's computer**
(`expo run:android` / `expo run:ios`); there is no app-store pipeline in the repository
(`app/package.json:56`,
`app/README.md:7`). The daily loop `./dev.sh`
starts the server, opens a **public tunnel** to it (cloudflared, else ngrok) so friends' phones
can reach it off the founder's Wi-Fi, and starts the app's bundler
(`dev.sh:12`).

When the app opens, it first checks the server answers (4 seconds); if not, a "Can't reach the
server" screen lets the person type an address. With no saved sign-in it goes to the phone
screen. After sign-in it sends the person to consent if that is not settled, then to setup until
setup is finished on this phone
(`app/src/app/_layout.tsx:58`,
`app/src/app/_layout.tsx:93`,
`app/src/app/_layout.tsx:146`,
`app/src/app/_layout.tsx:152`).

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| Phone number | Normalised; a 6-digit code is made and "sent" | Code | `phone_challenges`: a hash of the number and a hash of the code, 5-minute expiry, caller's IP | Nobody reads it back; only the sign-in role touches this table | `server/src/api/auth.ts:427` |
| The code | Checked (5 tries); a known number signs in, an unknown one needs an invite | Code | The challenge becomes a 15-minute "ticket" | | `server/src/api/auth.ts:533` |
| Invite code | Checked; the account is created | Code | `tenants`, `app_users` (number hash, no number), `device_sessions` | The person | `server/src/api/auth.ts:77` |
| "I agree" | Three documents accepted | Code | `consents` rows, append-only | The person | `server/src/api/consent.ts:93` |

### Arjun and Meera

Nothing in sign-up differs by gender. Both see, in order:

1. **"What's your number?"** with country chips (+91 preselected, +1, +44) and "Text me a code".
   The footer promises: "We text you once. Your number is never shown to anybody, and we keep
   only a scrambled version of it." (`app/src/features/auth/phone-screen.tsx:92`,
   `app/src/features/auth/phone-screen.tsx:85`).
2. **"Check your texts"**, "We sent six digits to the number ending <last two digits>." In the
   development setup no text is sent: the founder reads the code from the server's log. (If the
   server were echoing codes back, the box would arrive filled in under a red warning, "The
   server is echoing codes back (SMS_DEV_ECHO). Turn that off before anyone else uses this.";
   that switch is off since 2026-09-28.)
   (`app/src/features/auth/verify-screen.tsx:149`,
   `app/src/features/auth/verify-screen.tsx:182`).
3. **"You need a code"**: "Your number is confirmed. Now someone has to let you in. If a friend
   sent you eight characters, put them here." (`app/src/features/auth/invite-screen.tsx:73`).
   In development, the reusable code KNOX-1010 works.
4. **"Before we start"**: three short documents and one button, "I agree". There is no decline
   button: "If you would rather not, close the app — nothing has been set up yet."
   (`app/src/features/consent/consent-screen.tsx:103`,
   `app/src/features/consent/consent-screen.tsx:96`).
5. Then setup (stage 2).

### 1.1 Phone and SMS code

- **Normalising:** spaces and dashes removed; a local number is completed for the chosen country
  only (+91: 10 digits) (`shared/src/phone.ts:31`).
  Only +91, +1 and +44 can be texted (`server/src/env.ts:279`).
- **The code:** six random digits, valid 5 minutes, at most 5 guesses
  (`server/src/phone.ts:85`,
  `shared/src/phone.ts:110`,
  `shared/src/phone.ts:122`).
- **Stored:** only hashes. The number is never written to the database; the account keeps a
  keyed hash (`server/src/phone.ts:47`).
- **Sending:** the development setup uses the `console` sender, which sends no SMS and writes the
  full number and the code to the server log; `msg91` and `twilio` send real texts
  (`server/src/env.ts:221`,
  `server/src/sms.ts:51`).
  With `SMS_DEV_ECHO=true` the server would also return the code in its reply; it is off in the
  development setup since 2026-09-28
  (`server/src/api/auth.ts:451`).
- **Limits:** per IP 10 codes per 15 minutes; per number 3 per 15 minutes; 500 texts a day in
  total (`server/src/ratelimit.ts:204`,
  `server/src/ratelimit.ts:206`,
  `server/src/env.ts:286`). These counters live in
  the server's memory and reset when it restarts.
- **Three outcomes** after a right code: a signed-in person adds the number to their account; a
  known number signs straight in (no invite, no consent screen); an unknown number gets a ticket
  for the invite screen (`server/src/api/auth.ts:610`,
  `server/src/api/auth.ts:615`).

### 1.2 Invites

- **Only a new number needs one.** Codes are 8 characters, valid 14 days
  (`server/src/tokens.ts:46`,
  `server/src/env.ts:205`).
- **Three per person, in all.** An invite that expires unused comes back; the reviewer has no
  limit. In Settings: "Invites · N left", "Make an invite", shared as "Here's a code for Clone:
  <code>" (`server/src/env.ts:212`,
  `app/src/features/settings/settings-screen.tsx:83`).
- **KNOX-1010** is a reusable development code made by a script; it works only while
  `ALLOW_REUSABLE_INVITES=true` (on in development) and each use makes a new account
  (`server/scripts/dev-invite.ts:25`,
  `server/src/api/auth.ts:218`).
- **A production server refuses to start** with any development shortcut on: reusable invites,
  echoed codes, the console SMS sender, legacy tokens, unverified or device sign-up, practice
  profiles saying yes, or a development secret (`server/src/env.ts:363`,
  `server/src/env.ts:367`,
  `server/src/env.ts:401`).

### 1.3 Consent

Three documents, shown in plain words and accepted with one "I agree"
(`server/src/api/consent.ts:32`,
`server/src/api/consent.ts:33`,
`server/src/api/consent.ts:34`):

- **Age:** "You have to be 18 or older to use this." "We keep the year you were born. Other people
  only ever see your age." (`app/src/features/consent/consent-screen.tsx:37`)
- **Terms:** "Be a person. No harassment, no pretending to be somebody else, no pictures that are not
  of you." "Your agent talks to other agents for you. You always make the final call about who you
  meet" (`app/src/features/consent/consent-screen.tsx:42`)
- **Privacy:** "What you tell your clone is used to represent you to other agents. Only things marked
  public ever leave your account." "Your photos and first name are never public. A person sees them
  only after you say yes to sharing them with that person." "We send text to AI providers to run your
  clone. We do not sell anything to anybody." (`app/src/features/consent/consent-screen.tsx:46`,
  `app/src/features/consent/consent-screen.tsx:47`,
  `app/src/features/consent/consent-screen.tsx:49`)

Stored as append-only rows; the app role cannot change or delete them
(`server/migrations/0042_consents_append_only.sql:25`).
Consent is also a condition for being sent out (stage 2).

### 1.4 Sessions, the phone's id, and bans at the door

- **Session token:** a random session id plus a signature; checked on every request against the
  session row (not revoked, not expired, owner not banned). It lasts 180 days from creation
  (`server/src/tokens.ts:18`,
  `server/src/auth.ts:33`,
  `server/src/env.ts:203`).
- **An older sign-in method is off:** with `ALLOW_LEGACY_TOKENS` on, a bare account id would be
  accepted as a sign-in token (`server/src/auth.ts:72`). The
  development setup turns it off (since 2026-09-28), but the code default is still on
  (`server/src/env.ts:199`). See Known gaps.
- **The phone's id:** at sign-in the app sends a stable phone id (Android ID; on iPhone a random id
  kept in the keychain). The server keeps only a keyed hash
  (`app/src/lib/device.ts:12`,
  `server/src/phone.ts:62`).
- **Bans at the door:** every way in checks whether the number's hash or the phone's hash is banned;
  the answer is "This account was closed after a report. If you think that is a mistake, write to"
  the support address (`server/src/api/auth.ts:116`).

### Docs vs code

- The consent footer says "nothing has been set up yet"; by then the account, the number's hash and a
  session already exist (`server/src/api/auth.ts:249`).
- The phone screen promises the number is kept only in scrambled form; with the console sender (the
  development default) the full number is written to the server log
  (`app/src/features/auth/phone-screen.tsx:86`).
- HOW-IT-WORKS.md §11 says every door checks bans "before spending anything"; at the invite step the
  phone ticket is spent before the ban check (`HOW-IT-WORKS.md:876`,
  `server/src/api/auth.ts:194`).
- `app/README.md` still lists a "signin = dev token" route and says real sign-in and consent are
  "Not built" (`app/README.md:20`).

### Unverified

- Whether any build was ever distributed through TestFlight or the Play Store (none is configured
  in the repository).

---

## 2. Onboarding

Setup is a short run of screens. Only a few answers are **required**: the three basics, the five
cards, birth year, city, and consent. Everything else is optional and can come later. When the
required answers are in, the person is **"in the pool"**: their agent can be sent out and others
can meet it.

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| "Tell it one true thing" (one sentence) | Facts are pulled out of it; the clone then answers a question as the person | AI ([AI-1](#ai-1), then [AI-2](#ai-2)) | An episode (the words) and facts | The person; public facts can later reach others (stage 4) | `server/src/api/tell.ts:73` |
| The interview: basics, five cards, faith, one sentence | Each tap is saved; card "who's fine" rows become hard rules | Code (the sentence also goes to [AI-3](#ai-3)) | `question_answers`, facts, `preferences` | The person; rules are used by matching | `server/src/api/interview.ts:276` |
| Essentials: birth year, age range, city, distance | Saved; city becomes a map point | Code | Facts, match profile | The person; age and area appear on cards | `server/src/api/dating.ts:376` |
| Voice (optional): a WhatsApp export | Only the person's own lines are read; a style note is written | AI ([AI-5](#ai-5)) | A "voice" note; the chat itself is not kept | The person's own clone | `server/src/memory/chatImport.ts:127` |
| Self-test (optional) | The clone writes as the person; they grade it | AI ([AI-2](#ai-2)) | Grades | The person | `server/src/api/selftest.ts:44` |
| Character, photos (optional) | A 3D look; up to six photos | Code | Look, photos (location data removed) | Look: everyone in the town; photos: stage 9 | `app/src/features/onboarding/photos-step.tsx:168` |

### Arjun and Meera

The screens and questions are the same for both; only their taps differ. Arjun taps "A man" on
"You are…" and "Women" on "You want to meet…"; Meera taps "A woman" and "Men"
(`server/src/onboarding/questions.ts:144`,
`server/src/onboarding/questions.ts:153`).
In order, each sees:

1. **"Tell it one true thing"** — "Anything about you. One sentence is enough to start." Arjun types
   "I work in AI and run most mornings."
   (`app/src/features/onboarding/start-screen.tsx:140`).
   His work field and exercise are fields a must-have can depend on, so both facts are
   **held for his Yes** rather than learned (`server/src/api/tell.ts:90`).
   Anything heard moves him on: with only held facts the screen skips the sample reply (the
   clone has nothing live to answer from) and goes straight to the questions
   (`app/src/features/onboarding/start-state.ts:24`,
   `app/src/features/onboarding/start-screen.tsx:47`).
   It asks again only when nothing at all was heard.
2. **"Now it's you"** (only when something was learned; Arjun's sentence skips it) — "Someone asks
   you", the clone's first reply in his name, "Is that you?", "That's me" / "Not even close"
   (`app/src/features/onboarding/start-screen.tsx:87`).
3. **"Now it asks you some things"**, with an optional "Paste from another AI"
   (`app/src/features/onboarding/start-screen.tsx:106`,
   `app/src/features/onboarding/start-screen.tsx:122`).
4. **The interview** (below).
5. **"A few things missing"**, because birth year and city are asked next
   (`app/src/features/onboarding/interview-screen.tsx:233`).
6. **Essentials**: "What year were you born?", "Who would you like to meet?" (ages, pre-filled ±5 from
   their own), "Where are you now?", "How far would you travel?"
   (`app/src/features/profile/fields.ts:63`,
   `app/src/features/profile/age-range.ts:42`).
   Both type "Bangalore", which resolves to the city centre.
7. **"Now, how you talk"** (voice), **"Is this you?"** (self-test), **"Make your character"**, **"One
   last thing"** (photos) — all skippable
   (`app/src/features/onboarding/voice-screen.tsx:162`,
   `app/src/features/onboarding/photos-step.tsx:114`).
8. **Home**, the town, with "Send my agent out".

### 2.1 The screens in order

For a new person: start → (optional paste) → interview → essentials → voice → self-test →
character → photos → Home (`app/src/features/onboarding/interview-screen.tsx:214`,
`app/src/features/onboarding/essentials-screen.tsx:73`,
`app/src/features/onboarding/character-step.tsx:23`).
The Stories screen is shown only when someone is already in the pool when the interview ends, so a
new person does not see it during setup; it is reached later from the You tab.
"Setup done" is remembered on the phone only after the photos step; closing the app earlier
restarts setup at the first screen (`app/src/features/onboarding/photos-step.tsx:95`).

### 2.2 Every question

**Basics** (required, cannot be skipped)
(`server/src/onboarding/questions.ts:359`):

| Question | Answers |
|---|---|
| "You are…" | A woman, A man, Nonbinary, Something else |
| "You want to meet…" (several) | Women, Men, Nonbinary people |
| "What are you here for?" | Something long-term, Marriage, Company, Something casual, Still working it out |

Sources: `server/src/onboarding/questions.ts:142`,
`server/src/onboarding/questions.ts:151`,
`server/src/onboarding/questions.ts:159`.

**The five cards** (the fixed "set" questions; required, but "Prefer not to say" counts as an
answer) (`server/src/onboarding/questions.ts:371`).
Each card has two rows: **You** (your answer) and **Your partner** ("Tap every one that is okay.
People who have not said still pass."), with "All are okay" and nothing pre-ticked
(`app/src/features/onboarding/interview-screen.tsx:359`,
`app/src/features/onboarding/interview-screen.tsx:363`):

| Card | You | Your partner | Answers |
|---|---|---|---|
| Kids | "Do you want children?" | "Which are okay for your partner?" | Want kids; Don't want kids; Not sure yet; Have kids, want more; Have kids, done |
| One person or open | "One person, or open?" | "Which are okay for your partner?" | One person; Open; Either could work |
| Smoking | "Do you smoke?" | "How much can your partner smoke?" | Never, Rarely, Sometimes, Often, Every day |
| Drinking | "Do you drink?" | "How much can your partner drink?" | same five |
| Food | "How do you eat?" | "How can your partner eat?" | Everything, No beef, No pork, Fish no meat, Vegetarian, Vegan |

Sources: `server/src/onboarding/questions.ts:175`,
`server/src/onboarding/questions.ts:179`,
`server/src/onboarding/questions.ts:182`,
`server/src/onboarding/questions.ts:183`,
`server/src/onboarding/questions.ts:184`.
Ticking only some partner answers stores **one hard rule** (a must-have) on that card; "All are
okay" stores none (`server/src/api/interview.ts:531`).

**Faith** (optional, can be skipped whole): "What is your faith?" with eleven answers (Hindu,
Muslim, Christian, Sikh, Jain, Buddhist, Jewish, Zoroastrian, "Spiritual, not religious", "Not
religious", "Something else") and "Optional. Nobody ever sees your answer. It is only used to check
who fits, both ways." (`server/src/onboarding/questions.ts:196`,
`server/src/onboarding/questions.ts:202`).

**"Couldn't be with"** (optional): "Anyone else you couldn't be with?" — "Be blunt. If it matches one
of your cards, you'll see the change and decide. If not, you'll spot it in the first chat."
(`server/src/onboarding/questions.ts:220`). The sentence is
kept as a want (stage 5). A model may read it as a change to one card's partner row, shown as
"Change this card?" with "Keep this" / "Leave it"; nothing changes unless the person keeps it
(`app/src/features/onboarding/interview-screen.tsx:157`).

**Optional profile questions**, asked only once the person is already in the pool, one at a time,
with "Skip this one" and "That's enough for now": "How often do you move your body?", "How much does
religion matter to you?", "How much does politics matter to you?", "How far did you get with
school?", "What field are you in?", "Any field you would especially like them to be in?", "Early or
late?", "Money — how do you think about it?", "What do you actually watch?", "How do you get
around?", "Would you move cities for the right person?"
(`server/src/api/interview.ts:125`,
`server/src/onboarding/questions.ts:232`,
`server/src/onboarding/questions.ts:259`,
`server/src/onboarding/questions.ts:312`).

**Situation questions** (8): never asked during setup. They arrive only as a question of the day
when someone else's want needs the answer (stages 3 and 5)
(`server/src/onboarding/next-question.ts:113`).

**Essentials** (the setup wizard): "What should people call you?" (asked first; "Just your first
name." and "People see it only after you share your profile with them."), "What year were you
born?", "Who would you like to meet?" (age range), "Where are you now?" ("Your city is enough. Nobody
sees your exact location."), "How far would you travel?" (10 km, 25 km, 50 km, 200 km, Anywhere).
Only the first name and distance can be declined here
(`app/src/features/profile/fields.ts:59`,
`app/src/features/profile/fields.ts:62`,
(`app/src/features/profile/fields.ts:82`,
`app/src/features/profile/fields.ts:94`).
A city among 46 listed ones becomes that city's centre; an unlisted city becomes a point only if
"Use my location" was used (`shared/src/places.ts:36`,
`server/src/api/dating.ts:107`).

**Wants** are not asked during setup. "What would you love in someone?" is on the Stories screen and
"What you're looking for" is reached from the You tab or Settings (stage 5)
(`app/src/features/settings/settings-screen.tsx:243`).

**The name others see comes only from that screen** (since 2026-09-28). One word of letters is kept
(a number or an "@" gets "Just your first name, in letters."); the fact store refuses a first name
from any other writer, so a name said in chat never becomes it; and without one the other person sees
"Someone" (`server/src/api/dating.ts:296`,
`server/src/memory/facts.ts:103`,
`server/src/matching/profile.ts:76`,
`server/src/api/dating.ts:166`). People who set up
before the step existed are asked on the Home ("Add your first name") and can set it on the You tab
("First name") (`app/src/features/world/hud.tsx:189`,
`app/src/features/profile/profile-screen.tsx:244`).

### 2.3 Required vs optional, and "ready to send"

The server recomputes readiness on every profile rebuild. A person is **in the pool** when all of
these hold (`server/src/matching/profile.ts:207`,
`shared/src/values.ts:77`):

- gender, who they want to meet, birth year, city **with a map point**, and what they are here for,
  each from a confirmed (not held) fact (`server/src/matching/profile.ts:45`,
  `server/src/matching/profile.ts:152`);
- an answer (or "prefer not to say") on each of the five cards
  (`server/src/matching/profile.ts:178`);
- all three consent documents (`server/src/matching/profile.ts:205`);
- age 18 or over, computed from the birth year alone (`server/src/matching/profile.ts:190`).

Not required: photos, a name, age range, distance, neighbourhood, faith, the sentence, stories,
voice, self-test, character. The self-test's "It's ready. It can go out and meet people for you."
is a separate notion and gates nothing (`app/src/features/onboarding/self-test-screen.tsx:145`).

**When someone is not ready:** the Home's big button reads "Finish setup" and the status line names the
first missing item ("Your birth year", "Where you live"...); the Matches tab says "Your agent is still
inside — It needs a few more things before it can talk to anyone."; a refused send says "Your agent
needs a few more answers before it can go out."
(`app/src/features/world/hud.tsx:223`,
`app/src/features/matches/matches-screen.tsx:229`).

### 2.4 Model calls during setup

The first screen already calls a model (fact extraction, then a sample reply); so do the paste, the
"couldn't be with" sentence, the voice import and each self-test. Since 2026-09-28 these setup calls
are counted apart, up to 40 a day, and never use the 10 a day that chat, learning and rounds share;
the $2.00 daily cost cap still covers them. Measured before the change: real people's setup used 1 to
4 of the 10 on their first day (`server/src/api/tell.ts:76`,
`server/src/metering.ts:59`,
`server/src/memory/selftest.ts:24`).

### Docs vs code

- HOW-IT-WORKS.md §2 gives the flow as `start → interview → (essentials → voice → self-test) →
  character → photos → home`, skipping the middle only after a paste. The code skips to Stories when the
  person is already in the pool, and a paste can never put a new person in the pool, because pasted
  facts are held until confirmed (`HOW-IT-WORKS.md:63`,
  `server/src/memory/pasteImport.ts:188`).
- HOW-IT-WORKS.md §2a describes the partner row as "Anyone is fine" or "Let me choose". The screen shows
  "All are okay" and every answer, unticked (`HOW-IT-WORKS.md:82`).
- HOW-IT-WORKS.md §2b says "which part of town" is asked in setup; it is not asked until the person has
  a map point (`server/src/matching/profile.ts:350`).
- HOW-IT-WORKS.md §2c calls the voice step free paragraphs "extracted into facts"; it is a WhatsApp
  import that writes a style note, not facts (`HOW-IT-WORKS.md:150`).
- The location code and the phone's permission text say only the city is kept. For an unlisted city,
  "Use my location" stores the phone's position rounded to about 1 km
  (`app/app.json:48`,
  `app/src/lib/location.ts:72`).

---

## 3. How the agent learns about its person

**No model is trained or fine-tuned.** A search of the whole repository for fine-tuning, training
jobs, adapters or tuned model ids finds nothing in the project's code; every model the app can use is
a stock vendor model in the price table (`server/src/llm/caps.ts:151`,
`HOW-IT-WORKS.md:172`). "Learning" means **writing rows in the
database**: facts, the raw messages, a style note, answer sheets and a matching profile. A model is
used only to **extract** facts from what a person typed, to **point** at their own sentences, or to
**phrase** a chat reply. The rows are the agent.

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| A tap in the interview or setup | Saved as a fact, live at once | Code | `facts` (+ `question_answers`) | The person; matching | `server/src/api/interview.ts:456` |
| A message to your own clone | Stored; about 5 minutes after the chat goes quiet, a model reads the whole session and pulls out facts | [AI-1](#ai-1) | `episodes` (both sides), then `facts` | The person; learned facts are private until "OK to share" | `server/src/memory/session.ts:28` |
| A heard answer on a "tapped" field (city, cards, work, exercise...) | Held, not live, until the person says "Yes, that's right" | Code | `facts` with status `staged` | The person, as a question | `server/src/memory/extract.ts:237` |
| A story ("Things to talk about") | Saved word for word | Code | Episode + fact, shareable | Others' cards, via the agents | `server/src/onboarding/stories.ts:150` |
| Question of the day | Saved like a story and put on the answer sheet | Code | Episode + fact + answer sheet | Others, via the agents | `server/src/matching/unknowns.ts:212` |
| A paste from another AI | A model extracts facts; every one is held for checking | [AI-4](#ai-4) | `facts` (all `staged`); the pasted text is not kept | The person | `server/src/memory/pasteImport.ts:188` |
| A WhatsApp export | A model describes how the person writes | [AI-5](#ai-5) | A style note only | The person's own clone | `server/src/memory/chatImport.ts:55` |

### Arjun and Meera

- **Arjun tells his clone** "I work in AI and run most mornings." His phone sends it over the live
  chat connection; the server stores it, and the clone replies. No fact is written yet
  (`server/src/api/chat.ts:315`).
- **About five minutes after he stops**, a background sweep runs the extractor over the whole
  session ([AI-1](#ai-1)) (`server/src/index.ts:149`).
  Likely results (they depend on the model; unverified): work field "AI", exercise "runs most
  mornings". Both are fields a must-have can depend on, so both are **held**
  (`server/src/onboarding/questions.ts:415`).
- **What Arjun sees** on the YOU tab: "Your agent heard something", the claim with his own words,
  "Is that right? Nothing changes until you say so.", and "Yes, that's right" / "No"
  (`app/src/features/profile/profile-screen.tsx:130`,
  `app/src/features/profile/profile-screen.tsx:136`,
  `app/src/features/profile/profile-screen.tsx:139`).
- **If he taps Yes**, the claim becomes his live answer, and it stays match-only: "that's right" is
  not "OK to share", so nobody else hears his work sentence until he shares it on "How you appear"
  (`server/src/memory/pasteImport.ts:337`,
  `server/src/matching/brief.ts:108`).
  One side effect remains (Known gaps): "runs most mornings" is not one of the exercise answers, so
  his exercise answer becomes "unknown" for matching
  (`shared/src/values.ts:37`).
- **Meera pastes** a paragraph about herself from another AI. One model call pulls facts out of it
  ([AI-4](#ai-4)); **every** fact is held for checking, and the paragraph itself is not stored. She sees
  "Held for checking" and "Nothing is treated as true until you say so."
  (`server/src/memory/pasteImport.ts:183`,
  `app/src/features/onboarding/paste-screen.tsx:60`).
  Until she confirms, nothing from the paste affects matching, her cards or her clone's "true right
  now" list. Even after she confirms, a pasted fact can never be quoted to anyone, because the
  quote check needs her own typed words and the paste was not kept
  (`server/src/matching/brief.ts:271`).
- **Arjun never sees** anything of Meera's paste or chat unless she made it shareable and it passed the
  quote rules (stage 4).

### 3.1 What a "fact" is

One row per claim about the person (`server/migrations/0002_facts.sql:29`):

- **The words** exactly as said, plus a comparable value derived by code, never by a model
  (`server/src/memory/facts.ts:211`).
- **Status:** live (`active`), held (`staged`), replaced, or withdrawn
  (`server/migrations/0002_facts.sql:42`).
  The database refuses to make an untrusted row live
  (`server/migrations/0010_origin_gate.sql:19`).
- **How sure:** asserted, hedged, hypothetical, reported, negated; only an asserted claim by the person
  goes live (`server/src/memory/facts.ts:74`).
- **Visibility:** public, match-only or private (stage 4).
- **Where it came from:** the exact quote, the messages, which extractor.

A single-answer field keeps one live fact; a new one replaces the old, which is kept
(`server/migrations/0002_facts.sql:90`).
The vocabulary is closed: 59 core fields, 4 open ones, and 8 situation fields
(`shared/src/facts.ts:196`,
`shared/src/facts.ts:211`).

**The matching profile** is one row per person rebuilt from **live** facts only; held facts never
reach it (`server/src/matching/profile.ts:45`).
It is rebuilt by the interview, setup, the pool check and "send my agent out", not by chat itself
(`server/src/api/interview.ts:119`).

### 3.2 The confirm step

- **What is held:** anything heard (chat, the first sentence, a paste) on a **tapped** field: gender, who
  they want to meet, birth year, city, intent, age range, distance, neighbourhood, the five cards,
  faith, the eight situation answers, and (since 2026-09-28) work field, exercise, sleep and moving
  cities; plus **everything** from a paste (`server/src/onboarding/questions.ts:403`).
- **What goes live at once:** everything else heard in chat (interests, things done, employer, wants
  and "could not be with" sentences...), but **match-only**: it may help matching, it is never said to
  anyone until "OK to share" (`server/src/memory/extract.ts:245`).
  A Yes on a held fact keeps it match-only too; only a tapped field that nothing ever quotes (the basics,
  the cards, faith, the situations) keeps its own default
  (`server/src/matching/brief.ts:108`).
- **Where the question appears:** the YOU tab, one at a time ("Your agent heard something"), and "What it
  knows" ("Is this right?", with "Yes" / "No", and "Good. It believes you now." / "Dropped. It will not use
  that.") (`app/src/features/knowledge/you-screen.tsx:112`,
  `server/src/api/profile.ts:243`).
- **Before a Yes**, a held fact changes nothing in matching, cards, sheets, talk or want checks. Two
  exceptions: the person's own clone still sees the sentence in its recent chat, and a background
  resolver ([AI-8](#ai-8)) can retire a live answer on a multi-answer field (for example who they want to
  meet, or work field) on the strength of an unconfirmed sentence, with no Yes and no record of the
  change (`server/src/memory/session.ts:133`,
  `server/src/memory/session.ts:142`).
  Unverified whether this happens in practice.

### 3.3 Question of the day

- **Where it comes from:** every "I don't know" an agent gave in a round, and every want that could not be
  checked (stage 5), recorded against that person; the asker is not recorded
  (`server/migrations/0062_question_of_the_day.sql:13`).
- **Which one:** the most-asked gap in the last 14 days that they have not answered and did not skip in the
  last 7; at most two a day (`server/src/matching/unknowns.ts:29`).
- **Where:** a chip "A question for you" in the town. For a bank question: "Other agents asked yours this"
  … "Answer it, and next time it can say what you said.", with "Save and share" / "Not now"
  (`app/src/features/question/question-state.ts:10`,
  `app/src/features/question/question-screen.tsx:104`).
  For a card or tied question it opens that one question in the interview.
- **What an answer writes:** a shareable fact in the person's own words, put straight on their answer
  sheet. An answer naming a private topic or a contact detail is kept but never said: "Those are only ever
  checked, never said." (`app/src/features/question/question-state.ts:23`).

### 3.4 Paste and import

- **Paste** (onboarding "Bring what it knows", YOU → "In your words", "Catch it up fast"): up to 60,000
  characters; one model call; every fact held; guesses become questions the clone "won't guess" about; the
  pasted text is thrown away (`shared/src/paste.ts:72`,
  `server/src/memory/pasteImport.ts:86`).
- **WhatsApp export** ("Now, how you talk"): parsed on the phone; the person picks which speaker they are;
  only their own lines (at least 20, at most the last 2,000) are sent; one model call writes a style note;
  the messages are not stored (`app/src/features/onboarding/voice-screen.tsx:93`,
  `app/src/features/onboarding/voice-screen.tsx:124`).

### 3.5 Background jobs

| Job | When | What it does | Model? | Code |
|---|---|---|---|---|
| Session sweeper | Every 60 s, for chats quiet 5+ minutes | Extracts facts; may resolve conflicts, re-render the profile, refresh the answer sheet | [AI-1](#ai-1), [AI-8](#ai-8), [AI-9](#ai-9), [AI-10](#ai-10) | `server/src/index.ts:147` |
| Consolidator | Every hour | Merges exact duplicates, lowers the weight of old unused facts, re-opens one old question | No (plain SQL) | `server/src/memory/consolidate.ts:26` |
| Embeddings | After each chat reply | Turns both messages into vectors for recall | [AI-7](#ai-7) (not metered) | `server/src/api/chat.ts:470` |
| Round worker | Every 5 s | Runs rounds; records "I don't know"s for the question of the day | See stages 6–7 | `server/src/index.ts:155` |

Two configured model tasks, `reflect` and `canon`, have no caller: no reflection or canonicalisation runs
(`server/src/llm/index.ts:32`, `server/src/llm/index.ts:34`).

### 3.6 What the "agent" is at the moment it runs

**In a round** (the default path), the agent is not a chatbot. It is:

- a **row** of matching data (age, gender, who they seek, place, intent, tags, card answers) used by SQL
  (`server/src/matching/candidates.ts:34`);
- a **list of the person's own shareable sentences**, loaded under their own database session
  (`server/src/matching/orchestrator.ts:313`);
- an **answer sheet** built earlier: 12 fixed questions, each pointing at one of those sentences
  (`server/src/matching/orchestrator.ts:303`);
- the person's **wants** (stage 5);
- and one **model call per pair** that may only point at those sentences and write a date idea
  ([AI-11](#ai-11)).

The matchmaker's database role can read a person's facts only where they are public, live and current
(`server/migrations/0028_matchmaker.sql:48`).

**In the person's own chat**, the clone is a model prompt ([AI-6](#ai-6)) that says "You are this person's clone:
an agent that knows them and speaks with their voice and judgement." and "Never invent a detail about them
that is not in the fragments." (`server/src/api/chat.ts:35`,
`server/src/api/chat.ts:41`). It is given the
profile summary, the style note, the last 20 messages of this chat, **every** live fact (private ones
included, since it talks only to its own person), and up to 5 recalled old messages
(`server/src/api/chat.ts:98`). Its replies are not
checked by code. They are stored, but since 2026-09-28 neither the extractor nor recall reads them: facts
and "things they said before" come only from the person's own lines
(`server/src/api/chat.ts:91`,
`server/src/memory/retrieval.ts:81`).

### Docs vs code

- HOW-IT-WORKS.md §3 describes the agent only as the switched-off conversation setup (dossier, voice,
  quotes). The default-path agent (answer sheet, talk, wants, tags) is not described there
  (`HOW-IT-WORKS.md:173`).
- HOW-IT-WORKS.md §3 says no model "judges for you on the default path". A model decides which of a person's
  sentences answer another agent (the talk) and whether their wants are met, which reorders who they meet
  (`HOW-IT-WORKS.md:166`).
- HOW-IT-WORKS.md §2c says chat facts are "learned at once". Only non-tapped, asserted facts are, and they
  stay private until "OK to share" (`HOW-IT-WORKS.md:153`).
- ARCHITECTURE.md describes a nightly 03:00 job with a batch model, reflections, weekly canonicalisation and
  embedding backfill. The code runs an hourly SQL-only job, and none of the rest exists
  (`ARCHITECTURE.md:418`,
  `server/src/memory/consolidate.ts:26`).
- ARCHITECTURE.md says extracted candidates "land staged". An asserted claim by the person goes live on first
  write (`ARCHITECTURE.md:450`).

### Unverified

- Which fields the extractor picks for a given sentence, and whether it repeats identical words when it
  re-reads a session (model behaviour; nothing was run).
- Whether the background resolver retires tapped answers in practice.

---

## 4. Privacy

Three layers decide what one person can learn about another: a **visibility level** on every
fact, **word filters** on anything repeated to someone else (private topics and contact
details), and **database roles** that limit what each part of the server can read.

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| A fact is written | It gets a level: public, match-only or private | Code | `facts.disclosure` | Public: can be quoted to others. Match-only: used for matching, never said. Private: hidden by the person | `server/migrations/0018_dating_schema.sql:39` |
| "OK to share" on a learned sentence | Match-only → public | Code | `facts.disclosure`, audit row | Others, via cards and agents | `app/src/features/appearance/appearance-screen.tsx:187` |
| "Hide" on a sentence or answer | → private; comes off cards already written, at the next load | Code | `facts.disclosure`, audit row | Nobody else | `server/src/api/me.ts:177` |
| A sentence naming kids, faith, drinking… or holding a phone number, email, handle, link or address | Kept, but never repeated to anyone | Code | Nothing extra | Only the person | `server/src/matching/brief.ts:203` |
| A sentence naming a company, college or building | A suggestion: "This names a company. Hide this?" | Code | Nothing unless hidden | The person | `app/src/features/appearance/appearance-state.ts:72` |

### Arjun and Meera

- **Before they meet**, Arjun's agent (server code) can read Meera's matching row: age, gender, who
  she seeks, place, distance, intent, tags and card answers, to filter and count
  (`server/migrations/0019_match_role.sql:40`). Arjun himself sees at most her 3D
  character and neighbourhood in the town: no name, age, tags or photo
  (`server/src/api/world.ts:256`).
- **In Cubbon Park, live** (since 2026-09-29): walking in the park at the same time, each sees the
  other's character where they stand, out to the mist (about 365 m), and reads what the other types if
  they are within about 20 m. Nothing said is written anywhere; a line holding a phone number, email,
  handle or link is not sent; people blocked either way never see or hear each other there
  (`shared/src/events.ts:82`,
  `server/src/park/room.ts:137`).
  "Find someone to talk to" ranks the free people there by what they have in common, with matching's
  own reading of both files, but tells the one asked only one thing both of them made public ("You both
  like climbing"), never a word from a fact only matching may use. On a bench the two of them see and
  hear only each other; people near see that they sit, never what they say. For "Sit and talk" the
  server counts how many things each says there -- a number, never the words
  (`server/src/park/quests.ts:90`,
  `server/src/park/socket.ts:251`).
- **When the agents meet**, up to 20 of Meera's **public**, verified sentences are read under her own
  database session and sent to the model for the talk and for Arjun's want check
  (`server/src/matching/orchestrator.ts:366`).
- **On Arjun's card** (his turn): her headline, shared tags, up to two of her sentences, the talk,
  Arjun's wants against her sentences ("Matches"/"Doesn't match" only on a want tied to a question;
  a private-topic want says only "A private topic. Their answer is never shown."), an opener (stage 8)
  (`app/src/features/matches/exchange.ts:178`).
- **On the reveal**: the first name she typed on the setup screen, age, city, up to eight interest and
  work tags from facts she made shareable (no private-topic word), photos (stage 9)
  (`server/src/api/dating.ts:145`,
  `server/src/api/dating.ts:164`).
- **Arjun never sees** her facts list, her chat, her hidden or match-only sentences, her rules and
  wants, her card answers as values, her check-in answers, her reports or blocks, her exact location,
  her birth year or her phone number
  (`server/src/matching/brief.ts:265`,
  `app/src/features/consent/consent-screen.tsx:38`).

### 4.1 The three levels

| Founder's word | Code name | Meaning | Code |
|---|---|---|---|
| share | `public` | May be quoted to other people through cards and agents | `server/src/matching/brief.ts:279` |
| match-only | `matchable_only` | Used for matching, never said to anyone | `server/src/memory/extract.ts:245` |
| never | `private` | Set only by the person's own "Hide" | `server/src/matching/brief.ts:276` |

- **Defaults.** Some kinds of fact start public (city, work field, interests, story answers,
  intent, kids and one-person-or-open answers, diet, exercise...), the rest start match-only
  (`shared/src/facts.ts:98`).
  Some kinds can **never** be made public: medical conditions, allergies, religion, politics,
  ethnicity, full name, birth date, employer, children, relationships, drugs
  (`shared/src/facts.ts:90`,
  `shared/src/facts.ts:91`).
- **Learned is private.** Anything learned from chat, the first sentence or a paste starts match-only,
  until the person taps "OK to share" on "How you appear"
  (`server/migrations/0063_learned_is_private.sql:25`).
  A "Yes, that's right" on something held keeps it match-only too: it confirms, it does not share
  (`server/src/matching/brief.ts:107`).
  Stories and question-of-the-day answers start public, because the person typed them to be said.
- **Public is not enough to be quoted.** A sentence reaches another person only if it is also of an
  allowed kind (interests, things done, topics, media, pets, story answers, work, exercise, sleep,
  transport; the agents also use goals and dislikes), was typed by the person (found word for word
  in their messages), is 12 to 300 characters, is not an interview tap, and passes the word filters
  (`server/src/matching/brief.ts:87`,
  `server/src/matching/brief.ts:266`).
  Card answers (kids, one person or open, smoking, drinking, food, faith) are never quoted; they are
  only used to filter.
- **Where levels are not applied:** the matching row is built from every live fact whatever its level,
  so match-only and hidden facts still filter and rank; and the reveal's tags come from that row (Known
  gaps) (`server/src/matching/profile.ts:45`,
  `server/src/api/dating.ts:162`).

### 4.2 Private topics and contact details

- **Private topics** are matched by a list of about 150 word stems: smoking, drinking, kids, family and
  marriage words, monogamy, diet, faith and caste, politics, health and drugs. A sentence with one is
  saved but never repeated (`server/src/matching/brief.ts:191`,
  `server/src/matching/brief.ts:176`).
  The stories screen says so as you type: "This one mentions something private, like kids or drinking,
  so your agent will not repeat it." (`app/src/features/stories/stories-screen.tsx:94`).
- **Contact details** ("when unsure, block"): phone numbers (8+ digits, or spelled out), emails
  including "at … dot", @handles and "my insta is…", links and domains, "dm me on…", street addresses,
  pin codes (`shared/src/contact.ts:12`,
  `shared/src/contact.ts:21`).
- **Where the filters run:** every path that repeats a person's words to someone else: card quotes,
  shared tags, answer sheets, the agents' talk, the date idea (twice), want quotes, the recap, and every
  time a card is shown (`server/src/matching/brief.ts:284`,
  `server/src/matching/talk.ts:193`).
- **Where they do not run:** direct messages after both say yes (by design: people swap details there),
  report text, and the reveal's name, city and tags (`server/src/messaging/store.ts:106`).

### 4.3 "How you appear" and hiding

- **The screen** (YOU → Manage, or the town's "How you appear" chip) shows, in order: "Your agent only
  brings you people who" (the person's card rules read back in words), "What someone sees about you"
  (headline, the fixed line, tags, up to eight sentences each marked "On your card", "Not on a card
  now" or "Hidden"), "When another agent asks yours" (their answer sheet), and "Learned in chat" ("Only
  you see these. Your agent uses them to find people, but never says them until you tap OK to share.")
  (`app/src/features/appearance/appearance-screen.tsx:88`,
  `app/src/features/appearance/appearance-screen.tsx:106`,
  `app/src/features/appearance/appearance-screen.tsx:167`,
  `app/src/features/appearance/appearance-screen.tsx:181`).
  Opening it can refresh the answer sheet, one model call ([AI-10](#ai-10)).
- **Not shown there**, though others see it: the reveal (first name, tags, photos), the character, the
  neighbourhood, and "Matches"/"Doesn't match" on wants tied to a question (`server/src/api/me.ts:89`).
- **"Hide this?"** is a suggestion under any sentence that names a company, college or building, found
  by word lists; it never blocks (`shared/src/identifying.ts:11`).
- **Hiding** makes the fact private: new cards, sheets, talk and want checks skip it; cards already
  written drop it at the next load; a date idea resting on it is withdrawn. It stays usable for
  matching (`server/src/matching/brief.ts:757`).
- **Other controls:** remove a photo ("It is deleted from the server as well."); answer a story again
  (the old answer is kept but replaced); no per-fact delete; no message unsend
  (`app/src/features/photos/photos-screen.tsx:110`,
  `app/src/features/knowledge/you-screen.tsx:183`).

### 4.4 Who can read what in the database

Row-level security is the boundary. Each part of the server connects as its own role
(`server/migrations/0000_roles.sql:16`):

| Role | Used for | Can read | Code |
|---|---|---|---|
| `clone_app` | Everything a signed-in person does | Their own rows only (facts, messages, photos, cards...); the shared pair row and its messages; can write but not read reports; invites table in full (no row security) | `server/migrations/0022_rendezvous.sql:104`, `server/migrations/0024_messages.sql:107` |
| `clone_match` | Finding and counting candidates | In-pool matching rows (all columns), the rule columns of live preferences (never their sentences), characters | `server/migrations/0019_match_role.sql:40`, `server/migrations/0021_matching_fixes.sql:22` |
| `clone_matchmaker` | Running rounds, reveals, the reviewer | Facts only where public, live and current; every matching row, pair, card, transcript, report and photo record; every profile summary; the founder's two count functions | `server/migrations/0028_matchmaker.sql:48`, `server/migrations/0028_matchmaker.sql:51` |
| `clone_eraser` | Deleting an account | Everything (bypasses row security), to delete and verify | `server/migrations/0026_eraser_role.sql:24` |
| `clone_door` | The phone sign-in | Code challenges (hashes, caller IP); account id and number hash | `server/migrations/0066_door_and_discovery_roles.sql:46` |
| `clone_discovery` | Background sweepers | Ids, counts and times, and each account's device name | `server/migrations/0066_door_and_discovery_roles.sql:67` |
| owner `clone` | Migrations and founder scripts | Everything | `server/src/env.ts:13` |

- **Nobody in the app can read** transcripts, the erasure log, phone challenges or bans
  (`server/migrations/0028_matchmaker.sql:73`).
- **One important exception to "the database decides":** in a round, a person's quotable sentences are
  read under **that person's own** session, where they can see all their facts; one SQL clause
  (`disclosure = public`) is what keeps the rest off a stranger's card
  (`server/src/matching/brief.ts:258`).
- **Phone numbers** are never stored, only a keyed hash; the screen shows only the last two digits
  (`server/migrations/0045_phone_identity.sql:22`,
  `shared/src/phone.ts:95`).
- **Photos** live on the server's disk, re-encoded (which removes location data), and are served only
  through a signed-in route that asks the database rule in stage 9; "none" and "not allowed" look the
  same (`server/src/photos/store.ts:8`,
  `server/src/api/photos.ts:43`).

### 4.5 Deleting an account, and exporting

- **Settings → "Delete everything"** ("Cannot be undone. The clone and all of its memory go.") deletes the
  person's rows from 23 tables, their photo folder, every pair they were in (including **both** sides of
  their conversations) and reports about them; then it counts what is left and deletes the account last
  (`app/src/features/settings/settings-screen.tsx:290`,
  `server/src/memory/erasure.ts:35`,
  `server/src/memory/erasure.ts:200`).
- **It leaves:** a receipt with counts, invites, reports they filed (without their name), bans and the
  phone and device hashes of a ban, the account's device name, and anything already sent to AI providers
  or written to server logs (`server/migrations/0007_erasure.sql:12`).
- **"Download everything"** exports their facts, all their messages with their clone, their profile,
  questions, their own messages to matches and their model usage, as plain text to the share sheet
  (`app/src/features/settings/settings-screen.tsx:120`).

### 4.6 Operators, logs and AI providers

- **The reviewer** (accounts in `ADMIN_USER_IDS`) sees the reports queue (reason, the reporter's note, the
  reported person's first name; never who reported), the Numbers page, and the unmatched-wants list
  (stage 11). No admin route reads messages, photos or facts
  (`server/src/api/admin.ts:113`,
  `server/src/api/admin.ts:25`).
- **Logs** carry user ids, not message text; the redaction list covers text fields. In development the
  console SMS sender logs full numbers and codes (`server/src/log.ts:8`).
- **AI providers** receive: everything typed to the clone, and its replies, for chat; only the
  person's own lines for extraction (`server/src/memory/extract.ts:187`);
  every message's text for embeddings, and in a round the other person's public sentences and both
  people's wants. The per-session notice names the provider: "You are talking to an AI. Your messages are
  processed by…" (`server/src/api/config.ts:50`).
- **Push notifications** (since 2026-09-28) pass through Expo's push service and, on Android, Google's:
  each carries the kind of event and the card's id, never a name or anybody's words. A phone's push
  token is kept against its account only (row-level security), dropped at sign-out, and deleted with
  the account (`server/src/api/push.ts:36`,
  `server/src/memory/erasure.ts:41`).
- **The Settings promise** reads "Nobody else has ever seen what your clone knows about you."
  (`app/src/features/settings/settings-screen.tsx:297`).
  By design, other members see public sentences, tags and a first name; the reviewer sees want topic
  words; AI providers process the text. Read literally, the promise is broader than the code.

### Docs vs code

- HOW-IT-WORKS.md says the agent "cannot say more than the public facts, because the database will not
  show it more". For quotes, it is one SQL clause under the person's own session, not a database policy
  (`HOW-IT-WORKS.md:837`).
- HOW-IT-WORKS.md says the matchmaker sees "only facts marked public". It can also read every profile
  summary (written from all facts) and, through a function, every real person's want sentences
  (`HOW-IT-WORKS.md:831`).
- HOW-IT-WORKS.md says `clone_match` reads "dealbreaker preferences only". It reads the rule columns of
  every live preference (`HOW-IT-WORKS.md:830`).
- HOW-IT-WORKS.md and CLAUDE.md say the discovery role reads "never content". It can read each account's
  device name, which often contains a person's name (`HOW-IT-WORKS.md:834`).
- The consent screen says "Only things marked public ever leave your account." Since 2026-09-28 reveal
  tags are public-only and private-topic wants show nothing, but the first name (typed for this), age
  and city on the reveal, and "Matches" on a want tied to a situation question (which says how the other
  person answered it) also reach other people
  (`app/src/features/consent/consent-screen.tsx:46`).
- The consent screen says you can "change" everything the clone knows. There is no per-fact edit or delete,
  only hide, confirm/reject and answering again (`app/src/features/consent/consent-screen.tsx:48`).
- ARCHITECTURE.md says row-level security is on "every table". Invites, tenants, phone challenges and the
  erasure log have none, deliberately (`ARCHITECTURE.md:391`).
- A code comment says erasure "is a way out of a ban". Since 0065 a ban keeps the phone hash, so it is not
  (`server/src/memory/erasure.ts:165`).

### Unverified

- Live database grants (read from the migrations; the catalogue was not queried).
- Encryption at rest for photos and the database, and how long AI providers keep data.

---

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
| Arjun types "What would you love in someone?" | Saved as one `seeking` fact, match-only | Code | `facts` row + an episode with his words | Arjun; his agent's checks; the founder's list (topic words or shared text only) | `server/src/onboarding/stories.ts:150` |
| Answer to "Anyone else you couldn't be with?" | Saved as a `dealbreaker` fact; a model may also propose a card change | Code, plus [AI-3](#ai-3) | `facts` row | Same as above | `server/src/api/interview.ts:341` |
| A want's words match a question | The question is offered; Arjun ticks the answers he accepts | Code (word patterns) | `preferences` row: field, ticked values, strength | Arjun, on "Looking for" | `server/src/matching/want-questions.ts:84` |
| Arjun taps "Must have" | The rule becomes a hard filter, both directions | Code (SQL) | `preferences.strength = 'dealbreaker'` | Arjun | `server/src/matching/candidates.ts:88` |
| A round meets Meera: tied want | Her answer is compared with his ticks | Code | Status on the card record | Arjun sees "Matches", "Doesn't match" or "We can't check this one yet." | `server/src/matching/want-questions.ts:113` |
| A round meets Meera: untied or private want | One model call checks all of Arjun's untied wants against his first 12 candidates | [AI-12](#ai-12), then code | Status (+ her sentence) on the card record | Untied: her sentence, or "Nothing they've said covers this yet." Private: only "A private topic. Their answer is never shown." | `server/src/matching/wants.ts:257` |
| Meera never answered the question | The want reads "can't check"; a request to ask Meera is recorded | Code | `unknown_asks` row about Meera | Meera may get it as a question of the day; the asker is never named | `server/src/matching/unknowns.ts:127` |

### Arjun and Meera

- **Arjun writes his wants.** On "Things to talk about" → "What would you love in someone?"
  he types: "I want someone who saves money, not an impulse spender. Someone kind." That
  is one `seeking` fact, split into two wants when read
  (`server/src/matching/wants.ts:84`).
- **The first want gets a question.** "saves", "money" and "spender" match the windfall
  question, which comes before the "impulse" question in the list, so Arjun is offered:
  "You get an unexpected ₹50,000. What happens to most of it?"
  (`server/src/matching/want-questions.ts:35`,
  `server/src/onboarding/questions.ts:329`).
  "Someone kind" matches nothing, so it stays a sentence.
- **What Arjun sees** on YOU → Manage → "What you're looking for": his first want in
  quotes, "We can ask people this. Tick the answers that are fine for you.", the question,
  five answer chips and "Use this question". Under "Someone kind": "Checked against what
  people write. It can only move people down, never hide them."
  (`app/src/features/preferences/wants-state.ts:42`,
  `app/src/features/preferences/wants-card.tsx:67`,
  `app/src/features/preferences/wants-card.tsx:78`,
  `app/src/features/preferences/wants-state.ts:39`)
- **He ticks** "Saved or invested" and "Pays off something I owe". The server stores the
  values `save-invest` and `pay-off`, strength "Really want"
  (`server/src/api/wants.ts:101`).
- **Meera's side, round one.** Situation questions are never asked during onboarding, so
  Meera has most likely not answered the ₹50,000 question. Arjun's card about her then
  says "We can't check this one yet." for that want, and the app records that Meera
  should be asked it (`server/src/onboarding/next-question.ts:110`,
  `server/src/matching/unknowns.ts:88`).
- **What Meera sees** later, if it is her most-asked gap: a "A question for you" chip in
  the town; the screen says "MONEY", the question, and "Other agents needed this once
  lately to check who fits, and yours could not say. One tap. Nobody ever sees your
  answer." (`app/src/features/world/hud.tsx:191`,
  `app/src/features/question/question-state.ts:45`).
  She is never told whose want it was, or what the want said.
- **If Meera had answered** "Saved or invested", Arjun's card says "Matches"; if she
  answered "A treat: a trip, a gadget, a night out", it says "Doesn't match" and she moves
  later in Arjun's order, never out
  (`server/src/matching/wants.ts:297`).
- **If Arjun had tapped "Must have"**, a Meera who answered "A treat" would never be met by
  Arjun's agent, and Arjun would never be met by hers: each person's must-haves apply to
  both searches (`server/src/matching/candidates.ts:98`,
  `server/src/matching/candidates.ts:102`). A Meera who never answered
  still passes.
- **"Someone kind"** goes to the model with up to 10 of Meera's own public sentences. If
  the model points at one, Arjun's card shows "You asked for “Someone kind”" and "They
  said" with her sentence, with no verdict word. Otherwise: "Nothing they've said covers
  this yet." (`app/src/features/matches/exchange.ts:205`,
  `app/src/features/matches/exchange.ts:169`).
- **Meera never sees Arjun's wants**, or that he has any. Her card about Arjun lists only
  her own wants (`server/src/matching/orchestrator.ts:387`).

### 5.1 Where wants come from

- **Stories screen.** "What would you love in someone?", with the hint "Only you see this.
  Your agent looks for it in what people say about themselves." and the label "Only for
  your agent" (`server/src/onboarding/stories.ts:57`,
  `server/src/onboarding/stories.ts:58`,
  `app/src/features/stories/stories-screen.tsx:79`).
  12 to 300 characters (`server/src/onboarding/stories.ts:67`,
  `server/src/onboarding/stories.ts:68`). Saving writes one
  `seeking` fact, visibility "match-only"
  (`server/src/onboarding/stories.ts:154`).
  There is only ever one live `seeking` fact: saving again replaces the whole sentence
  (`server/src/onboarding/stories.ts:147`).
- **The interview's free sentence.** "Anyone else you couldn't be with?", up to 400
  characters, stored as a `dealbreaker` fact
  (`server/src/onboarding/questions.ts:220`,
  `server/src/api/interview.ts:209`). Several can
  stay live at once (`shared/src/facts.ts:138`). The same sentence
  also goes to a model that may propose a change to one card's "Who's fine" row; only the
  person's "Keep this" writes it ([AI-3](#ai-3); `server/src/api/interview.ts:359`).
- **Chat.** The chat extractor may also write `seeking` or `dealbreaker` facts. These fields
  are not "tapped" fields, so they go live at once, without a confirm step
  (`server/src/memory/extract.ts:237`).
  Unverified: how often this happens in practice.
- **How a want is read.** Only live `seeking` and `dealbreaker` facts count
  (`server/src/matching/wants.ts:43`).
  Each is split into sentences, pieces under 4 characters dropped, duplicates removed, and
  only the **first five** kept, newest first
  (`server/src/matching/wants.ts:44`,
  `server/src/matching/wants.ts:105`).
  A want from "could not be with" is marked `not`; a want naming a private topic is marked
  private (`server/src/matching/wants.ts:102`,
  `server/src/matching/wants.ts:102`).
- **Deleting a want.** There is no button to delete a single want. Re-saving the story
  replaces the `seeking` sentence; "Delete everything" removes all. Unverified beyond the
  route list the research checked.

### 5.2 Tying a want to a question

- **Matching is by word patterns, not by a model.** The first of 12 patterns that matches
  wins; no match leaves the want as a sentence
  (`server/src/matching/want-questions.ts:13`,
  `server/src/matching/want-questions.ts:83`).
- **The 12 questions**, in match order: street food; the ₹50,000 windfall; the last
  unplanned big buy; the last book finished; looking after a friend's dog; weeknight
  dinner; "What field are you in?"; "How often do you move your body?"; "Early or late?";
  a long weekend with no plans; a 7 pm call about plans tonight; "Would you move cities for
  the right person?" (`server/src/matching/want-questions.ts:31`,
  `server/src/onboarding/questions.ts:336`,
  `server/src/onboarding/questions.ts:345`,
  `server/src/onboarding/questions.ts:259`,
  `server/src/onboarding/questions.ts:312`).
  Eight are "situation" questions; four are optional profile questions. A want can never be
  tied to the basics, the five core cards or the faith card.
- **The screen** is YOU → Manage → "What you're looking for", titled "Looking for": "Only
  must-haves remove anybody. Everything else just ranks."
  (`app/src/features/profile/profile-screen.tsx:285`,
  `app/src/features/preferences/preferences-screen.tsx:68`).
  The "Your wants" card lists each want with one line
  (`app/src/features/preferences/wants-state.ts:38`,
  `app/src/features/preferences/wants-state.ts:39`,
  `app/src/features/preferences/wants-state.ts:41`,
  `app/src/features/preferences/wants-state.ts:42`),
  and ends "Nobody is told what you asked for, or that it was you."
  (`app/src/features/preferences/wants-card.tsx:28`).
- **Ticking.** Nothing is pre-ticked. "Use this question" is disabled until one answer is
  ticked; ticking every answer stores no rule at all ("Every answer is fine, so this rules
  nobody out and ranks nobody.")
  (`app/src/features/preferences/wants-state.ts:22`,
  `app/src/features/preferences/wants-card.tsx:75`,
  `server/src/api/wants.ts:96`).
- **What is stored** is a `preferences` row: field, operator `in`, the ticked **values**
  (not the labels), a strength that starts at "Really want", and the want's own words as
  its source (`server/src/api/wants.ts:101`,
  `server/src/api/wants.ts:103`). "Stop checking" retires the rule;
  rules are retired, never deleted (`server/src/api/wants.ts:90`).

### 5.3 Must have, Really want, Nice to have

- **Three strengths**: Must have (`dealbreaker`), Really want (`strong`), Nice to have
  (`mild`) (`app/src/features/preferences/strengths.ts:11`,
  `app/src/features/preferences/strengths.ts:12`,
  `app/src/features/preferences/strengths.ts:13`).
- **Must have is allowed only on fields the person tapped themselves**: the basics, the
  five cards, faith, the eight situation answers, and (since 2026-09-28) work field,
  exercise, sleep and moving cities. On these fields a sentence said in chat waits for the
  person's Yes before it counts, so chat can never silently move someone into or out of a
  must-have (`server/src/onboarding/questions.ts:425`,
  `server/src/onboarding/questions.ts:426`,
  `server/src/onboarding/questions.ts:415`).
  The server refuses a must-have anywhere else
  (`server/src/api/dating.ts:524`).
- **What a Must have does.** It is the only personal rule that removes anybody, and it is
  checked both ways: Arjun's must-haves on Meera, and Meera's must-haves on Arjun
  (`server/src/matching/candidates.ts:97`,
  `server/src/matching/candidates.ts:101`).
  A field with several answers (the work field) passes if any of the other person's
  answers is ticked (`server/src/matching/candidates.ts:30`).
- **What Really want and Nice to have do.** They feed a score (weight 3 and 1) that is
  recorded on each pair but **no longer decides who a round meets**
  (`server/src/matching/score.ts:25`,
  `server/src/matching/orchestrator.ts:168`). The one place the
  score still orders people is the town's square, where the 40 strangers shown are the top
  of the score (`server/src/api/world.ts:180`).
  In a round, what moves a person later is the want check: each "not met" want pushes that
  candidate later within their group (real people stay ahead of practice profiles),
  whatever the strength (`server/src/matching/wants.ts:284`).
- **The pool count.** "Who your agent can reach" shows how many people pass every filter,
  rounded to the nearest 10; below 20 it says "Under 20" and a warning such as "Very few
  people fit. Turn a must-have into a want to reach more."
  (`server/src/matching/candidates.ts:226`,
  `app/src/lib/counts.ts:12`,
  `app/src/features/preferences/preferences-screen.tsx:98`).

### 5.4 When the other person has not answered

- **The filter lets them through.** An unanswered field is "unknown", never a mismatch,
  even for a Must have (`server/migrations/0020_match_functions.sql:22`,
  `server/migrations/0071_must_have_fields_wait_for_yes.sql:40`).
  Every card carries the same line: "Passes your rules both ways, on everything they've
  answered" (`server/src/matching/brief.ts:65`).
- **The card says** "We can't check this one yet." for that want
  (`app/src/features/matches/exchange.ts:170`).
- **The other person may be asked.** A tied want that could not be checked records
  `ask:<question>` against the other person; a private want records `card:<field>`
  (`server/src/matching/unknowns.ts:88`,
  `server/src/matching/unknowns.ts:76`).
  It becomes a candidate for their question of the day: the most-asked open gap from the
  last 14 days, at most 2 a day, and not again for 7 days after a skip
  (`server/src/matching/unknowns.ts:29`,
  `server/src/matching/unknowns.ts:31`,
  `server/src/matching/unknowns.ts:33`).
  Practice profiles are never asked
  (`server/src/matching/orchestrator.ts:416`).
- **A written card is not updated** when the answer arrives later: the want results are
  stored with the card when the round runs
  (`server/src/matching/brief.ts:633`).

### 5.5 Untied and private wants: the model check

- **When.** Whenever the person starting a round has at least one untied or private want,
  one model call checks all of those wants against the first 12 people of the shortlist,
  10 sentences each. A second call checks each real person's own wants against the
  starter's sentences, for that person's card. Both calls are charged to the starter
  (`server/src/matching/wants.ts:307`,
  `server/src/matching/wants.ts:308`,
  `server/src/matching/orchestrator.ts:215`,
  `server/src/matching/orchestrator.ts:373`).
  If every want is tied, no call is made
  (`server/src/matching/wants.ts:231`).
  Full details are in [AI-12](#ai-12).
- **Whose words go in.** The reader's own want text, and the other person's own public
  sentences: never interview answers, 12 to 300 characters, found word for word in
  something they typed, with no private topic and no contact detail
  (`server/src/matching/brief.ts:266`,
  `server/src/matching/brief.ts:268`,
  `server/src/matching/brief.ts:279`).
  Another person's wants are never sent as sentences.
- **Code checks the answer.** A "met" or "not met" survives only with the number of one of
  that person's sentences; the quote shown is looked up by that number, never copied from
  the model's reply. Anything else becomes "unknown"
  (`server/src/matching/wants.ts:202`,
  `server/src/matching/wants.ts:203`).
- **Private wants.** The model maps the want to one of six cards (kids, one person or open,
  smoking, drinking, food, faith) and the answers that satisfy it; code then compares the
  other person's answer on that card
  (`server/src/matching/wants.ts:196`,
  `server/src/matching/wants.ts:198`). The result is
  stored and moves a not-met person later in the round, but whatever it is -- met, not met, or no
  card to check (politics, health) -- Arjun's card says only "A private topic. Their answer is never
  shown." (`server/src/matching/brief.ts:446`).
  "Matches" beside "Someone who doesn't drink" used to tell him Meera's card answer, which she was
  promised nobody sees.
- **If the call fails**, every want on that side, tied ones included, reads "We can't
  check this one yet." (a private one keeps its private line) and nothing is recorded to ask later
  (`server/src/matching/wants.ts:238`).

### 5.6 What the card shows

Section "WHAT YOU ASKED FOR", with each of the reader's own wants
(`app/src/features/matches/matches-screen.tsx:390`):

| Kind of want | Label | Answer line |
|---|---|---|
| Untied, a sentence found | "You asked for" / "You couldn't be with" | "They said" + their sentence in quotes (a practice profile's line is marked "(practice)") |
| Untied, nothing found | same | "They said" + "Nothing they've said covers this yet." |
| Tied to a question | same | "Matches" or "Doesn't match" |
| Private topic | same | "A private topic. Their answer is never shown." whatever the check found |
| Could not be checked | same | "We can't check this one yet." |

Sources: `app/src/features/matches/exchange.ts:197`,
`app/src/features/matches/exchange.ts:201`,
`app/src/features/matches/exchange.ts:178`.
An untied want shows no verdict: "met" and "not met" look the same, and the reader judges
the sentence (`server/src/matching/brief.ts:708`).
Never shown: the other person's wants, their actual card answer, how a private-topic want came
out, and any quote beside a tied or private want
(`server/src/matching/brief.ts:714`).

### 5.7 After a date

If a tied want showed "Matches" on the reader's card, the after-date check-in may ask
"You wanted “…”. Did they seem that way?" (or, for a could-not-be-with, "You didn't want
“…”. Were they fine on that?"), at most two such questions
(`server/src/checkin/questions.ts:56`,
`server/src/checkin/questions.ts:42`). See stage 10.

### Docs vs code

- HOW-IT-WORKS.md says a round's only model call is the agents' talk, and a comment above
  the round route says "A round makes no model call". The code also makes the want-check
  calls above, by default (`HOW-IT-WORKS.md:810`,
  `server/src/api/dating.ts:944`,
  `server/src/matching/orchestrator.ts:23`).
- HOW-IT-WORKS.md says a want that names a card "is left out". The code keeps it as a
  private want and checks it (`HOW-IT-WORKS.md:522`,
  `server/src/matching/wants.ts:22`).
- HOW-IT-WORKS.md says a want's status is "never sent to a phone". That is true for untied
  and private-topic wants; for a tied want "Matches"/"Doesn't match" and "can't check" are sent
  (`HOW-IT-WORKS.md:545`,
  `server/src/matching/brief.ts:449`).
- The app says wants "move people up the list". Nothing moves anybody up in a round: the
  score no longer picks, and the want check only moves people down
  (`app/src/features/preferences/preferences-screen.tsx:141`).
- The app says a private want is "Checked against your card". It is checked against the
  **other person's** card (`server/src/matching/wants.ts:196`).
- The footer "Must-haves come from your cards" is no longer the whole story: a tied want
  set to Must have is a must-have too
  (`app/src/features/preferences/preferences-screen.tsx:171`).
- The interview says a sentence no card holds "can't be checked on paper" ("We can't check
  that on paper. You'll spot it in the first chat."). Since 2026-09-25 that sentence is a
  want and is checked every round
  (`app/src/features/onboarding/sentence-proposal.ts:38`).
- HOW-IT-WORKS.md §12 says no multi-answer field can be a must-have; since 0071 the work
  field can be (`HOW-IT-WORKS.md:891`).
- "How you appear" reads back only must-haves on the five cards; a must-have on a tied want
  is not read back (`server/src/api/me.ts:136`).

### Unverified

- The real cost of one want-check call: it has never run on real data (the development
  database has had no rounds since 2026-09-22; query run 2026-09-28).
- The rule clashes in "Known gaps" (two wants on one question, orphaned rules) are read
  from the SQL, not run.
- Whether the model maps the same private want to the same card every round.

---

## 6. Sending the agent out

A person asks for a **round**: their agent goes out and meets up to three people who pass
every rule, both ways. The round runs in the background on the server; the phone gets
live updates. Picking who is met is **code**, not a model. By default a round still makes
some model calls (the agents' talk and the want checks, stages 5 and 7).

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| Arjun taps "Send my agent out" | Server re-checks he is ready, may refresh his answer sheet, queues a round | Code, maybe [AI-10](#ai-10) | `rounds` row (queued) | Arjun | `server/src/api/dating.ts:950` |
| The worker picks the round up (about every 5 s) | SQL finds everyone who passes every rule both ways | Code (SQL) | Nothing yet | Nobody | `server/src/matching/rounds.ts:161` |
| The candidate list | Real people first, then most recently active; people already met are removed; a weekly cap protects busy real people | Code | Nothing yet | Nobody | `server/src/matching/candidates.ts:132` |
| Arjun's untied wants | One call checks them against the first 12; people with a "not met" move later | [AI-12](#ai-12) + code | Want results kept for the cards | Arjun (on his cards) | `server/src/matching/orchestrator.ts:217` |
| The first three who can still be claimed | A pair row is claimed for each; a score is recorded but does not pick | Code | `rendezvous` row per pair, with `rank_score` | Nobody on screen (founder scripts only) | `server/src/matching/orchestrator.ts:238` |
| Each pair | The agents' exchange and the two cards (stages 7 and 8) | [AI-11](#ai-11) + code | Two card rows per pair | Each person, their own card | `server/src/matching/brief.ts:637` |

### Arjun and Meera

1. **Arjun taps "Send my agent out"** on the Home tab, which is a 3D map of Bengaluru (the
   "town") (`app/src/app/(tabs)/index.tsx:1`,
   `app/src/features/world/hud.tsx:225`).
   The same button is on the Matches tab (`app/src/features/matches/matches-screen.tsx:273`).
2. **The server** re-checks that Arjun is ready, refreshes his answer sheet if his
   shareable sentences changed (at most one model call), checks the daily limit and queues
   the round (`server/src/api/dating.ts:961`,
   `server/src/api/dating.ts:968`,
   `server/src/api/dating.ts:1011`).
3. **Arjun sees** the button change to "Your agent is out…" and the line "Your agent is
   heading out…" (`app/src/features/world/hud.tsx:139`).
4. **Within about 5 seconds** the worker starts the round. Meera passes every rule both
   ways (below). Real people are listed before practice profiles, so she comes ahead of
   all of them (`server/src/matching/rounds.ts:158`).
5. **Arjun's agent walks to Meera's** on his screen, and his status reads "Your agent is
   out — meeting 3 people". **On Meera's phone**, if the app is open, Arjun's agent walks
   over to hers and the seat reads "Your agent is with them now." Meera did nothing to
   start this (`server/src/matching/orchestrator.ts:276`,
   `app/src/features/world/hud.tsx:141`,
   `app/src/features/world/agent-sheet.tsx:43`).
6. **When it is done** Arjun sees "Your agent met 3 people. See Matches." and a short replay
   of the agents' exchange as speech bubbles, ending on the date idea and "See the card"
   (`app/src/features/world/world-screen.tsx:274`,
   `app/src/features/world/exchange-strip.tsx:83`).
7. **Meera** finds a new card in her Matches tab with a three-day clock. Whether she can
   read it yet depends on who decides first (stage 9).

### 6.1 The two ways to send

- **"Send my agent out"**: an open round, up to 3 people
  (`server/src/matching/orchestrator.ts:71`).
- **"Send my agent over"**: tap one stranger standing in the square, then this button on
  their sheet. It meets exactly that one person, if they pass every rule
  (`app/src/features/world/agent-sheet.tsx:74`,
  `server/src/matching/orchestrator.ts:130`).
  The tap itself never checks the rules (since 2026-09-28): a block, someone already met, or a
  handle the square never gave out gets "That person has moved on."; anyone else is a visit that
  counts, and the round checks the rules. Before, a rule failure answered at once and for free, so
  flipping your own must-have and tapping again read someone's card answer
  (`server/src/matching/world.ts:92`,
  `server/src/api/dating.ts:998`).
  A stranger in the square shows no name, age or photo: "Someone in the square", "One of
  the people your agent could meet.", and a neighbourhood
  (`app/src/features/world/agent-sheet.tsx:42`,
  `app/src/features/world/agent-sheet.tsx:64`).
  The 40 strangers in the square are chosen by the preference score, not real-first
  (`server/src/api/world.ts:180`).

### 6.2 Limits

| Limit | Value in the dev setup | What counts | Code |
|---|---|---|---|
| Open rounds | 1 per rolling 24 hours | Only a finished open round that met at least one person | `server/src/matching/world.ts:44`, `server/src/matching/rounds.ts:94` |
| Visits ("send my agent over") | 5 per rolling 24 hours | Every visit asked for, even one that failed | `server/src/matching/world.ts:28`, `server/src/matching/rounds.ts:78` |
| One round at a time | A second tap returns the round already running | | `server/src/matching/rounds.ts:101` |
| Model spend | $2.00 per person per day | All of that person's model calls | `server/src/env.ts:323` |
| Model calls | 10 per person per day (`TRIAL_TURN_CAP_PER_DAY=10`) | Chat, learning and rounds; setup calls are counted apart, up to 40 a day (since 2026-09-28) | `server/src/metering.ts:59` |

None of `ROUNDS_PER_DAY`, `TARGETED_ROUNDS_PER_DAY`, `ROUND_CANDIDATES`,
`WEEKLY_REAL_EXPOSURE`, `AGENT_TALK` or `RENDEZVOUS_RUNS` is set in the development
configuration, so the code defaults above apply (checked 2026-09-28).

What the person sees when a limit hits: "Your agent has been out enough for today." (spend
or round limit), "That is all the visits for today. Try again tomorrow.", "That person has
moved on.", "Your agent needs a few more answers before it can go out."
(`app/src/features/world/world-screen.tsx:36`,
`app/src/features/world/world-screen.tsx:39`,
`app/src/features/world/world-screen.tsx:40`,
`app/src/features/world/world-screen.tsx:43`).
Because chat and rounds share the same 10-calls-a-day allowance, a person who chatted a lot
can be told their agent "has been out enough for today" when it never went out
(`server/src/matching/orchestrator.ts:293`,
`server/src/metering.ts:64`).

### 6.3 The rules: who the agent may meet

Every rule is checked in SQL, in one query, with Arjun as `a` and each candidate as `b`
(`server/src/matching/candidates.ts:34`). Almost every rule
lets an **unknown** value pass: someone who never answered is not excluded for it.

| Rule | Arjun → Meera | Meera → Arjun | If unknown | Code |
|---|---|---|---|---|
| Not yourself | | | | `server/src/matching/candidates.ts:36` |
| Both ready ("in the pool") | Arjun ready | Meera ready | Not ready = out | `server/src/matching/candidates.ts:37` |
| Real and practice | A real person meets practice profiles while `sees_synthetic` is on (the default); practice profiles never meet real people | | | `server/src/matching/candidates.ts:43` |
| Blocks (a report also blocks) | Arjun never blocked Meera | Meera never blocked Arjun | | `server/src/matching/candidates.ts:49` |
| Gender | Meera's gender is in Arjun's "seeking" | Arjun's is in Meera's | Passes | `server/src/matching/candidates.ts:62`, `server/src/matching/candidates.ts:63` |
| Age | Meera's age in Arjun's range | Arjun's age in Meera's range | Passes | `server/src/matching/candidates.ts:66`, `server/src/matching/candidates.ts:68` |
| Distance | Within Arjun's maximum distance | Within Meera's | No location: skipped. No maximum: only that person's side passes (since 2026-09-28; before, one missing maximum switched off both) | `server/src/matching/candidates.ts:80` |
| What they are looking for (intent) | At least one choice in common | same | Passes | `server/src/matching/candidates.ts:86` |
| Must-haves | Every Arjun must-have passes on Meera | Every Meera must-have passes on Arjun | Passes | `server/src/matching/candidates.ts:98`, `server/src/matching/candidates.ts:102` |
| Recently active | Meera used the app in the last 60 days; a practice profile always passes (since 2026-09-28) | (not checked for Arjun; he just tapped) | | `server/src/matching/candidates.ts:111` |

After the SQL, three more steps remove people:

- **Already met, ever.** Anyone Arjun has a pair with, in any state (declined, expired,
  introduced), is removed. A pair can exist only once
  (`server/src/matching/orchestrator.ts:144`,
  `server/migrations/0022_rendezvous.sql:44`).
- **Weekly exposure cap.** A real person already met by 5 other real people's rounds in the
  last 7 days is skipped. Practice profiles are never capped
  (`server/src/matching/candidates.ts:151`,
  `server/src/matching/candidates.ts:167`).
- **Claims.** Two rounds running at once cannot claim the same pair
  (`server/src/matching/orchestrator.ts:240`).

"Ready" (`in_pool`) means: the basics answered, all five core cards answered (a "prefer not
to say" counts), consent given, and age 18 or over. A moderator's hide or a ban forces it
off (`server/src/matching/profile.ts:205`,
`server/src/matching/profile.ts:207`,
`server/migrations/0048_filter_defects.sql:53`). See stage 2.

### 6.4 Picking

- **Order:** real people first, then the most recently active; the round looks at the
  first 500 (`server/src/matching/orchestrator.ts:135`).
- **The score records, it does not pick.** For the first 20 people, a preference score
  (`rank_score`) is computed and stored on each pair, for later measurement only
  (`server/src/matching/orchestrator.ts:162`,
  `server/src/matching/orchestrator.ts:168`). The score mixes
  how many of the other person's Really-want / Nice-to-have rules are met with how many
  tags the two share, in both directions, shrunk when little is known
  (`server/src/matching/score.ts:187`,
  `server/src/matching/score.ts:191`).
  It is never shown to anyone in the app.
- **The only reorder is downward:** the want check can move a candidate later, inside
  their own group (stage 5).
- **Three are claimed**, in order, until three claims succeed (one for a visit)
  (`server/src/matching/orchestrator.ts:231`).

### 6.5 Real people and practice profiles

- **What practice profiles are.** Invented people, written straight into the matching table
  with no facts and no chat history, under one shared account `__synthetic__`
  (`server/src/matching/synthetic.ts:11`,
  `server/src/db/seed-synthetic.ts:24`). They are sampled
  from hand-written distributions by a script; **no model writes them**
  (`server/src/matching/marginals.ts:13`,
  `server/src/matching/synthetic-voice.ts:11`). The development database
  holds 5,008 of them, last seeded 2026-09-12 to 14 (query run 2026-09-28). The invented
  names include "Meera" and "Arjun", so a practice card can carry our example names
  (`server/src/matching/synthetic.ts:72`).
- **Who sees them.** Every real person, by default; they are the fallback when too few
  real people fit (`server/migrations/0037_practice_profiles.sql:51`).
- **How they are labelled.** "Practice match — this one is not a real person." on the card,
  "Practice match / Not a real person" in lists, their lines marked "(practice)", and the
  reveal says "This is not a real person. The pool is invented until enough people have
  joined…" (`app/src/features/matches/matches-screen.tsx:343`,
  `app/src/features/matches/exchange.ts:47`,
  `app/src/features/matches/reveal-screen.tsx:179`).
- **They never say yes** in this setup. A switch (`SYNTHETIC_AUTO_YES`) could make them, and a
  production server refuses to start with it on
  (`server/src/env.ts:356`).

### Docs vs code

- HOW-IT-WORKS.md §4 says "Seven rules, and nothing else may exclude anybody". The code
  also excludes by readiness, "already met ever", the weekly cap and claims
  (`HOW-IT-WORKS.md:196`,
  `server/src/matching/orchestrator.ts:157`).
- HOW-IT-WORKS.md §4 says every rule is symmetric. "Recently active" is checked on the
  candidate only (`HOW-IT-WORKS.md:204`,
  `server/src/matching/candidates.ts:111`).
- HOW-IT-WORKS.md §10 says rounds are limited by the round count "instead of by spend". The
  daily spend and call caps can still refuse a round
  (`HOW-IT-WORKS.md:818`,
  `server/src/metering.ts:56`).
- Several code comments still say a round makes no model call
  (`server/src/api/dating.ts:944`,
  `server/src/matching/answer-sheet.ts:24`). By default it makes the
  talk and want-check calls.
- HOW-IT-WORKS.md §9 says a model may write the prose for invented people. No model is
  used (`HOW-IT-WORKS.md:789`).

### Unverified

- What a round costs today: no round has run since the talk was added on 2026-09-24 (the
  last rounds on the development database are from 2026-09-22; query run 2026-09-28).

---

## 7. The agent-to-agent exchange

The name suggests two chatbots talking freely. **By default they do not.** Free
conversations between agents exist in the code but are switched off
(`server/src/matching/rendezvous.ts:75`).
What runs instead is **the talk**: one model call per pair that may only **point**, at a
fixed list of questions and at each person's own numbered sentences. Code then builds
every line a person reads out of those real sentences. The only words a model writes that a
person ever reads are the **date idea**, and code checks those.

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| Arjun's and Meera's own sentences (up to 20 each) | Loaded under each person's own database session, filtered | Code | Nothing | Nobody | `server/src/matching/orchestrator.ts:313` |
| Both lists, 12 questions, 4 reactions | The model picks questions and sentence numbers, and writes one date idea | [AI-11](#ai-11) | Nothing yet | Nobody | `server/src/matching/talk.ts:105` |
| The model's reply | Code rebuilds the lines from the real sentences and drops anything that breaks a rule | Code | The talk, inside both cards | Each person, on their own card, on their turn | `server/src/matching/talk.ts:244` |
| The date idea | Checked for length, person words, claims, verdict words, private topics, contact details, and made-up facts | Code | Inside both cards | Both, then in chat after both say yes | `server/src/matching/talk.ts:193` |
| A question one agent could not answer | Shown as "I don't know"; recorded as something to ask that person later | Code | `unknown_asks` row | That person, as a question of the day | `server/src/matching/talk.ts:234` |
| No talk (a side has no sentences, or the call failed) | The card falls back to pre-built answer sheets | Code | Inside both cards | Each person, their own card | `server/src/matching/talk.ts:312` |

### Arjun and Meera

- **What goes in for Arjun:** things he typed himself and allowed to be shared, for example
  "I spend Sunday mornings at the Cubbon Park run club." A sentence qualifies only if it
  is public, current, not an interview tap, 12 to 300 characters, found word for word in
  something he typed, and names no private topic and no contact detail
  (`server/src/matching/brief.ts:265`,
  `server/src/matching/brief.ts:268`,
  `server/src/matching/brief.ts:271`,
  `server/src/matching/brief.ts:203`).
  Things his clone learned in chat stay private until he taps "OK to share" (stage 4), so
  they do not go in (`server/migrations/0063_learned_is_private.sql:25`).
- **The same for Meera,** loaded under her own session.
- **The model's job:** pick questions from a fixed bank ("What do you do on weekends?",
  and 11 more) and answer each with the **number** of one of that person's sentences, or
  "don't know"; add fixed reactions ("Oh, nice.", "Love that.", "Ha!", "Fair enough."); name
  up to two pairs of sentences the two share; and write one date idea
  (`server/src/matching/answer-sheet.ts:59`,
  `server/src/matching/talk.ts:65`,
  `server/src/matching/talk.ts:113`).
- **What Arjun reads on his card** (when it is his turn): "DATE IDEA", "SOMETHING YOU SHARE",
  and "Read what your agents said", which opens the lines as "Your agent" and "Their agent".
  Every answer line is Meera's or Arjun's own sentence, word for word
  (`app/src/features/matches/matches-screen.tsx:59`,
  `app/src/features/matches/matches-screen.tsx:68`,
  `app/src/features/matches/matches-screen.tsx:80`,
  `app/src/features/matches/exchange.ts:153`).
- **Meera reads the same talk** with the sides swapped, on her own card
  (`server/src/matching/talk.ts:286`).
- **If Meera's agent had no sentence about reading**, her line reads "I don't know", and the
  reading question may later become Meera's question of the day
  (`app/src/features/matches/exchange.ts:18`).

### 7.1 Who speaks, how long, which topics

- **The model chooses** the order and the questions; the prompt asks for 6 to 12 lines "that
  bring out what the two have in common"
  (`server/src/matching/talk.ts:116`).
- **Code enforces the shape:** at most 12 lines; each bank question once; an answer only right
  after a question, once per side per question; each sentence used once; a reaction only
  right after the other side's sentence; a question nobody answered is dropped; a talk with
  fewer than two answers is thrown away
  (`server/src/matching/talk.ts:58`,
  `server/src/matching/talk.ts:225`,
  `server/src/matching/talk.ts:241`,
  `server/src/matching/talk.ts:256`).
- **The 12 topics** are fixed and the same for everybody: weekends, food, music, watching,
  reading, travel, work, goal, pets, active, evening, learning
  (`server/src/matching/answer-sheet.ts:59`,
  `server/src/matching/answer-sheet.ts:70`).

### 7.2 "I don't know"

The prompt tells the model to use "don't know" "rather than stretch a sentence to fit";
code turns it into the line "I don't know."
(`server/src/matching/talk.ts:108`,
`server/src/matching/talk.ts:234`).
Each one is recorded against that real person and can become their question of the day
(stage 3) (`server/src/matching/unknowns.ts:127`).
The sender's recap also lists them: "It had to say "I don't know" about …. Tell it, and it
will know next time." (`app/src/features/matches/recap.ts:22`).

### 7.3 The date idea

- **Written by the model**, "under 12 words, says what to do and where, and never mentions
  either person", built on one sentence from each side, and "nothing about kids, faith,
  politics, smoking, drinking or diet"
  (`server/src/matching/talk.ts:114`).
- **Checked by code** before it is kept: 8 to 80 characters, at most 14 words, no person
  words (I, you, they...), no claim verbs (loves, likes, enjoys...), no verdict words (match,
  compatible, chemistry, score...), no private topic or contact detail, no quotation marks
  (`server/src/matching/talk.ts:191`,
  `server/src/matching/talk.ts:121`,
  `server/src/matching/talk.ts:131`).
- **"Adds no facts":** every content word must come from the two cited sentences or from a
  fixed list of going-out words and Bengaluru public places; otherwise the idea is dropped
  (`server/src/matching/talk.ts:181`,
  `server/src/matching/talk.ts:156`).
- **Checked again** when the card is written, every time it is read (it disappears if the
  other person's sentence is no longer shareable), and when someone proposes it in chat
  (`server/src/matching/brief.ts:757`,
  `server/src/api/date-idea.ts:88`).

### 7.4 The fallback: answer sheets

Each person has an **answer sheet**: for each of the 12 bank questions, a pointer to one of
their own sentences, or nothing. A model builds it outside the round, whenever their
shareable sentences change ([AI-10](#ai-10);
`server/src/matching/answer-sheet.ts:104`,
`server/src/matching/answer-sheet.ts:185`).
Only fact ids are stored. When there is no talk, the card shows "WHAT YOUR AGENTS ASKED EACH
OTHER": questions both answered, then only theirs, then up to two the reader answered and
they did not (`server/src/matching/answer-sheet.ts:348`,
`app/src/features/matches/matches-screen.tsx:374`).

### 7.5 What is saved, and what people can read

- **Saved:** one `rendezvous` row per pair and one card row per person (headline, shared tags,
  work, quotes, the talk or the sheet exchange, wants with their status, an opener). No
  transcript is saved on the default path, and the model's raw reply is not kept
  (`server/src/matching/brief.ts:632`,
  `server/src/matching/rendezvous.ts:625`).
- **Readable:** each person reads only their own card, and only on their turn (stage 9)
  (`server/src/api/dating.ts:647`).
  Nobody can read transcripts, scores or want statuses in the app
  (`server/migrations/0028_matchmaker.sql:73`).

### 7.6 The switched-off conversation mode

If `RENDEZVOUS_RUNS` were set above 0, each pair would hold that many short conversations,
5 messages a side (`server/src/matching/rendezvous.ts:85`).
Each agent would get its person's public facts as a list and a sample of how they write,
plus the other person's public tags, with the instruction "Only say things you were actually
told about your person. Never invent a detail to keep it going."; a second model would read
each transcript and return yes, no or not enough (`server/src/matching/rendezvous.ts:116`,
`server/src/matching/rendezvous.ts:153`). Transcripts
would be stored but never shown, and the verdicts gate nothing
(`server/src/matching/orchestrator.ts:353`).
Details: [AI-13](#ai-13).

### Docs vs code

- HOW-IT-WORKS.md calls the talk "the only model call in a round". The want checks are
  model calls in the same round (`HOW-IT-WORKS.md:27`,
  `server/src/matching/orchestrator.ts:373`).
- HOW-IT-WORKS.md §6 describes "Five runs per pair". That is only true if the switch is set
  to 5; the code default is 0 (`HOW-IT-WORKS.md:273`).
- HOW-IT-WORKS.md §7 says the model phase does "nothing by default". The talk and want checks
  run there by default (`HOW-IT-WORKS.md:316`).
- HOW-IT-WORKS.md §7a says the answer sheet passes "the same check a quote passes". The same
  verification, but two more kinds of sentence are allowed (goals and dislikes), which the
  card's quote list leaves out on purpose
  (`server/src/matching/answer-sheet.ts:79`).

### Unverified

- How often the talk succeeds in practice: it was added on 2026-09-24 and no round has run
  on the development database since 2026-09-22 (query run 2026-09-28).

---

## 8. The card each person sees

For every pair a round creates, **code** writes two cards: Arjun's card about Meera and
Meera's card about Arjun. No model writes any card text
(`server/src/matching/brief.ts:4`). The two cards
differ, because each is built for its reader
(`server/src/matching/brief.ts:563`,
`server/src/matching/brief.ts:564`).
A card never shows the other person's name or photos; those are on the "reveal"
(stage 9).

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| Meera's age, intent and neighbourhood | Become the headline, e.g. "Here for something long-term · 27 · Jayanagar" | Code | Card row (`headline`) | Arjun, on his turn | `server/src/matching/brief.ts:333` |
| Tags both share | "You both like …" (up to 5), "You both work in …" (up to 2), public tags only | Code | Card row | Arjun, on his turn | `server/src/matching/brief.ts:493` |
| Meera's own public sentences | Up to 2 quotes, "In their words, <month year>" | Code | Card row | Arjun, on his turn | `server/src/matching/brief.ts:461` |
| The talk or the answer sheets | Shown as the agents' exchange (stage 7) | [AI-11](#ai-11) earlier, code now | Card row | Arjun, on his turn | `app/src/features/matches/matches-screen.tsx:371` |
| Arjun's wants | "WHAT YOU ASKED FOR" (stage 5) | [AI-12](#ai-12) earlier, code now | Card row, with each want's status | Arjun only | `app/src/features/matches/matches-screen.tsx:390` |
| Every time the card is opened | Each of Meera's sentences is re-checked; anything she hid or changed comes off | Code | Nothing | | `server/src/matching/brief.ts:743` |

### Arjun and Meera

In this example Meera decides first (stage 9 explains why).

- **Meera's card about Arjun** (her turn): his character, "WAITING ON YOU", a headline such
  as "Here for something long-term · 29 · Indiranagar", the fixed line "Passes your rules
  both ways, on everything they've answered", "You both like climbing." (no "You both work
  in" line: they work in different fields), "In their words, August 2026" and one of his
  sentences in quotes, then the
  date idea and what the agents said, "WHAT YOU ASKED FOR" with **her** wants, an opener
  such as "Ask them about travel", and the buttons "Yes, share my profile with them" and "Not
  this one". No photo and no name: she decides on these words and his character (stage 9)
  (`app/src/features/matches/matches-screen.tsx:330`,
  `app/src/features/matches/matches-screen.tsx:348`,
  `app/src/features/matches/matches-screen.tsx:362`,
  `app/src/features/matches/matches-screen.tsx:420`,
  `app/src/features/matches/matches-screen.tsx:424`).
- **Arjun's card about Meera, while it is not his turn**, is the "plain card": Meera's
  character, "WAITING ON THEM", "Your agent met someone", the fixed line, and "They decide
  first. If they share their profile, you will see it here." Nothing else: no age, no area, no
  quotes, no talk, no wants
  (`server/src/matching/brief.ts:680`,
  `app/src/features/matches/turn.ts:43`).
- **After Meera shares her profile**, Arjun's card fills in (the same sections, built for him),
  with "See who it is" to open her profile, and "Not this one"
  (`app/src/features/matches/matches-screen.tsx:432`).
  Her own card now says "You shared your profile. If they share theirs back, you can talk."
  (`app/src/features/matches/turn.ts:41`).

### 8.1 Every section, top to bottom

| # | On screen | Where it comes from | Code |
|---|---|---|---|
| 1 | Their character (a small 3D look) | The look they built; sent even on a plain card | `app/src/features/matches/matches-screen.tsx:328` |
| 2 | "WAITING ON YOU" / "WAITING ON THEM" | Whose turn it is | `app/src/features/matches/matches-screen.tsx:330` |
| 3 | Headline | Intent · age · neighbourhood (or city) of the other person; nothing known → "Your agent met someone" | `server/src/matching/brief.ts:335` |
| 4 | "Passes your rules both ways, on everything they've answered" | The same fixed words on every card | `server/src/matching/brief.ts:65` |
| 5 | "Practice match — this one is not a real person." | Practice profiles only | `app/src/features/matches/matches-screen.tsx:343` |
| 6 | "You both like …" / "You both work in …" | Tags both have, only from **public** facts, each word checked for private topics | `server/src/matching/rendezvous.ts:384` |
| 7 | "In their words, <month year>" + a quote | Up to 2 of their own public sentences, typed by them, 12–300 characters, of allowed kinds (interests, things done, topics, media, pets, story answers, work, exercise, sleep, transport) | `server/src/matching/brief.ts:87` |
| 8a | "DATE IDEA", "SOMETHING YOU SHARE", "Read what your agents said" | The talk (stage 7) | `app/src/features/matches/matches-screen.tsx:80` |
| 8b | or "WHAT YOUR AGENTS ASKED EACH OTHER" | The answer sheets, when there is no talk | `app/src/features/matches/matches-screen.tsx:374` |
| 9 | "WHAT YOU ASKED FOR" | The reader's own wants (stage 5) | `app/src/features/matches/exchange.ts:197` |
| 10 | "Ask them about …" | First that applies: a question they could not answer in the talk; one from the sheets; a shared interest; a quote; a shared work field; one of their tags | `server/src/matching/brief.ts:536` |
| 11 | "Fades tomorrow if you don't answer." / "Fades today if you don't answer." | Days left on the reader's turn | `app/src/features/matches/fade.ts:15` |
| 12 | First move: "Yes, share my profile with them" and "Not this one". Second move: "See who it is" and "Not this one". Otherwise one line saying whose move it is | By whose turn it is (stage 9) | `app/src/features/matches/matches-screen.tsx:418` |
| 13 | "Block or report" | On every card | `app/src/features/matches/matches-screen.tsx:451` |

Only one "waiting on you" card shows at a time; the rest wait below it. Cards are ordered
newest round first, then by a hash of the pair's id, never by a score
(`app/src/features/matches/matches-screen.tsx:322`,
`server/src/api/dating.ts:599`).

### 8.2 Checked again every time

When a card is shown, each of the other person's sentences on it must still be one of
their current public facts and pass the private-topic and contact-detail check. Anything
that fails comes off: a quote, an answer, a talk line, the date idea, or an opener that
used it (`server/src/matching/brief.ts:743`,
`server/src/api/dating.ts:617`).
Not re-checked: the headline and the shared tags, which stay as written when the round ran
(`server/src/matching/brief.ts:761`).

### 8.3 What a card never shows

- **No score, percentage or verdict about the pair.** The query for cards does not even
  select the score columns, and the stored "concern" is always empty
  (`server/src/api/dating.ts:566`,
  `server/src/matching/brief.ts:638`). One exception is per want, not
  per pair: "Matches" / "Doesn't match" on a want tied to a question; a private-topic want shows
  only "A private topic. Their answer is never shown." (stage 5).
- **No transcript**: no app role can read the conversation table
  (`server/migrations/0028_matchmaker.sql:68`).
- **Not the other person's card about you**: database row-level security
  (`server/migrations/0022_rendezvous.sql:105`).
- **Nothing learned in chat, nothing hidden**: quotes read public facts only
  (`server/src/matching/brief.ts:279`).
- **No card answers** (kids, one person or open, smoking, drinking, food, faith), as text or as
  "Matches" (since 2026-09-28).
- **No name, no photo** (`server/src/matching/brief.ts:654`).
- **Not whether they said no** (`server/migrations/0031_other_said_yes.sql:15`), although timing can give it away (Known gaps).

### Docs vs code

- HOW-IT-WORKS.md §7 says a card has "No concern, no verdict, no number". Tied wants carry
  "Matches" / "Doesn't match", and the reveal carries a count ("Confirmed by N
  people who met them") (`HOW-IT-WORKS.md:339`).
- HOW-IT-WORKS.md says every sentence is re-checked when a card is shown. True for
  sentences; the headline and shared tags are not re-checked
  (`HOW-IT-WORKS.md:348`).

---

## 9. Deciding

Both people must say yes before they can talk, and **nobody's photos or name reach anyone until
that person has said yes to them** (since 2026-09-28). They do not decide at the same time:
one person, the **first mover**, decides first on the words card and the other's character
alone; their yes shares **their own** profile. Then the other person sees it and shares theirs
back, or not. Each turn lasts three days. Code decides everything here; no model is involved.

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| Cards are written | A real person facing a practice profile decides first; between two real people, the one with more open cards (a tie goes to the lower account id). The first mover's phone is woken | Code | `rendezvous.first_mover`, `answer_by` = now + 3 days | Nobody sees the rule's result directly | `server/src/matching/brief.ts:790` |
| First mover taps "Yes, share my profile with them" | Their photos, first name and profile open to the other person; the other gets a fresh 3 days | Code | Their yes on their card row | The other person, from then on | `app/src/features/matches/turn.ts:35` |
| The other taps "Yes, share mine back" | Their profile opens to the first mover; the pair is introduced; chat opens | Code | Pair `introduced` | Both | `app/src/features/matches/turn.ts:44` |
| Either says no ("Not this one", "Not for me") | The pair ends at once, silently; anything shared closes | Code | `human_says_yes = false`, pair `lapsed` | Nobody is told | `server/src/matching/orchestrator.ts:576` |
| Nobody answers in 3 days | The pair expires; anything shared closes | Code (a timer every 10 minutes) | Pair `expired` | Nobody is told | `server/src/matching/expiry.ts:26` |
| An answer out of turn | Refused by the server | Code | Nothing | — | `server/src/api/dating.ts:873` |

### 9.1 Who decides first, and why

- **The rule:** a practice profile never decides first -- it never answers, so the real person
  always does (since 2026-09-28; migration 0074 moved the one open card where a real person was
  waiting behind a practice profile). Between two real people, whoever has more open cards (waiting for an answer) is the
  first mover; a tie goes to the lower account id
  (`server/src/matching/brief.ts:790`,
  `server/src/matching/brief.ts:804`,
  `server/src/matching/brief.ts:812`).
- **The reason, in the code:** dating apps are lopsided; the flooded side decides alone and
  first so it is not flooded again; both must still say yes
  (`server/src/matching/brief.ts:615`).
- **In our example** Meera already has cards from other men's rounds, so she is the first
  mover. If Arjun had more open cards, or they tied and his id sorted first, the roles would
  swap.
- **Turn order is enforced by the server:** the decide route refuses an answer that is not the
  caller's turn ("not_your_turn") or a second answer ("already_decided"), and the database write
  in `decide()` repeats the same test, so no caller can answer out of turn
  (`server/src/api/dating.ts:871`,
  `server/src/api/dating.ts:873`,
  `server/src/matching/orchestrator.ts:566`).
  Two old open pairs have no first mover recorded; either side may go first there.

### 9.2 What each person sees, step by step

**Step 1 — Meera decides first, on words alone.** Her card about Arjun is the full words card
(stage 8) with his 3D character, but no photo and no name. Under it:

- "Yes, share my profile with them" and "Not this one", and the note "This shows them your
  photos and first name. Nothing is shared until you tap it."
  (`app/src/features/matches/matches-screen.tsx:420`,
  `app/src/features/matches/turn.ts:37`).
- If she opens his profile screen anyway, it says "Not yet — Their photos and name show only after
  they share them. You decide first, on the card."
  (`server/src/api/dating.ts:195`).

**Meanwhile Arjun** sees the plain card (stage 8) with "They decide first. If they share their
profile, you will see it here.", no buttons, and in the town "They decide first. If they share
their profile, you will see it."
(`app/src/features/matches/turn.ts:43`,
`server/src/api/dating.ts:196`).
He cannot answer yet: the server refuses it.

**Step 2 — Meera taps "Yes, share my profile with them".** Her card now says "You shared your
profile. If they share theirs back, you can talk.", and her town seat "You shared your profile.
Waiting on them." Arjun gets his turn: a fresh three days, and a live event
(`app/src/features/matches/turn.ts:41`,
`app/src/features/world/agent-sheet.tsx:46`,
`server/src/matching/world.ts:127`).

**Step 3 — Arjun sees who shared.** His card fills in with her words, and "See who it is" opens
her profile: her photos (or her character and "No photos yet"), "WHO THEY ARE": "Meera, 27" (or
"Someone, 27" if no first name is known), her city, "Confirmed by N people who met them" (hidden
at 0), tag chips; "Your agent never decided whether you would find them attractive. It has no
opinion about that and does not keep one."; then "Yes, share mine back" and "Not for me", and
under them "Yes shows them your photos and first name, and opens a chat. If you say no, they
are not told."
(`app/src/features/matches/matches-screen.tsx:432`,
`app/src/features/matches/reveal-screen.tsx:227`,
`app/src/features/matches/reveal-screen.tsx:149`,
`app/src/features/matches/turn.ts:47`).

**Step 4 — Arjun taps "Yes, share mine back".** They are introduced (stage 10). Only now can
Meera see his photos and name.

If a decision does not go through (no connection, the card expired), the screen says "That did
not go through. Try again." instead of confirming it
(`app/src/features/matches/reveal-screen.tsx:75`).

### 9.3 When Meera's profile and photos become visible to Arjun

**What is shown.** The reveal returns the first name she typed on the setup screen ("Someone"
without one), age, city, up to 8 interest and work tags, her character and her photos. The tags
come only from facts she made shareable and never name a private topic (since 2026-09-28; they
used to come from the matching row, chat-learned and hidden ones included)
(`server/src/api/dating.ts:179`,
`server/src/api/dating.ts:162`,
`server/src/api/dating.ts:145`).

**When: only after Meera has said yes to Arjun.** The reveal route opens a person's profile only
when they said yes in that pair; otherwise it answers "waiting" with no name in it
(`server/src/api/dating.ts:731`). The database photo rule is
the same test: a person's photos show only to someone they said yes to, and only while the pair
has not ended in a no or expired
(`server/migrations/0073_consent_first_reveal.sql:42`,
`server/migrations/0073_consent_first_reveal.sql:40`).
Photos are served only through signed-in routes that ask that rule
(`server/src/api/photos.ts:72`).
The town shows a first name under the same test
(`server/src/api/world.ts:202`).
It stands a met person on their own neighbourhood only where the card already names the place
(Arjun decides first, or Meera has said yes); otherwise the seat stands in the viewer's own
neighbourhood, so the second mover does not learn where the first mover lives
(`server/src/api/world.ts:212`,
`server/src/api/world.ts:246`).

| Case | When Arjun sees Meera's profile and photos |
|---|---|
| Meera is first mover (our example) | After her "Yes, share my profile with them" |
| Arjun is first mover | After Arjun shared his, and Meera tapped "Yes, share mine back" |

**Is Meera ever asked "can we share your profile?"** **Yes: her yes is exactly that question.**
The first mover's button is "Yes, share my profile with them" and the second person's is "Yes,
share mine back"; nothing of a person is shown to the other before their own tap
(`app/src/features/matches/turn.ts:35`).
The promises match: consent says "Your photos and first name are never public. A person sees them
only after you say yes to sharing them with that person."; the photo screens say "Nobody sees these
until you share your profile with them." and "Only people you share your profile with"
(`app/src/features/consent/consent-screen.tsx:47`,
`app/src/features/onboarding/photos-step.tsx:168`,
`app/src/features/photos/photos-screen.tsx:133`).

### 9.4 What "no" does

- **One tap, final**, no confirmation: "Not this one" on the card or "Not for me" on the
  profile screen (`app/src/features/matches/reveal-screen.tsx:152`).
  It cannot be undone (`server/src/matching/orchestrator.ts:562`).
- **The person saying no** sees "Done" / "They are not told anything. Your agent keeps
  looking." (`app/src/features/matches/reveal-screen.tsx:87`).
- **The other person** is sent nothing
  (`server/src/matching/orchestrator.ts:579`),
  but their card disappears from Matches at once, because both people's lists hide ended pairs
  (`server/src/api/dating.ts:583`).
- **Whatever was shared closes:** after a no, the profile screen answers "not found" and the photos
  stop (`server/src/api/dating.ts:717`).
- **A first-mover no ends it**: the second mover never gets a turn and never saw anything.
- **Never again:** a pair can exist only once, so they are never matched again
  (`server/migrations/0022_rendezvous.sql:44`).

### 9.5 Phones woken (push notifications, since 2026-09-28)

Each moment that asks something of a person wakes their phone, whether or not the app is open:

| Moment | Who is woken | What the lock screen says | Code |
|---|---|---|---|
| New card, you decide first | The first mover | "Your agent met someone" / "You decide first. The card is waiting." | `server/src/matching/orchestrator.ts:425` |
| The first mover shared | The second person | "They shared their profile with you" / "Your turn: see who it is." | `server/src/matching/orchestrator.ts:621` |
| The second yes | The first mover (not the person who just tapped) | "You can talk now" / "They shared theirs back. Say hello." | `server/src/matching/orchestrator.ts:608` |
| A card fades within a day | The person whose turn it is, once | "A card fades today" / "Answer it before it is gone." | `server/src/push/index.ts:78` |

No name and no words anybody wrote ever go on the lock screen; a no wakes nobody
(`server/src/push/index.ts:31`). The phone asks for
permission when the person first sends their agent out, not at launch
(`app/src/features/world/world-screen.tsx:289`), and a
tap opens the card, their profile or the chat
(`app/src/features/push/route.ts:14`).
**Not yet reaching phones:** the app has no Expo project id yet and the server sends with
`PUSH_PROVIDER=console` (a log line per push) until the founder sets it up
(`server/src/env.ts:229`).

### 9.6 Expiry after three days

- **The clock:** 3 days from when the cards are written, for the first mover; a fresh 3 days
  from the first mover's yes, for the second
  (`server/src/matching/expiry.ts:18`,
  `server/src/matching/orchestrator.ts:614`).
- **Fading:** with 1 to 2 days left the card dims and says "Fades tomorrow if you don't
  answer."; under a day, "Fades today if you don't answer."; only the person whose turn it is
  sees this (`app/src/features/matches/fade.ts:16`). Once
  a day is left, that person's phone also gets "A card fades today", once per card
  (`server/src/push/index.ts:78`).
- **The sweeper** runs every 10 minutes and whenever the Matches list or a decision is
  loaded; it marks overdue pairs `expired` and writes no answer
  (`server/src/index.ts:202`,
  `server/src/matching/expiry.ts:27`).
- **Expired is not no:** a no is `lapsed` plus a recorded "no"; an expiry is its own status and
  is left out of the yes/no measurement; the founder's numbers count it separately
  (`server/migrations/0069_matches_expire.sql:19`,
  `server/migrations/0070_founder_funnel.sql:46`).
  An expired pair still uses the pair's one lifetime slot, and its photos close.

### Docs vs code

- HOW-IT-WORKS.md says photos are "shown only after both say yes". Since 2026-09-28 each person's
  photos show after **their own** yes: the first mover's before the second person answers
  (`HOW-IT-WORKS.md:158`).
- HOW-IT-WORKS.md says the first mover sees the other's profile and decides; the first mover now
  decides on the words card and character alone
  (`HOW-IT-WORKS.md:365`).
- HOW-IT-WORKS.md says after a no "their card simply never arrives". An existing card
  disappears early, which can reveal the no
  (`HOW-IT-WORKS.md:369`).
- HOW-IT-WORKS.md says an expiry leaves "both answers" empty. When the second mover's turn
  runs out, the first mover's yes stays recorded
  (`HOW-IT-WORKS.md:501`).

---

## 10. After both say yes

The second yes turns the pair into an **introduction**: a private chat opens between the
two people, with the agents' date idea offered at the top. From here on, the humans talk
to each other; no agent speaks for anyone. Code does all of it; the only model-written
words are the date idea, written earlier (stage 7).

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| The second yes | Pair becomes `introduced`; chat opens | Code | `rendezvous.introduced_at` | Both | `server/src/matching/orchestrator.ts:592` |
| A message | Sent over a live connection; delivered, read receipts | Code | `messages` row | The two people | `server/migrations/0025_messaging_fixes.sql:37` |
| "Propose this date" | Sends "How about this: <idea>?" as the person's own message, once per chat | Code | `messages` row (kind `date_idea`) | The two people | `server/src/api/date-idea.ts:31` |
| Two quiet days | A one-time nudge for each person | Code | `nudged_at` on each person's card row | Each person, once | `app/src/features/dm/date-idea.ts:17` |
| 72 hours after the introduction | The after-date check-in inside the chat | Code | `date_checkins` row per person | The person who answered; one bit is shared if both say "see again" | `server/src/api/dating.ts:121` |
| Block or report | Both are kept apart everywhere; a report is queued for the reviewer | Code | `blocks` row, and `reports` row | Reviewer sees reports | `server/src/messaging/store.ts:220` |
| Reviewer bans | Sessions revoked, hidden from everyone, phone and handset remembered | Code | `bans`, `ban_marks` | Reviewer | `server/migrations/0065_bans_stick.sql:70` |

### Arjun and Meera

1. **Arjun taps "Yes, share mine back".** He sees the "both said yes" moment: the two characters walk
   in and meet, then "You both said yes" / "Meera can message you now, and nobody else can."
   and a "Say hello" button (`app/src/features/matches/moment.ts:27`,
   `app/src/features/matches/moment.ts:29`,
   `app/src/features/matches/both-yes-moment.tsx:88`).
2. **Meera gets no moment.** Her waiting card disappears and "Arjun" appears in Chats with
   "Say something"; only now can she see his photos and first name, which his yes shared with her
   (`server/migrations/0073_consent_first_reveal.sql:42`,
   `server/src/matching/orchestrator.ts:605`,
   `app/src/features/dm/conversations-screen.tsx:94`). If her app is closed,
   her phone is woken: "You can talk now" (stage 9.5); a message to a closed app wakes the phone
   too, at most once every two minutes per chat, saying only "New message"
   (`server/src/api/chat.ts:281`,
   `server/src/push/index.ts:39`).
3. **The chat** opens with the agents' date idea at the top: "YOUR AGENTS' DATE IDEA", the idea,
   "Propose this date", "It goes as a message from you. You two pick the day." Below it: "You
   both said yes. Nobody else can message you here."
   (`app/src/features/dm/date-idea.ts:39`,
   `app/src/features/dm/thread-screen.tsx:254`,
   `app/src/features/dm/thread-screen.tsx:278`).
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
  message a stranger (`server/migrations/0024_messages.sql:12`,
  `server/src/api/chat.ts:233`).
- **Limits:** 1 to 4,000 characters; 60 events a minute per person ("Slow down a moment."); no
  daily cap (`shared/src/events.ts:54`,
  `server/src/ratelimit.ts:216`).
- **Contact details are allowed in chat.** The contact-detail filter guards what agents say,
  not what people type to each other; the app itself tells people to swap details in chat
  (`server/src/matching/brief.ts:198`,
  `app/src/features/stories/stories-state.ts:29`).
- **Receipts:** "Sent", "Delivered", "Read", "typing…", always on
  (`app/src/features/dm/thread-screen.tsx:40`).
- **Messages are never deleted by the app**; there is no delete route
  (`server/migrations/0025_messaging_fixes.sql:57`).

### 10.2 "Propose this date"

The server rebuilds the idea from the caller's own card, checks it again, and sends
"How about this: <idea>?" as a message from that person. Nothing typed on the phone is used.
Either person can do it, once per conversation in total; a second try gets "A date has
already been proposed here."
(`server/src/api/date-idea.ts:10`,
`server/src/api/date-idea.ts:173`).
If there is no checked idea, there is no button.

### 10.3 The nudge

Due when the pair was introduced at least 2 days ago, nobody has written in the last 2 days,
and this person has not been nudged for this match. It is shown in the app only (no push), once
per person per match; opening the chat marks it seen for good
(`server/src/api/date-idea.ts:43`,
`server/src/api/date-idea.ts:136`).
The chat shows "IT HAS BEEN QUIET FOR TWO DAYS" and either the date idea with its button, or
"Say hello? You both said yes." (`app/src/features/dm/date-idea.ts:34`).

### 10.4 The after-date check-in

- **When:** 72 hours after the introduction by default, inside the chat only
  (`server/src/api/dating.ts:765`).
- **Step 1:** "Did you two meet up? They are not told what you say." [Yes] [Not yet]. The first
  answer is final: a "Not yet" is never asked again
  (`app/src/features/dm/checkin.tsx:109`,
  `server/src/api/dating.ts:922`).
- **After "Not yet":** "What happened? Only you see this." with "Plans fell through", "They
  stopped replying", "I changed my mind", "Something else", or Skip
  (`app/src/features/dm/checkin.tsx:122`).
- **After "Yes"**, up to 6 questions, each [Yes] [No] [Not sure]: "Did they look like their
  photos?", "Did they seem about 29?", "Did they go by Arjun?", "Do they live around
  Bengaluru?", then up to two of the reader's matched wants ("You wanted “…”. Did they seem
  that way?"), then up to two of their tags ("Did climbing come up?", "Do they work in …?")
  (`server/src/checkin/questions.ts:46`,
  `server/src/checkin/questions.ts:66`,
  `server/src/checkin/questions.ts:40`).
- **Then:** "Did you feel safe with them?" [Yes] [No]; on No: "Sorry. Do you want to stop
  hearing from Arjun?" [Block] [Block and report] [Not now]. Then "Would you see them again?"
  "They only hear this if you both say yes." Finally "Thanks. +50 points."
  (`app/src/features/dm/checkin.tsx:148`,
  `app/src/features/dm/checkin.tsx:167`,
  `app/src/features/dm/checkin.tsx:63`).
- **Stored:** one `date_checkins` row per person; final, cannot be changed
  (`server/migrations/0058_date_checkins.sql:54`).
- **Who sees it:** only the person who answered. One bit crosses: if both said yes to "see
  again", both see "You both said you'd see each other again."
  (`server/migrations/0058_date_checkins.sql:13`,
  `app/src/features/dm/checkin.tsx:101`).
- **Used for:** "Confirmed by N people who met them" on that person's future reveals (a check-in
  with no identity answer of "no" counts); reviewer flags when 2+ people say the photos or age
  were wrong, or 1+ felt unsafe (no automatic action); the founder's numbers
  (`server/migrations/0058_date_checkins.sql:67`,
  `server/migrations/0058_date_checkins.sql:104`).
  Never written into anybody's facts.

### 10.5 Block and report

- **Where:** every card ("Block or report"), the reveal and chat headers ("⋯"), a met
  person's sheet in the town, and the check-in's "felt unsafe" step
  (`app/src/features/dm/thread-screen.tsx:226`).
- **Block:** "Block Meera?" / "You will never see each other again, anywhere in the app. They
  are not told." (`app/src/features/safety/safety-sheet.tsx:44`).
- **Report:** "REPORT -- WHAT HAPPENED?" with seven reasons: "Harassment or threats",
  "Inappropriate messages or photos", "Fake profile", "Seems under 18", "Spam or a scam", "Made
  me feel unsafe", "Something else"; an optional note (up to 2,000 characters); the button
  "Report and block"; and "Something urgent? Write to" the support address
  (`app/src/features/safety/reasons.ts:17`,
  `app/src/features/safety/reasons.ts:23`,
  `app/src/features/safety/safety-sheet.tsx:101`).
  A report always blocks too (`server/src/messaging/store.ts:220`).
- **Effect, both ways:** the card, reveal, chat, town seat, photos and date idea disappear for
  both; sends are refused; they are never matched again
  (`server/migrations/0064_bans_and_apart.sql:54`).
  The blocked person is told nothing; a message they try to send shows "not sent"
  (`server/src/api/chat.ts:253`).
- **No automatic action on reports**; a reviewer looks at them
  (`server/migrations/0039_trust_and_safety.sql:21`).

### 10.6 Bans

- **Who:** only accounts listed in `ADMIN_USER_IDS` (the reviewer), from the "Reports to review"
  screen in Settings: "Ban <name>?" / "They are signed out, taken out of the pool and hidden from
  everybody, for good." (`app/src/features/admin/reports-screen.tsx:46`).
- **What it does:** hides all their photos; records the ban; remembers the account's phone-number
  hash and the hashed id of every phone they signed in on; revokes every session; takes them
  out of the pool for good (`server/migrations/0065_bans_stick.sql:61`,
  `server/migrations/0065_bans_stick.sql:64`,
  `server/migrations/0065_bans_stick.sql:71`).
- **What the banned person sees:** they are signed out, and signing in again with the same
  number or the same phone gets "This account was closed after a report. If you think that is a
  mistake, write to" the support address
  (`server/src/api/auth.ts:125`).
  A ban outlives account deletion, and no code lifts a ban.

### Docs vs code

- HOW-IT-WORKS.md says the "you both said yes" moment appears "when the second yes lands"; only
  the person whose tap made the introduction sees it
  (`HOW-IT-WORKS.md:635`).
- HOW-IT-WORKS.md says the "apart" check is asked "by every place two people meet … the chat list
  and every message". It is not asked when reading message history, for typing and read events,
  or by the check-in (`HOW-IT-WORKS.md:861`).

---

## 11. What the Numbers page and the "wants with no question yet" list measure

Both are for the **reviewer** only: an account listed in `ADMIN_USER_IDS`. For anyone else the server answers
"not found", and the Settings row does not appear
(`server/src/api/admin.ts:44`,
`server/src/env.ts:190`).
The way in: YOU → Manage → Settings → "Help and safety" → "Numbers" ("How far matches get, real people only")
(`app/src/features/settings/settings-screen.tsx:272`).

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| The reviewer opens Numbers | One database function counts real people and pairs | Code (SQL) | Nothing | The reviewer | `server/migrations/0070_founder_funnel.sql:21` |
| Same screen, lower card | Every real person's want sentences are read, private ones and those a question covers are dropped, the rest counted by people | Code | Nothing | The reviewer: topic words, and whole wants only when 2+ people wrote the same thing | `server/src/matching/want-gaps.ts:60` |

### Arjun and Meera

Neither ever sees these pages. If both wrote "Someone who loves theatre", the reviewer sees the want itself, "2
people"; if only Arjun wrote it, the reviewer sees only its topic word, "theatre · 1 person"
(`app/src/features/admin/funnel.ts:28`).

### 11.1 Who counts as a "real person"

Every account that is not a practice profile, whose address is not a test fixture's (`@example.test`), and that
has signed in on a phone at least once (`server/migrations/0070_founder_funnel.sql:28`,
`server/migrations/0070_founder_funnel.sql:29`,
`server/migrations/0070_founder_funnel.sql:30`).
A **pair** counts only when both people are real and the round has finished
(`server/migrations/0070_founder_funnel.sql:34`).

### 11.2 The numbers, top to bottom

Title "Numbers", "Real people only"; card "HOW FAR MATCHES GET"; counts only, no percentages
(`app/src/features/admin/funnel-screen.tsx:32`,
`app/src/features/admin/funnel-screen.tsx:36`):

| Row | Counts | Code |
|---|---|---|
| Matches | Pairs between two real people, whatever happened next | `server/migrations/0070_founder_funnel.sql:37` |
| Both said yes | Pairs that were introduced | `server/migrations/0070_founder_funnel.sql:38` |
| First message | Introduced pairs with at least one message | `server/migrations/0070_founder_funnel.sql:40` |
| Date proposed | Pairs where someone tapped "Propose this date" | `server/migrations/0070_founder_funnel.sql:42` |
| Met | Pairs where either person said yes to "Did you two meet up?" | `server/migrations/0070_founder_funnel.sql:45` |
| People | Real people, including those still setting up | `app/src/features/admin/funnel-screen.tsx:42` |
| Expired, nobody answered | Pairs that ran out of time | `server/migrations/0070_founder_funnel.sql:46` |

Footer: "Invented people, test accounts and anybody who never signed in on a phone are left out. Met counts either
check-in." (`app/src/features/admin/funnel-screen.tsx:46`).

**Today's values** on the development database (queried 2026-09-28): People 11; Matches 0; every later step 0.
Of the 11, 4 are ready to be sent out. The pool also holds 5,008 practice profiles, which these numbers leave out.

### 11.3 "Wants with no question yet"

- **What goes in:** every live want sentence ("What would you love in someone?" and "couldn't be with") of every
  real person, read through a database function only the matchmaker role may call
  (`server/migrations/0072_founder_unmatched_wants.sql:30`,
  `server/migrations/0072_founder_unmatched_wants.sql:35`).
- **What is dropped:** any sentence naming a private topic, and any that one of the 12 questions already matches
  (`server/src/matching/want-gaps.ts:51`).
- **How it is counted:** each sentence is lower-cased, punctuation removed and a leading phrase like "I want" or
  "someone who" stripped; then the number of **different people** per sentence is counted, and separately per
  content word (`server/src/matching/want-gaps.ts:30`,
  `server/src/matching/want-gaps.ts:54`).
- **What is shown:** card "WANTS WITH NO QUESTION YET": the 10 most common topic words ("theatre · 2 people"),
  then up to 10 whole wants that two or more people share, most people first; "Every want so far fits a
  question." when empty; footer "A want only one person has shows as its topic, never their words."
  (`app/src/features/admin/funnel-screen.tsx:51`,
  `app/src/features/admin/funnel-screen.tsx:58`).
- **Why:** to tell the founder which situation questions to add next. It measures demand, not accuracy.

### 11.4 The want-check accuracy test (not in the app)

`server/evals/wants` holds 300 invented want/sentence pairs to be marked by hand on a local page that never shows
the app's own answer; a separate command scores the model against the marks, with a 90% target, and sends nothing
without `--go` (`server/evals/wants/accuracy.ts:19`,
`server/evals/wants/score.ts:35`). As of 2026-09-28 no pair is marked and it has
never run.

### Docs vs code

- HOW-IT-WORKS.md §7e says "two ways of saying one want count once". Only wants whose cleaned-up words are identical
  are merged; different wordings are separate rows, joined only through shared topic words
  (`HOW-IT-WORKS.md:653`).
- HOW-IT-WORKS.md §7e says a one-person want "shows as its topic words". The screen does not list one-person wants
  at all; it lists the top topic words across all wants (`HOW-IT-WORKS.md:654`).

---

<a id="ai-calls"></a>
## 12. Every AI model call

**Which model.** Every call goes through one router that picks a model per task
(`server/src/llm/index.ts:38`). The code's default for
most tasks is Claude Sonnet 5 (`server/src/env.ts:89`);
the development configuration (`server/.env`, not in git) sets every task to **Google Gemini 3.5 Flash-Lite**
and embeddings to Gemini Embedding 001. The typed decision model and a separate judge model are not set, so
they are off.

**Price** (from the repository's own table): Gemini 3.5 Flash-Lite costs $0.30 per million input tokens and
$2.50 per million output tokens (`server/src/llm/caps.ts:151`,
`server/src/llm/caps.ts:153`). The embedding model has no price in the repository.
"Measured" below means averages from the development database's call ledger, queried on 2026-09-28; the ledger
holds 8,158 calls and $7.02 in total, all since 2026-09-08. Where a call has never run on this model, the cost
is an estimate from its output limit.

**Metering.** Each call is recorded against one person (`llm_calls`) and counted against their day: at most
$2.00 and at most **10 model calls** per person per day, for every account; setup calls (AI-1 on the first screen,
AI-2 to AI-5, and the answer sheet the first sentence builds) are counted apart, up to 40 a day, since 2026-09-28
(`server/src/metering.ts:59`); the day resets at midnight UTC
(`server/src/metering.ts:56`,
`server/src/metering.ts:65`,
`server/src/metering.ts:47`). Embeddings are not
metered. The server refuses to start if a routed model has no verified price or retires within 90 days
(`server/src/llm/index.ts:118`).

### Summary

| # | Call | Task | When | On by default? | Output limit | Cost per call |
|---|---|---|---|---|---|---|
| AI-1 | Fact extraction | extract | The first setup sentence; 5 minutes after any chat goes quiet | Yes | 4,096 tokens | Measured ≈ $0.0006 (27 calls) |
| AI-2 | Sample reply ("Is this you?") | chat | Setup's first screen; the self-test | Yes, on use | 300 | Measured ≈ $0.00013 (3 calls) |
| AI-3 | "Couldn't be with" → card proposal | extract | Answering that interview question | Yes | 512 | Not measured; ≤ $0.0015 |
| AI-4 | Paste import | extract | "Paste from another AI" | On use | 8,192 | Not measured; ≤ $0.02 + input |
| AI-5 | Style note from WhatsApp | extract | "Now, how you talk" | On use | (not set) | Not measured |
| AI-6 | Own-clone chat reply | chat | Every message to your clone | Yes | 2,048 | Measured ≈ $0.00045 (5 calls) |
| AI-7 | Embeddings | (none) | Every chat message | Yes | n/a | Not metered, not priced |
| AI-8 | Conflict resolver | resolve | Inside AI-1, when a multi-answer field may conflict | Yes, sometimes | (not set) | Not measured |
| AI-9 | Profile summary | render_profile | Inside AI-1, when 3+ facts changed | Yes, sometimes | (not set) | Not measured |
| AI-10 | Answer sheet | extract | When shareable sentences changed: after learning, opening "How you appear", sending out | Yes, sometimes | 600 | Not measured; ≤ $0.002 |
| AI-11 | The agents' talk | extract | Each pair in a round | Yes | 1,500 | Not measured; ≤ $0.004 + input |
| AI-12 | Want check | extract | Once per round for the sender's untied wants; once per real person met for theirs | Yes, when such wants exist | 2,000 | Not measured; ≤ $0.005 + input |
| AI-13 | Agent conversations (talker + judge) | chat, resolve | Each pair, several runs | **No** (`RENDEZVOUS_RUNS=0`) | 200 / 400 | Measured in the old design ≈ $0.0004 per message |
| AI-14 | Typed decision model | decide | "Couldn't be with" (instead of AI-3); a "second evening" score per pair | **No** (`DECIDE_MODEL` unset) | n/a | — |
| AI-15 | Face check | none (runs on the server) | "Check your photos" | **No** (`FACE_CHECK=off`) | n/a | No vendor, no credits |

Two routed tasks, `reflect` and `canon`, are never called, and an old "file score" function is dead code
(`server/src/llm/index.ts:32`, `server/src/matching/score.ts:211`).
No model is ever sent a photo: requests carry text only (`server/src/llm/port.ts:29`).

**A default round** makes 0–1 answer-sheet call at the tap, 0–1 want check for the sender, and per pair 0–1
talk and 0–1 want check for the other person: up to 8 calls, charged to the sender. Estimated at well under
$0.02; not measured, because no round has run since the talk was added.

<a id="ai-1"></a>
### AI-1. Fact extraction

- **Task / model:** `extract` → Gemini 3.5 Flash-Lite (`server/src/memory/extract.ts:175`).
- **When:** the first setup screen, at once; and for every chat session, about 5 minutes after it goes quiet
  (`server/src/api/tell.ts:73`,
  `server/src/memory/session.ts:28`).
  Story and question-of-the-day answers are also swept later, and a first-screen sentence is extracted a second
  time by the sweeper (`server/src/memory/session.ts:302`).
- **What goes in:** the person's own lines from the session -- never the clone's (since 2026-09-28) --
  plus their current facts; a session with nothing they typed makes no call. Key instructions: "You extract
  durable facts about ONE person from what they typed to their AI clone.", "NEVER generalise the object.",
  "when in doubt choose the weaker stance", "Silence is not evidence."
  (`server/src/memory/extract.ts:187`,
  `server/src/memory/extract.ts:67`,
  `server/src/memory/extract.ts:79`,
  `server/src/memory/extract.ts:91`,
  `server/src/memory/extract.ts:99`).
- **What comes out:** a list of facts (field, words, how sure, the exact quote, when), facts that may now be
  false, and what the session was for (`server/src/memory/extract.ts:203`).
- **Code checks:** the reply must parse, or nothing is kept; unknown fields and under-18 birth years are
  refused; tapped fields are held; anything not asserted is held; learned facts start match-only
  (`server/src/memory/extract.ts:213`,
  `server/src/memory/facts.ts:119`). The model never sees the clone's words, so a
  fact cannot come from them; a first name is refused whatever the model says (it is set on a screen).
- **Stored:** facts, an audit trail, questions the clone wants to ask, session intents.

<a id="ai-2"></a>
### AI-2. Sample reply ("Is this you?")

- **Task / model:** `chat` → Flash-Lite; recorded under the label `render_profile`
  (`server/src/memory/selftest.ts:86`,
  `server/src/api/selftest.ts:44`).
- **When:** right after the first sentence ("Now it's you"), on "Test it" in setup, and Settings → "Test it again".
- **In:** the profile summary, every live fact, the style note, and a fixed question such as "A friend asks
  what you have been up to lately. What do you say?". Instructions: "You are answering AS this person, in a
  message to a friend." "Never invent a fact to make the answer richer."
  (`server/src/memory/selftest.ts:36`,
  `server/src/memory/selftest.ts:48`,
  `server/src/memory/selftest.ts:53`).
- **Out:** up to 300 tokens of text. **Checks:** none beyond trimming. **Stored:** the answer and the person's
  grade. Shown only to the person; it gates nothing.

<a id="ai-3"></a>
### AI-3. "Couldn't be with" → card proposal

- **Task / model:** `extract` → Flash-Lite, 512 tokens (`server/src/onboarding/dealbreaker.ts:281`).
- **When:** the interview's "Anyone else you couldn't be with?" is answered.
- **In:** the sentence alone. Instructions: "Only map what is actually there." "Prefer null over a loose fit."
  "Use only the values listed for the field. Never invent one."
  (`server/src/onboarding/dealbreaker.ts:128`,
  `server/src/onboarding/dealbreaker.ts:130`,
  `server/src/onboarding/dealbreaker.ts:132`).
- **Out:** one of the five card fields (or none) and the answers the sentence excludes.
- **Checks:** only the five cards, only real answers, frequencies closed upward, never "exclude everything"
  (`server/src/onboarding/dealbreaker.ts:94`).
- **Stored:** nothing from the model. The phone shows a proposal ("Change this card?") and only "Keep this" writes a rule.

<a id="ai-4"></a>
### AI-4. Paste import

- **Task / model:** `extract` → Flash-Lite, 8,192 tokens (`server/src/memory/pasteImport.ts:159`).
- **When:** "Paste from another AI", "In your words", "Catch it up fast".
- **In:** the pasted text, up to 60,000 characters. Instructions: "Extract only what the text actually says." "A
  guess is NEVER a fact." (`server/src/memory/pasteImport.ts:80`,
  `server/src/memory/pasteImport.ts:86`).
- **Out:** facts, and guesses with a question for each.
- **Checks:** must parse; every fact is forced to "reported" and "untrusted", so it is held
  (`server/src/memory/pasteImport.ts:183`).
- **Stored:** held facts and questions; the pasted text is thrown away.

<a id="ai-5"></a>
### AI-5. Style note from a WhatsApp export

- **Task / model:** `extract` → Flash-Lite (`server/src/memory/chatImport.ts:83`).
- **When:** "Now, how you talk", in first-time setup.
- **In:** up to 400 of the person's own messages (sampled from what the phone sent). Instructions: "Ignore the
  CONTENT of what they discuss. You are describing the voice, not the topics." "Use their actual words as
  examples. Quote short fragments." (`server/src/memory/chatImport.ts:55`,
  `server/src/memory/chatImport.ts:49`).
- **Out:** style, habits, things they never do. **Checks:** at least 20 messages; must parse
  (`server/src/memory/chatImport.ts:100`).
- **Stored:** only the note; it is added to every own-chat prompt.

<a id="ai-6"></a>
### AI-6. Own-clone chat reply

- **Task / model:** `chat` → Flash-Lite, streamed, 2,048 tokens (`server/src/api/chat.ts:377`,
  `server/src/api/chat.ts:402`).
- **When:** every message a person sends to their own clone.
- **In:** the profile summary, style note, last 20 messages, **every** live fact (including private ones: it
  talks only to its own person), up to 5 recalled old messages. Instructions: "You are this person's clone: an
  agent that knows them and speaks with their voice and judgement." "Never invent a detail about them that is not
  in the fragments." "Speak plainly, in their register."
  (`server/src/api/chat.ts:35`,
  `server/src/api/chat.ts:41`,
  `server/src/api/chat.ts:43`).
- **Out:** free text. **Checks:** none; streamed straight to the phone
  (`server/src/api/chat.ts:409`).
- **Stored:** the reply, as a message in the person's history.

<a id="ai-7"></a>
### AI-7. Embeddings

- **Model:** Gemini Embedding 001, 768 numbers per text (`server/src/llm/adapters/google.ts:216`).
- **When:** each chat message is embedded to search the person's past messages; after the reply, both messages
  are embedded and stored (`server/src/memory/retrieval.ts:64`,
  `server/src/api/chat.ts:480`).
- **Checks / metering:** none; these calls bypass the meter and the ledger
  (`server/src/llm/embeddings.ts:26`).

<a id="ai-8"></a>
### AI-8. Conflict resolver

- **Task / model:** `resolve` → Flash-Lite (`server/src/memory/resolve.ts:89`).
- **When:** inside AI-1, when new facts share a multi-answer field with live ones.
- **In:** two numbered lists, existing and new. Instructions: "Return three lists of INTEGERS, referring to
  positions in EXISTING. Never return text." "When you cannot decide, choose uncertain_ids."
  (`server/src/memory/resolve.ts:41`,
  `server/src/memory/resolve.ts:63`).
- **Checks:** must parse; out-of-range numbers dropped. **Stored:** contradicted facts are retired; uncertain ones
  become a question (`server/src/memory/session.ts:142`).

<a id="ai-9"></a>
### AI-9. Profile summary

- **Task / model:** `render_profile` → Flash-Lite (`server/src/memory/profile.ts:146`).
- **When:** inside AI-1, when 3 or more facts changed, and only if the new summary would not drop more than a
  quarter of the old (`server/src/memory/session.ts:181`).
- **In:** up to 60 confirmed facts, any visibility. Instructions: "Write a short profile of this person from the
  facts given." "Use ONLY the facts given. Add nothing." (`server/src/memory/profile.ts:71`,
  `server/src/memory/profile.ts:82`).
- **Out / checks:** four text blocks, each cut to a length; no content check. **Stored:** the summary, used in the
  own chat and self-test.

<a id="ai-10"></a>
### AI-10. Answer sheet

- **Task / model:** `extract` → Flash-Lite, 600 tokens (`server/src/matching/answer-sheet.ts:200`).
- **When:** only when the person's shareable sentences changed: after learning, when "How you appear" opens, and
  when they tap "Send my agent out" (`server/src/matching/answer-sheet.ts:185`).
- **In:** up to 40 of the person's own public, verified sentences, numbered, and the 12 bank questions.
  Instructions: "For each question, give the number of the ONE sentence that answers it directly, or null."
  "Never write any words of your own." "Null is always safe. A wrong number is shown to another person as
  something this person said." (`server/src/matching/answer-sheet.ts:104`,
  `server/src/matching/answer-sheet.ts:111`).
- **Checks:** numbers must be in range, one sentence per question; the person's own question-of-the-day answers win.
  **Stored:** question → fact id, no words.

<a id="ai-11"></a>
### AI-11. The agents' talk

- **Task / model:** `extract` → Flash-Lite, 1,500 tokens, one per pair, charged to the sender
  (`server/src/matching/talk.ts:331`, `server/src/matching/talk.ts:328`).
- **In:** both people's shareable sentences (up to 20 each), the 12 questions, 4 reactions. Instructions: "You
  script a short, warm first chat between two dating agents, A and B." "You never write a sentence about a
  person. You choose:" … "Keep it to 6-12 lines." The date idea "is under 12 words, says what to do and where, and
  never mentions either person" (`server/src/matching/talk.ts:103`,
  `server/src/matching/talk.ts:105`,
  `server/src/matching/talk.ts:114`).
- **Out:** lines made of question ids, sentence numbers, reactions and "don't know"; shared pairs; one date idea.
- **Checks:** all shown words are rebuilt by code from the real sentences; the shape rules in stage 7; the date
  idea's word filters and "adds no facts" test (`server/src/matching/talk.ts:333`).
- **Stored:** inside both cards.

<a id="ai-12"></a>
### AI-12. Want check

- **Task / model:** `extract` → Flash-Lite, 2,000 tokens (`server/src/matching/wants.ts:257`,
  `server/src/matching/wants.ts:264`).
- **In:** the want-holder's untied and private wants, up to 10 sentences from each of up to 12 people, and the six
  cards' possible answers (never anyone's answer). Instructions: "You check what one person asked for in a partner
  against what other people wrote about themselves." "Judge only from the one sentence you cite." "Some wants are
  marked PRIVATE. Never use anybody's sentences for those"
  (`server/src/matching/wants.ts:150`,
  `server/src/matching/wants.ts:159`,
  `server/src/matching/wants.ts:161`).
- **Out:** per person and want: met, not met or unknown, with a sentence number; for private wants, a card and the
  acceptable answers.
- **Checks:** a verdict survives only with a valid sentence number; the quote is looked up, never copied; private
  wants are decided by code from the other person's card
  (`server/src/matching/wants.ts:202`,
  `server/src/matching/wants.ts:198`).
- **Stored:** on the cards; "not met" moves a candidate later.

<a id="ai-13"></a>
### AI-13. Agent conversations (switched off)

- **When:** only if `RENDEZVOUS_RUNS` is above 0; the code default is 0 and it is not set
  (`server/src/matching/rendezvous.ts:75`).
- **Talker:** `chat`, 200 tokens a message: "You represent ONE person, talking to an agent that represents somebody
  else." "Only say things you were actually told about your person. Never invent a detail to keep it going."
  (`server/src/matching/rendezvous.ts:110`).
- **Judge:** labelled `resolve` but routed to the chat model unless `ASSESS_MODEL` is set: "Warmth is not evidence."
  Returns yes, no or not enough (`server/src/matching/rendezvous.ts:190`,
  `server/src/matching/rendezvous.ts:221`).
- **Stored:** transcripts that no app role can read; the verdicts gate nothing.

<a id="ai-14"></a>
### AI-14. Typed decision model (switched off)

With `DECIDE_MODEL` set, "Couldn't be with" would be mapped by typed yes/no questions instead of AI-3, and each
pair would get a hidden "after one evening together, each would want a second one" probability, stored and never
shown (`server/src/matching/score.ts:292`,
`server/src/matching/score.ts:304`).

<a id="ai-15"></a>
### AI-15. Face check (switched off)

With `FACE_CHECK` on, two selfie frames are compared with the person's photos by a face model that runs on the
server itself, with no vendor; the frames are deleted and only the verdict is kept
(`server/src/photos/face.ts:7`,
`server/src/env.ts:328`).

### Docs vs code

- HOW-IT-WORKS.md §10 says "Every model call goes through llm.complete". The chat uses a streaming call, and
  embeddings bypass the router and the meter (`HOW-IT-WORKS.md:805`).
- HOW-IT-WORKS.md §10 says "One meter wraps a whole round". There are two meters, each with its own budget check
  (`HOW-IT-WORKS.md:807`).
- `MAX_SESSION_OUTPUT_TOKENS` is configured but nothing enforces it
  (`server/src/env.ts:341`).
- ARCHITECTURE.md plans chat on GPT-5.6-luna, nightly batch jobs and a paid tier with a 10-turn trial. The code
  runs every task on one model, has no batch jobs and no payment code; the 10-call cap applies to everyone
  (`ARCHITECTURE.md:24`,
  `ARCHITECTURE.md:127`).
- ENGINE-DECISION.md recommends a Python FastAPI service and a matching cascade of embeddings, Haiku scoring and a
  Sonnet mediator. The server is TypeScript (Hono) and a round is SQL plus the talk and want calls
  (`ENGINE-DECISION.md:9`).

### Unverified

- Whether Google bills Gemini's thinking tokens: the code records them but does not price them
  (`server/src/llm/adapters/google.ts:115`).
- The embedding model's price, and whether the Gemini key is on the free or paid tier (their data terms differ).

---

## 13. What else the app does (not in the outline above)

| Feature | What it does | Who can reach it | Code |
|---|---|---|---|
| **The town** (Home tab) | A 3D miniature Bengaluru built from OpenStreetMap, 30 neighbourhoods; your agent, up to 40 strangers and the people you met walk about as full 3D bodies; tap your own agent to talk to it. Development builds add a "Test: add 1000 people" chip that spreads a test crowd over all 30 neighbourhoods (since 2026-09-29) | Everyone | `app/src/features/world/map.ts:4`, `server/src/matching/world.ts:50`, `app/src/features/world/hud.tsx:200` |
| **Cubbon Park** | A walkable version of the real park; up to 32 agents; "Directions" opens a Google Maps search. Everybody is a full walking body drawn by the graphics chip, in less detail further away (since 2026-09-28; before, the nearest 12 had bodies and everyone else was a capsule). A mist ends the view at about 365 m: past it no person, tree, bench or lamp is drawn, and people out of sight are moved less often. Benches, lamps and bins: the detailed models near you, plain shapes further out (since 2026-09-28; before, the full set was 13 times over its budget and the park had none). Since 2026-09-29 each is sized against the people using it: a bench's seat is where a sitting person's seat is (it was 28 cm higher, so people sat inside benches), and grass is ankle to knee high, bushes waist to shoulder. Every path can be walked or ridden end to end: no tree, bench, lamp or rock stands on one, the paths keep clear of the buildings' walls, and the park's edge stops you at its real boundary (since 2026-09-29; before, it was a ring of invisible circles that stopped you up to a metre and a half short of it, or let you a metre past it). An iron railing you can see through runs all the way round that boundary, with a gate wherever a path meets it; beyond it is a road with Bengaluru's traffic -- two-wheelers, autos, cars and BMTC buses, keeping left -- and buildings, none of which anybody can reach (since 2026-09-29; before, the park ran into a green plain). "Ride a bike", above the stick, puts you on a bicycle anywhere in the park: twice as fast as walking, pedalling as you go, and everybody near sees you on it; you get off to sit on a bench, and for the car. Talking with someone, "Things to do" lists what the two can do together -- walk side by side 250 m, ride side by side 500 m, sit on a bench and each say three things, stand at three of the park's sights -- and each done pays both of them points (10 to 30) once a day, to spend on their look; the server decides from where they are, never from what they say, and the one you are with wears a ring at their feet. Development builds add a "Test: add 1000 people" chip, to watch the frame rate. Since 2026-09-29 the park is live: real people in it at the same time see each other ("3 here now"), each in place of their agent, and "Say something" reaches whoever is within about 20 m, over their heads and in a short log, stored nowhere; tapping one of them offers "Block or report". "Find someone to talk to" asks the free person here with most in common (never anybody talking, asking or being asked); they get "Someone here would like to talk" ("You both like …" only for something both made public) and say yes or not now; on a yes a small car drives the one who asked over. The two can then "Sit on a bench": they walk to the nearest free bench and sit, and from then on what they say reaches only each other, and nothing said near them reaches them | Everyone, "Visit Cubbon Park" | `app/src/features/world/venue.ts:61`, `app/src/features/world/crowd-gpu.ts:117`, `app/src/features/world/camera.ts:77`, `app/src/features/world/venue-mesh.ts:55`, `app/src/features/world/venue-mesh.ts:94`, `app/src/features/world/hud.tsx:183`, `app/src/features/world/park-hud.tsx:171`, `app/src/features/world/park-hud.tsx:379`, `server/src/park/pairs.ts:65`, `app/src/features/world/garden.ts:605`, `app/src/features/world/fence-mesh.ts:23`, `app/src/features/world/city-plan.ts:28`, `app/src/features/world/traffic.ts:26`, `app/src/features/world/bike.ts:55`, `shared/src/park-quests.ts:29`, `server/migrations/0078_park_points.sql:22` |
| **"Who's here"** | A list of the same people as the town, practice profiles marked "Not a real person" | Everyone | `app/src/features/world/people.ts:52` |
| **Character builder** | The 3D figure others see in the town and on cards until you share your profile with them; items bought with points. Seven tabs (Body, Face, Hair, Top, Bottoms, Shoes, Extras), each a few titled rows, every colour named for what it colours ("Top colour"); the camera goes to what is being changed, and a line says when a pick changed something else ("Your bottoms changed to fit."). Since 2026-09-29: hairstyle apart from the face (11, one of them Shaved, men's faces only), eye colour, height, colours for trousers and shoes ("As made" first), more skin tones, hair and cloth colours, and five places to wear things instead of one "extra": hat (cap, beanie, bucket hat, hard hat, beret), glasses, earrings, round the neck, bag. Anything bought before keeps its meaning | Everyone | `app/src/features/look/builder-screen.tsx:32`, `shared/src/look.ts:70`, `app/src/features/look/builder-model.ts:64` |
| **Points** | +50 for a check-in, +10 for "did you meet", +20 first look, +30 photos checked; in Cubbon Park, +10 to +30 for each thing done together, once a day (since 2026-09-29); only the person sees the balance | Everyone | `server/src/points/ledger.ts:14`, `server/src/points/ledger.ts:18` |
| **Round recap** | "WHAT YOUR AGENT DID" after your own round: template sentences, up to two of your own sentences it used, topics, and what it had to say "I don't know" to | The round's sender | `server/src/matching/recap.ts:36` |
| **Live updates** | One connection carries clone chat, messages and town events (queued, met, talking, decided, done, your turn, introduced) | Everyone | `shared/src/events.ts:198` |
| **Push notifications** | A closed app is woken for a new card, "they shared their profile", "you can talk now", a message, and "a card fades today"; no names or words on the lock screen. Needs the founder's Expo setup before it reaches phones (stage 9.5) | Everyone, once allowed | `server/src/push/index.ts:34` |
| **Photos screen** | Up to six photos, re-encoded to drop location data | Everyone | `server/src/photos/store.ts:30` |
| **Selfie check** | "Photos checked" badge from a local face model | Off (`FACE_CHECK=off`) | `server/src/api/verify.ts:39` |
| **"What it knows"** | Every fact, its history, and the confirm questions | Everyone | `app/src/features/knowledge/you-screen.tsx:91` |
| **Clarifying questions** | "It wants to know" cards in chat, from facts that may be stale or from paste guesses; they never close | Everyone | `app/src/features/chat/clone-chat.tsx:93` |
| **Settings** | Theme, 3D town on/off, 30 fps battery mode, contact support, "Download everything", "Delete everything", sign out, server address, credits | Everyone | `app/src/features/settings/settings-screen.tsx:236` |
| **Server address** | Anyone can point the app at another server; the app also opens this screen by itself when the server is unreachable | Everyone | `app/src/features/settings/connect-screen.tsx:36` |
| **Reports to review** | The reviewer's queue: "No action", "Hide photos", "Ban" | Reviewer | `app/src/features/settings/settings-screen.tsx:270` |
| **Identity flags** | Counts of people whose dates said the photos or age were wrong, or felt unsafe; no screen | Reviewer, API only | `server/src/api/admin.ts:78` |
| **Public pages** | `/health`, `/v1/config` (the AI notice), and `/stats`, an unlinked "How small this is" page with the people count and self-test pass rate | Anyone with the server address | `server/src/api/stats.ts:53` |
| **Graphics bench** | A hidden 3D benchmark: tap the version line in Settings five times | Anyone | `app/src/features/settings/settings-screen.tsx:39` |
| **Practice pool seeding** | `npm run seed:synthetic` replaces the invented pool (500 by default), no model | Founder, command line | `server/src/db/seed-synthetic.ts:16` |
| **Fallback Home** | If 3D cannot run, Home becomes the plain clone chat, and sending out moves to the Matches tab | Everyone | `app/src/features/world/world-screen.tsx:378` |

Also present in the code but not visible anywhere: a "how well it knows you" score that the YOU tab fetches but
never draws (`server/src/memory/completion.ts:83`),
and a "voice" message source that the app never sends; "voice" in this app means the WhatsApp style import
(`shared/src/events.ts:31`).

---

## 14. What it does NOT do

Each line was checked against the code. "Mostly" means true with an exception, named in the last column.

| It does not… | Holds? | Evidence | Exception |
|---|---|---|---|
| **Train or fine-tune any model.** Every model is a stock vendor model. | Yes | `server/src/llm/caps.ts:87` | — |
| **Predict chemistry or compatibility.** No model judges the pair; a preference score is recorded but does not pick who is met; the date idea is refused if it uses words like "match", "compatible" or "chemistry". | Mostly | `server/src/matching/orchestrator.ts:168`, `server/src/matching/talk.ts:131` | A model does judge each **want** (met / not met), which moves people later. A switched-off option ([AI-14](#ai-14)) would store a hidden "would want a second evening" probability. |
| **Show a score or percentage** to a person. The card query does not even select the score columns. | Yes | `server/src/api/dating.ts:566` | Counts appear: "Confirmed by N people who met them", rounded pool sizes, the reviewer's Numbers page. |
| **Say yes for anyone.** Only a person's own tap decides; agent verdicts gate nothing. | Yes | `server/src/api/dating.ts:848`, `server/src/matching/orchestrator.ts:82` | Practice profiles can be switched to say yes automatically (off; a production server refuses to start with it on) (`server/src/env.ts:356`). |
| **Let a model write what others read about you.** Cards are written by code from your own words. | Mostly | `server/src/matching/brief.ts:4` | The date idea is model-written (and checked by code) (`server/src/matching/talk.ts:28`). |
| **Judge looks.** No photo is ever sent to a model; matching never uses photos. | Yes | `server/src/llm/port.ts:29`, `app/src/features/matches/reveal-screen.tsx:259` | — |
| **Show your photos or first name to anyone you have not said yes to.** The photo rule and the profile screen both test your own yes in that pair. | Yes | `server/migrations/0073_consent_first_reveal.sql:42`, `server/src/api/dating.ts:731` | Your 3D character, age, neighbourhood and shareable sentences are on the words card before any yes. |
| **Let strangers message you.** A message can only go to an introduced pair. | Yes | `server/migrations/0024_messages.sql:12` | — |
| **Tell anyone they were turned down.** Nothing is sent on a no. | In words, yes | `server/src/matching/orchestrator.ts:579` | The other person's card disappears early, which can give it away (Known gaps). |
| **Show you the other person's wants or rules.** Each card lists only its reader's wants. | Yes | `server/src/matching/orchestrator.ts:386` | — |
| **Hide anyone for a "Really want" or "Nice to have".** Only must-haves exclude. | Yes | `server/src/matching/candidates.ts:88` | — |
| **Match the same two people twice.** | Yes | `server/migrations/0022_rendezvous.sql:44` | They can still appear to each other as strangers in the town. |
| **Store your phone number** in the database. Only a keyed hash is kept. | Yes | `server/migrations/0045_phone_identity.sql:22` | In development, the console SMS sender writes full numbers to the server log. |
| **Track your location.** Location is read only when you tap "Use my location", never in the background. | Yes | `app/src/features/onboarding/essentials-screen.tsx:347` | For a city not on the list, the phone's position is stored rounded to about 1 km. |
| **Act on reports automatically.** A person reviews each one. | Yes | `server/migrations/0039_trust_and_safety.sql:21` | — |
| **Put a name or anybody's words on the lock screen.** Push notifications say only what kind of thing happened. | Yes | `server/src/push/index.ts:34` | Push reaches phones only after the founder's Expo setup (stage 9.5). |
| **Hold free conversations between agents.** | Yes, by default | `server/src/matching/rendezvous.ts:75` | The code exists behind a switch ([AI-13](#ai-13)). |

---

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
   (`server/src/sms.ts:51`).
2. **The code default is still on.** A new development setup whose `.env` lacks the line turns the
   old sign-in method back on; only a production server refuses it
   (`server/src/env.ts:199`,
   `server/src/env.ts:363`).

### 15.2 Private information that can reach another person

**Closed on 2026-09-28**, each with a test that fails when the rule is taken out: reveal tags come only
from facts the person made shareable, with no private-topic word; the name others see comes only from
the setup screen, never from chat; a want on a private topic shows one fixed line, never "Matches";
the message history answers only for an introduced pair nobody has blocked; "Send my agent over" no
longer checks your rules at the tap, so a card answer cannot be read off it for free; the town keeps a
first mover in the viewer's own neighbourhood until they share; and the extractor and recall read only
the person's own lines (stages 2, 3, 5, 6, 9 and AI-1). What remains:

3. **A "no" shows by timing.** A no removes the other person's card at once; an unanswered card lasts three days
    (`server/src/api/dating.ts:583`).
4. **"Matches" on a situation want can say how someone answered.** A want tied to a situation question ("a
    saver") shows "Matches" or "Doesn't match"; if it accepts one answer, that tells the reader the other
    person's answer, though situation answers are "never repeated to anybody"
    (`server/src/matching/want-questions.ts:113`,
    `shared/src/facts.ts:209`).
5. **The square itself can still be probed** (read, not run). Strangers in the square are people who pass your
    rules, so flipping a must-have and reopening the town shows whether a stranger you recognise by their character
    is still there; the sample is 40 nearest plus 24 recent and refreshes every 30 seconds
    (`server/src/api/world.ts:177`,
    `server/src/api/world.ts:94`).
6. **Word lists have gaps.** The private-topic list is finite ("family", "wedding", "Diwali" are not on it), and the
    talk and answer sheets also use "goal" and "dislikes" sentences, which the card's own rule leaves out as the place
    "where faith, politics and children are said in prose"
    (`server/src/matching/answer-sheet.ts:79`,
    `server/src/matching/brief.ts:81`).
7. **Deleting an account deletes reports against that person and both halves of their chats**
    (`server/migrations/0025_messaging_fixes.sql:100`).
    If deletion fails part way, the app still says "Nothing was removed."
    (`app/src/features/settings/settings-screen.tsx:138`).
8. **Promises that are broader than the code.** "Nobody else has ever seen what your clone knows about you." and
    "Only things marked public ever leave your account." sit beside the first name, age and city on the reveal,
    "Matches" on situation wants, the reviewer's want topics, and AI providers processing the text
    (`app/src/features/settings/settings-screen.tsx:297`).
9. **Latent:** the matchmaker role can read every profile summary, which is written from all facts including private
    ones; nothing reads it in a round today (`server/migrations/0028_matchmaker.sql:51`).
10. **AI providers** receive everything typed to the clone and every message's text (embeddings); the in-app notice
    names the chat providers but not the embedding provider, and its privacy links point to pages the server does not
    serve (`server/src/api/config.ts:51`).

### 15.3 Behaviour a person would not expect

**Closed on 2026-09-28**, each with a test that fails when the rule is taken out: a practice profile never
decides first (the one open card where a real person waited behind one was moved to them); distance is each person's own
limit, both ways; the practice pool no longer expires; setup calls no longer use the day's ten; and phones are
woken for a new card, a share, an introduction, a message and a card fading today (stages 6 and 9).

11. **Ten model calls a day** for chat, learning and rounds together (setup is counted apart since 2026-09-28).
    Somebody who chats a lot can leave no call for a round, which then fails with "Your agent has been out enough
    for today", and in chat the reason is never shown (`server/src/env.ts:331`,
    `app/src/lib/api.ts:361`).
12. **"Really want" and "Nice to have" do not change who a round meets**; the screen says they "move people up the
    list" (stage 5).
13. **A city not on the list keeps a person out of the pool** unless they tap "Use my location"; they are told "It does
    not know where you are." (`server/src/matching/profile.ts:152`).
14. **Someone who turns 18 this year is refused all year**, because only the birth year is asked
    (`shared/src/values.ts:118`).
15. **A mistyped invite code burns the sign-in ticket**; the retry says "That took too long. Ask for a new code.", and the
    invite screen has no back button (`server/src/api/auth.ts:194`).
16. **"Yes, that's right" can do more than agree.** A confirmed free phrase replaces a card answer with "unknown" (for
    example "socially" for drinking), and a confirmed city phrase without a map point takes the person out of the pool
    (`server/src/memory/pasteImport.ts:329`).
17. **Unconfirmed chat can still retire answers** on multi-answer fields such as who they want to meet or work field, with
    no Yes and no record (read, not run) (`server/src/memory/session.ts:142`).
18. **Rule clashes.** Two wants tied to the same question overwrite each other's rule; a must-have outlives its want
    sentence and cannot be deleted, only changed in strength (`server/src/matching/profile.ts:414`).
19. **Only one waiting card shows at a time.** Each card now wakes the phone when it arrives and the day it fades,
    but only after the founder's push setup; until then a second card can still run out unseen
    (`app/src/features/matches/matches-screen.tsx:322`).
20. **Check-in details.** "Not yet" is final; tapping Block from "Did you feel safe?" drops the unsafe answer; "Not sure"
    counts toward "Confirmed by N people" (`app/src/features/dm/checkin.tsx:77`,
    `server/migrations/0058_date_checkins.sql:67`).

### 15.4 Money and operations

21. Embeddings are not metered or priced; Gemini's thinking tokens are recorded but not priced; Gemini calls have no
    retry and no timeout; the per-session output cap is not enforced; the in-repo spend report (`npm run stats`)
    reads through a role that sees no rows, so it shows zero; a first-screen sentence is extracted twice
    (`server/src/llm/adapters/google.ts:31`,
    `server/src/db/stats.ts:5`).
22. **Documentation drift.** HOW-IT-WORKS.md, ARCHITECTURE.md, ENGINE-DECISION.md, both READMEs and several code
    comments describe older designs; the "Docs vs code" notes in each stage list the specific disagreements.

---

## 16. One-page summary

1. **Install.** Today the app is a development build installed from the founder's computer. It talks to a server on
   the founder's laptop through a public tunnel.
2. **Sign up.** You enter your phone number and a 6-digit code. A new number also needs an invite code from a member
   (each member has 3). Then you agree to three short documents: age, terms, privacy.
3. **Set up.** You write one true sentence about yourself. You answer 3 basics (who you are, who you want to meet, what
   you're here for) and 5 cards (kids, one person or open, smoking, drinking, food). Each card has a "who's fine for my
   partner" row. You add your first name, birth year, age range, city and distance. Faith, voice, a character and
   photos are optional.
4. **Ready.** When the basics, the five cards, birth year, city and consent are in and you are 18 or over, your agent
   can go out.
5. **Learning.** Nothing is trained. The app stores what you tap and type as facts. A model pulls facts out of your
   chats about 5 minutes after you stop. Anything it hears about a key answer (city, cards, work, exercise, sleep,
   moving) waits for your "Yes, that's right". Things learned in chat stay private until you tap "OK to share".
6. **Privacy.** Each fact is shareable, match-only or hidden. Nothing about kids, faith, drinking, smoking, food,
   politics or health is ever quoted to anyone. Neither are phone numbers, emails, handles, links or addresses. The
   database gives each part of the server only what it needs.
7. **Wants.** You write what you want and who you couldn't be with. If a want fits one of 12 questions, you tick the
   answers you'd accept. "Must have" hides people who answered differently, both ways. People who haven't answered
   still pass. Other wants are checked by a model against the other person's own sentences, or against their private
   card; a want on a private topic never shows how it came out.
8. **Sending out.** Tap "Send my agent out" (once a day) or send it to one person in the town (5 a day). Code finds
   people who pass every rule both ways. Real people come before practice profiles, and nobody is met twice. It picks
   up to three.
9. **The agents' exchange.** For each pair, one model call picks questions from a fixed list and points at each
   person's own sentences. It also writes one short date idea, which code checks. Free agent conversations exist but
   are switched off.
10. **The card.** Code writes a card for each person from real sentences: headline, what you share, their words, what
    the agents said, your wants checked, and a question to ask them. There is no score and no model-written text,
    except the date idea.
11. **Deciding.** Nobody's photos or name reach anyone until that person says yes to them. A real person always
    decides before a practice profile; between two real people, whoever has more open cards decides first, on the words and the other's character alone, with "Yes, share my profile with them". Then
    the other person sees that profile and answers "Yes, share mine back" or "Not for me". The server takes answers
    only in that order. Each turn lasts 3 days. A no is never announced. A card nobody answers expires.
12. **After both say yes.** Chat opens between the two people. Phones are woken for a new card, a share, an
    introduction, a message and a card fading today (once the founder's Expo push setup is done). Either can send the agents' date idea as a message,
    once. If nobody writes for 2 days, each gets one gentle nudge. After 3 days, each is asked privately whether they
    met, how it went, and whether they felt safe. Block and report are on every card and chat. A reviewer can ban a
    person's number and phone.
13. **Numbers.** The founder's page counts real people and how far their matches get. Another list shows which wants
    no question covers yet, as topic words, so the founder knows which questions to add.
14. **Biggest risks today.** Timing can still give away a no, "Matches" on a situation want can say how someone
    answered, and the town's strangers can be probed by changing your own rules. The development server's log holds
    phone numbers and sign-in codes. (Reveal tags, chat-heard names, private-want answers, the message history, the
    send-over probe, the town's neighbourhoods and the clone's own words were closed on 2026-09-28.)
