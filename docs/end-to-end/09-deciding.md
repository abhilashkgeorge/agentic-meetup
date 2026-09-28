## 9. Deciding

Both people must say yes before they can talk. They do not decide at the same time: one
person, the **first mover**, sees the other's profile and decides alone; only after a yes
does the second person get a turn. Each turn lasts three days. Code decides everything
here; no model is involved.

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| Cards are written | The person with more open cards becomes first mover (a tie goes to the lower account id) | Code | `rendezvous.first_mover`, `answer_by` = now + 3 days | Nobody sees the rule's result directly | [server/src/matching/brief.ts:756] `if (na !== nb) return na > nb ? a : b;` |
| First mover taps "Show me who it is" | The reveal: first name, age, city, tag chips, photos | Code | Nothing | The first mover | [server/src/api/dating.ts:688] `const mine = seat.first_mover === ctx.userId;` |
| First mover taps "Yes" | The turn passes; the other person gets a fresh 3 days and the full card | Code | Their answer on their card row | The second mover, from then on | [server/src/matching/orchestrator.ts:596] `notify(other, { type: 'match.turn', rendezvousId, agent: agentRef(other, userId) });` |
| Either taps "No" | The pair ends at once, silently | Code | `human_says_yes = false`, pair `lapsed` | Nobody is told | [server/src/matching/orchestrator.ts:555] `UPDATE rendezvous SET status = 'lapsed' WHERE id = $1 AND status <> 'introduced'` |
| Nobody answers in 3 days | The pair expires | Code (a timer every 10 minutes) | Pair `expired` | Nobody is told | [server/src/matching/expiry.ts:26] `UPDATE rendezvous SET status = 'expired', expired_at = now()` |
| The second yes | The pair is introduced; chat opens | Code | Pair `introduced` | Both | [server/src/matching/orchestrator.ts:571] `UPDATE rendezvous r SET status = 'introduced', introduced_at = now()` |

### 9.1 Who decides first, and why

- **The rule:** whoever has more open cards (waiting for an answer) is the first mover; a
  tie goes to the lower account id ([server/src/matching/brief.ts:749] `AND r.status IN ('decided', 'shown_a', 'shown_b')`,
  [server/src/matching/brief.ts:757] `return a < b ? a : b;`).
- **The reason, in the code:** dating apps are lopsided; the flooded side decides alone and
  first so it is not flooded again; both must still say yes
  ([server/src/matching/brief.ts:581] `THE ASYMMETRY IS THE POINT. Whichever side has the larger inbox decides ALONE and`).
- **In our example** Meera already has cards from other men's rounds, so she is the first
  mover. If Arjun had more open cards, or they tied and his id sorted first, the roles would
  swap. Practice profiles are not excluded from being first mover; since they never answer,
  a real person can wait three days on one (Known gaps).
- **Turn order is enforced by the app, not the server:** the decide route checks that the
  caller is in the pair and it has not expired, not whose turn it is
  ([server/src/api/dating.ts:815] `WHERE id = $1 AND status <> 'expired'`).

### 9.2 What each person sees before and after

- **The second mover before any yes (Arjun):** the plain card (stage 8) and "They are looking
  first. Whoever gets more matches decides first — it stops one side being buried." No buttons,
  no fade line. If he opens the reveal: "Not yet", "They are looking at your profile first."
  His town shows "Someone your agent met", "Around <her neighbourhood>", "Waiting on them.
  They are never told what you chose."
  ([server/src/api/dating.ts:690] `return c.json({ waiting: true, message: 'They are looking at your profile first.' });`,
  [app/src/features/world/agent-sheet.tsx:46] `: agent.state === 'waiting' ? 'Waiting on them. They are never told what you chose.'`).
