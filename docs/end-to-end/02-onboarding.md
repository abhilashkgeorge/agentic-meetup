## 2. Onboarding

Setup is a short run of screens. Only a few answers are **required**: the three basics, the five
cards, birth year, city, and consent. Everything else is optional and can come later. When the
required answers are in, the person is **"in the pool"**: their agent can be sent out and others
can meet it.

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| "Tell it one true thing" (one sentence) | Facts are pulled out of it; the clone then answers a question as the person | AI ({AI:extract}, then {AI:selftest}) | An episode (the words) and facts | The person; public facts can later reach others (stage 4) | [server/src/api/tell.ts:73] `out = await metered(ctx, 'extract', () => extractSessionFacts(` |
| The interview: basics, five cards, faith, one sentence | Each tap is saved; card "who's fine" rows become hard rules | Code (the sentence also goes to {AI:dealbreaker}) | `question_answers`, facts, `preferences` | The person; rules are used by matching | [server/src/api/interview.ts:276] `INSERT INTO question_answers (tenant_id, user_id, question_id, answer, skipped)` |
| Essentials: birth year, age range, city, distance | Saved; city becomes a map point | Code | Facts, match profile | The person; age and area appear on cards | [server/src/api/dating.ts:376] `extractorModel: 'direct',` |
| Voice (optional): a WhatsApp export | Only the person's own lines are read; a style note is written | AI ({AI:voice}) | A "voice" note; the chat itself is not kept | The person's own clone | [server/src/memory/chatImport.ts:127] `VALUES ($1,$2,'voice',$3,$4,$5,'{}', now())` |
| Self-test (optional) | The clone writes as the person; they grade it | AI ({AI:selftest}) | Grades | The person | [server/src/api/selftest.ts:44] `metered(ctx, 'render_profile', () => nextSelfTest(db, ctx), { db, setup: true }));` |
| Character, photos (optional) | A 3D look; up to six photos | Code | Look, photos (location data removed) | Look: everyone in the town; photos: stage 9 | [app/src/features/onboarding/photos-step.tsx:168] `Nobody sees these until you share your profile with them. Your agent never does,` |

### Arjun and Meera

The screens and questions are the same for both; only their taps differ. Arjun taps "A man" on
"You are…" and "Women" on "You want to meet…"; Meera taps "A woman" and "Men"
([server/src/onboarding/questions.ts:144] `{ value: 'woman', label: 'A woman' }, { value: 'man', label: 'A man' },`,
[server/src/onboarding/questions.ts:153] `{ value: 'woman', label: 'Women' }, { value: 'man', label: 'Men' },`).
In order, each sees:

1. **"Tell it one true thing"** — "Anything about you. One sentence is enough to start." Arjun types
   "I work in AI and run most mornings."
   ([app/src/features/onboarding/start-screen.tsx:140] `Tell it one true thing`).
   His work field and exercise are fields a must-have can depend on, so both facts are
   **held for his Yes** rather than learned ([server/src/api/tell.ts:90] `if (r.outcome === 'staged') staged++;`).
   Anything heard moves him on: with only held facts the screen skips the sample reply (the
   clone has nothing live to answer from) and goes straight to the questions
   ([app/src/features/onboarding/start-state.ts:24] `if ((r.toConfirm ?? 0) > 0) return { next: 'questions' };`,
   [app/src/features/onboarding/start-screen.tsx:47] `if (after.next === 'questions') return setStage('done');`).
   It asks again only when nothing at all was heard.
