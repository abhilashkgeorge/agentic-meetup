## 8. The card each person sees

For every pair a round creates, **code** writes two cards: Arjun's card about Meera and
Meera's card about Arjun. No model writes any card text
([server/src/matching/brief.ts:4] `THE BRIEF IS CODE. NO MODEL WRITES ANY OF IT.`). The two cards
differ, because each is built for its reader
([server/src/matching/brief.ts:570] `forA: composeBrief(a, b, qa.forA, talk.forA, wants.forA),`,
[server/src/matching/brief.ts:571] `forB: composeBrief(b, a, qa.forB, talk.forB, wants.forB),`).
A card never shows the other person's name or photos; those are on the "reveal"
(stage 9).

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| Meera's age, intent and neighbourhood | Become the headline, e.g. "Here for something long-term · 27 · Jayanagar" | Code | Card row (`headline`) | Arjun, on his turn | [server/src/matching/brief.ts:334] `Here for ${words.join(' or ')}` |
| Tags both share | "You both like …" (up to 5), "You both work in …" (up to 2), public tags only | Code | Card row | Arjun, on his turn | [server/src/matching/brief.ts:500] `const shared = inCommon(LIKED).slice(0, 5);` |
| Meera's own public sentences | Up to 2 quotes, "In their words, <month year>" | Code | Card row | Arjun, on his turn | [server/src/matching/brief.ts:468] `Up to two of the OTHER person's verified sentences.` |
| The talk or the answer sheets | Shown as the agents' exchange (stage 7) | {AI:talk} earlier, code now | Card row | Arjun, on his turn | [app/src/features/matches/matches-screen.tsx:414] `{m.talk ? <TalkOnCard talk={m.talk} /> : exchangeRows(m.qa).length > 0 && (` |
| Arjun's wants | "WHAT YOU ASKED FOR" (stage 5) | {AI:wants} earlier, code now | Card row, with each want's status | Arjun only | [app/src/features/matches/matches-screen.tsx:433] `WHAT YOU ASKED FOR` |
| Every time the card is opened | Each of Meera's sentences is re-checked; anything she hid or changed comes off | Code | Nothing | | [server/src/matching/brief.ts:750] `const ok = (t: string) => mayRepeat(t) && (live === null || live.has(sentenceKey(t)));` |

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
  ([app/src/features/matches/matches-screen.tsx:370] `{m.waitingOnYou ? 'WAITING ON YOU' : 'WAITING ON THEM'}`,
  [app/src/features/matches/matches-screen.tsx:391] `You both like {m.shared.join(', ')}.`,
  [app/src/features/matches/matches-screen.tsx:405] `In their words, ${q.when}`,
  [app/src/features/matches/matches-screen.tsx:463] `<Button label={m.practice ? WORDS.shareFirstPractice : WORDS.shareFirst}`,
  [app/src/features/matches/matches-screen.tsx:477] `<Button label={WORDS.notThisOne} variant="ghost" onPress={() => void pass(m.id)} />`).
- **Arjun's card about Meera, while it is not his turn**, is the "plain card": Meera's
  character, "WAITING ON THEM", "Your agent met someone", the fixed line, and "They decide
  first. If they share their profile, you will see it here." Nothing else: no age, no area, no
  quotes, no talk, no wants
  ([server/src/matching/brief.ts:687] `({ headline: PLAIN_HEADLINE, line: BRIEF_LINE, shared: [], work: [], quotes: []`,
  [app/src/features/matches/turn.ts:43] `theyFirst: 'They decide first. If they share their profile, you will see it here.',`).
- **After Meera shares her profile**, Arjun's card fills in (the same sections, built for him),
  with "See who it is" to open her profile, and "Not this one"
  ([app/src/features/matches/matches-screen.tsx:475] `<Button label={m.practice ? WORDS.seeThemPractice : WORDS.seeThem}`).
  Her own card now says "You shared your profile. If they share theirs back, you can talk."
  ([app/src/features/matches/turn.ts:41] `youShared: 'You shared your profile. If they share theirs back, you can talk.',`).

### 8.1 Every section, top to bottom

| # | On screen | Where it comes from | Code |
|---|---|---|---|
| 1 | Their character (a small 3D look) | The look they built; sent even on a plain card | [app/src/features/matches/matches-screen.tsx:368] `{m.look && <CharacterAvatar look={m.look} size={40} />}` |
| 2 | "WAITING ON YOU" / "WAITING ON THEM" | Whose turn it is | [app/src/features/matches/matches-screen.tsx:370] `{m.waitingOnYou ? 'WAITING ON YOU' : 'WAITING ON THEM'}` |
| 3 | Headline | Intent · age · neighbourhood (or city) of the other person; nothing known → "Your agent met someone" | [server/src/matching/brief.ts:336] `const place = (card.area ? findArea(card.area)?.name : null) ?? card.city ?? null;` |
| 4 | "Passes your rules both ways, on everything they've answered" | The same fixed words on every card | [server/src/matching/brief.ts:66] `export const BRIEF_LINE = "Passes your rules both ways, on everything they've answered";` |
| 5 | "Practice match — this one is not a real person." | Practice profiles only | [app/src/features/matches/matches-screen.tsx:386] `Practice match — this one is not a real person.` |
| 6 | "You both like …" / "You both work in …" | Tags both have, only from **public** facts, each word checked for private topics | [server/src/matching/rendezvous.ts:384] `WHERE user_id = $1 AND status = 'active' AND valid_to IS NULL AND disclosure = 'public'` |
| 7 | "In their words, <month year>" + a quote | Up to 2 of their own public sentences, typed by them, 12–300 characters, of allowed kinds (interests, things done, topics, media, pets, story answers, work, exercise, sleep, transport) | [server/src/matching/brief.ts:88] `'interest', 'did', 'topic', 'media_taste', 'pet', 'prompt_answer',` |
| 8a | "DATE IDEA", "SOMETHING YOU SHARE", "Read what your agents said" | The talk (stage 7) | [app/src/features/matches/matches-screen.tsx:83] `open ? 'Hide the chat' : 'Read what your agents said'` |
| 8b | or "WHAT YOUR AGENTS ASKED EACH OTHER" | The answer sheets, when there is no talk | [app/src/features/matches/matches-screen.tsx:417] `WHAT YOUR AGENTS ASKED EACH OTHER</Text>` |
| 9 | "WHAT YOU ASKED FOR" | The reader's own wants (stage 5) | [app/src/features/matches/exchange.ts:197] `const label = w.kind === 'not' ? "You couldn't be with" : 'You asked for';` |
| 10 | "Ask them about …" | First that applies: a question they could not answer in the talk; one from the sheets; a shared interest; a quote; a shared work field; one of their tags | [server/src/matching/brief.ts:543] `Ask them about ${talkAsk.toLowerCase()}` |
| 11 | "Fades tomorrow if you don't answer." / "Fades today if you don't answer." | Days left on the reader's turn | [app/src/features/matches/fade.ts:15] `"Fades tomorrow if you don't answer."` |
| 12 | First move: "Yes, share my profile with them" and "Not this one". Second move: "See who it is" and "Not this one". Otherwise one line saying whose move it is | By whose turn it is (stage 9) | [app/src/features/matches/matches-screen.tsx:461] `{turnOf(m) === 'share-first' && (` |
| 13 | "Block or report" | On every card | [app/src/features/matches/matches-screen.tsx:494] `{ color: p.textTertiary, textAlign: 'center' }]}>Block or report</Text>` |

Only one "waiting on you" card shows at a time. Since 2026-09-29 it is the one that fades soonest, so a
card can only run out while it is the one on screen, and under "WAITING ON YOU" it says "2 more waiting"
when there are more; before, it was simply the first, and the others could run out unseen. The server
orders cards newest round first, then by a hash of the pair's id, never by a score
([app/src/features/matches/matches-screen.tsx:362] `[...soonestFirst(matches.filter((m) => m.waitingOnYou)).slice(0, 1),`,
[app/src/features/matches/waiting.ts:15] `export function soonestFirst<T extends Waiting>(cards: readonly T[]): T[] {`,
[server/src/api/dating.ts:628] `ORDER BY r.created_at DESC, md5(r.id::text) COLLATE "C"`).

Matches reads the cards on every visit and again whenever the live connection says they changed: a
card written by somebody else's round that came to this person, the other person's yes making it
their turn, both saying yes, a round finished (since 2026-10-03; before, a card made while the tab
was open waited until the person left it and came back)
([app/src/features/world/bridge.ts:112] `export function cardsChange(ev: TownEvent): boolean {`).

### 8.2 Checked again every time

When a card is shown, each of the other person's sentences on it must still be one of
their current public facts and pass the private-topic and contact-detail check. Anything
that fails comes off: a quote, an answer, a talk line, the date idea, or an opener that
used it ([server/src/matching/brief.ts:750] `const ok = (t: string) => mayRepeat(t) && (live === null || live.has(sentenceKey(t)));`,
[server/src/api/dating.ts:646] `AND disclosure = 'public' AND status = 'active' AND valid_to IS NULL`).
Not re-checked: the headline and the shared tags, which stay as written when the round ran
([server/src/matching/brief.ts:768] `return { ...card, quotes, qa, wants, talk, opener };`).

### 8.3 What a card never shows

- **No score, percentage or verdict about the pair.** The query for cards does not even
  select the score columns, and the stored "concern" is always empty
  ([server/src/api/dating.ts:595] `SELECT r.id, b.headline, b.overlap_quotes, b.questions,`,
  [server/src/matching/brief.ts:645] `VALUES ($1,$2,$3,$4,'',$5)`). One exception is per want, not
  per pair: "Matches" / "Doesn't match" on a want tied to a question; a private-topic want shows
  only "A private topic. Their answer is never shown." (stage 5).
- **No transcript**: no app role can read the conversation table
  ([server/migrations/0028_matchmaker.sql:68] `-- No policy for clone_app, deliberately. A transcript is never shown to either human:`).
- **Not the other person's card about you**: database row-level security
  ([server/migrations/0022_rendezvous.sql:105] `USING (for_user = NULLIF(current_setting('app.user_id', true), '')::uuid)`).
- **Nothing learned in chat, nothing hidden**: quotes read public facts only
  ([server/src/matching/brief.ts:280] `opts.disclosures ? [...opts.disclosures] : opts.includeHidden ? ['public', 'private'] : ['public'],`).
- **No card answers** (kids, one person or open, smoking, drinking, food, faith), as text or as
  "Matches" (since 2026-09-28).
- **No name, no photo** ([server/src/matching/brief.ts:661] `export interface BriefCard {`).
- **Not whether they said no** ([server/migrations/0031_other_said_yes.sql:15] `-- A NO IS SILENT, AND THIS KEEPS IT SILENT.`), although timing can give it away (Known gaps).

### Docs vs code

- HOW-IT-WORKS.md §7 says a card has "No concern, no verdict, no number". Tied wants carry
  "Matches" / "Doesn't match", and the reveal carries a count ("Confirmed by N
  people who met them") ([HOW-IT-WORKS.md:339] `relationship intent is ever named. No concern, no verdict, no number.`).
- HOW-IT-WORKS.md says every sentence is re-checked when a card is shown. True for
  sentences; the headline and shared tags are not re-checked
  ([HOW-IT-WORKS.md:348] `**A card is checked again every time it is shown** (`).
