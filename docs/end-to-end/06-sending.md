## 6. Sending the agent out

A person asks for a **round**: their agent goes out and meets up to three people who pass
every rule, both ways. The round runs in the background on the server; the phone gets
live updates. Picking who is met is **code**, not a model. By default a round still makes
some model calls (the agents' talk and the want checks, stages 5 and 7).

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| Arjun taps "Send my agent out" | Server re-checks he is ready, may refresh his answer sheet, queues a round | Code, maybe {AI:sheet} | `rounds` row (queued) | Arjun | [server/src/api/dating.ts:896] `.post('/v1/matches/run', async (c) => {` |
| The worker picks the round up (about every 5 s) | SQL finds everyone who passes every rule both ways | Code (SQL) | Nothing yet | Nobody | [server/src/matching/rounds.ts:161] `ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED)` |
| The candidate list | Real people first, then most recently active; people already met are removed; a weekly cap protects busy real people | Code | Nothing yet | Nobody | [server/src/matching/candidates.ts:119] `ORDER BY b.is_synthetic ASC, b.last_active_at DESC` |
| Arjun's untied wants | One call checks them against the first 12; people with a "not met" move later | {AI:wants} + code | Want results kept for the cards | Arjun (on his cards) | [server/src/matching/orchestrator.ts:216] `const order = pre && !target ? demote(shortlist.order, notMetCounts(pre.byId)) : shortlist.order;` |
| The first three who can still be claimed | A pair row is claimed for each; a score is recorded but does not pick | Code | `rendezvous` row per pair, with `rank_score` | Nobody on screen (founder scripts only) | [server/src/matching/orchestrator.ts:237] `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, rank_score)` |
| Each pair | The agents' exchange and the two cards (stages 7 and 8) | {AI:talk} + code | Two card rows per pair | Each person, their own card | [server/src/matching/brief.ts:603] `(rendezvous_id, for_user, headline, overlap_quotes, concern, questions)` |

### Arjun and Meera

1. **Arjun taps "Send my agent out"** on the Home tab, which is a 3D map of Bengaluru (the
   "town") ([app/src/app/(tabs)/index.tsx:1] `export { default } from '../../features/world/world-screen';`,
   [app/src/features/world/hud.tsx:180] `label={active ? 'Your agent is out…' : 'Send my agent out'}`).
   The same button is on the Matches tab ([app/src/features/matches/matches-screen.tsx:253] `label={active ? 'Your agent is out…' : 'Send my agent out'}`).
2. **The server** re-checks that Arjun is ready, refreshes his answer sheet if his
   shareable sentences changed (at most one model call), checks the daily limit and queues
   the round ([server/src/api/dating.ts:907] `return poolNow(db, ctx);`,
   [server/src/api/dating.ts:914] `await ensureSheet(ctx);`,
   [server/src/api/dating.ts:951] `return c.json({ roundId: round.id, status: round.status }, 202);`).
3. **Arjun sees** the button change to "Your agent is out…" and the line "Your agent is
   heading out…" ([app/src/features/world/hud.tsx:112] `? 'Your agent is heading out…'`).
4. **Within about 5 seconds** the worker starts the round. Meera passes every rule both
   ways (below). Real people are listed before practice profiles, so she comes ahead of
   all of them ([server/src/matching/rounds.ts:158] `UPDATE rounds SET status = 'running', started_at = now()`).
5. **Arjun's agent walks to Meera's** on his screen, and his status reads "Your agent is
   out — meeting 3 people". **On Meera's phone**, if the app is open, Arjun's agent walks
   over to hers and the seat reads "Your agent is with them now." Meera did nothing to
   start this ([server/src/matching/orchestrator.ts:275] `type: 'round.met', roundId: null, rendezvousId: pair.rendezvousId,`,
   [app/src/features/world/hud.tsx:114] `Your agent is out — meeting ${talking} ${talking === 1 ? 'person' : 'people'}`,
   [app/src/features/world/agent-sheet.tsx:43] `: agent.state === 'talking' ? 'Your agent is with them now.'`).
6. **When it is done** Arjun sees "Your agent met 3 people. See Matches." and a short replay
   of the agents' exchange as speech bubbles, ending on the date idea and "See the card"
   ([app/src/features/world/world-screen.tsx:238] `Your agent met ${r.met} people. See Matches.`,
   [app/src/features/world/exchange-strip.tsx:83] `label="See the card" variant="primary" onPress={onSeeCard}`).
7. **Meera** finds a new card in her Matches tab with a three-day clock. Whether she can
   read it yet depends on who decides first (stage 9).

### 6.1 The two ways to send

- **"Send my agent out"**: an open round, up to 3 people
  ([server/src/matching/orchestrator.ts:70] `Number(process.env.ROUND_CANDIDATES ?? 3)`).
- **"Send my agent over"**: tap one stranger standing in the square, then this button on
  their sheet. It meets exactly that one person, if they pass every rule
  ([app/src/features/world/agent-sheet.tsx:73] `visits.left > 0 ? 'Send my agent over' : 'No visits left today'`,
  [server/src/matching/orchestrator.ts:129] `if (!(await isCandidate(c, userId, target))) {`).
  A stranger in the square shows no name, age or photo: "Someone in the square", "One of
  the people your agent could meet.", and a neighbourhood
  ([app/src/features/world/agent-sheet.tsx:42] `One of the people your agent could meet.`,
  [app/src/features/world/agent-sheet.tsx:63] `Around {areaName(agent.area)}`).
  The 40 strangers in the square are chosen by the preference score, not real-first
  ([server/src/api/world.ts:175] `ids = (await rank(db, me, fresh, STRANGERS_IN_SQUARE)).map((r) => r.userId);`).

### 6.2 Limits

| Limit | Value in the dev setup | What counts | Code |
|---|---|---|---|
| Open rounds | 1 per rolling 24 hours | Only a finished open round that met at least one person | [server/src/matching/world.ts:45] `Number(process.env.ROUNDS_PER_DAY ?? 1)`, [server/src/matching/rounds.ts:94] `AND result->'metAll' <> '[]'::jsonb` |
| Visits ("send my agent over") | 5 per rolling 24 hours | Every visit asked for, even one that failed | [server/src/matching/world.ts:29] `Number(process.env.TARGETED_ROUNDS_PER_DAY ?? 5)`, [server/src/matching/rounds.ts:78] `WHERE user_id = $1 AND target_user_id IS NOT NULL` |
| One round at a time | A second tap returns the round already running | | [server/src/matching/rounds.ts:101] `ON CONFLICT (user_id) WHERE status IN ('queued', 'running') DO NOTHING` |
| Model spend | $2.00 per person per day | All of that person's model calls | [server/src/env.ts:313] `DAILY_COST_CAP_USD: z.coerce.number().default(2.0),` |
| Model calls | 10 per person per day (`TRIAL_TURN_CAP_PER_DAY=10`) | Every model call: chat, learning and rounds alike | [server/src/metering.ts:97] `SET turns_used = tenant_budget.turns_used + 1,` |

None of `ROUNDS_PER_DAY`, `TARGETED_ROUNDS_PER_DAY`, `ROUND_CANDIDATES`,
`WEEKLY_REAL_EXPOSURE`, `AGENT_TALK` or `RENDEZVOUS_RUNS` is set in the development
configuration, so the code defaults above apply (checked 2026-09-28).

What the person sees when a limit hits: "Your agent has been out enough for today." (spend
or round limit), "That is all the visits for today. Try again tomorrow.", "That person has
moved on.", "Your agent needs a few more answers before it can go out."
([app/src/features/world/world-screen.tsx:35] `budget_exceeded: 'Your agent has been out enough for today.',`,
[app/src/features/world/world-screen.tsx:38] `daily_targets: 'That is all the visits for today. Try again tomorrow.',`,
[app/src/features/world/world-screen.tsx:39] `not_here: 'That person has moved on.',`,
[app/src/features/world/world-screen.tsx:42] `not_ready: 'Your agent needs a few more answers before it can go out.',`).
Because chat and rounds share the same 10-calls-a-day allowance, a person who chatted a lot
can be told their agent "has been out enough for today" when it never went out
([server/src/matching/orchestrator.ts:292] `const outcomes = await metered(spender, 'rendezvous', async () => {`,
[server/src/metering.ts:49] `if (row.turn_cap !== null && row.turns_used >= row.turn_cap) {`).

### 6.3 The rules: who the agent may meet

Every rule is checked in SQL, in one query, with Arjun as `a` and each candidate as `b`
([server/src/matching/candidates.ts:34] `FROM match_profile a, match_profile b`). Almost every rule
lets an **unknown** value pass: someone who never answered is not excluded for it.

| Rule | Arjun → Meera | Meera → Arjun | If unknown | Code |
|---|---|---|---|---|
| Not yourself | | | | [server/src/matching/candidates.ts:36] `AND b.user_id <> a.user_id` |
| Both ready ("in the pool") | Arjun ready | Meera ready | Not ready = out | [server/src/matching/candidates.ts:37] `AND a.in_pool AND b.in_pool` |
| Real and practice | A real person meets practice profiles while `sees_synthetic` is on (the default); practice profiles never meet real people | | | [server/src/matching/candidates.ts:43] `AND (a.is_synthetic = b.is_synthetic OR (a.sees_synthetic AND b.is_synthetic))` |
| Blocks (a report also blocks) | Arjun never blocked Meera | Meera never blocked Arjun | | [server/src/matching/candidates.ts:49] `AND NOT block_exists(a.user_id, b.user_id)` |
| Gender | Meera's gender is in Arjun's "seeking" | Arjun's is in Meera's | Passes | [server/src/matching/candidates.ts:62] `AND (a.seeking_gender = '{}' OR b.gender IS NULL OR b.gender = ANY(a.seeking_gender))`, [server/src/matching/candidates.ts:63] `AND (b.seeking_gender = '{}' OR a.gender IS NULL OR a.gender = ANY(b.seeking_gender))` |
| Age | Meera's age in Arjun's range | Arjun's age in Meera's range | Passes | [server/src/matching/candidates.ts:66] `AND (a.age_min IS NULL OR b.age IS NULL OR b.age >= a.age_min)`, [server/src/matching/candidates.ts:68] `AND (b.age_min IS NULL OR a.age IS NULL OR a.age >= b.age_min)` |
| Distance | Within the **shorter** of the two maximum distances | same | If either person has no location **or no maximum distance**, the rule is skipped for both | [server/src/matching/candidates.ts:74] `OR a.max_distance_km IS NULL OR b.max_distance_km IS NULL`, [server/src/matching/candidates.ts:76] `<= LEAST(a.max_distance_km, b.max_distance_km) * 1000.0)` |
| What they are looking for (intent) | At least one choice in common | same | Passes | [server/src/matching/candidates.ts:79] `AND (a.intent = '{}' OR b.intent = '{}' OR a.intent && b.intent)` |
| Must-haves | Every Arjun must-have passes on Meera | Every Meera must-have passes on Arjun | Passes | [server/src/matching/candidates.ts:91] `AND NOT ${passes('b')})`, [server/src/matching/candidates.ts:95] `AND NOT ${passes('a')})` |
| Recently active | Meera used the app in the last 60 days | (not checked for Arjun; he just tapped) | | [server/src/matching/candidates.ts:98] `AND b.last_active_at > now() - interval '60 days'` |

After the SQL, three more steps remove people:

- **Already met, ever.** Anyone Arjun has a pair with, in any state (declined, expired,
  introduced), is removed. A pair can exist only once
  ([server/src/matching/orchestrator.ts:143] `FROM rendezvous WHERE user_a = $1 OR user_b = $1`,
  [server/migrations/0022_rendezvous.sql:44] `CREATE UNIQUE INDEX rendezvous_pair ON rendezvous (user_a, user_b);`).
- **Weekly exposure cap.** A real person already met by 5 other real people's rounds in the
  last 7 days is skipped. Practice profiles are never capped
  ([server/src/matching/candidates.ts:138] `Number(process.env.WEEKLY_REAL_EXPOSURE ?? 5)`,
  [server/src/matching/candidates.ts:154] `WHERE r.requested_at > now() - interval '7 days'`).
- **Claims.** Two rounds running at once cannot claim the same pair
  ([server/src/matching/orchestrator.ts:239] `ON CONFLICT (user_a, user_b) DO NOTHING`).

"Ready" (`in_pool`) means: the basics answered, all five core cards answered (a "prefer not
to say" counts), consent given, and age 18 or over. A moderator's hide or a ban forces it
off ([server/src/matching/profile.ts:204] `if (!agreed) missing.push('consent');`,
[server/src/matching/profile.ts:206] `const inPool = missing.length === 0 && adult;`,
[server/migrations/0048_filter_defects.sql:53] `NEW.in_pool := false;`). See stage 2.

### 6.4 Picking

- **Order:** real people first, then the most recently active; the round looks at the
  first 500 ([server/src/matching/orchestrator.ts:134] `ids = await candidateIds(c, userId, 500);`).
- **The score records, it does not pick.** For the first 20 people, a preference score
  (`rank_score`) is computed and stored on each pair, for later measurement only
  ([server/src/matching/orchestrator.ts:161] `// PICKED IN THE CANDIDATE QUERY'S ORDER: real people first, then the most recently`,
  [server/src/matching/orchestrator.ts:167] `it just no longer decides who is met.`). The score mixes
  how many of the other person's Really-want / Nice-to-have rules are met with how many
  tags the two share, in both directions, shrunk when little is known
  ([server/src/matching/score.ts:187] `const forwardTotal = 0.6875 * forward.score + 0.3125 * overlap;`,
  [server/src/matching/score.ts:191] `const mutual = Math.sqrt(Math.max(forwardTotal, 0) * Math.max(backwardTotal, 0));`).
  It is never shown to anyone in the app.
- **The only reorder is downward:** the want check can move a candidate later, inside
  their own group (stage 5).
- **Three are claimed**, in order, until three claims succeed (one for a visit)
  ([server/src/matching/orchestrator.ts:230] `const k = target ? 1 : CANDIDATES_PER_ROUND;`).

### 6.5 Real people and practice profiles

- **What practice profiles are.** Invented people, written straight into the matching table
  with no facts and no chat history, under one shared account `__synthetic__`
  ([server/src/matching/synthetic.ts:11] `SYNTHETIC PEOPLE NEVER TOUCH`,
  [server/src/db/seed-synthetic.ts:24] `const TENANT_NAME = '__synthetic__';`). They are sampled
  from hand-written distributions by a script; **no model writes them**
  ([server/src/matching/marginals.ts:13] `So the STRUCTURE is sampled from numbers somebody can argue with, and a model is`,
  [server/src/matching/synthetic-voice.ts:11] `NO MODEL IS CALLED HERE.`). The development database
  holds 5,008 of them, last seeded 2026-09-12 to 14 (query run 2026-09-28). The invented
  names include "Meera" and "Arjun", so a practice card can carry our example names
  ([server/src/matching/synthetic.ts:72] `'Ananya', 'Divya', 'Meera', 'Priya', 'Rhea', 'Sneha', 'Kavya', 'Ishita', 'Tara',`).
- **Who sees them.** Every real person, by default; they are the fallback when too few
  real people fit ([server/migrations/0037_practice_profiles.sql:51] `UPDATE match_profile SET sees_synthetic = true WHERE NOT is_synthetic;`).
- **How they are labelled.** "Practice match — this one is not a real person." on the card,
  "Practice match / Not a real person" in lists, their lines marked "(practice)", and the
  reveal says "This is not a real person. The pool is invented until enough people have
  joined…" ([app/src/features/matches/matches-screen.tsx:323] `Practice match — this one is not a real person.`,
  [app/src/features/matches/exchange.ts:47] `${s.text} (practice)`,
  [app/src/features/matches/reveal-screen.tsx:172] `This is not a real person. The pool is invented until enough people have`).
- **They never say yes** in this setup. A switch (`SYNTHETIC_AUTO_YES`) could make them, and a
  production server refuses to start with it on
  ([server/src/env.ts:337] `if (env.NODE_ENV === 'production' && env.SYNTHETIC_AUTO_YES) {`).

### Docs vs code

- HOW-IT-WORKS.md §4 says "Seven rules, and nothing else may exclude anybody". The code
  also excludes by readiness, "already met ever", the weekly cap and claims
  ([HOW-IT-WORKS.md:196] `**Seven rules, and nothing else may exclude anybody:**`,
  [server/src/matching/orchestrator.ts:156] `const pickable = fresh.filter((id) => !capped.has(id));`).
- HOW-IT-WORKS.md §4 says every rule is symmetric and distance uses "the shorter of the two".
  "Recently active" is checked on the candidate only, and the distance rule is skipped
  entirely when either person has no maximum distance
  ([HOW-IT-WORKS.md:204] `| distance | the **shorter** of the two willingnesses |`,
  [server/src/matching/candidates.ts:74] `OR a.max_distance_km IS NULL OR b.max_distance_km IS NULL`).
- HOW-IT-WORKS.md §10 says rounds are limited by the round count "instead of by spend". The
  daily spend and call caps can still refuse a round
  ([HOW-IT-WORKS.md:818] `what the person said has changed -- §7a). Rounds are limited by`,
  [server/src/metering.ts:47] `throw new BudgetExceeded('daily_cost', spent, costCap)`).
- Several code comments still say a round makes no model call
  ([server/src/api/dating.ts:890] `A round makes no model call (orchestrator.ts), so what limits it`,
  [server/src/matching/answer-sheet.ts:24] `still makes zero model calls.`). By default it makes the
  talk and want-check calls.
- HOW-IT-WORKS.md §9 says a model may write the prose for invented people. No model is
  used ([HOW-IT-WORKS.md:789] `hand-written distributions that are reviewable in a diff; a model is only ever allowed to`).

### Unverified

- What a round costs today: no round has run since the talk was added on 2026-09-24 (the
  last rounds on the development database are from 2026-09-22; query run 2026-09-28).