- **The first mover's reveal (Meera)**, top to bottom: Arjun's photos (or his character and
  "No photos yet"), "WHO THEY ARE": "Arjun, 29" (or "Someone, 29" if his clone never heard
  his name, since no screen asks for one), his city, "✓ Photos checked" (never in
  development: the face check is off), "Confirmed by N people who met them" (hidden at 0),
  tag chips; "Your agent never decided whether you would find them attractive. It has no
  opinion about that and does not keep one."; buttons "Yes" and "Not for me"; and under
  them "Either way, they are never told what you chose."
  ([app/src/features/matches/reveal-screen.tsx:220] `<Card label="Who they are">`,
  [app/src/features/matches/reveal-screen.tsx:233] `Confirmed by ${them.confirmedBy} ${them.confirmedBy === 1 ? 'person' : 'people'} who met them`,
  [app/src/features/matches/reveal-screen.tsx:252] `Your agent never decided whether you would find them attractive. It has no`,
  [app/src/features/matches/reveal-screen.tsx:142] `label={them?.practice ? 'I would say yes' : 'Yes'}`,
  [app/src/features/matches/reveal-screen.tsx:151] `: 'Either way, they are never told what you chose.'}`).
- **After Meera's yes** she reads "Sent" and "They see your profile now. If they say yes too,
  you will both get an introduction. If not, neither of you hears anything."
  ([app/src/features/matches/reveal-screen.tsx:113] `They see your profile now. If they say yes too, you will both get an`).
  Her card then shows "WAITING ON THEM" with the line "They are looking first…", which is
  the wrong sentence for her situation (Known gaps)
  ([server/src/api/dating.ts:637] `waitingOnThem: r.human_says_yes === true || !myTurn,`).
- **Arjun's turn** then starts: his card fills in, the Chats tab shows "WAITING ON YOU", and
  his town shows Meera's first name ([app/src/features/dm/conversations-screen.tsx:54] `<Text style={[type.label, { color: p.textSecondary }]}>WAITING ON YOU</Text>`).

### 9.3 When Meera's profile and photos become visible to Arjun

**What is shown.** The reveal returns first name, age, city, up to 8 interest and work
tags, her character and her photos
([server/src/api/dating.ts:172] `name,                         // FIRST NAME ONLY (0027)`,
[server/src/api/dating.ts:155] `.filter((t) => t.startsWith('interest:') || t.startsWith('works_in:'))`).
Photos are served only through signed-in routes that ask the database rule
`visible_photos(owner, viewer)` ([server/src/api/photos.ts:72] `const allowed = await tenantSession(ctx, (db) => photos.visibleTo(db, owner, ctx.userId));`).

**When.** The photo rule allows a viewer who is the first mover, or whose other half has
already said yes, or an introduced pair
([server/migrations/0032_photos.sql:75] `r.status = 'introduced'`,
[server/migrations/0032_photos.sql:76] `OR r.first_mover = viewer`,
[server/migrations/0032_photos.sql:78] `OR coalesce((SELECT b.human_says_yes FROM rendezvous_briefs b`).
So:

| Case | When Arjun sees Meera's profile and photos |
|---|---|
| Meera is first mover (our example) | Only after Meera taps "Yes" |
| Arjun is first mover | **As soon as the cards exist**, before Meera has done anything |

**Is Meera ever asked "can we share your profile?"** **No.** No such question exists
anywhere in the app. The decide call carries only yes or no
([server/src/api/dating.ts:805] `const body = z.object({ yes: z.boolean() }).safeParse(await c.req.json().catch(() => null));`).

- If Meera is the **first mover**, her "Yes" **is** the permission: it opens her profile and
  photos to Arjun. Before tapping, she reads only "Yes", "Not for me" and "Either way, they
  are never told what you chose." She learns that Arjun now sees her profile only after
  tapping ("They see your profile now.").
- If Meera is the **second mover**, nobody asks her at all: Arjun sees her profile and photos
  first, and her later yes or no does not change what he already saw.

What she was told when she signed up does not match either case: "Your photos are never
public. They are shown to one person at a time, after both agents have said yes."; and on the
photo screens, "Only somebody you have both said yes to ever sees these."
([app/src/features/consent/consent-screen.tsx:47] `They are shown to one person at a time, after both agents have said yes.`,
[app/src/features/onboarding/photos-step.tsx:168] `Only somebody you have both said yes to ever sees these. Your agent never does,`,
[app/src/features/photos/photos-screen.tsx:133] `<Card label="Only people you have both said yes to">`).
Several first movers can also see the same photos at the same time.

