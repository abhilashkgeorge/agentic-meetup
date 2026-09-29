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
| Every AI task (chat, extract, resolve, reflect, render_profile, canon) | Google Gemini 3.5 Flash-Lite (the code default is Claude Sonnet 5) | [server/src/env.ts:89] `CHAT_MODEL: z.string().default('anthropic:claude-sonnet-5'),` |
| Embeddings | Gemini Embedding 001, 768 dimensions | [server/src/env.ts:106] `EMBEDDING_MODEL: z.string().default('google:gemini-embedding-001'),` |
| Typed decision model, separate judge model | Not set (off) | [server/src/env.ts:104] `DECIDE_MODEL: z.string().default(''),` |
| Agent conversations | Off (`RENDEZVOUS_RUNS` not set, default 0) | [server/src/matching/rendezvous.ts:75] `export const RUNS = Number(process.env.RENDEZVOUS_RUNS ?? 0);` |
| The agents' talk | On (`AGENT_TALK` not set, default on) | [server/src/matching/talk.ts:49] `export const talkOn = (): boolean => (process.env.AGENT_TALK ?? 'on') !== 'off';` |
| SMS | `console`: no text is sent, the code goes to the server log only (`SMS_DEV_ECHO=false` since 2026-09-28) | [server/src/env.ts:221] `SMS_PROVIDER: z.enum(['console', 'msg91', 'twilio']).default('console'),` |
| Reusable dev invite `KNOX-1010` | Works (`ALLOW_REUSABLE_INVITES=true`) | [server/src/env.ts:320] `ALLOW_REUSABLE_INVITES: z` |
| Old-style sign-in (account id as token) | Off (`ALLOW_LEGACY_TOKENS=false` since 2026-09-28; the code default is on) | [server/src/env.ts:199] `.default('true')` |
| Face check | Off | [server/src/env.ts:339] `FACE_CHECK: z.enum(['off', 'tfjs-node', 'wasm']).default('off'),` |
| Spend per person per day | $2.00 and 10 model calls, plus up to 40 setup calls counted apart (since 2026-09-28) | [server/src/env.ts:342] `TRIAL_TURN_CAP_PER_DAY: z.coerce.number().default(10),`, [server/src/env.ts:351] `SETUP_CALLS_PER_DAY: z.coerce.number().default(40),` |
| Push notifications | `console`: each push is written to the server log, nothing is sent, until the app has an Expo project and `PUSH_PROVIDER=expo` is set | [server/src/env.ts:229] `PUSH_PROVIDER: z.enum(['off', 'console', 'expo']).default('console'),` |

The development values come from `server/.env`, which is not in git. A production server refuses to start with the
development shortcuts on ([server/src/env.ts:374] `if (env.NODE_ENV === 'production' && env.ALLOW_LEGACY_TOKENS) {`).

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
