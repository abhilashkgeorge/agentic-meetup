## 2. Onboarding

Setup is a conversation with your clone (since 2026-10-04; before, it was a run of screens, each
with its own Next). The clone says hello and asks one thing at a time; the person answers under its
last message -- by typing, by tapping chips, on a card's two rows, or on the map -- and the answer
appears as their own bubble. Only a few answers are **required**: the three basics, the five cards,
birth year, city, and consent. Everything else is optional and can come later. When the required
answers are in, the person is **"in the pool"**: their agent can be sent out and others can meet it.

What the clone says in setup is written down, not generated, and every answer is saved by the call the
old screens made: the chat adds no model call
([app/src/features/onboarding/setup-script.ts:16] `the clone says here is written down below, not generated: setup costs no model call`,
[app/src/app/onboarding/index.tsx:5] `export { default } from '../../features/onboarding/setup-chat';`).

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| "Tell me one true thing about yourself" (one sentence) | Facts are pulled out of it; the clone then answers a question as the person | AI ({AI:extract}, then {AI:selftest}) | An episode (the words) and facts | The person; public facts can later reach others (stage 4) | [server/src/api/tell.ts:73] `out = await metered(ctx, 'extract', () => extractSessionFacts(` |
| The questions: basics, five cards, faith, one sentence | Each tap is saved; card "who's fine" rows become hard rules | Code (the sentence also goes to {AI:dealbreaker}) | `question_answers`, facts, `preferences` | The person; rules are used by matching | [server/src/api/interview.ts:276] `INSERT INTO question_answers (tenant_id, user_id, question_id, answer, skipped)` |
| Essentials: first name, birth year, age range, city, distance | Saved; city becomes a map point | Code | Facts, match profile | The person; age and area appear on cards | [server/src/api/dating.ts:383] `extractorModel: 'direct',` |
| How you write (optional): a WhatsApp export | Only the person's own lines are read; a style note is written | AI ({AI:voice}) | A "voice" note; the chat itself is not kept | The person's own clone | [server/src/memory/chatImport.ts:127] `VALUES ($1,$2,'voice',$3,$4,$5,'{}', now())` |
| "Is that you?" (after the one true thing) | The clone writes as the person; they grade it | AI ({AI:selftest}) | Grades | The person | [server/src/api/selftest.ts:44] `metered(ctx, 'render_profile', () => nextSelfTest(db, ctx), { db, setup: true }));` |
| Character, photos (optional) | A 3D look; up to six photos | Code | Look, photos (location data removed) | Look: everyone in the town; photos: stage 9 | [app/src/features/onboarding/photos-step.tsx:187] `Nobody sees these until you share your profile with them. Your agent never does,` |

### Arjun and Meera

The conversation is the same for both; only their answers differ. Arjun taps "A man" on
"You are…" and "Women" on "You want to meet…"; Meera taps "A woman" and "Men"
([server/src/onboarding/questions.ts:146] `{ value: 'woman', label: 'A woman' }, { value: 'man', label: 'A man' },`,
[server/src/onboarding/questions.ts:155] `{ value: 'woman', label: 'Women' }, { value: 'man', label: 'Men' },`).
In order, each reads and answers:

1. **The hello** — "Hi! I'm your clone.", what it is for, and "Let's start with you. Tell me one
   true thing about yourself. Anything.", with three example lines to tap
   ([app/src/features/onboarding/setup-script.ts:42] `"Hi! I'm your clone.",`,
   [app/src/features/onboarding/setup-script.ts:44] `"Let's start with you. Tell me one true thing about yourself. Anything.",`,
   [app/src/features/onboarding/setup-script.ts:62] `'I live in Bangalore and I work at an ISP.',`).
   Arjun types "I work in AI and run most mornings." His work field and exercise are fields a
   must-have can depend on, so both facts are **held for his Yes** rather than learned
   ([server/src/api/tell.ts:90] `if (r.outcome === 'staged') staged++;`).
