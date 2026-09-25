/**
 * The testing shortcuts work on a laptop, and a production server refuses to start
 * with any of them on.
 *
 * WHAT THE FOUNDER ASKED FOR (build list item 5): "keep KNOX-1010 and console SMS
 * working but development-only -- the server refuses to start in production if either
 * is on; don't delete them."
 *
 * WHY A REAL START, NOT A READ OF THE SOURCE. reusable-invite.test.ts checked that the
 * refusal was WRITTEN in env.ts, with a regex. A refusal that is written but never
 * reached -- behind a wrong condition, or after an early return -- passes that. So this
 * starts the server's settings module for real, in a child process, once with a clean
 * production setup (it must start) and once per shortcut (it must not).
 *
 * THE SHORTCUTS: ALLOW_REUSABLE_INVITES (KNOX-1010), SMS_PROVIDER=console (the code in
 * the server log), SMS_DEV_ECHO (the code in the reply), and ALLOW_UNVERIFIED_SIGNUP
 * (an account without a verified number), which had no refusal until now.
 *
 * Negative controls: drop the ALLOW_UNVERIFIED_SIGNUP refusal from env.ts -> its case
 * here fails, and the others still pass; drop the DOOR/DISCOVERY refusal (item 6) ->
 * both of its cases fail.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ENV_MODULE = pathToFileURL(join(import.meta.dirname, '..', 'src', 'env.ts')).href;
const TSX = import.meta.resolve('tsx');

/** What every start needs, whatever the mode. Never connected to: only parsed. */
const REQUIRED: Record<string, string> = {
  DATABASE_URL: 'postgres://clone_app:x@localhost:5433/clone',
  AUTH_SECRET: randomBytes(32).toString('hex'),
};

/** Everything a production host must set, set safely. Explicit, so .env cannot fill it. */
const SAFE_PRODUCTION: Record<string, string> = {
  ...REQUIRED,
  NODE_ENV: 'production',
  PHONE_PEPPER: randomBytes(32).toString('hex'),
  SMS_PROVIDER: 'twilio',
  SMS_DEV_ECHO: 'false',
  ALLOW_REUSABLE_INVITES: 'false',
  ALLOW_UNVERIFIED_SIGNUP: 'false',
  ALLOW_DEVICE_SIGNUP: 'false',
  ALLOW_LEGACY_TOKENS: 'false',
  SYNTHETIC_AUTO_YES: 'false',
  // Their own narrow roles since 0066 (item 6); never checked for a live connection here.
  DOOR_DATABASE_URL: 'postgres://clone_door:x@localhost:5433/clone',
  DISCOVERY_DATABASE_URL: 'postgres://clone_discovery:x@localhost:5433/clone',
};

/**
 * Start the settings module the way the server does, and say whether it started.
 *
 * FROM OUTSIDE THE SERVER FOLDER, so the module's own .env loading finds no file: a
 * setting this test takes away must stay away, not be filled back in from the
 * developer's .env. Everything it needs is given here (REQUIRED, SAFE_PRODUCTION).
 */
function boot(set: Record<string, string>, unset: string[] = []): { started: boolean; said: string } {
  const env: Record<string, string | undefined> = { ...process.env, ...set };
  for (const k of unset) delete env[k];
  const r = spawnSync(process.execPath,
    ['--import', TSX, '--input-type=module', '-e', `await import(${JSON.stringify(ENV_MODULE)}); console.log('STARTED')`],
    { cwd: tmpdir(), env, encoding: 'utf8', timeout: 60_000 });
  return { started: r.status === 0 && r.stdout.includes('STARTED'), said: `${r.stdout}\n${r.stderr}` };
}

describe('production', () => {
  it('starts when every shortcut is off', () => {
    const r = boot(SAFE_PRODUCTION);
    expect(r.started, r.said).toBe(true);
  }, 60_000);

  it.each([
    ['KNOX-1010, the reusable invite', { ALLOW_REUSABLE_INVITES: 'true' }, 'ALLOW_REUSABLE_INVITES'],
    ['console SMS', { SMS_PROVIDER: 'console' }, 'SMS_PROVIDER'],
    ['the code echoed back', { SMS_DEV_ECHO: 'true' }, 'SMS_DEV_ECHO'],
    ['an account with no verified number', { ALLOW_UNVERIFIED_SIGNUP: 'true' }, 'ALLOW_UNVERIFIED_SIGNUP'],
  ])('refuses to start with %s on', (_what, on, name) => {
    const r = boot({ ...SAFE_PRODUCTION, ...on });
    expect(r.started, `a production server started with ${name} on`).toBe(false);
    expect(r.said).toContain(name);
  }, 60_000);

  // Item 6: sign-in and discovery have their own roles (0066), and no fallback.
  it.each(['DOOR_DATABASE_URL', 'DISCOVERY_DATABASE_URL'])('refuses to start without %s', (name) => {
    const r = boot(SAFE_PRODUCTION, [name]);
    expect(r.started, `a production server started without ${name}`).toBe(false);
    expect(r.said).toContain(name);
  }, 60_000);
});

describe('development', () => {
  it('starts with KNOX-1010 and console SMS on, which is where they are for', () => {
    const r = boot({
      ...REQUIRED, NODE_ENV: 'development', ALLOW_REUSABLE_INVITES: 'true', SMS_PROVIDER: 'console', SMS_DEV_ECHO: 'true',
    });
    expect(r.started, r.said).toBe(true);
  }, 60_000);
});
