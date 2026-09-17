# CLAUDE.md

Agentic dating app. Every person has an AI clone built from their own words; clones meet
each other and decide whether the two humans should. One founder, one repo, phones on
the desk. Design history lives in `ARCHITECTURE.md` and `ENGINE-DECISION.md`; the
credential story in `server/ROTATION.md`. This file is the working rules.

## Layout and commands

| Package  | What                                   | Run                                              |
|----------|----------------------------------------|--------------------------------------------------|
| `shared` | types, predicates, value shapes, phone | `npm run typecheck` (root: builds shared+server) |
| `server` | Hono + Postgres/pgvector, TypeScript   | `npm run dev` · `npm run migrate` · `npm test`   |
| `app`    | Expo SDK 57 / React Native             | `npm run android` · `cd app && npx vitest run`   |

Use root `npm run typecheck` (server `src/` + shared, clean), not `tsc -b --force` at the
root: that also covers `spike/`, `server/scripts` and `server/tests`, which carry 11 known
errors that are nobody's job. Native deps in `app` go in with
`npx expo install <pkg>`, never a hand-picked version (wrong `expo-location` broke the
Android build once). Temp files go in `$CLAUDE_JOB_DIR/tmp` when running as a job.

## Talking to the founder

Short sentences, common words, lead with the answer. He is not a reader; a long dense
answer is the same as no answer. One caveat, the one that changes what he should do, not a
list. Offer the long version instead of dumping it. Code, commits and security warnings are
written normally.

- Never echo a phone number back, even one he pasted in a log line.
- Do not spend model credits on anything but the app itself. Tests stub the model
  (`vi.mock('../src/llm/index.js')`); scripts that read the database call no model.
- Never delete data unless asked. Empty tables and orphan rows are reported, not removed.
- Legal and compliance questions are his to handle; raise once, do not block on them.

## Database

Row-level security is the isolation boundary. The app connects as `clone_app`; matching
reads as `clone_match`; rounds run as `clone_matchmaker`; erasure as `clone_eraser`. The
owner `clone` (superuser) is used only by migrations and by `phoneSession` /
`discoverySession`, which need cross-tenant reads before a tenant exists. Every query goes
through a helper in `server/src/db/client.ts` — `tenantSession`, `matchSession`,
`matchmakerSession`, `adminSession`, `provisioningSession`, `phoneSession`,
`discoverySession`, `eraseSession`. `adminSession` is `clone_app` with no tenant context,
not the owner pool; RLS still applies and matches nothing on tenant-scoped tables.

- Migration `0000` runs `ALTER DEFAULT PRIVILEGES`: every new table gives `clone_app` all
  four privileges unless the migration takes them back. **Every new table needs an
  explicit REVOKE for each role that should not touch it**, and a policy if it carries a
  user or tenant column. `tests/schema-shape.test.ts` checks the live catalogue.
- `facts` and `episodes` are hash-partitioned 32 ways (`facts_p0`…). Never name a
  partition in a query; the roles cannot see them by name and that is deliberate (0035).
- Migrations are numbered, applied once, and immutable after commit. The header comment
  says WHAT was wrong, HOW it was measured, and WHY this fix — read 0035, 0047, 0053 for
  the shape. Fixing a committed migration means a new one.
- A table that holds user rows goes in `USER_TABLES` in `server/src/memory/erasure.ts`;
  `tests/erasure-coverage.test.ts` fails if it is missed.
- Every model call goes through `llm.complete` in `server/src/llm/index.ts`, which is the
  metering choke point. `modelFor(task)` picks the model; nothing calls a vendor SDK
  directly. `llm_calls.estimated` marks rows without measured tokens.

## Tests are guards, or they are decoration

Every fix ships with a test that plants the failing case and fails on the old code. Then
run the negative control: revert the fix, watch the test fail, restore it, and say so in
the commit. A test that passed on the old code proved nothing (it has happened: a filter
test that returned `[]` under the wrong role, an ordering test that passed by insertion
luck). When behaviour cannot be observed — query counts, a dropped term — assert the
source shape with comments stripped, and say why in the test.

- Fixtures are inserted through an owner `Pool`; the code under test runs through the real
  role session. Isolate scenes with a unique `intent` tag; clean up tenants in `afterAll`.
- Round tests call `converse()`, which sleeps between runs: `vi.setConfig({ testTimeout })`.
- Numbers in a report come from a query run now, not from memory of a previous run.

## Commits

Subject: one plain sentence about what changed for a person ("Fix five hard-filter
defects that never threw"). Body: what was wrong, how it was found, what was measured,
what was deliberately left alone. End with:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: <session url>
```

Commit only when asked. The founder runs the phones; say what to tap after a change.

## The matching mechanism is measured, not argued

Every pair carries three scores before the humans look (`rank_score`, `llm_file_score`,
`agreement`) and the humans' answers after. `server/scripts/compare-scorers.ts` reports
which one predicts a yes; it needs ~50 real decisions before it is a finding. Do not show
a percentage to a human (OkCupid 2014: the number changes behaviour more than it predicts
it). The plan and its literature are in the commit messages from `64f549e` to `c373d30`.

## Release blockers (safe on a laptop, not anywhere else)

1. Rotate every key per `server/ROTATION.md` §5 — only AFTER both phones have a number
   attached (Settings → "Add your phone number"), because rotation logs them out.
2. Delete the reusable dev invite `KNOX-1010` and all its machinery: `scripts/dev-invite.ts`,
   the `reusable` column and row, `ALLOW_REUSABLE_INVITES`, the redeem branch, its test.
3. Move `phoneSession` / `discoverySession` off the superuser onto a dedicated owner role.
4. Set a real `SMS_PROVIDER`; `console` prints codes to the server log.