2. **What it heard**, in the person's words ("Got it: trekking, maths teacher."), and "I'll check a
   couple of things with you as we go." when something was held
   ([app/src/features/onboarding/setup-script.ts:71] `const heard = r.facts.slice(0, 3).map((f) => f.value).filter(Boolean);`,
   [app/src/features/onboarding/setup-script.ts:75] `if ((r.toConfirm ?? 0) > 0) out.push("I'll check a couple of things with you as we go.");`).
   It asks again only when nothing at all was heard.
3. **"Is that you?"** (only when something was learned; Arjun's sentence skips it, since the clone has
   nothing live to answer from) — "Here's how I'd answer someone already, as you:", the question, its
   reply in his name, and "That's me" / "Not even close"
   ([app/src/features/onboarding/start-state.ts:24] `if ((r.toConfirm ?? 0) > 0) return { next: 'questions' };`,
   [app/src/features/onboarding/setup-chat.tsx:283] `await say([SAMPLE_INTRO, item.question,`).
4. **The questions**, each one a message (below): a basic is one tap; a card shows "You" and "Your
   partner" rows and sends nothing until both are answered; the faith card can be skipped; the
   sentence is typed. Send and Skip stay on screen under the chips, which scroll
   ([app/src/features/onboarding/setup-chat.tsx:555] `// One tap is the answer, as on the old screen.`,
   [app/src/features/onboarding/setup-chat.tsx:528] `<Button label="Send" variant="primary" disabled={!done} loading={busy}`,
   [app/src/features/onboarding/setup-chat.tsx:712] `{area.actions}`).
5. **The essentials**, in the chat: "Thanks. Now the basics I need to go out for you.", then "What
   should people call you?", "What year were you born?", "Who would you like to meet?" (ages,
   pre-filled ±5 from their own), "Where are you now?" (typed, or "Use my location") and "How far would
   you travel?" -- the map and its slider, inside the chat
   ([app/src/features/onboarding/setup-script.ts:120] `export const ESSENTIALS_INTRO = 'Thanks. Now the basics I need to go out for you.';`,
   [app/src/features/profile/fields.ts:78] `{ key: 'birth_date', title: 'What year were you born?', kind: 'number',`,
   [app/src/features/profile/age-range.ts:42] `return { min: clamp(age - AGE_SPREAD), max: clamp(age + AGE_SPREAD) };`,
   [app/src/features/onboarding/setup-chat.tsx:587] `{field.kind === 'distance' && <DistanceStep detect onChange={setDistance} />}`).
   Both type "Bangalore", which resolves to the city centre.
6. **Stories** — "That's enough for me to go out for you. Now, if you like, a few stories: they are
   what I'll have to talk about." Up to three, each skippable, or "That's enough for now"
   ([app/src/features/onboarding/setup-script.ts:142] `export const STORIES_INTRO = "That's enough for me to go out for you.`,
   [app/src/features/onboarding/setup-script.ts:143] `export const STORIES_MAX = 3;`).
7. **How you write** — "Want me to sound like you, not just know about you?" "Share a chat" opens the
   WhatsApp import, which comes back to the chat after its note or a skip
   ([app/src/features/onboarding/setup-script.ts:150] `'Want me to sound like you, not just know about you?',`,
   [app/src/features/onboarding/voice-screen.tsx:111] `? <Button label="Back to the chat" variant="primary" onPress={() => router.back()} />`).
8. **Character** and **photos**, each opened from the chat on a tap and back to it, or "Skip for now".
   What happened there is said as it was: "Done", "2 photos", or "Later" for a skip
   ([app/src/features/onboarding/setup-chat.tsx:241] `add('me', takeVoiceLearned() ? 'Done' : 'Later');`,
   [app/src/features/onboarding/photos-step.tsx:105] `if (from === 'chat') { router.back(); return; }`).
9. **"All set, Arjun. I'll go out and meet people for you."**, then how to keep it up to date: "Talk
   to me any time from the town (tap "Your clone")..." and "Go to the town"
   ([app/src/features/onboarding/setup-script.ts:161] `'Talk to me any time from the town (tap "Your clone").`,
   [app/src/features/onboarding/setup-chat.tsx:671] `<Button label={fromFinish ? 'Back' : 'Go to the town'}`).
