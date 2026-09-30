## 9. Deciding

Both people must say yes before they can talk, and **nobody's photos or name reach anyone until
that person has said yes to them** (since 2026-09-28). They do not decide at the same time:
one person, the **first mover**, decides first on the words card and the other's character
alone; their yes shares **their own** profile. Then the other person sees it and shares theirs
back, or not. Each turn lasts three days. Code decides everything here; no model is involved.

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| Cards are written | A real person facing a practice profile decides first; between two real people, the one with more open cards (a tie goes to the lower account id). The first mover's phone is woken | Code | `rendezvous.first_mover`, `answer_by` = now + 3 days | Nobody sees the rule's result directly | [server/src/matching/brief.ts:797] `if (practice.has(a) !== practice.has(b)) return practice.has(a) ? b : a;` |
| First mover taps "Yes, share my profile with them" | Their photos, first name and profile open to the other person; the other gets a fresh 3 days | Code | Their yes on their card row | The other person, from then on | [app/src/features/matches/turn.ts:35] `shareFirst: 'Yes, share my profile with them',` |
| The other taps "Yes, share mine back" | Their profile opens to the first mover; the pair is introduced; chat opens | Code | Pair `introduced` | Both | [app/src/features/matches/turn.ts:44] `shareBack: 'Yes, share mine back',` |
| Either says no ("Not this one", "Not for me") | The pair ends at once, silently; anything shared closes | Code | `human_says_yes = false`, pair `lapsed` | Nobody is told | [server/src/matching/orchestrator.ts:588] `UPDATE rendezvous SET status = 'lapsed' WHERE id = $1 AND status <> 'introduced'` |
| Nobody answers in 3 days | The pair expires; anything shared closes | Code (a timer every 10 minutes) | Pair `expired` | Nobody is told | [server/src/matching/expiry.ts:26] `UPDATE rendezvous SET status = 'expired', expired_at = now()` |
| An answer out of turn | Refused by the server | Code | Nothing | — | [server/src/api/dating.ts:902] `if (!myTurn) return c.json({ error: 'not_your_turn' }, 409);` |

### 9.1 Who decides first, and why

- **The rule:** a practice profile never decides first -- it never answers, so the real person
  always does (since 2026-09-28; migration 0074 moved the one open card where a real person was
  waiting behind a practice profile). Between two real people, whoever has more open cards (waiting for an answer) is the
  first mover; a tie goes to the lower account id
  ([server/src/matching/brief.ts:797] `if (practice.has(a) !== practice.has(b)) return practice.has(a) ? b : a;`,
  [server/src/matching/brief.ts:811] `AND r.status IN ('decided', 'shown_a', 'shown_b')`,
  [server/src/matching/brief.ts:819] `return a < b ? a : b;`).
- **The reason, in the code:** dating apps are lopsided; the flooded side decides alone and
  first so it is not flooded again; both must still say yes
  ([server/src/matching/brief.ts:622] `THE ASYMMETRY IS THE POINT. Whichever side has the larger inbox decides ALONE and`).
- **In our example** Meera already has cards from other men's rounds, so she is the first
  mover. If Arjun had more open cards, or they tied and his id sorted first, the roles would
  swap.
- **Turn order is enforced by the server:** the decide route refuses an answer that is not the
  caller's turn ("not_your_turn") or a second answer ("already_decided"), and the database write
  in `decide()` repeats the same test, so no caller can answer out of turn
  ([server/src/api/dating.ts:900] `if (seat.status !== 'decided' || seat.mine !== null) return c.json({ error: 'already_decided' }, 409);`,
  [server/src/api/dating.ts:902] `if (!myTurn) return c.json({ error: 'not_your_turn' }, 409);`,
  [server/src/matching/orchestrator.ts:578] `AND (r.first_mover = $2 OR r.first_mover IS NULL`).
  Two old open pairs have no first mover recorded; either side may go first there.

### 9.2 What each person sees, step by step

**Step 1 — Meera decides first, on words alone.** Her card about Arjun is the full words card
(stage 8) with his 3D character, but no photo and no name. Under it:

