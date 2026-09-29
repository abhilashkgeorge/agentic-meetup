import { z } from 'zod';

// Load .env for local dev. In production the environment is already populated and
// there is no file -- that is not an error.
try {
  process.loadEnvFile();
} catch {
  /* no .env present */
}

const Env = z.object({
  DATABASE_URL: z.string().startsWith('postgres'),
  /** Owner/superuser connection, migrations only. The app never uses this. */
  MIGRATION_DATABASE_URL: z.string().startsWith('postgres').optional(),
  /**
   * The matching connection. A separate role that can SELECT match_profile and
   * dealbreaker preference rows, and nothing else in the database.
   *
   * Matching is the one operation that must read across tenants. Rather than punch a
   * hole in the app role's isolation -- where one forgotten WHERE clause exposes
   * everything -- the crossing gets an identity that has nothing else to reach.
   */
  MATCH_DATABASE_URL: z.string().startsWith('postgres').optional(),
  /**
   * The erasure connection. BYPASSRLS, because proving a row is gone means being able
   * to see one that is not. Optional here and checked at the point of use: an erasure
   * that cannot verify itself must refuse to run, not quietly report success.
   */
  ERASE_DATABASE_URL: z.string().startsWith('postgres').optional(),
  /**
   * The matchmaker connection. Reads public facts across tenants -- which is the one
   * thing running a rendezvous requires and no other session can do -- and writes the
   * rendezvous, its runs and its briefs. Falls back to the app connection, where it
   * simply finds nobody: the correct failure, silent and total.
   */
  MATCHMAKER_DATABASE_URL: z.string().startsWith('postgres').optional(),
  /**
   * The phone door (clone_door, 0066): code hashes, and one look at an account by its
   * number. And background discovery (clone_discovery): ids, counts and times across
   * tenants, never content. Neither falls back to anything -- the owner they used to
   * be is a superuser, and the app role cannot see what they need, so a missing one
   * fails loudly at first use. Production refuses to start without them.
   */
  DOOR_DATABASE_URL: z.string().startsWith('postgres').optional(),
  DISCOVERY_DATABASE_URL: z.string().startsWith('postgres').optional(),
  PORT: z.coerce.number().default(8000),
  /**
   * This server's public name. It cannot be derived from a request: an address built
   * from a LAN IP works on the founder's laptop and nowhere else, which is the kind
   * of bug only found by somebody who cannot reach it. Used by the phone and by the
   * public stats page.
   */
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8000'),
  /**
   * NO DEFAULT, AND THAT IS THE POINT.
   *
   * Six refusals below are written as `NODE_ENV === 'production' && <unsafe thing>`,
   * and every one of them was dead code on a real host. This defaulted to
   * 'development', and nothing in this repo has ever set it: `npm start` is a bare
   * `node dist/index.js`, there is no Dockerfile, no compose service for the app, no
   * CI step and no unit file. So a deployment got the dev signing key, unsigned
   * legacy credentials, the SMS sender that texts nobody, and the flag that returns
   * one-time codes in the response -- with every guard that exists to prevent exactly
   * that silently skipped, because the host never said it was production.
   *
   * Required now, so an unconfigured host refuses to boot instead of booting unsafe.
   * A missing answer is not the same as "development", and treating it as one is how
   * a safety check becomes decoration.
   */
  NODE_ENV: z.enum(['development', 'test', 'production']),

  ANTHROPIC_API_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),
  /**
   * Gemini. Carries the cheap high-volume work AND embeddings, which Anthropic has
   * no endpoint for -- so an all-Anthropic routing has always run with full-text
   * recall only. One key closes both.
   */
  GEMINI_API_KEY: z.string().default(''),
  /**
   * TypeSafe, for System One models (Jev). A different SHAPE of model, not a cheaper
   * one: unstructured state in, typed decisions with calibrated probabilities out. It
   * writes no text at all, so it can never carry a conversation -- see
   * `adapters/typesafe.ts` and the `decide` task.
   */
  TYPESAFE_API_KEY: z.string().default(''),
  TYPESAFE_API_URL: z.string().default('https://api.typesafe.ai/v1/systemone'),

  CHAT_MODEL: z.string().default('anthropic:claude-sonnet-5'),
  EXTRACT_MODEL: z.string().default('anthropic:claude-sonnet-5'),
  RESOLVE_MODEL: z.string().default('anthropic:claude-sonnet-5'),
  REFLECT_MODEL: z.string().default('anthropic:claude-sonnet-5'),
  RENDER_PROFILE_MODEL: z.string().default('anthropic:claude-sonnet-5'),
  CANON_MODEL: z.string().default('anthropic:claude-sonnet-5'),
  /**
   * The typed-decision task. OFF BY DEFAULT and that is deliberate.
   *
   * Empty means every decision keeps running through the prose models it runs through
   * today, so setting nothing changes nothing. Set it to `typesafe:jev-latest` to move
   * the two places that want a calibrated probability rather than a paragraph: mapping
   * a written dealbreaker onto a filter, and the fourth file scorer recorded on every
   * pair for comparison. Nothing else may use it -- it cannot write text.
   */
  DECIDE_MODEL: z.string().default(''),

  EMBEDDING_MODEL: z.string().default('google:gemini-embedding-001'),
  EMBEDDING_DIMENSIONS: z.coerce.number().default(768),
  EMBEDDING_VERSION: z.coerce.number().default(1),

  /**
   * HMAC key for bearer tokens. Rotating it logs every device out, which is the
   * intended break-glass. Defaulted only outside production: a silent default in
   * production would mean every deployment signs with the same well-known key.
   */
  /**
   * Where photo files live. On disk, not in the database: a 300KB JPEG in a row is a
   * 300KB row that every backup, replica and query plan has to carry around.
   */
  PHOTO_DIR: z.string().default('./var/photos'),

  /**
   * The token signing key. NO DEFAULT, for the same reason as NODE_ENV.
   *
   * It used to fall back to a literal committed in this repository. The guard against
   * that was `NODE_ENV === 'production' && startsWith('dev-only')`, which never ran,
   * so the realistic outcome was a public host signing every session with a key
   * anybody could read off GitHub. The pepper for hashed phone numbers is derived
   * from this too, so the same string also made the "we never store your number"
   * promise worthless.
   *
   * Required always. `openssl rand -base64 48` and put it in .env.
   */
  AUTH_SECRET: z.string().min(32),

  /**
   * Open self-signup. Was true for one founder on one laptop; it is false from the
   * moment a second person exists, because an open user-creation endpoint on a
   * public host is a free way to mint tenants and burn the model budget.
   * Accounts now come from invite codes.
   */
  ALLOW_DEVICE_SIGNUP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Accept the old unsigned "bearer token IS the user id" credential, so devices
   * already carrying one can trade it for a real session instead of losing an
   * account. Turn this off once every device has upgraded -- it is a hole with a
   * scheduled end, and a hole without one is just a hole.
   */
  /**
   * Whether an invented profile answers `yes` on behalf of its non-existent human.
   *
   * OFF BY DEFAULT, and that is the fix for a real bug. With it on, a real person who
   * said yes to a practice profile was introduced to it and dropped into a chat that
   * nobody would ever answer. Off, the pair stops at the brief: the agent still went
   * out, the person still saw what a match looks like, and no empty conversation is
   * created.
   *
   * It stays available because the messaging layer is otherwise untestable by hand --
   * turning it on is how the founder walks the whole flow on a real phone.
   */
  /**
   * Who may read reports and hide photographs.
   *
   * A comma-separated list of user ids, and deliberately not a column on `app_users`:
   * a flag in the database can be set by anything that can write to the database,
   * whereas this requires shell access to the machine the server runs on. At one
   * reviewer, that is the right trade. When there are several it becomes a role.
   *
   * Empty means nobody, and the admin routes then 404 for everyone -- which is the
   * correct default for a server that has not been told who is in charge.
   */
  /**
   * The model that judges a rendezvous, when it should not be the one that wrote it.
   *
   * Empty means "the same model as the prober", which is the default and the thing
   * the rendezvous header has always warned about: both sides are one model agreeing
   * with itself. Measured over 47 pairs, agreement was 79.3% against a 50% pass mark.
   *
   * Set it to a model from a different family -- `anthropic:claude-sonnet-5` is the
   * only other priced, in-date option in caps.ts today -- to find out how much of
   * that agreement was the two people and how much was one model. It costs a second
   * provider on the critical path, so it is left off until the free intervention
   * (the calibration in ASSESSOR) has been measured on its own.
   */
  ASSESS_MODEL: z.string().default(''),

  ADMIN_USER_IDS: z.string().default(''),

  SYNTHETIC_AUTO_YES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  ALLOW_LEGACY_TOKENS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /** Days a device session stays valid without being seen. */
  SESSION_TTL_DAYS: z.coerce.number().default(180),
  /** Days an unredeemed invite code stays live. */
  INVITE_TTL_DAYS: z.coerce.number().default(14),
  /**
   * How many people one person may bring in, in all (the founder's item 5: "3 per
   * user"). Used invites count, and so do open ones still in date; one that ran out
   * unused comes back, because it brought nobody. The reviewer has no limit -- in
   * production they are how the first people arrive. Scarcity is the point.
   */
  INVITES_PER_USER: z.coerce.number().default(3),

  /**
   * Phone identity.
   *
   * SMS_PROVIDER picks the sender. 'console' writes the code to the server log and
   * texts nobody, which is the only setting that works with no provider account and
   * is therefore the default.
   */
  SMS_PROVIDER: z.enum(['console', 'msg91', 'twilio']).default('console'),
  /**
   * PUSH_PROVIDER picks how a closed phone is woken (push/send.ts). 'console' writes one
   * line per push to the log -- who and what kind, never a token -- and sends nothing:
   * the default, and all that works before the app has an Expo project and a Firebase
   * key. 'expo' sends through Expo's push service (free; no model is involved). 'off'
   * does nothing.
   */
  PUSH_PROVIDER: z.enum(['off', 'console', 'expo']).default('console'),
  /**
   * The park's voice (park/voice.ts): a LiveKit server, open source, run on this laptop
   * in development (`npm run voice`, livekit.dev.yaml) or hosted. Unset, the park is
   * text only and nothing else changes. LIVEKIT_URL is what the PHONE connects to --
   * ws://localhost:7880 in development, down the USB cable (adb reverse); the server's
   * own calls go to LIVEKIT_API_URL, which defaults to it with http for ws.
   */
  LIVEKIT_URL: z.string().url().optional(),
  LIVEKIT_API_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  /** Optional: Expo's "enhanced push security" access token. Never logged. */
  EXPO_ACCESS_TOKEN: z.string().default(''),

  /**
   * Return the code in the HTTP response.
   *
   * Turns the whole point of a one-time code off: anyone who can reach the route can
   * read the code for any number. It exists because testing the flow on two handsets
   * with no SMS account is otherwise miserable. Refused at boot in production, and
   * the response says plainly that it is on.
   */
  SMS_DEV_ECHO: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * The pepper for hashed phone numbers. See src/phone.ts.
   *
   * Optional, and derived from AUTH_SECRET when unset so an existing deployment keeps
   * working. Set it explicitly before there is real data: once numbers are stored,
   * changing this detaches every account from its owner, so it must NOT be rotated on
   * the same schedule as AUTH_SECRET.
   */
  PHONE_PEPPER: z.string().min(32).optional(),

  /**
   * Countries we will pay to send a text to.
   *
   * WITHOUT THIS, SMS PUMPING. The attack is not hypothetical and not aimed at us:
   * somebody buys a block of premium numbers in a country with high termination fees,
   * points a script at any signup form that texts codes, and takes a cut of the
   * carrier revenue on every message. The bill is ours. An allowlist is the only
   * control that works, because the per-number limit is per NUMBER and they have
   * thousands.
   *
   * Defaults to the three the app actually offers on its own screen. The screen was
   * already limited to these; the server accepted every number on earth.
   */
  /**
   * How many proxies sit in front of this server.
   *
   * Zero means none, so `x-forwarded-for` is ignored completely and the socket's own
   * peer address is used. Anything above zero says how far from the RIGHT of that
   * header the real client sits -- one per hop our own infrastructure adds. Set it to
   * the wrong number and the limit is either useless or applied to the proxy.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(4).default(0),

  SMS_COUNTRIES: z.string().default('+91,+1,+44'),

  /**
   * A hard ceiling on texts per day across everybody, as a last line under the
   * per-IP and per-number limits. Those are both defeatable by spreading the work;
   * this one is not, because it does not care who is asking.
   */
  SMS_DAILY_CAP: z.coerce.number().default(500),

  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),

  /**
   * Whether an account can be made without a verified number.
   *
   * On, redeeming an invite alone still works, which is how every account that
   * predates this migration was made. Off is the destination: a number is the only
   * thing standing between a removed person and a fresh account.
   */
  /**
   * Honour invites marked `reusable`, which are never spent.
   *
   * A code that makes unlimited accounts and never expires is a backdoor, and this
   * is the switch that makes one possible. Off by default and refused at boot in
   * production, so a reusable row restored from a dump behaves as an ordinary
   * single-use invite on a real host.
   */
  ALLOW_REUSABLE_INVITES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  ALLOW_UNVERIFIED_SIGNUP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  ALLOW_UNVERIFIED_PRICING: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DAILY_COST_CAP_USD: z.coerce.number().default(2.0),
  /**
   * "Photos checked": a face model on this machine (photos/face.ts). off = not offered
   * anywhere; tfjs-node = the native TensorFlow binary; wasm = the slower fallback.
   */
  FACE_CHECK: z.enum(['off', 'tfjs-node', 'wasm']).default('off'),
  /** Similarity at or above which two faces are the same person. Set from scripts/face-spike.ts. */
  FACE_MATCH_MIN: z.coerce.number().min(0).max(1).default(0.45),
  TRIAL_TURN_CAP_PER_DAY: z.coerce.number().default(10),
  /**
   * Setup and onboarding calls a day -- the first sentence, "Is this you?", the
   * "couldn't be with" reading, a paste or chat import. They used to count against the
   * ten above, so setting up could use most of a day's calls and the first round then
   * failed (the founder, 2026-09-28: setup must not count). Their own bound instead,
   * roomy for one honest setup and still a stop for a looping client. The daily cost
   * cap covers them as it covers everything.
   */
  SETUP_CALLS_PER_DAY: z.coerce.number().default(40),
  MAX_SESSION_OUTPUT_TOKENS: z.coerce.number().default(60_000),
});

