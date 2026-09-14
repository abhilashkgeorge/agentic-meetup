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
  PORT: z.coerce.number().default(8000),
  /**
   * This server's public name. It cannot be derived from a request: an address built
   * from a LAN IP works on the founder's laptop and nowhere else, which is the kind
   * of bug only found by somebody who cannot reach it. Used by the phone and by the
   * public stats page.
   */
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  ANTHROPIC_API_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),
  /**
   * Gemini. Carries the cheap high-volume work AND embeddings, which Anthropic has
   * no endpoint for -- so an all-Anthropic routing has always run with full-text
   * recall only. One key closes both.
   */
  GEMINI_API_KEY: z.string().default(''),

  CHAT_MODEL: z.string().default('anthropic:claude-sonnet-5'),
  EXTRACT_MODEL: z.string().default('anthropic:claude-sonnet-5'),
  RESOLVE_MODEL: z.string().default('anthropic:claude-sonnet-5'),
  REFLECT_MODEL: z.string().default('anthropic:claude-sonnet-5'),
  RENDER_PROFILE_MODEL: z.string().default('anthropic:claude-sonnet-5'),
  CANON_MODEL: z.string().default('anthropic:claude-sonnet-5'),

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

  AUTH_SECRET: z.string().min(32).default('dev-only-insecure-secret-change-me-32ch'),

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
  /** How many invites one person may have outstanding. Scarcity is the point. */
  INVITES_PER_USER: z.coerce.number().default(5),

  ALLOW_UNVERIFIED_PRICING: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DAILY_COST_CAP_USD: z.coerce.number().default(2.0),
  TRIAL_TURN_CAP_PER_DAY: z.coerce.number().default(10),
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

if (env.NODE_ENV === 'production' && env.AUTH_SECRET.startsWith('dev-only')) {
  throw new Error('AUTH_SECRET must be set in production');
}
export type Env = z.infer<typeof Env>;