- "Yes, share my profile with them" and "Not this one", and the note "This shows them your
  photos and first name. Nothing is shared until you tap it."
  ([app/src/features/matches/matches-screen.tsx:428] `<Button label={m.practice ? WORDS.shareFirstPractice : WORDS.shareFirst}`,
  [app/src/features/matches/turn.ts:37] `shareFirstNote: 'This shows them your photos and first name. Nothing is shared until you tap it.',`).
- If she opens his profile screen anyway, it says "Not yet — Their photos and name show only after
  they share them. You decide first, on the card."
  ([server/src/api/dating.ts:196] `if (seat.first_mover === me) return 'Their photos and name show only after they share them. You decide first, on the card.';`).

**Meanwhile Arjun** sees the plain card (stage 8) with "They decide first. If they share their
profile, you will see it here.", no buttons, and in the town "They decide first. If they share
their profile, you will see it."
([app/src/features/matches/turn.ts:43] `theyFirst: 'They decide first. If they share their profile, you will see it here.',`,
[server/src/api/dating.ts:197] `return 'They decide first. If they share their profile, you will see it here.';`).
He cannot answer yet: the server refuses it.

**Step 2 — Meera taps "Yes, share my profile with them".** Her card now says "You shared your
profile. If they share theirs back, you can talk.", and her town seat "You shared your profile.
Waiting on them." Arjun gets his turn: a fresh three days, and a live event
([app/src/features/matches/turn.ts:41] `youShared: 'You shared your profile. If they share theirs back, you can talk.',`,
[app/src/features/world/agent-sheet.tsx:46] `: agent.state === 'shared' ? 'You shared your profile. Waiting on them.'`,
[server/src/matching/world.ts:127] `if (seat.humanSaysYes === true) return 'shared';`).

**Step 3 — Arjun sees who shared.** His card fills in with her words, and "See who it is" opens
her profile: her photos (or her character and "No photos yet"), "WHO THEY ARE": "Meera, 27" (or
"Someone, 27" if no first name is known), her city, "Confirmed by N people who met them" (hidden
at 0), tag chips; "Your agent never decided whether you would find them attractive. It has no
opinion about that and does not keep one."; then "Yes, share mine back" and "Not for me", and
under them "Yes shows them your photos and first name, and opens a chat. If you say no, they
are not told."
([app/src/features/matches/matches-screen.tsx:440] `<Button label={m.practice ? WORDS.seeThemPractice : WORDS.seeThem}`,
[app/src/features/matches/reveal-screen.tsx:227] `<Card label="Who they are">`,
[app/src/features/matches/reveal-screen.tsx:149] `<Button label={them?.practice ? WORDS.shareBackPractice : WORDS.shareBack} variant="primary"`,
[app/src/features/matches/turn.ts:47] `shareBackNote: 'Yes shows them your photos and first name, and opens a chat. If you say no, they are not told.',`).

**Step 4 — Arjun taps "Yes, share mine back".** They are introduced (stage 10). Only now can
Meera see his photos and name.

If a decision does not go through (no connection, the card expired), the screen says "That did
not go through. Try again." instead of confirming it
([app/src/features/matches/reveal-screen.tsx:75] `if (!r) { setFailed(true); return; }`).

### 9.3 When Meera's profile and photos become visible to Arjun

**What is shown.** The reveal returns the first name she typed on the setup screen ("Someone"
without one), age, city, up to 8 interest and work tags, her character and her photos. The tags
come only from facts she made shareable and never name a private topic (since 2026-09-28; they
used to come from the matching row, chat-learned and hidden ones included)
([server/src/api/dating.ts:180] `name,                         // FIRST NAME ONLY (0027)`,
[server/src/api/dating.ts:163] `.filter((t) => t.startsWith('interest:') || t.startsWith('works_in:'))`,
[server/src/api/dating.ts:146] `return { ...row, attribute_tags: await publicTags(db, row.user_id), look: await lookOf(db, row.user_id, synthetic) };`).

