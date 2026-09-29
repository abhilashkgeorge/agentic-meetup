/**
 * Removing a test's own people. A report no longer goes with the account it is about
 * (0079: reports against somebody outlive their account), so deleting a test's tenants
 * would leave its reports behind in the tests' database, unowned, for every later run to
 * wade through -- the review queue among them. Their reports go first, then the tenants.
 */
import type { Pool } from 'pg';

export async function removeTenants(owner: Pool, tenantIds: readonly string[]): Promise<void> {
  if (!tenantIds.length) return;
  await owner.query(
    `DELETE FROM reports
      WHERE reporter_id IN (SELECT id FROM app_users WHERE tenant_id = ANY($1))
         OR reported_id IN (SELECT id FROM app_users WHERE tenant_id = ANY($1))`, [tenantIds]);
  await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [tenantIds]);
}