export const env = Env.parse(process.env);

// A default signing key is a convenience in dev and a vulnerability in production.
// Open self-signup is a free way to mint tenants and burn the model budget, and it
// is exactly the flag somebody forgets to turn off on the day they point a domain at
// this. Refusing to start is the only reminder that works.
if (env.NODE_ENV === 'production' && env.ALLOW_DEVICE_SIGNUP) {
  throw new Error(
    'ALLOW_DEVICE_SIGNUP must be false in production. Accounts come from invite codes.',
  );
}

if (env.NODE_ENV === 'production' && env.SYNTHETIC_AUTO_YES) {
  throw new Error(
    'SYNTHETIC_AUTO_YES must be false in production: it introduces real people to '
    + 'conversations with invented ones, which nobody will ever answer.',
  );
}

if (env.NODE_ENV === 'production' && env.ALLOW_LEGACY_TOKENS) {
  throw new Error('ALLOW_LEGACY_TOKENS must be false in production: the old credential is unsigned.');
}

if (env.NODE_ENV === 'production' && env.ALLOW_REUSABLE_INVITES) {
  throw new Error(
    'ALLOW_REUSABLE_INVITES must be false in production: a reusable invite is a code '
    + 'that creates unlimited accounts and never expires.',
  );
}

if (env.NODE_ENV === 'production' && env.SMS_DEV_ECHO) {
  throw new Error(
    'SMS_DEV_ECHO must be false in production: it returns the one-time code to '
    + 'whoever asked for it, which means anyone can sign in as any number.',
  );
}

