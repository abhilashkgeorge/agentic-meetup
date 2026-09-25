# Rotating the credentials

Everything in this project sat on disk in a directory with no `.gitignore` for the
whole of its life. Nothing was ever committed — the repository had no commits at all
until 2026-09-14 — so nothing leaked into git history. But the keys have been readable
by anything that could read the filesystem, for months, and one `git add .` away from
being permanent. **Treat them as exposed and rotate them.**

This is the one item on the list nobody else can do for you: it needs your Google and
Anthropic accounts.

Verify the result with `npx tsx scripts/check-keys.ts`, which connects as every
database role, probes the routed model with a single token, and prints no secret.

---

## 1. Gemini — the one that matters

This is the key that spends money. It is `GEMINI_API_KEY` and carries every model call
in the product.

1. <https://aistudio.google.com/apikey>
2. Create a new key. Copy it.
3. Put it in `server/.env` as `GEMINI_API_KEY=…`
4. **Delete the old key from that page.** Creating a new one does not disable the old
   one, and a key you have replaced but not revoked is a key that still works.
5. `npx tsx scripts/check-keys.ts` — the provider line should say `answered`.

## 2. Anthropic

`ANTHROPIC_API_KEY`. Nothing routes to it today, so this can wait — but it is a live
credential and it has been on disk just as long.

1. <https://console.anthropic.com/settings/keys>
2. Create a new key, paste it into `server/.env`, then **revoke the old one**.

If you set `ASSESS_MODEL=anthropic:claude-sonnet-5` to break the rendezvous model
symmetry, this key moves onto the critical path and stops being optional.

## 3. The database passwords

Every role currently uses its own name as its password: `clone_app:clone_app`,
`clone_matchmaker:clone_matchmaker`, and so on. `check-keys.ts` prints
`(password equals the role name)` next to each one so this cannot be forgotten.

That is fine for a database listening on localhost on your laptop. It is not fine the
moment Postgres is reachable from anywhere else, and the passwords are written in
plain text inside migrations `0000`, `0019`, `0026` and `0028`, which are committed.

Those migrations have already run, so **editing them changes nothing** — they are
history. Rotate the live roles instead, and keep the new passwords out of the repo:

```sh
# pick real ones; these are placeholders
psql "$MIGRATION_DATABASE_URL" <<'SQL'
ALTER ROLE clone_app        PASSWORD 'REPLACE_ME_1';
ALTER ROLE clone_match      PASSWORD 'REPLACE_ME_2';
ALTER ROLE clone_matchmaker PASSWORD 'REPLACE_ME_3';
ALTER ROLE clone_eraser     PASSWORD 'REPLACE_ME_4';
ALTER ROLE clone            PASSWORD 'REPLACE_ME_5';
ALTER ROLE clone_door       PASSWORD 'REPLACE_ME_6';
ALTER ROLE clone_discovery  PASSWORD 'REPLACE_ME_7';
SQL
```

Then update the URLs in `server/.env` (DOOR_ and DISCOVERY_DATABASE_URL too, since
0066) and re-run `check-keys.ts`. Every role must
still connect, and `(password equals the role name)` must be gone from every line.

When you deploy for real, the passwords should come from the host's secret store and
never be typed into `.env` at all.

## 4. The one told to a chat window

A database password was pasted into a conversation earlier in this project's life.
Anything said to a third party is out of your control regardless of what that party
does with it. Step 3 covers it; do not skip it on the grounds that the database is
only on localhost today.

---

## What is already done

- `.gitignore` covers `.env`, `.env.*` (keeping `.env.example`), `*.pem`, `*.key`,
  `*.p8`, `*.p12`, `*.jks`, `node_modules/`, `.expo/`, the Graphiti virtualenv and
  `/server/var/` (uploaded photographs).
- The whole committable tree was scanned for key-shaped strings before the first
  commit: clean.
- `ALLOW_DEVICE_SIGNUP=false`, so a leaked key cannot be paired with open signup.
- Every unauthenticated route is rate limited.

## 5. The signing key is still the public dev default

`AUTH_SECRET` no longer has a default, so the server refuses to boot without one.
`.env` now sets it explicitly to `dev-only-insecure-secret-change-me-32ch` — the
string that used to be the fallback, and which is committed in this repository.

**It is written out rather than changed on purpose.** Every session token on both
handsets is signed with it, and until an account has a phone number attached there
is no way back in through the app. Rotating it today would sign both phones out with
no recovery path.

The order that works:

1. Open the app on each phone and verify a number. That attaches it to the account.
2. Generate a real key: `openssl rand -base64 48`.
3. Put it in `.env` as `AUTH_SECRET` and restart.
4. Both phones sign in again by number. Nothing is lost.

`PHONE_PEPPER` is already random and must NOT be rotated on the same schedule.
Rotating the signing key costs everyone a sign-in. Rotating the pepper detaches every
account from its number, permanently, with no way to recompute the link.
