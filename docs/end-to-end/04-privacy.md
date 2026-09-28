## 4. Privacy

Three layers decide what one person can learn about another: a **visibility level** on every
fact, **word filters** on anything repeated to someone else (private topics and contact
details), and **database roles** that limit what each part of the server can read.

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| A fact is written | It gets a level: public, match-only or private | Code | `facts.disclosure` | Public: can be quoted to others. Match-only: used for matching, never said. Private: hidden by the person | [server/migrations/0018_dating_schema.sql:39] `CHECK (disclosure IN ('public', 'matchable_only', 'private'))` |
| "OK to share" on a learned sentence | Match-only → public | Code | `facts.disclosure`, audit row | Others, via cards and agents | [app/src/features/appearance/appearance-screen.tsx:187] `<Chip label="OK to share"` |
| "Hide" on a sentence or answer | → private; comes off cards already written, at the next load | Code | `facts.disclosure`, audit row | Nobody else | [server/src/api/me.ts:177] `const to = hidden ? 'private' : 'public';` |
| A sentence naming kids, faith, drinking… or holding a phone number, email, handle, link or address | Kept, but never repeated to anyone | Code | Nothing extra | Only the person | [server/src/matching/brief.ts:203] `return !namesCoreValue(text) && contactDetail(text) === null;` |
| A sentence naming a company, college or building | A suggestion: "This names a company. Hide this?" | Code | Nothing unless hidden | The person | [app/src/features/appearance/appearance-state.ts:72] `This names a ${names}. Hide this?` |

### Arjun and Meera

- **Before they meet**, Arjun's agent (server code) can read Meera's matching row: age, gender, who
  she seeks, place, distance, intent, tags and card answers, to filter and count
  ([server/migrations/0019_match_role.sql:40] `USING (in_pool);`). Arjun himself sees at most her 3D
  character and neighbourhood in the town: no name, age, tags or photo
  ([server/src/api/world.ts:256] `area: strangers.areas.get(id) ?? CENTRAL_AREA`).
- **When the agents meet**, up to 20 of Meera's **public**, verified sentences are read under her own
  database session and sent to the model for the talk and for Arjun's want check
  ([server/src/matching/orchestrator.ts:365] `loadQuotes(pair.b, { predicates: TALK_SOURCES, limit: TALK_SENTENCES })`).
- **On Arjun's card** (his turn): her headline, shared tags, up to two of her sentences, the talk,
  Arjun's wants against her sentences ("Matches"/"Doesn't match" only on a want tied to a question;
  a private-topic want says only "A private topic. Their answer is never shown."), an opener (stage 8)
  ([app/src/features/matches/exchange.ts:178] `export const PRIVATE_TOPIC = 'A private topic. Their answer is never shown.';`).
- **On the reveal**: the first name she typed on the setup screen, age, city, up to eight interest and
  work tags from facts she made shareable (no private-topic word), photos (stage 9)
  ([server/src/api/dating.ts:145] `return { ...row, attribute_tags: await publicTags(db, row.user_id), look: await lookOf(db, row.user_id, synthetic) };`,
  [server/src/api/dating.ts:164] `.filter((t) => t.word && mayRepeat(t.word))`).
- **Arjun never sees** her facts list, her chat, her hidden or match-only sentences, her rules and
  wants, her card answers as values, her check-in answers, her reports or blocks, her exact location,
  her birth year or her phone number
  ([server/src/matching/brief.ts:265] `AND f.disclosure = ANY($3::text[])`,
  [app/src/features/consent/consent-screen.tsx:38] `'We keep the year you were born. Other people only ever see your age.',`).

### 4.1 The three levels

| Founder's word | Code name | Meaning | Code |
|---|---|---|---|
| share | `public` | May be quoted to other people through cards and agents | [server/src/matching/brief.ts:279] `opts.includeHidden ? ['public', 'private'] : ['public']` |
| match-only | `matchable_only` | Used for matching, never said to anyone | [server/src/memory/extract.ts:245] `...learnedDisclosure(f.predicate),` |
| never | `private` | Set only by the person's own "Hide" | [server/src/matching/brief.ts:276] `// 'private' is only ever set by the person hiding a quote (POST` |

- **Defaults.** Some kinds of fact start public (city, work field, interests, story answers,
  intent, kids and one-person-or-open answers, diet, exercise...), the rest start match-only
  ([shared/src/facts.ts:98] `export const defaultDisclosure = (predicate: string): 'public' | 'matchable_only' =>`).
  Some kinds can **never** be made public: medical conditions, allergies, religion, politics,
  ethnicity, full name, birth date, employer, children, relationships, drugs
  ([shared/src/facts.ts:90] `'medical_condition', 'allergy', 'religion', 'politics', 'ethnicity',`,
  [shared/src/facts.ts:91] `'full_name', 'birth_date', 'works_at', 'has_children', 'close_to', 'lives_with',`).
