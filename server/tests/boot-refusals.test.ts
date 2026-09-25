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
 * Negative control: drop the ALLOW_UNVERIFIED_SIGNUP refusal from env.ts -> its case
 * here fails, and the others still pass.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const SERVER = join(import.meta.dirname, '..');

/** Everything a production host must set, set safely. Explicit, so .env cannot fill it. */
const SAFE_PRODUCTION: Record<string, string> = {
  NODE_ENV: 'production',
  AUTH_SECRET: randomBytes(32).toString('hex'),
  PHONE_PEPPER: randomBytes(32).toString('hex'),
  SMS_PROVIDER: 'twilio',
  SMS_DEV_ECHO: 'false',
  ALLOW_REUSABLE_INVITES: 'false',
  ALLOW_UNVERIFIED_SIGNUP: 'false',
  ALLOW_DEVICE_SIGNUP: 'false',
  ALLOW_LEGACY_TOKENS: 'false',
  SYNTHETIC_AUTO_YES: 'false',
};

/** Start the settings module the way the server does, and say whether it started. */
function boot(env: Record<string, string>): { started: boolean; said: string } {
  const r = spawnSync(process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', "await import('./src/env.ts'); console.log('STARTED')"],
    { cwd: SERVER, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60_000 });
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
});

describe('development', () => {
  it('starts with KNOX-1010 and console SMS on, which is where they are for', () => {
    const r = boot({
      NODE_ENV: 'development', ALLOW_REUSABLE_INVITES: 'true', SMS_PROVIDER: 'console', SMS_DEV_ECHO: 'true',
    });
    expect(r.started, r.said).toBe(true);
  }, 60_000);
});
