import { Pool } from 'pg';
import { env } from '../src/env.js';
import { mintToken } from '../src/tokens.js';
const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const { rows } = await owner.query<{ id: string }>(
  `SELECT id FROM device_sessions
    WHERE user_id = (SELECT id FROM app_users WHERE email = $1)
      AND revoked_at IS NULL AND expires_at > now()
    ORDER BY last_seen_at DESC NULLS LAST LIMIT 1`, [process.argv[2] ?? 'abhilash@dabba.com']);
if (!rows[0]) { console.error('no live device session'); process.exit(1); }
console.log(mintToken(rows[0].id));
await owner.end();