- **Learned is private.** Anything learned from chat, the first sentence or a paste starts match-only,
  until the person taps "OK to share" on "How you appear"
  ([server/migrations/0063_learned_is_private.sql:25] `UPDATE facts SET disclosure = 'matchable_only'`).
  A "Yes, that's right" on something held keeps it match-only too: it confirms, it does not share
  ([server/src/matching/brief.ts:107] `export function learnedDisclosure(predicate: string): { disclosure?: 'matchable_only' } {`).
  Stories and question-of-the-day answers start public, because the person typed them to be said.
- **Public is not enough to be quoted.** A sentence reaches another person only if it is also of an
  allowed kind (interests, things done, topics, media, pets, story answers, work, exercise, sleep,
  transport; the agents also use goals and dislikes), was typed by the person (found word for word
  in their messages), is 12 to 300 characters, is not an interview tap, and passes the word filters
  ([server/src/matching/brief.ts:87] `'interest', 'did', 'topic', 'media_taste', 'pet', 'prompt_answer',`,
  [server/src/matching/brief.ts:266] `AND f.extractor_model <> 'interview'`).
  Card answers (kids, one person or open, smoking, drinking, food, faith) are never quoted; they are
  only used to filter.
- **Where levels are not applied:** the matching row is built from every live fact whatever its level,
  so match-only and hidden facts still filter and rank; and the reveal's tags come from that row (Known
  gaps) ([server/src/matching/profile.ts:45] `WHERE f.user_id = $1 AND f.status = 'active' AND f.valid_to IS NULL`,
  [server/src/api/dating.ts:162] `.filter((t) => t.startsWith('interest:') || t.startsWith('works_in:'))`).

### 4.2 Private topics and contact details

- **Private topics** are matched by a list of about 150 word stems: smoking, drinking, kids, family and
  marriage words, monogamy, diet, faith and caste, politics, health and drugs. A sentence with one is
  saved but never repeated ([server/src/matching/brief.ts:191] `export function namesCoreValue(text: string): boolean {`,
  [server/src/matching/brief.ts:176] `'church', 'temple', 'mosque', 'gurdwara', 'pray', 'relig', 'faith',`).
  The stories screen says so as you type: "This one mentions something private, like kids or drinking,
  so your agent will not repeat it." ([app/src/features/stories/stories-screen.tsx:94] `This one mentions something private, like kids or drinking, so your agent will not repeat it.`).
- **Contact details** ("when unsure, block"): phone numbers (8+ digits, or spelled out), emails
  including "at … dot", @handles and "my insta is…", links and domains, "dm me on…", street addresses,
  pin codes ([shared/src/contact.ts:12] `WHEN UNSURE, BLOCK. A false alarm costs one sentence not being quoted`,
  [shared/src/contact.ts:21] `export type ContactKind = 'phone' | 'email' | 'handle' | 'link' | 'invite' | 'address';`).
- **Where the filters run:** every path that repeats a person's words to someone else: card quotes,
  shared tags, answer sheets, the agents' talk, the date idea (twice), want quotes, the recap, and every
  time a card is shown ([server/src/matching/brief.ts:284] `return rows.filter((r) => mayRepeat(r.source_quote)).map((r) => ({`,
  [server/src/matching/talk.ts:193] `PERSON.test(idea) || CLAIM.test(idea) || VERDICT.test(idea) || !mayRepeat(idea)`).
- **Where they do not run:** direct messages after both say yes (by design: people swap details there),
  report text, and the reveal's name, city and tags ([server/src/messaging/store.ts:106] `INSERT INTO messages (id, rendezvous_id, sender_id, body, seq, kind)`).

### 4.3 "How you appear" and hiding

