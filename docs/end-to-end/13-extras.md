## 13. What else the app does (not in the outline above)

| Feature | What it does | Who can reach it | Code |
|---|---|---|---|
| **The town** (Home tab) | A 3D miniature Bengaluru built from OpenStreetMap, 30 neighbourhoods; your agent, up to 40 strangers and the people you met walk about; tap your own agent to talk to it | Everyone | [app/src/features/world/map.ts:4] `One JSON file, built once from OpenStreetMap by server/scripts/build-map.ts and`, [server/src/matching/world.ts:50] `export const STRANGERS_IN_SQUARE = 40;` |
| **Cubbon Park** | A walkable version of the real park; up to 32 agents; "Directions" opens a Google Maps search | Everyone, "Visit Cubbon Park" | [app/src/features/world/venue.ts:61] `export const MAX_VENUE_AGENTS = 32;` |
| **"Who's here"** | A list of the same people as the town, practice profiles marked "Not a real person" | Everyone | [app/src/features/world/people.ts:52] `a.practice ? 'Not a real person' : undefined` |
| **Character builder** | The 3D figure others see in the town and on cards until you share your profile with them; items bought with points | Everyone | [app/src/features/look/builder-screen.tsx:28] `This is you in the square, and what people see on your card until you share your profile with them.` |
| **Points** | +50 for a check-in, +10 for "did you meet", +20 first look, +30 photos checked; only the person sees the balance | Everyone | [server/src/points/ledger.ts:13] `export const POINTS = { checkin: 50, met: 10, look: 20, photos_checked: 30 } as const;` |
| **Round recap** | "WHAT YOUR AGENT DID" after your own round: template sentences, up to two of your own sentences it used, topics, and what it had to say "I don't know" to | The round's sender | [server/src/matching/recap.ts:36] `some: 'Your agent went out and met some new people.',` |
| **Live updates** | One connection carries clone chat, messages and town events (queued, met, talking, decided, done, your turn, introduced) | Everyone | [shared/src/events.ts:125] `z.object({ type: z.literal('round.queued'), roundId: z.uuid() }),` |
| **No push notifications** | Nothing reaches a closed app: matches, turns, introductions and messages wait until it is opened | — | [server/src/api/chat.ts:267] `// Offline: no receipt, and a push notification is what wakes them. Marking it` |
| **Photos screen** | Up to six photos, re-encoded to drop location data | Everyone | [server/src/photos/store.ts:30] `export const MAX_PHOTOS = 6;` |
| **Selfie check** | "Photos checked" badge from a local face model | Off (`FACE_CHECK=off`) | [server/src/api/verify.ts:39] `if (!faceCheckEnabled()) return c.json({ status: 'unavailable' });` |
| **"What it knows"** | Every fact, its history, and the confirm questions | Everyone | [app/src/features/knowledge/you-screen.tsx:91] `<ScreenTitle title="What it knows" />` |
| **Clarifying questions** | "It wants to know" cards in chat, from facts that may be stale or from paste guesses; they never close | Everyone | [app/src/features/chat/clone-chat.tsx:93] `<Card label="It wants to know">` |
| **Settings** | Theme, 3D town on/off, 30 fps battery mode, contact support, "Download everything", "Delete everything", sign out, server address, credits | Everyone | [app/src/features/settings/settings-screen.tsx:231] `Row title="Easier on the battery" subtitle="Draws the town at 30 frames a second."` |
| **Server address** | Anyone can point the app at another server; the app also opens this screen by itself when the server is unreachable | Everyone | [app/src/features/settings/connect-screen.tsx:36] `await setServerUrl(candidate);` |
| **Reports to review** | The reviewer's queue: "No action", "Hide photos", "Ban" | Reviewer | [app/src/features/settings/settings-screen.tsx:265] `<Row title="Reports to review" value={admin.open ? String(admin.open) : ''}` |
| **Identity flags** | Counts of people whose dates said the photos or age were wrong, or felt unsafe; no screen | Reviewer, API only | [server/src/api/admin.ts:78] `.get('/v1/admin/flags', async (c) => {` |
| **Public pages** | `/health`, `/v1/config` (the AI notice), and `/stats`, an unlinked "How small this is" page with the people count and self-test pass rate | Anyone with the server address | [server/src/api/stats.ts:53] `<title>How small this is</title>` |
| **Graphics bench** | A hidden 3D benchmark: tap the version line in Settings five times | Anyone | [app/src/features/settings/settings-screen.tsx:38] `if (t.n >= 5) { t.n = 0; router.push('/dev/gl'); }` |
| **Practice pool seeding** | `npm run seed:synthetic` replaces the invented pool (500 by default), no model | Founder, command line | [server/src/db/seed-synthetic.ts:16] `const count = Number(process.argv[2] ?? 500);` |
| **Fallback Home** | If 3D cannot run, Home becomes the plain clone chat, and sending out moves to the Matches tab | Everyone | [app/src/features/world/world-screen.tsx:332] `if (renderer === null) return <ChatScreen />;` |

Also present in the code but not visible anywhere: a "how well it knows you" score that the YOU tab fetches but
never draws ([server/src/memory/completion.ts:83] `band: 'just met' | 'getting to know you' | 'knows you fairly well' | 'knows you well';`),
and a "voice" message source that the app never sends; "voice" in this app means the WhatsApp style import
([shared/src/events.ts:30] `source: z.enum(['text', 'voice']).default('text'),`).
