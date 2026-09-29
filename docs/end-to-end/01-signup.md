## 1. Install and sign-up

### 1.0 Install

The app is called "Clone" (id `com.clone.app` on both platforms)
([app/app.json:3] `"name": "Clone",`, [app/app.json:25] `"package": "com.clone.app"`).
Today it reaches a phone only as a **development build compiled on the founder's computer**
(`expo run:android` / `expo run:ios`); there is no app-store pipeline in the repository
([app/package.json:60] `"android": "expo run:android",`,
[app/README.md:7] `dev build; Expo Go cannot load the native modules`). The daily loop `./dev.sh`
starts the server, opens a **public tunnel** to it (cloudflared, else ngrok) so friends' phones
can reach it off the founder's Wi-Fi, and starts the app's bundler
([dev.sh:12] `are opened by friends on their own phones, off your WiFi, so a LAN address can never`).

When the app opens, it first checks the server answers (4 seconds); if not, a "Can't reach the
server" screen lets the person type an address. With no saved sign-in it goes to the phone
screen. After sign-in it sends the person to consent if that is not settled, then to setup until
setup is finished on this phone
([app/src/app/_layout.tsx:58] `let reachable = await pingServer(getApiBase());`,
[app/src/app/_layout.tsx:93] `setRoute('phone');`,
[app/src/app/_layout.tsx:146] `if (!consent || !consent.settled) {`,
[app/src/app/_layout.tsx:152] `setRoute((await isOnboarded()) ? null : 'onboarding');`).

### At a glance

| Input | What happens | AI or code? | What gets stored | Who can see it | Code |
|---|---|---|---|---|---|
| Phone number | Normalised; a 6-digit code is made and "sent" | Code | `phone_challenges`: a hash of the number and a hash of the code, 5-minute expiry, caller's IP | Nobody reads it back; only the sign-in role touches this table | [server/src/api/auth.ts:427] `INSERT INTO phone_challenges (phone_hmac, code_hmac, expires_at, created_ip)` |
| The code | Checked (5 tries); a known number signs in, an unknown one needs an invite | Code | The challenge becomes a 15-minute "ticket" | | [server/src/api/auth.ts:533] `SET verified_at = COALESCE(verified_at, now()),` |
| Invite code | Checked; the account is created | Code | `tenants`, `app_users` (number hash, no number), `device_sessions` | The person | [server/src/api/auth.ts:77] `INSERT INTO app_users (id, tenant_id, email, tier, phone_hmac, phone_verified_at)` |
| "I agree" | Three documents accepted | Code | `consents` rows, append-only | The person | [server/src/api/consent.ts:98] `INSERT INTO consents (tenant_id, user_id, document, version)` |

### Arjun and Meera

Nothing in sign-up differs by gender. Both see, in order:

1. **"What's your number?"** with country chips (+91 preselected, +1, +44) and "Text me a code".
   The footer promises: "We text you once. Your number is never shown to anybody, and we keep
   only a scrambled version of it." ([app/src/features/auth/phone-screen.tsx:92] `What's your number?`,
   [app/src/features/auth/phone-screen.tsx:85] `We text you once. Your number is never shown to anybody, and we keep only a`).
2. **"Check your texts"**, "We sent six digits to the number ending <last two digits>." In the
   development setup no text is sent: the founder reads the code from the server's log. (If the
   server were echoing codes back, the box would arrive filled in under a red warning, "The
   server is echoing codes back (SMS_DEV_ECHO). Turn that off before anyone else uses this.";
   that switch is off since 2026-09-28.)
   ([app/src/features/auth/verify-screen.tsx:149] `Check your texts`,
   [app/src/features/auth/verify-screen.tsx:182] `The server is echoing codes back (SMS_DEV_ECHO). Turn that off before anyone`).
3. **"You need a code"**: "Your number is confirmed. Now someone has to let you in. If a friend
   sent you eight characters, put them here." ([app/src/features/auth/invite-screen.tsx:73] `You need a code`).
   In development, the reusable code KNOX-1010 works.
4. **"Before we start"**: three short documents and one button, "I agree". There is no decline
   button: "If you would rather not, close the app — nothing has been set up yet."
   ([app/src/features/consent/consent-screen.tsx:110] `Before we start`,
   [app/src/features/consent/consent-screen.tsx:103] `If you would rather not, close the app — nothing has been set up yet.`).
5. Then setup (stage 2).

### 1.1 Phone and SMS code

