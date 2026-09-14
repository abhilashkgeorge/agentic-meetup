/**
 * Fill the pool with synthetic people.
 *
 *   npm run seed:synthetic            500, the default
 *   npm run seed:synthetic -- 5000    once the gates pass at 500
 *   npm run seed:synthetic -- 0       remove them all
 *
 * Start at 500. The quality gates will fail the first few times and iterating at 500
 * is fast; scaling to 5,000 before they pass just makes the failures slower.
 */
import { Pool } from 'pg';
import { env } from '../env.js';
import { assess, loadProfiles, makeProfile, rng } from '../matching/synthetic.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const count = Number(process.argv[2] ?? 500);
const SEED = Number(process.env.SYNTHETIC_SEED ?? 20260912);

/**
 * One tenant for all of them. They share no data and cannot be reached by anybody,
 * so per-tenant isolation buys nothing here and 5,000 tenants would make every
 * cross-tenant count in the system misleading.
 */
const TENANT_NAME = '__synthetic__';

const { rows: existing } = await owner.query<{ id: string }>(
  `SELECT id FROM tenants WHERE name = $1`, [TENANT_NAME],
);
let tenantId = existing[0]?.id;

if (count === 0) {
  if (tenantId) {
    const { rowCount } = await owner.query(
      `DELETE FROM match_profile WHERE is_synthetic AND tenant_id = $1`, [tenantId],
    );
    console.log(`removed ${rowCount} synthetic profiles`);
  } else {
    console.log('none to remove');
  }
  await owner.end();
  process.exit(0);
}

if (!tenantId) {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [TENANT_NAME],
  );
  tenantId = rows[0]!.id;
}

// Replaced wholesale rather than added to, so a run is reproducible from its seed.
await owner.query(`DELETE FROM match_profile WHERE is_synthetic AND tenant_id = $1`, [tenantId]);

const r = rng(SEED);
const profiles = Array.from({ length: count }, () => makeProfile(r, tenantId!));

const report = assess(profiles);
console.log(`\ngenerated ${report.count} profiles (seed ${SEED})\n`);
for (const [axis, dist] of Object.entries(report.distributions)) {
  const top = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  ${axis.padEnd(20)} ${top.map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join('  ')}`);
}
console.log(`\n  fields left blank      ${(report.missingRate * 100).toFixed(1)}%`);
console.log(`  distinct interest sets ${report.distinctInterestSets} of ${report.count}`);

// THE GATES. A collapsed pool looks completely fine profile by profile; the only way
// to catch it is to measure the spread and refuse to load on it.
const failures: string[] = [];

// Mode collapse: if most people share an interest list, the pool is one person.
const variety = report.distinctInterestSets / report.count;
if (variety < 0.9) failures.push(`interest variety ${(variety * 100).toFixed(0)}% (needs 90%+)`);

// No holes means the "unknown is not a mismatch" path never runs, which is the one
// line that decides whether a real pool is empty.
if (report.missingRate < 0.1) failures.push(`only ${(report.missingRate * 100).toFixed(1)}% of fields blank (needs 10%+)`);

// Any axis where one value takes most of the pool has stopped being a variable.
for (const [axis, dist] of Object.entries(report.distributions)) {
  const top = Math.max(...Object.values(dist));
  if (top > 0.7) failures.push(`${axis} is ${(top * 100).toFixed(0)}% one value`);
}

if (failures.length) {
  console.error('\nGATES FAILED — nothing loaded:');
  for (const f of failures) console.error(`  ✗ ${f}`);
  await owner.end();
  process.exit(1);
}

const loaded = await loadProfiles(await owner.connect(), profiles);
console.log(`\n  loaded ${loaded} into the pool ✓\n`);
await owner.end();