- **The screen** (YOU → Manage, or the town's "How you appear" chip) shows, in order: "Your agent only
  brings you people who" (the person's card rules read back in words), "What someone sees about you"
  (headline, the fixed line, tags, up to eight sentences each marked "On your card", "Not on a card
  now" or "Hidden"), "When another agent asks yours" (their answer sheet), and "Learned in chat" ("Only
  you see these. Your agent uses them to find people, but never says them until you tap OK to share.")
  ([app/src/features/appearance/appearance-screen.tsx:88] `<Card label="Your agent only brings you people who">`,
  [app/src/features/appearance/appearance-screen.tsx:106] `<Card label="What someone sees about you">`,
  [app/src/features/appearance/appearance-screen.tsx:167] `<Card label="When another agent asks yours">`,
  [app/src/features/appearance/appearance-screen.tsx:181] `Only you see these. Your agent uses them to find people`).
  Opening it can refresh the answer sheet, one model call ({AI:sheet}).
- **Not shown there**, though others see it: the reveal (first name, tags, photos), the character, the
  neighbourhood, and "Matches"/"Doesn't match" on wants tied to a question ([server/src/api/me.ts:89] `const quotes = all.slice(0, 8).map((q) => {`).
- **"Hide this?"** is a suggestion under any sentence that names a company, college or building, found
  by word lists; it never blocks ([shared/src/identifying.ts:11] `A SUGGESTION, NEVER A BLOCK. Nothing here stops a sentence; it only lets the screen`).
- **Hiding** makes the fact private: new cards, sheets, talk and want checks skip it; cards already
  written drop it at the next load; a date idea resting on it is withdrawn. It stays usable for
  matching ([server/src/matching/brief.ts:757] `const date = talk.date && keep(talk.date.theirs) ? talk.date : null;`).
- **Other controls:** remove a photo ("It is deleted from the server as well."); answer a story again
  (the old answer is kept but replaced); no per-fact delete; no message unsend
  ([app/src/features/photos/photos-screen.tsx:110] `'Remove this photo?', 'It is deleted from the server as well.'`,
  [app/src/features/knowledge/you-screen.tsx:183] `It keeps the old answer. It just stops saying it.`).

### 4.4 Who can read what in the database

Row-level security is the boundary. Each part of the server connects as its own role
([server/migrations/0000_roles.sql:16] `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`):

| Role | Used for | Can read | Code |
|---|---|---|---|
| `clone_app` | Everything a signed-in person does | Their own rows only (facts, messages, photos, cards...); the shared pair row and its messages; can write but not read reports; invites table in full (no row security) | [server/migrations/0022_rendezvous.sql:104] `CREATE POLICY briefs_mine ON rendezvous_briefs FOR ALL`, [server/migrations/0024_messages.sql:107] `CREATE POLICY reports_write_only ON reports FOR INSERT` |
| `clone_match` | Finding and counting candidates | In-pool matching rows (all columns), the rule columns of live preferences (never their sentences), characters | [server/migrations/0019_match_role.sql:40] `USING (in_pool);`, [server/migrations/0021_matching_fixes.sql:22] `GRANT SELECT (id, user_id, predicate, operator, value, strength) ON preferences TO clone_match;` |
| `clone_matchmaker` | Running rounds, reveals, the reviewer | Facts only where public, live and current; every matching row, pair, card, transcript, report and photo record; every profile summary; the founder's two count functions | [server/migrations/0028_matchmaker.sql:48] `USING (disclosure = 'public' AND status = 'active' AND valid_to IS NULL);`, [server/migrations/0028_matchmaker.sql:51] `GRANT SELECT ON core_profile TO clone_matchmaker;` |
| `clone_eraser` | Deleting an account | Everything (bypasses row security), to delete and verify | [server/migrations/0026_eraser_role.sql:24] `NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;` |
| `clone_door` | The phone sign-in | Code challenges (hashes, caller IP); account id and number hash | [server/migrations/0066_door_and_discovery_roles.sql:46] `GRANT SELECT, INSERT, UPDATE, DELETE ON phone_challenges TO clone_door;` |
| `clone_discovery` | Background sweepers | Ids, counts and times, and each account's device name | [server/migrations/0066_door_and_discovery_roles.sql:67] `GRANT SELECT (id, name) ON tenants TO clone_discovery;` |
| owner `clone` | Migrations and founder scripts | Everything | [server/src/env.ts:13] `/** Owner/superuser connection, migrations only. The app never uses this. */` |

- **Nobody in the app can read** transcripts, the erasure log, phone challenges or bans
  ([server/migrations/0028_matchmaker.sql:73] `REVOKE ALL ON rendezvous_runs FROM clone_app;`).
- **One important exception to "the database decides":** in a round, a person's quotable sentences are
  read under **that person's own** session, where they can see all their facts; one SQL clause
  (`disclosure = public`) is what keeps the rest off a stranger's card
  ([server/src/matching/brief.ts:258] `// private, matchable_only and the NEVER_PUBLIC kinds alike. Nothing but this`).
- **Phone numbers** are never stored, only a keyed hash; the screen shows only the last two digits
  ([server/migrations/0045_phone_identity.sql:22] `so it works as a lookup key and as a ban key`,
  [shared/src/phone.ts:95] `What to print back at somebody: the last two digits, nothing else.`).
- **Photos** live on the server's disk, re-encoded (which removes location data), and are served only
  through a signed-in route that asks the database rule in stage 9; "none" and "not allowed" look the
  same ([server/src/photos/store.ts:8] `sharp drops all metadata unless asked to keep`,
  [server/src/api/photos.ts:43] `Returns an empty list both for "they have no photos" and for "you are not allowed`).

### 4.5 Deleting an account, and exporting

- **Settings → "Delete everything"** ("Cannot be undone. The clone and all of its memory go.") deletes the
  person's rows from 23 tables, their photo folder, every pair they were in (including **both** sides of
  their conversations) and reports about them; then it counts what is left and deletes the account last
  ([app/src/features/settings/settings-screen.tsx:285] `subtitle="Cannot be undone. The clone and all of its memory go."`,
  [server/src/memory/erasure.ts:35] `'answer_sheets', 'unknown_asks', 'question_prompts', 'look_items', 'looks', 'photo_checks',`,
  [server/src/memory/erasure.ts:198] `if (!remaining.length) await c.query('DELETE FROM app_users WHERE id = $1'`).
- **It leaves:** a receipt with counts, invites, reports they filed (without their name), bans and the
  phone and device hashes of a ban, the account's device name, and anything already sent to AI providers
  or written to server logs ([server/migrations/0007_erasure.sql:12] `counts, never rows.`).
- **"Download everything"** exports their facts, all their messages with their clone, their profile,
  questions, their own messages to matches and their model usage, as plain text to the share sheet
  ([app/src/features/settings/settings-screen.tsx:119] `await Share.share({ message: data });`).

### 4.6 Operators, logs and AI providers

- **The reviewer** (accounts in `ADMIN_USER_IDS`) sees the reports queue (reason, the reporter's note, the
  reported person's first name; never who reported), the Numbers page, and the unmatched-wants list
  (stage 11). No admin route reads messages, photos or facts
  ([server/src/api/admin.ts:113] `SELECT r.id, r.reporter_id, r.reported_id, r.reason, r.detail,`,
  [server/src/api/admin.ts:25] `import { hide, unhide } from '../photos/store.js';`).
- **Logs** carry user ids, not message text; the redaction list covers text fields. In development the
  console SMS sender logs full numbers and codes ([server/src/log.ts:8] `redact: { paths: ['*.rawText', '*.raw_text', '*.text', 'req.headers.authorization']`).
- **AI providers** receive: everything typed to the clone, and its replies, for chat; only the
  person's own lines for extraction ([server/src/memory/extract.ts:187] `const said = input.transcript.filter((t) => t.role === 'user');`);
  every message's text for embeddings, and in a round the other person's public sentences and both
  people's wants. The per-session notice names the provider: "You are talking to an AI. Your messages are
  processed by…" ([server/src/api/config.ts:50] `You are talking to an AI. Your messages are processed by`).
- **The Settings promise** reads "Nobody else has ever seen what your clone knows about you."
  ([app/src/features/settings/settings-screen.tsx:292] `Nobody else has ever seen what your clone knows about you.`).
  By design, other members see public sentences, tags and a first name; the reviewer sees want topic
  words; AI providers process the text. Read literally, the promise is broader than the code.

### Docs vs code

- HOW-IT-WORKS.md says the agent "cannot say more than the public facts, because the database will not
  show it more". For quotes, it is one SQL clause under the person's own session, not a database policy
  ([HOW-IT-WORKS.md:837] `The agent that goes out **cannot say more than the public facts, because the database`).
- HOW-IT-WORKS.md says the matchmaker sees "only facts marked public". It can also read every profile
  summary (written from all facts) and, through a function, every real person's want sentences
  ([HOW-IT-WORKS.md:831] `two people at once, and only facts marked **public**`).
- HOW-IT-WORKS.md says `clone_match` reads "dealbreaker preferences only". It reads the rule columns of
  every live preference ([HOW-IT-WORKS.md:830] `and dealbreaker preferences only`).
- HOW-IT-WORKS.md and CLAUDE.md say the discovery role reads "never content". It can read each account's
  device name, which often contains a person's name ([HOW-IT-WORKS.md:834] `background work: ids, counts and times across tenants, never content (0066)`).
- The consent screen says "Only things marked public ever leave your account." Since 2026-09-28 reveal
  tags are public-only and private-topic wants show nothing, but the first name (typed for this), age
  and city on the reveal, and "Matches" on a want tied to a situation question (which says how the other
  person answered it) also reach other people
  ([app/src/features/consent/consent-screen.tsx:46] `Only things marked public ever leave your account.`).
- The consent screen says you can "change" everything the clone knows. There is no per-fact edit or delete,
  only hide, confirm/reject and answering again ([app/src/features/consent/consent-screen.tsx:48] `You can read everything it knows about you, change it, or delete the whole account, from Settings.`).
- ARCHITECTURE.md says row-level security is on "every table". Invites, tenants, phone challenges and the
  erasure log have none, deliberately ([ARCHITECTURE.md:391] `from the first migration, on every table.`).
- A code comment says erasure "is a way out of a ban". Since 0065 a ban keeps the phone hash, so it is not
  ([server/src/memory/erasure.ts:163] `// erasure is therefore a way out of a ban.`).

### Unverified

- Live database grants (read from the migrations; the catalogue was not queried).
- Encryption at rest for photos and the database, and how long AI providers keep data.