**When: only after Meera has said yes to Arjun.** The reveal route opens a person's profile only
when they said yes in that pair; otherwise it answers "waiting" with no name in it
([server/src/api/dating.ts:760] `if (seat.other_said_yes !== true) {`). The database photo rule is
the same test: a person's photos show only to someone they said yes to, and only while the pair
has not ended in a no or expired
([server/migrations/0073_consent_first_reveal.sql:42] `AND b.human_says_yes IS TRUE));`,
[server/migrations/0073_consent_first_reveal.sql:40] `AND r.status NOT IN ('lapsed', 'expired')`).
Photos are served only through signed-in routes that ask that rule
([server/src/api/photos.ts:72] `const allowed = await tenantSession(ctx, (db) => photos.visibleTo(db, owner, ctx.userId));`).
The town shows a first name under the same test
([server/src/api/world.ts:211] `const entitled = own.seats.filter((s) => s.status !== 'running' && s.other_said_yes === true);`).
It stands a met person on their own neighbourhood only where the card already names the place
(Arjun decides first, or Meera has said yes); otherwise the seat stands in the viewer's own
neighbourhood, so the second mover does not learn where the first mover lives
([server/src/api/world.ts:221] `.filter((s) => s.status !== 'running' && (s.first_mover === me || s.other_said_yes === true))`,
[server/src/api/world.ts:255] `area: seatAreas.get(s.other_id) ?? own.myArea ?? CENTRAL_AREA,`).

| Case | When Arjun sees Meera's profile and photos |
|---|---|
| Meera is first mover (our example) | After her "Yes, share my profile with them" |
| Arjun is first mover | After Arjun shared his, and Meera tapped "Yes, share mine back" |

**Is Meera ever asked "can we share your profile?"** **Yes: her yes is exactly that question.**
The first mover's button is "Yes, share my profile with them" and the second person's is "Yes,
share mine back"; nothing of a person is shown to the other before their own tap
([app/src/features/matches/turn.ts:35] `shareFirst: 'Yes, share my profile with them',`).
The promises match: consent says "Your photos and first name reach a person only after you say yes to
sharing your profile with them."; the photo screens say "Nobody sees these until you share your profile
with them." and "Only people you share your profile with"
([app/src/features/consent/consent-screen.tsx:52] `'Your photos and first name reach a person only after you say yes to sharing your profile with them.',`,
[app/src/features/onboarding/photos-step.tsx:168] `Nobody sees these until you share your profile with them. Your agent never does,`,
[app/src/features/photos/photos-screen.tsx:133] `<Card label="Only people you share your profile with">`).

### 9.4 What "no" does

- **One tap, final**, no confirmation: "Not this one" on the card or "Not for me" on the
  profile screen ([app/src/features/matches/reveal-screen.tsx:152] `<Button label={WORDS.notForMe} disabled={busy}`).
  It cannot be undone ([server/src/matching/orchestrator.ts:574] `WHERE rendezvous_id = $1 AND for_user = $2 AND human_says_yes IS NULL`).
- **The person saying no** sees "Done" / "They are not told anything. Your agent keeps
  looking." ([app/src/features/matches/reveal-screen.tsx:87] `They are not told anything. Your agent keeps looking.`).
- **The other person** is sent nothing
  ([server/src/matching/orchestrator.ts:591] `// NOTHING is sent to anybody. The town on the other phone keeps showing`),
  but their card disappears from Matches at once, because both people's lists hide ended pairs
  ([server/src/api/dating.ts:612] `AND r.status NOT IN ('lapsed', 'expired')`).
- **Whatever was shared closes:** after a no, the profile screen answers "not found" and the photos
  stop ([server/src/api/dating.ts:746] `WHERE r.id = $1 AND r.status NOT IN ('expired', 'lapsed')`).
- **A first-mover no ends it**: the second mover never gets a turn and never saw anything.
- **Never again:** a pair can exist only once, so they are never matched again
  ([server/migrations/0022_rendezvous.sql:44] `CREATE UNIQUE INDEX rendezvous_pair ON rendezvous (user_a, user_b);`).

### 9.5 Phones woken (push notifications, since 2026-09-28)

Each moment that asks something of a person wakes their phone, whether or not the app is open:

| Moment | Who is woken | What the lock screen says | Code |
|---|---|---|---|
| New card, you decide first | The first mover | "Your agent met someone" / "You decide first. The card is waiting." | [server/src/matching/orchestrator.ts:437] `if (firstMover) void wake(firstMover, 'turn', pair.rendezvousId);` |
| The first mover shared | The second person | "They shared their profile with you" / "Your turn: see who it is." | [server/src/matching/orchestrator.ts:633] `wakes.push([other, 'shared']);` |
| The second yes | The first mover (not the person who just tapped) | "You can talk now" / "They shared theirs back. Say hello." | [server/src/matching/orchestrator.ts:620] `wakes.push([other, 'introduced']);` |
| A card fades within a day | The person whose turn it is, once | "A card fades today" / "Answer it before it is gone." | [server/src/push/index.ts:78] `export async function warnFading(): Promise<number> {` |

No name and no words anybody wrote ever go on the lock screen; a no wakes nobody
([server/src/push/index.ts:31] `turn: { title: 'Your agent met someone'`). The phone asks for
permission when the person first sends their agent out, not at launch
([app/src/features/world/world-screen.tsx:292] `void registerForPush(token, { ask: true });`), and a
tap opens the card, their profile or the chat
([app/src/features/push/route.ts:14] `export function routeForPush(data: Record<string, unknown> | null | undefined): string | null {`).
**Not yet reaching phones:** the app has no Expo project id yet and the server sends with
`PUSH_PROVIDER=console` (a log line per push) until the founder sets it up
([server/src/env.ts:229] `PUSH_PROVIDER: z.enum(['off', 'console', 'expo']).default('console'),`).

### 9.6 Expiry after three days

- **The clock:** 3 days from when the cards are written, for the first mover; a fresh 3 days
  from the first mover's yes, for the second
  ([server/src/matching/expiry.ts:18] `export const ANSWER_DAYS = 3;`,
  [server/src/matching/orchestrator.ts:626] `UPDATE rendezvous SET answer_by = ${ANSWER_BY} WHERE id = $1 AND status = 'decided'`).
- **Fading:** with 1 to 2 days left the card dims and says "Fades tomorrow if you don't
  answer."; under a day, "Fades today if you don't answer."; only the person whose turn it is
  sees this ([app/src/features/matches/fade.ts:16] `"Fades today if you don't answer."`). Once
  a day is left, that person's phone also gets "A card fades today", once per card
  ([server/src/push/index.ts:78] `export async function warnFading(): Promise<number> {`).
- **The sweeper** runs every 10 minutes and whenever the Matches list or a decision is
  loaded; it marks overdue pairs `expired` and writes no answer
  ([server/src/index.ts:205] `}, 10 * 60 * 1000);`,
  [server/src/matching/expiry.ts:27] `WHERE status = 'decided' AND answer_by < now()`).
- **Expired is not no:** a no is `lapsed` plus a recorded "no"; an expiry is its own status and
  is left out of the yes/no measurement; the founder's numbers count it separately
  ([server/migrations/0069_matches_expire.sql:19] `--   'expired'   its own status, beside 'lapsed' (a no). Nobody said no: both`,
  [server/migrations/0070_founder_funnel.sql:46] `(SELECT count(*) FROM pairs WHERE status = 'expired')::int`).
  An expired pair still uses the pair's one lifetime slot, and its photos close.

### Docs vs code

- HOW-IT-WORKS.md says photos are "shown only after both say yes". Since 2026-09-28 each person's
  photos show after **their own** yes: the first mover's before the second person answers
  ([HOW-IT-WORKS.md:158] `- **photos**: not seen by any agent, not matched on, shown only after both say yes.`).
- HOW-IT-WORKS.md says the first mover sees the other's profile and decides; the first mover now
  decides on the words card and character alone
  ([HOW-IT-WORKS.md:365] `**Whoever has the larger inbox decides first** (`).
- HOW-IT-WORKS.md says after a no "their card simply never arrives". An existing card
  disappears early, which can reveal the no
  ([HOW-IT-WORKS.md:369] `never told, their card simply never arrives. In a small pool where people compare notes,`).
- HOW-IT-WORKS.md says an expiry leaves "both answers" empty. When the second mover's turn
  runs out, the first mover's yes stays recorded
  ([HOW-IT-WORKS.md:501] `(a no): both answers stay empty, and compare-scorers leaves it out`).
