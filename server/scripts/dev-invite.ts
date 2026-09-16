/**
 * The code that never runs out, for testing the new-account flow.
 *
 * Creates or refreshes one reusable invite. Reusable codes are honoured only while
 * ALLOW_REUSABLE_INVITES is on, and the server refuses to boot with that flag in
 * production -- so this row is inert anywhere but a development machine.
 *
 *   npx tsx scripts/dev-invite.ts            # KNOX-1010
 *   npx tsx scripts/dev-invite.ts SOME-CODE
 */
import { Pool } from 'pg';
import { env } from '../src/env.js';
import { normaliseInviteCode } from '../src/tokens.js';

if (env.NODE_ENV === 'production') {
  console.error('Refusing: this creates a code that makes unlimited accounts.');
  process.exit(1);
}

const code = normaliseInviteCode(process.argv[2] ?? 'knox1010');
const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

await owner.query(
  `INSERT INTO invites (code, note, reusable, expires_at)
   VALUES ($1, 'reusable dev code', true, now() + interval '100 years')
   ON CONFLICT (code) DO UPDATE
     SET reusable = true,
         note = 'reusable dev code',
         expires_at = now() + interval '100 years',
         -- Cleared in case this code was ever spent as an ordinary invite.
         reserved_for = NULL, reserved_at = NULL, used_by = NULL, used_at = NULL`,
  [code],
);

console.log(`reusable invite ready: ${code}`);
console.log(`  type it as "${code}", "${code.replace('-', '').toLowerCase()}" or with spaces --`);
console.log('  the app normalises all three to the same thing.');
console.log(`  honoured only while ALLOW_REUSABLE_INVITES=true (currently ${env.ALLOW_REUSABLE_INVITES}).`);
await owner.end();
