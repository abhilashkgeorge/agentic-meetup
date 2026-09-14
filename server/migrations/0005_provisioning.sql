-- 0005_provisioning: let a device create its own account without owner credentials.
--
-- SAME SHAPE OF PROBLEM AS 0004. Creating the first user for a brand-new tenant runs
-- before any tenant context exists -- creating it is the point -- but
-- app_users_isolation's WITH CHECK compares tenant_id against an unset setting, which
-- is NULL, so the INSERT is rejected by the very policy meant to protect it.
--
-- Same shape of fix: a narrow policy that only matches when the caller has NAMED the
-- tenant it is inserting into, transaction-locally. The caller must have just created
-- that tenant and hold its id, so this cannot be used to insert a user into somebody
-- else's tenant. clone_app stays NOSUPERUSER NOBYPASSRLS.

CREATE POLICY app_users_provisioning ON app_users
  FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.provisioning_tenant_id', true), '')::uuid);