- **Normalising:** spaces and dashes removed; a local number is completed for the chosen country
  only (+91: 10 digits) ([shared/src/phone.ts:31] `'+91': { trunk: '0', digits: [10] },`).
  Only +91, +1 and +44 can be texted ([server/src/env.ts:290] `SMS_COUNTRIES: z.string().default('+91,+1,+44'),`).
- **The code:** six random digits, valid 5 minutes, at most 5 guesses
  ([server/src/phone.ts:85] `return String(randomInt(0, max)).padStart(OTP_LENGTH, '0');`,
  [shared/src/phone.ts:110] `export const OTP_TTL_SEC = 300;`,
  [shared/src/phone.ts:122] `export const OTP_MAX_ATTEMPTS = 5;`).
- **Stored:** only hashes. The number is never written to the database; the account keeps a
  keyed hash ([server/src/phone.ts:47] `return createHmac('sha256', PEPPER).update(`).
- **Sending:** the development setup uses the `console` sender, which sends no SMS and writes the
  full number and the code to the server log; `msg91` and `twilio` send real texts
  ([server/src/env.ts:221] `SMS_PROVIDER: z.enum(['console', 'msg91', 'twilio']).default('console'),`,
  [server/src/sms.ts:51] `log.warn({ to, code }, 'SMS (console sender) -- this is the code');`).
  With `SMS_DEV_ECHO=true` the server would also return the code in its reply; it is off in the
  development setup since 2026-09-28
  ([server/src/api/auth.ts:451] `...(env.SMS_DEV_ECHO ? { devCode: code, devEchoIsOn: true } : {}),`).
- **Limits:** per IP 10 codes per 15 minutes; per number 3 per 15 minutes; 500 texts a day in
  total ([server/src/ratelimit.ts:204] `otpSend: { max: 10, windowMs: 15 * 60_000 },`,
  [server/src/ratelimit.ts:206] `otpSendPerPhone: { max: 3, windowMs: 15 * 60_000 },`,
  [server/src/env.ts:297] `SMS_DAILY_CAP: z.coerce.number().default(500),`). These counters live in
  the server's memory and reset when it restarts.
- **Three outcomes** after a right code: a signed-in person adds the number to their account; a
  known number signs straight in (no invite, no consent screen); an unknown number gets a ticket
  for the invite screen ([server/src/api/auth.ts:610] `return c.json({ status: 'signed_in', token: mintToken(sessionId), onboarded });`,
  [server/src/api/auth.ts:615] `return c.json({ status: 'needs_invite', ticket: challengeId, expiresInSec: TICKET_TTL_SEC });`).

### 1.2 Invites

- **Only a new number needs one.** Codes are 8 characters, valid 14 days
  ([server/src/tokens.ts:46] `const ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';`,
  [server/src/env.ts:205] `INVITE_TTL_DAYS: z.coerce.number().default(14),`).
- **Three per person, in all.** An invite that expires unused comes back; the reviewer has no
  limit. In Settings: "Invites · N left", "Make an invite", shared as "Here's a code for Clone:
  <code>" ([server/src/env.ts:212] `INVITES_PER_USER: z.coerce.number().default(3),`,
  [app/src/features/settings/settings-screen.tsx:84] `Here's a code for Clone: ${r.code}`).
- **KNOX-1010** is a reusable development code made by a script; it works only while
  `ALLOW_REUSABLE_INVITES=true` (on in development) and each use makes a new account
  ([server/scripts/dev-invite.ts:25] `VALUES ($1, 'reusable dev code', true, now() + interval '100 years')`,
  [server/src/api/auth.ts:218] `if (env.ALLOW_REUSABLE_INVITES) {`).
- **A production server refuses to start** with any development shortcut on: reusable invites,
  echoed codes, the console SMS sender, legacy tokens, unverified or device sign-up, practice
  profiles saying yes, or a development secret ([server/src/env.ts:374] `if (env.NODE_ENV === 'production' && env.ALLOW_LEGACY_TOKENS) {`,
  [server/src/env.ts:378] `if (env.NODE_ENV === 'production' && env.ALLOW_REUSABLE_INVITES) {`,
  [server/src/env.ts:412] `if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console') {`).

### 1.3 Consent

Three documents, shown in plain words and accepted with one "I agree"
([server/src/api/consent.ts:32] `{ document: 'age', version: '1', title: 'You are 18 or older' },`,
[server/src/api/consent.ts:33] `{ document: 'terms', version: '1', title: 'Terms of use' },`,
[server/src/api/consent.ts:39] `{ document: 'privacy', version: '3', title: 'How your data is used' },`):