### 9.4 What "no" does

- **One tap, final**, no confirmation: "Not this one" on the card or "Not for me" on the
  reveal ([app/src/features/matches/reveal-screen.tsx:145] `<Button label="Not for me" disabled={busy}`).
  It cannot be undone ([server/src/matching/orchestrator.ts:547] `WHERE rendezvous_id = $1 AND for_user = $2 AND human_says_yes IS NULL`).
- **The person saying no** sees "Done" / "They are not told anything. Your agent keeps
  looking." ([app/src/features/matches/reveal-screen.tsx:78] `They are not told anything. Your agent keeps looking.`).
- **The other person** is sent nothing
  ([server/src/matching/orchestrator.ts:558] `// NOTHING is sent to anybody. The town on the other phone keeps showing`),
  but their card disappears from Matches at once, because both people's lists hide ended pairs
  ([server/src/api/dating.ts:549] `AND r.status NOT IN ('lapsed', 'expired')`).
- **A first-mover no ends it**: the second mover never gets a turn.
- **Never again:** a pair can exist only once, so they are never matched again
  ([server/migrations/0022_rendezvous.sql:44] `CREATE UNIQUE INDEX rendezvous_pair ON rendezvous (user_a, user_b);`).

### 9.5 Expiry after three days

- **The clock:** 3 days from when the cards are written, for the first mover; a fresh 3 days
  from the first mover's yes, for the second
  ([server/src/matching/expiry.ts:18] `export const ANSWER_DAYS = 3;`,
  [server/src/matching/orchestrator.ts:590] `UPDATE rendezvous SET answer_by = ${ANSWER_BY} WHERE id = $1 AND status = 'decided'`).
- **Fading:** with 1 to 2 days left the card dims and says "Fades tomorrow if you don't
  answer."; under a day, "Fades today if you don't answer."; only the person whose turn it is
  sees this ([app/src/features/matches/fade.ts:16] `"Fades today if you don't answer."`).
- **The sweeper** runs every 10 minutes and whenever the Matches list or a decision is
  loaded; it marks overdue pairs `expired` and writes no answer
  ([server/src/index.ts:190] `}, 10 * 60 * 1000);`,
  [server/src/matching/expiry.ts:27] `WHERE status = 'decided' AND answer_by < now()`).
- **Expired is not no:** a no is `lapsed` plus a recorded "no"; an expiry is its own status and
  is left out of the yes/no measurement; the founder's numbers count it separately
  ([server/migrations/0069_matches_expire.sql:19] `--   'expired'   its own status, beside 'lapsed' (a no). Nobody said no: both`,
  [server/migrations/0070_founder_funnel.sql:46] `(SELECT count(*) FROM pairs WHERE status = 'expired')::int`).
  An expired pair still uses the pair's one lifetime slot.

### Docs vs code

- HOW-IT-WORKS.md says photos are "shown only after both say yes". The first mover sees them
  before anyone says yes ([HOW-IT-WORKS.md:158] `- **photos**: not seen by any agent, not matched on, shown only after both say yes.`).
- HOW-IT-WORKS.md says after a no "their card simply never arrives". An existing card
  disappears early, which can reveal the no
  ([HOW-IT-WORKS.md:369] `never told, their card simply never arrives. In a small pool where people compare notes,`).
- HOW-IT-WORKS.md says an expiry leaves "both answers" empty. When the second mover's turn
  runs out, the first mover's yes stays recorded
  ([HOW-IT-WORKS.md:501] `(a no): both answers stay empty, and compare-scorers leaves it out`).
- The reveal's tag chips read all of a person's interest and work tags, not only the
  public ones, unlike the card and HOW-IT-WORKS.md's "Learned is not shared"
  ([HOW-IT-WORKS.md:361] `whose button says "Save and share". Tags shown to others are chosen per fact, not per`,
  [server/src/api/dating.ts:155] `.filter((t) => t.startsWith('interest:') || t.startsWith('works_in:'))`).