2. **"Now it's you"** (only when something was learned; Arjun's sentence skips it) — "Someone asks
   you", the clone's first reply in his name, "Is that you?", "That's me" / "Not even close"
   ([app/src/features/onboarding/start-screen.tsx:87] `label="Someone asks you"`).
3. **"Now it asks you some things"**, with an optional "Paste from another AI"
   ([app/src/features/onboarding/start-screen.tsx:106] `Now it asks you some things`,
   [app/src/features/onboarding/start-screen.tsx:122] `label="Paste from another AI"`).
4. **The interview** (below).
5. **"A few things missing"**, because birth year and city are asked next
   ([app/src/features/onboarding/interview-screen.tsx:233] `{state.ready ? "That's enough to start" : 'A few things missing'}`).
6. **Essentials**: "What year were you born?", "Who would you like to meet?" (ages, pre-filled ±5 from
   their own), "Where are you now?", "How far would you travel?"
   ([app/src/features/profile/fields.ts:63] `{ key: 'birth_date', title: 'What year were you born?', kind: 'number',`,
   [app/src/features/profile/age-range.ts:42] `return { min: clamp(age - AGE_SPREAD), max: clamp(age + AGE_SPREAD) };`).
   Both type "Bangalore", which resolves to the city centre.
7. **"Now, how you talk"** (voice), **"Is this you?"** (self-test), **"Make your character"**, **"One
   last thing"** (photos) — all skippable
   ([app/src/features/onboarding/voice-screen.tsx:162] `label="Skip this for now"`,
   [app/src/features/onboarding/photos-step.tsx:114] `label="I'll do it later"`).
8. **Home**, the town, with "Send my agent out".

### 2.1 The screens in order

For a new person: start → (optional paste) → interview → essentials → voice → self-test →
character → photos → Home ([app/src/features/onboarding/interview-screen.tsx:214] `router.replace(state.ready ? '/onboarding/stories' : '/onboarding/essentials');`,
[app/src/features/onboarding/essentials-screen.tsx:73] `router.push('/onboarding/voice');`,
[app/src/features/onboarding/character-step.tsx:23] `const next = () => router.replace('/onboarding/photos');`).
The Stories screen is shown only when someone is already in the pool when the interview ends, so a
new person does not see it during setup; it is reached later from the You tab.
"Setup done" is remembered on the phone only after the photos step; closing the app earlier
restarts setup at the first screen ([app/src/features/onboarding/photos-step.tsx:95] `await setOnboarded();`).

### 2.2 Every question

**Basics** (required, cannot be skipped)
([server/src/onboarding/questions.ts:359] `export const GATING = ['q-gender', 'q-seeking', 'q-intent'];`):

| Question | Answers |
|---|---|
| "You are…" | A woman, A man, Nonbinary, Something else |
| "You want to meet…" (several) | Women, Men, Nonbinary people |
| "What are you here for?" | Something long-term, Marriage, Company, Something casual, Still working it out |

Sources: [server/src/onboarding/questions.ts:142] `text: 'You are…',`,
[server/src/onboarding/questions.ts:151] `text: 'You want to meet…',`,
[server/src/onboarding/questions.ts:159] `text: 'What are you here for?',`.

**The five cards** (the fixed "set" questions; required, but "Prefer not to say" counts as an
answer) ([server/src/onboarding/questions.ts:371] `['card-kids', 'card-monogamy', 'card-smoking', 'card-drinking', 'card-food']`).
Each card has two rows: **You** (your answer) and **Your partner** ("Tap every one that is okay.
People who have not said still pass."), with "All are okay" and nothing pre-ticked
([app/src/features/onboarding/interview-screen.tsx:359] `Tap every one that is okay. People who have not said still pass.`,
[app/src/features/onboarding/interview-screen.tsx:363] `label="All are okay"`):

| Card | You | Your partner | Answers |
|---|---|---|---|
| Kids | "Do you want children?" | "Which are okay for your partner?" | Want kids; Don't want kids; Not sure yet; Have kids, want more; Have kids, done |
| One person or open | "One person, or open?" | "Which are okay for your partner?" | One person; Open; Either could work |
| Smoking | "Do you smoke?" | "How much can your partner smoke?" | Never, Rarely, Sometimes, Often, Every day |
| Drinking | "Do you drink?" | "How much can your partner drink?" | same five |
| Food | "How do you eat?" | "How can your partner eat?" | Everything, No beef, No pork, Fish no meat, Vegetarian, Vegan |

Sources: [server/src/onboarding/questions.ts:175] `'Kids', 'Do you want children?', 'Which are okay for your partner?'`,
[server/src/onboarding/questions.ts:179] `card('card-monogamy', 'monogamy_stance', 'One person or open', 'One person, or open?'`,
[server/src/onboarding/questions.ts:182] `'Smoking', 'Do you smoke?', 'How much can your partner smoke?'`,
[server/src/onboarding/questions.ts:183] `'Drinking', 'Do you drink?', 'How much can your partner drink?'`,
[server/src/onboarding/questions.ts:184] `card('card-food', 'diet', 'Food', 'How do you eat?', 'How can your partner eat?', DIETS, {`.
Ticking only some partner answers stores **one hard rule** (a must-have) on that card; "All are
okay" stores none ([server/src/api/interview.ts:531] `strength: 'dealbreaker',`).

**Faith** (optional, can be skipped whole): "What is your faith?" with eleven answers (Hindu,
Muslim, Christian, Sikh, Jain, Buddhist, Jewish, Zoroastrian, "Spiritual, not religious", "Not
religious", "Something else") and "Optional. Nobody ever sees your answer. It is only used to check
who fits, both ways." ([server/src/onboarding/questions.ts:196] `'Faith', 'What is your faith?', 'Which are okay for your partner?'`,
[server/src/onboarding/questions.ts:202] `why: 'Optional. Nobody ever sees your answer. It is only used to check who fits, both ways.',`).

**"Couldn't be with"** (optional): "Anyone else you couldn't be with?" — "Be blunt. If it matches one
of your cards, you'll see the change and decide. If not, you'll spot it in the first chat."
([server/src/onboarding/questions.ts:220] `text: 'Anyone else you couldn\'t be with?',`). The sentence is
kept as a want (stage 5). A model may read it as a change to one card's partner row, shown as
"Change this card?" with "Keep this" / "Leave it"; nothing changes unless the person keeps it
([app/src/features/onboarding/interview-screen.tsx:157] `Your agent read your answer as this. Nothing changes unless you keep it.`).

**Optional profile questions**, asked only once the person is already in the pool, one at a time,
with "Skip this one" and "That's enough for now": "How often do you move your body?", "How much does
religion matter to you?", "How much does politics matter to you?", "How far did you get with
school?", "What field are you in?", "Any field you would especially like them to be in?", "Early or
late?", "Money — how do you think about it?", "What do you actually watch?", "How do you get
around?", "Would you move cities for the right person?"
([server/src/api/interview.ts:125] `const candidates = state.profile.inPool`,
[server/src/onboarding/questions.ts:232] `text: 'How often do you move your body?',`,
[server/src/onboarding/questions.ts:259] `text: 'What field are you in?',`,
[server/src/onboarding/questions.ts:312] `text: 'Would you move cities for the right person?',`).

**Situation questions** (8): never asked during setup. They arrive only as a question of the day
when someone else's want needs the answer (stages 3 and 5)
([server/src/onboarding/next-question.ts:113] `if (q.tier === 'situation') return false;`).

**Essentials** (the setup wizard): "What should people call you?" (asked first; "Just your first
name." and "People see it only after you share your profile with them."), "What year were you
born?", "Who would you like to meet?" (age range), "Where are you now?" ("Your city is enough. Nobody
sees your exact location."), "How far would you travel?" (10 km, 25 km, 50 km, 200 km, Anywhere).
Only the first name and distance can be declined here
([app/src/features/profile/fields.ts:59] `{ key: 'first_name', title: 'What should people call you?', kind: 'text', essential: true,`,
[app/src/features/profile/fields.ts:62] `note: 'People see it only after you share your profile with them.' },`,
([app/src/features/profile/fields.ts:82] `hint: 'Your city is enough. Nobody sees your exact location.' },`,
[app/src/features/profile/fields.ts:94] `{ value: '20000', label: 'Anywhere' },`).
A city among 46 listed ones becomes that city's centre; an unlisted city becomes a point only if
"Use my location" was used ([shared/src/places.ts:36] `export const PLACES: readonly Place[] = [`,
[server/src/api/dating.ts:107] `if (place) return { city: place.city, lat: place.lat, lon: place.lon, precision_km: 20 };`).

**Wants** are not asked during setup. "What would you love in someone?" is on the Stories screen and
"What you're looking for" is reached from the You tab or Settings (stage 5)
([app/src/features/settings/settings-screen.tsx:243] `<Row title="What you're looking for" onPress={() => router.push('/preferences')} />`).

**The name others see comes only from that screen** (since 2026-09-28). One word of letters is kept
(a number or an "@" gets "Just your first name, in letters."); the fact store refuses a first name
from any other writer, so a name said in chat never becomes it; and without one the other person sees
"Someone" ([server/src/api/dating.ts:296] `return c.json({ error: 'bad_name', message: 'Just your first name, in letters.' }, 400);`,
[server/src/memory/facts.ts:103] `if (SCREEN_ONLY.has(cand.predicate) && cand.extractorModel !== 'direct') {`,
[server/src/matching/profile.ts:76] `if (f.extractor_model === 'direct') displayName = firstName(f.object_text);`,
[server/src/api/dating.ts:166] `const name = other.display_name ?? 'Someone';`). People who set up
before the step existed are asked on the Home ("Add your first name") and can set it on the You tab
("First name") ([app/src/features/world/hud.tsx:173] `{askName && <Chip label="Add your first name" selected={false} onPress={onName} />}`,
[app/src/features/profile/profile-screen.tsx:232] `<Row title="First name" value={name ?? 'Not set'}`).

### 2.3 Required vs optional, and "ready to send"

The server recomputes readiness on every profile rebuild. A person is **in the pool** when all of
these hold ([server/src/matching/profile.ts:207] `const inPool = missing.length === 0 && adult;`,
[shared/src/values.ts:77] `export const POOL_REQUIRED = [`):

- gender, who they want to meet, birth year, city **with a map point**, and what they are here for,
  each from a confirmed (not held) fact ([server/src/matching/profile.ts:45] `WHERE f.user_id = $1 AND f.status = 'active' AND f.valid_to IS NULL`,
  [server/src/matching/profile.ts:152] `if (p === 'lives_in') return lat === null;`);
- an answer (or "prefer not to say") on each of the five cards
  ([server/src/matching/profile.ts:178] `for (const k of CORE_CARDS) if (!done.has(k.id)) missing.push(k.predicate);`);
- all three consent documents ([server/src/matching/profile.ts:205] `if (!agreed) missing.push('consent');`);
- age 18 or over, computed from the birth year alone ([server/src/matching/profile.ts:190] `const adult = age !== null && age >= MIN_AGE;`).

Not required: photos, a name, age range, distance, neighbourhood, faith, the sentence, stories,
voice, self-test, character. The self-test's "It's ready. It can go out and meet people for you."
is a separate notion and gates nothing ([app/src/features/onboarding/self-test-screen.tsx:145] `It's ready. It can go out and meet people for you.`).

**When someone is not ready:** the Home's big button reads "Finish setup" and the status line names the
first missing item ("Your birth year", "Where you live"...); the Matches tab says "Your agent is still
inside — It needs a few more things before it can talk to anyone."; a refused send says "Your agent
needs a few more answers before it can go out."
([app/src/features/world/hud.tsx:207] `<Button label="Finish setup" variant="primary" onPress={onFinishSetup} />`,
[app/src/features/matches/matches-screen.tsx:229] `It needs a few more things before it can talk to anyone.`).

### 2.4 Model calls during setup

The first screen already calls a model (fact extraction, then a sample reply); so do the paste, the
"couldn't be with" sentence, the voice import and each self-test. Since 2026-09-28 these setup calls
are counted apart, up to 40 a day, and never use the 10 a day that chat, learning and rounds share;
the $2.00 daily cost cap still covers them. Measured before the change: real people's setup used 1 to
4 of the 10 on their first day ([server/src/api/tell.ts:76] `), { setup: true });`,
[server/src/metering.ts:59] `if (row.setup_used >= env.SETUP_CALLS_PER_DAY) {`,
[server/src/memory/selftest.ts:24] `export const TEST_SIZE = 5;`).

### Docs vs code

- HOW-IT-WORKS.md §2 gives the flow as `start → interview → (essentials → voice → self-test) →
  character → photos → home`, skipping the middle only after a paste. The code skips to Stories when the
  person is already in the pool, and a paste can never put a new person in the pool, because pasted
  facts are held until confirmed ([HOW-IT-WORKS.md:63] `start → interview → (essentials → voice → self-test) → character → photos → home`,
  [server/src/memory/pasteImport.ts:188] `originClass: 'untrusted',`).
- HOW-IT-WORKS.md §2a describes the partner row as "Anyone is fine" or "Let me choose". The screen shows
  "All are okay" and every answer, unticked ([HOW-IT-WORKS.md:82] `one explicit tap -- "Anyone is fine" or "Let me choose".`).
- HOW-IT-WORKS.md §2b says "which part of town" is asked in setup; it is not asked until the person has
  a map point ([server/src/matching/profile.ts:350] `if (!p || p.lat === null || p.lon === null) return false;`).
- HOW-IT-WORKS.md §2c calls the voice step free paragraphs "extracted into facts"; it is a WhatsApp
  import that writes a style note, not facts ([HOW-IT-WORKS.md:150] `free paragraphs, extracted into facts.`).
- The location code and the phone's permission text say only the city is kept. For an unlisted city,
  "Use my location" stores the phone's position rounded to about 1 km
  ([app/app.json:48] `Only the city is kept — never your exact position, and never in the background.`,
  [app/src/lib/location.ts:72] `lat: coarse(fix.coords.latitude),`).