10. **Home**, the town, with "Send my agent out".

### 2.1 The conversation in order

For a new person: one true thing → (is that you?) → the questions → the essentials → stories → how
you write → character → photos → done
([app/src/features/onboarding/setup-script.ts:179] `case 'essentials': return finish ? 'done' : 'stories';`,
[app/src/features/onboarding/setup-script.ts:180] `case 'stories': return 'voice';`).
Only the essentials still missing are asked, so someone already in the pool when the questions end goes
straight to the stories. Until 2026-10-02 a new person never saw the stories during setup -- and they
are the only sentences an agent may repeat when it meets another, so the first two new people's agents
had nothing at all to say.
"Setup done" is remembered on the phone only at "Go to the town"
([app/src/features/onboarding/setup-chat.tsx:438] `await setOnboarded();`). Closing the app earlier
and opening it again carries on: "Welcome back. Let's carry on where we were.", and on with the
questions; nothing answered is asked again
([app/src/features/onboarding/setup-script.ts:49] `"Welcome back. Let's carry on where we were.",`,
[app/src/features/onboarding/setup-chat.tsx:222] `if (known && known.knows.length > 0) {`).
**"Finish setup"** (an agent that cannot go out yet, or "Which part of town?" and "Add your first name"
on the Home) opens the same chat: it starts at the questions, asks only what is still open, and ends
after the essentials with "That's everything. Thank you."
([app/src/features/profile/fields.ts:208] `return '/onboarding' as const;`,
[app/src/features/onboarding/setup-script.ts:189] `export const firstStage = (finish: boolean): Stage => (finish ? 'questions' : 'tell');`).
The old screens are still used outside setup: the question of the day opens the interview, the
"Faith (optional)" row on the You tab opens it to ask that card, and Settings opens the self-test
([app/src/features/question/question-screen.tsx:95] `router.replace({ pathname: '/onboarding/interview', params: { card: q.card!.id, qotd: q.id } })`,
[app/src/features/settings/settings-screen.tsx:263] `onPress={() => router.push('/onboarding/test')} last />`).

### 2.2 Every question

**Basics** (required, cannot be skipped)
([server/src/onboarding/questions.ts:356] `export const GATING = ['q-gender', 'q-seeking', 'q-intent'];`):

| Question | Answers |
|---|---|
| "You are…" | A woman, A man, Nonbinary, Something else |
| "You want to meet…" (several) | Women, Men, Nonbinary people |
| "What are you here for?" | Something long-term, Marriage, Company, Something casual, Still working it out |