- **Age:** "You have to be 18 or older to use this." "We keep the year you were born. Other people
  only ever see your age." ([app/src/features/consent/consent-screen.tsx:37] `'You have to be 18 or older to use this.',`)
- **Terms:** "Be a person. No harassment, no pretending to be somebody else, no pictures that are not
  of you." "Your agent talks to other agents for you. You always make the final call about who you
  meet" ([app/src/features/consent/consent-screen.tsx:42] `Your agent talks to other agents for you. You always make the final call about who you meet`)
- **Privacy** (version 3 since 2026-09-29, so everybody reads it again): "Your clone uses what you tell
  it to represent you to other agents." "Someone your agent meets sees what you mark public, your age,
  your part of town and what you are here for, and whether you fit what they asked for about work,
  exercise, sleep or moving cities." "Your answers to private questions, like faith, drinking or kids,
  help decide who you meet. They are never shown." "Your photos and first name reach a person only after
  you say yes to sharing your profile with them." "In Settings you can read everything it knows about you,
  say what is wrong, and delete the whole account." "If you delete your account, your chats are kept hidden
  for 30 days so the people you talked to can still report you. Only a reviewer reads them, and only after a
  report. Then they are deleted." "What you type and your messages go to AI providers,
  to run your clone and to search what it remembers. We do not sell anything to anybody."
  ([app/src/features/consent/consent-screen.tsx:50] `'Someone your agent meets sees what you mark public, your age, your part of town and what you are here for, and whether you fit what they asked for about work, exercise, sleep or moving cities.',`,
  [server/src/api/consent.ts:39] `{ document: 'privacy', version: '3', title: 'How your data is used' },`)

Stored as append-only rows; the app role cannot change or delete them
([server/migrations/0042_consents_append_only.sql:25] `REVOKE UPDATE, DELETE ON consents FROM clone_app;`).
Consent is also a condition for being sent out (stage 2).

### 1.4 Sessions, the phone's id, and bans at the door

- **Session token:** a random session id plus a signature; checked on every request against the
  session row (not revoked, not expired, owner not banned). It lasts 180 days from creation
  ([server/src/tokens.ts:18] `createHmac('sha256', env.AUTH_SECRET).update(sessionId).digest('base64url');`,
  [server/src/auth.ts:33] `WHERE id = $1 AND revoked_at IS NULL AND expires_at > now() AND NOT is_banned(user_id)`,
  [server/src/env.ts:203] `SESSION_TTL_DAYS: z.coerce.number().default(180),`).
- **An older sign-in method is off:** with `ALLOW_LEGACY_TOKENS` on, a bare account id would be
  accepted as a sign-in token ([server/src/auth.ts:72] `if (/^[0-9a-f-]{36}$/i.test(token)) {`). The
  development setup turns it off (since 2026-09-28), but the code default is still on
  ([server/src/env.ts:199] `.default('true')`). See Known gaps.
- **The phone's id:** at sign-in the app sends a stable phone id (Android ID; on iPhone a random id
  kept in the keychain). The server keeps only a keyed hash
  ([app/src/lib/device.ts:12] `Sent only at the doors (phone verify, invite redeem, device signup, token upgrade)`,
  [server/src/phone.ts:62] `return createHmac('sha256', PEPPER).update(`).
- **Bans at the door:** every way in checks whether the number's hash or the phone's hash is banned;
  the answer is "This account was closed after a report. If you think that is a mistake, write to"
  the support address ([server/src/api/auth.ts:116] `SELECT mark_banned('phone', $1) OR mark_banned('device', $2) AS banned`).

### Docs vs code

- The consent footer says "nothing has been set up yet"; by then the account, the number's hash and a
  session already exist ([server/src/api/auth.ts:249] `provisioned = await provision(body.data.label ?? 'device', userId, phone ?? undefined`).
- The phone screen promises the number is kept only in scrambled form; with the console sender (the
  development default) the full number is written to the server log
  ([app/src/features/auth/phone-screen.tsx:86] `scrambled version of it.`).
- HOW-IT-WORKS.md §11 says every door checks bans "before spending anything"; at the invite step the
  phone ticket is spent before the ban check ([HOW-IT-WORKS.md:876] `before spending anything: a new SIM in a banned phone,`,
  [server/src/api/auth.ts:194] `phone = await phoneSession((db) => spendTicket(db, body.data.ticket!));`).
- `app/README.md` still lists a "signin = dev token" route and says real sign-in and consent are
  "Not built" ([app/README.md:20] `expo-router screens (index = chat, signin = dev token)`).

### Unverified

- Whether any build was ever distributed through TestFlight or the Play Store (none is configured
  in the repository).
