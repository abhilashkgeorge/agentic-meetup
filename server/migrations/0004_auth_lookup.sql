-- 0004_auth_lookup: let authentication resolve a user WITHOUT privileged credentials.
--
-- THE PROBLEM. Authentication is the thing that ESTABLISHES tenant context, so it
-- necessarily runs before any context exists. But `app_users` is under RLS keyed on
-- tenant_id, and with no context set the policy evaluates NULL and returns zero rows.
-- Auth could never succeed. (This was latent from the first migration and would have
-- blocked the very first real request.)
--
-- THE WRONG FIX would be to give the application an owner or BYPASSRLS connection for
-- this one query. That hands the whole app a permanent RLS escape hatch to solve a
-- single lookup, and every future bug on that path becomes a full cross-tenant read.
--
-- THE FIX. A second policy that only matches when the caller has named the EXACT row
-- it wants, transaction-locally. The caller must already possess the id, so this
-- cannot enumerate: with no `app.auth_lookup_id` set it matches nothing, and with one
-- set it matches at most that single row. `clone_app` stays NOSUPERUSER NOBYPASSRLS.

CREATE POLICY app_users_auth_lookup ON app_users
  FOR SELECT
  USING (id = NULLIF(current_setting('app.auth_lookup_id', true), '')::uuid);