The app's setup and the profile ask the last one in the same words and read the answer back in
them (since 2026-10-03; before, they asked "What are you after?" with "Casual" and "Still
deciding").

Sources: [server/src/onboarding/questions.ts:144] `text: 'You are…',`,
[server/src/onboarding/questions.ts:153] `text: 'You want to meet…',`,
[shared/src/values.ts:42] `export const INTENT_QUESTION = 'What are you here for?';`.

**The five cards** (the fixed "set" questions; required, but "Prefer not to say" counts as an
answer). Since 2026-10-01 somebody here for something casual or for company gets four: the
kids card is never asked of them and does not hold them back (before, everybody was asked
"Do you want children?" and could not go out without it)
([server/src/onboarding/questions.ts:382] `export const NO_KIDS_CARD: readonly string[] = ['casual', 'companionship'];`) ([server/src/onboarding/questions.ts:368] `['card-kids', 'card-monogamy', 'card-smoking', 'card-drinking', 'card-food']`).
Each card has two rows: **You** (your answer) and **Your partner** ("Tap every one that is okay.
People who have not said still pass."), with "All are okay" and nothing pre-ticked
([app/src/features/onboarding/interview-screen.tsx:376] `Tap every one that is okay. People who have not said still pass.`,
[app/src/features/onboarding/interview-screen.tsx:380] `label="All are okay"`):

| Card | You | Your partner | Answers |
|---|---|---|---|
| Kids | "Do you want children?" | "Which are okay for your partner?" | Want kids; Don't want kids; Not sure yet; Have kids, want more; Have kids, done |
| One person or open | "One person, or open?" | "Which are okay for your partner?" | One person; Open; Either could work |
| Smoking | "Do you smoke?" | "How much can your partner smoke?" | Never, Rarely, Sometimes, Often, Every day |
| Drinking | "Do you drink?" | "How much can your partner drink?" | same five |
| Food | "How do you eat?" | "How can your partner eat?" | Everything, No beef, No pork, Fish no meat, Vegetarian, Vegan |

Sources: [server/src/onboarding/questions.ts:172] `'Kids', 'Do you want children?', 'Which are okay for your partner?'`,
[server/src/onboarding/questions.ts:176] `card('card-monogamy', 'monogamy_stance', 'One person or open', 'One person, or open?'`,
[server/src/onboarding/questions.ts:179] `'Smoking', 'Do you smoke?', 'How much can your partner smoke?'`,
[server/src/onboarding/questions.ts:180] `'Drinking', 'Do you drink?', 'How much can your partner drink?'`,
[server/src/onboarding/questions.ts:181] `card('card-food', 'diet', 'Food', 'How do you eat?', 'How can your partner eat?', DIETS, {`.
Ticking only some partner answers stores **one hard rule** (a must-have) on that card; "All are
okay" stores none ([server/src/api/interview.ts:531] `strength: 'dealbreaker',`).

**Faith** (optional, can be skipped whole): "What is your faith?" with eleven answers (Hindu,
Muslim, Christian, Sikh, Jain, Buddhist, Jewish, Zoroastrian, "Spiritual, not religious", "Not
religious", "Something else") and "Optional. Nobody ever sees your answer. It is only used to check
who fits, both ways." ([server/src/onboarding/questions.ts:193] `'Faith', 'What is your faith?', 'Which are okay for your partner?'`,
[server/src/onboarding/questions.ts:199] `why: 'Optional. Nobody ever sees your answer. It is only used to check who fits, both ways.',`).

**"Couldn't be with"** (optional): "Anyone else you couldn't be with?" — "Be blunt. If it matches one
of your cards, you'll see the change and decide. If not, you'll spot it in the first chat."
([server/src/onboarding/questions.ts:217] `text: 'Anyone else you couldn\'t be with?',`). The sentence is
kept as a want (stage 5). A model may read it as a change to one card's partner row, shown as
"Change this card?" with "Keep this" / "Leave it"; nothing changes unless the person keeps it
([app/src/features/onboarding/interview-screen.tsx:188] `Your agent read your answer as this. Nothing changes unless you keep it.`).

**Optional profile questions**, asked only once the person is already in the pool, one at a time,
with "Skip this one" and "That's enough for now": "How often do you move your body?", "How much does
religion matter to you?", "How much does politics matter to you?", "How far did you get with
school?", "What field are you in?", "Any field you would especially like them to be in?", "Early or
late?", "Money — how do you think about it?", "What do you actually watch?", "How do you get
around?", "Would you move cities for the right person?"
([server/src/api/interview.ts:125] `const candidates = state.profile.inPool`,
[server/src/onboarding/questions.ts:229] `text: 'How often do you move your body?',`,
[server/src/onboarding/questions.ts:256] `text: 'What field are you in?',`,
[server/src/onboarding/questions.ts:309] `text: 'Would you move cities for the right person?',`).

**Situation questions** (8): never asked during setup. They arrive only as a question of the day
when someone else's want needs the answer (stages 3 and 5)
([server/src/onboarding/next-question.ts:120] `if (q.tier === 'situation') return false;`).

**Essentials** (the setup wizard): "What should people call you?" (asked first; "Just your first
name." and "People see it only after you share your profile with them."), "What year were you
born?", "Who would you like to meet?" (age range), "Where are you now?" ("Your city is enough. Nobody
sees your exact location."), "How far would you travel?" -- since 2026-10-01 a map (before, five
chips: 10, 25, 50, 200 km, Anywhere): the person's place at the centre, a circle for the
distance that stays one size while the map zooms, a slider from 1 to 200 km (25 km to start),
"Anywhere" for no limit, "Use my location", and a way to stand somewhere else -- search a city or
a part of Bengaluru (on a page of its own, so the keyboard never hides the results), or drag the map, and the centre lands on the nearest named place. Moving the
circle moves where the person is matched from, both ways ("move you there", the founder's choice);
a neighbourhood is saved as the city plus the area, so nothing finer than a neighbourhood is
ever stored. In setup it starts on the person's neighbourhood when the pool has only their city
and the phone already allows location (no dialog appears unasked). The map's pictures are
OpenStreetMap's, fetched by our server and kept there, so the map provider never sees a person.
The same map is the "How far you'd go" row on the You tab, and the top of that tab says where the
person lives with the part of town first -- "Indiranagar, Bangalore" -- once one is saved (since
2026-10-03; before, the city alone) ([app/src/features/profile/fields.ts:63] `export function placeLine(city: string | null | undefined, area: string | null | undefined): string | undefined {`).
Only the first name and distance can be declined here
([app/src/features/profile/fields.ts:74] `{ key: 'first_name', title: 'What should people call you?', kind: 'text', essential: true,`,
[app/src/features/profile/fields.ts:77] `note: 'People see it only after you share your profile with them.' },`,
([app/src/features/profile/fields.ts:97] `hint: 'Your city is enough. Nobody sees your exact location.' },`,
[app/src/features/profile/fields.ts:107] `{ key: 'max_distance_km', title: 'How far would you travel?', kind: 'distance', essential: true,`,
[app/src/features/distance/geo.ts:188] `export function placeWrites(from: Spot | null, to: Spot): { predicate: 'lives_in' | 'area'; value: string; fix?: Spot['fix'] }[] {`,
[server/src/api/tiles.ts:23] `const TILE_URL = env.TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';`).
A city among 46 listed ones becomes that city's centre; an unlisted city becomes a point only if
"Use my location" was used ([shared/src/places.ts:36] `export const PLACES: readonly Place[] = [`,
[server/src/api/dating.ts:108] `if (place) return { city: place.city, lat: place.lat, lon: place.lon, precision_km: 20 };`).

**Wants** are not asked on their own during setup. "What would you love in someone?" is on the Stories
screen, which setup shows after the self-test (optional, like every story there), and "What you're
looking for" is reached from the You tab or Settings (stage 5)
([app/src/features/settings/settings-screen.tsx:261] `<Row title="What you're looking for" onPress={() => router.push('/preferences')} />`).

**The name others see comes only from that screen** (since 2026-09-28). One word of letters is kept
(a number or an "@" gets "Just your first name, in letters."); the fact store refuses a first name
from any other writer, so a name said in chat never becomes it; and without one the other person sees
"Someone" ([server/src/api/dating.ts:303] `return c.json({ error: 'bad_name', message: 'Just your first name, in letters.' }, 400);`,
[server/src/memory/facts.ts:131] `if (SCREEN_ONLY.has(cand.predicate) && cand.extractorModel !== 'direct') {`,
[server/src/matching/profile.ts:76] `if (f.extractor_model === 'direct') displayName = firstName(f.object_text);`,
[server/src/api/dating.ts:167] `const name = other.display_name ?? 'Someone';`). People who set up
before the step existed are asked on the Home ("Add your first name") and can set it on the You tab
("First name") ([app/src/features/world/town-bar.ts:19] `if (wants.askName) return { label: 'Add your first name', onPress: go.name };`,
[app/src/features/profile/profile-screen.tsx:267] `<Row title="First name" value={name ?? 'Not set'}`).

### 2.3 Required vs optional, and "ready to send"

The server recomputes readiness on every profile rebuild. A person is **in the pool** when all of
these hold ([server/src/matching/profile.ts:209] `const inPool = missing.length === 0 && adult;`,
[shared/src/values.ts:123] `export const POOL_REQUIRED = [`):

- gender, who they want to meet, birth year, city **with a map point**, and what they are here for,
  each from a confirmed (not held) fact ([server/src/matching/profile.ts:45] `WHERE f.user_id = $1 AND f.status = 'active' AND f.valid_to IS NULL`,
  [server/src/matching/profile.ts:152] `if (p === 'lives_in') return lat === null;`);
- an answer (or "prefer not to say") on each of the five cards -- four, without kids, for
  somebody here for something casual or for company
  ([server/src/matching/profile.ts:180] `for (const k of coreCardsFor(intent)) if (!done.has(k.id)) missing.push(k.predicate);`);
- all three consent documents ([server/src/matching/profile.ts:207] `if (!agreed) missing.push('consent');`);
- age 18 or over, computed from the birth year alone ([server/src/matching/profile.ts:192] `const adult = age !== null && age >= MIN_AGE;`).

Not required: photos, a name, age range, distance, neighbourhood, faith, the sentence, stories,
voice, self-test, character. The self-test's "It's ready. It can go out and meet people for you."
is a separate notion and gates nothing ([app/src/features/onboarding/self-test-screen.tsx:159] `It's ready. It can go out and meet people for you.`).

**When someone is not ready:** the Home's big button reads "Finish setup" and the status line names the
first missing item ("Your birth year", "Where you live"...); the Matches tab says "Your agent is still
inside — It needs a few more things before it can talk to anyone."; a refused send says "Your agent
needs a few more answers before it can go out."
([app/src/features/world/hud.tsx:219] `<Button label="Finish setup" variant="primary" onPress={onFinishSetup} />`,
[app/src/features/matches/matches-screen.tsx:267] `It needs a few more things before it can talk to anyone.`).

### 2.4 Model calls during setup

The one true thing already calls a model (fact extraction, then a sample reply); so do the paste, the
"couldn't be with" sentence, the WhatsApp import, each self-test and each story written in the setup
chat (read for anything else it says). The clone's own lines in the setup chat call none. Since 2026-09-28 these setup calls
are counted apart, up to 40 a day, and never use the 10 a day that chat, learning and rounds share;
the $2.00 daily cost cap still covers them. Measured before the change: real people's setup used 1 to
4 of the 10 on their first day ([server/src/api/tell.ts:76] `), { setup: true });`,
[server/src/metering.ts:73] `if (row.setup_used >= env.SETUP_CALLS_PER_DAY) {`,
[server/src/memory/selftest.ts:24] `export const TEST_SIZE = 5;`).

### Docs vs code

- HOW-IT-WORKS.md §2 gives the flow as screens, `start → interview → (essentials → voice → self-test) →
  character → photos → home`, skipping the middle only after a paste. Since 2026-10-04 setup is one
  conversation in which the paste is not offered (it is on the You tab, "Write them"); the chat asks only
  the essentials still missing, and a paste can never put a new person in the pool, because pasted
  facts are held until confirmed ([HOW-IT-WORKS.md:63] `start → interview → (essentials → voice → self-test) → character → photos → home`,
  [server/src/memory/pasteImport.ts:203] `originClass: 'untrusted',`).
- HOW-IT-WORKS.md §2a describes the partner row as "Anyone is fine" or "Let me choose". The screen shows
  "All are okay" and every answer, unticked ([HOW-IT-WORKS.md:82] `one explicit tap -- "Anyone is fine" or "Let me choose".`).
- HOW-IT-WORKS.md §2b says "which part of town" is asked in setup; it is not asked until the person has
  a map point ([server/src/matching/profile.ts:360] `if (!p || p.lat === null || p.lon === null) return false;`).
- HOW-IT-WORKS.md §2c calls the voice step free paragraphs "extracted into facts"; it is a WhatsApp
  import that writes a style note, not facts ([HOW-IT-WORKS.md:150] `free paragraphs, extracted into facts.`).
- The location code and the phone's permission text say only the city is kept. For an unlisted city,
  "Use my location" stores the phone's position rounded to about 1 km
  ([app/app.json:52] `Only the city is kept — never your exact position, and never in the background.`,
  [app/src/lib/location.ts:72] `lat: coarse(fix.coords.latitude),`).