// A provider that texts nobody is the right default and the wrong production
// setting: every code would sit in the log and no phone would ever ring.
// Sign-in and the background sweepers ran as the superuser until 0066. On a real host
// they must have their own connections; there is deliberately no fallback to use.
if (env.NODE_ENV === 'production' && (!env.DOOR_DATABASE_URL || !env.DISCOVERY_DATABASE_URL)) {
  throw new Error(
    'DOOR_DATABASE_URL and DISCOVERY_DATABASE_URL must be set in production: sign-in and '
    + 'the background sweepers have their own narrow roles (0066), never the owner.',
  );
}

// Every account has a verified number: it is what makes one person one account, and
// what a ban holds against (0065). Skipping it is for a laptop with no SMS account.
if (env.NODE_ENV === 'production' && env.ALLOW_UNVERIFIED_SIGNUP) {
  throw new Error(
    'ALLOW_UNVERIFIED_SIGNUP must be false in production: an account with no verified '
    + 'number is a second account for anybody, and a ban has nothing to hold on to.',
  );
}

if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console') {
  throw new Error('SMS_PROVIDER must be a real provider in production, not "console".');
}

if (env.NODE_ENV === 'production' && env.AUTH_SECRET.startsWith('dev-only')) {
  throw new Error('AUTH_SECRET must be set in production');
}

// `livekit-server --dev` signs with devkey / secret, which anybody can read in its docs:
// a voice pass signed with them is a pass anybody can mint.
if (env.NODE_ENV === 'production' && env.LIVEKIT_API_SECRET === 'secret') {
  throw new Error('LIVEKIT_API_SECRET must be a real secret in production, not the --dev placeholder.');
}

// A DERIVED PEPPER IS ONLY AS GOOD AS WHAT IT IS DERIVED FROM, and it also ties two
// rotations together that must not be tied: AUTH_SECRET can be rotated whenever you
// like, at the cost of everyone signing in again, while rotating the pepper detaches
// every stored number from its owner. Derivation is a convenience for a laptop; on a
// real host the two have to be separate strings.
if (env.NODE_ENV === 'production' && !env.PHONE_PEPPER) {
  throw new Error(
    'PHONE_PEPPER must be set in production. Deriving it from AUTH_SECRET means '
    + 'rotating the signing key silently orphans every account from its phone number.',
  );
}
export type Env = z.infer<typeof Env>;
