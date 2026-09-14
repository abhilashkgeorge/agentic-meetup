/** Creates a tenant + user and prints the dev bearer token. `npm run seed -- you@example.com` */
import { Pool } from 'pg';
import { env } from '../env.js';

const email = process.argv[2] ?? 'founder@example.com';
const pool = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

const t = await pool.query<{ id: string }>(
  `INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [email],
);
const u = await pool.query<{ id: string }>(
  `INSERT INTO app_users (tenant_id, email, tier) VALUES ($1, $2, 'paid') RETURNING id`,
  [t.rows[0]!.id, email],
);
await pool.end();

console.log(`tenant  ${t.rows[0]!.id}`);
console.log(`user    ${u.rows[0]!.id}`);
console.log(`\nDev token (W1 shim: the token IS the user id):\n  ${u.rows[0]!.id}`);
console.log(`\n  wscat -c 'ws://localhost:8000/v1/chat?token=${u.rows[0]!.id}'`);
